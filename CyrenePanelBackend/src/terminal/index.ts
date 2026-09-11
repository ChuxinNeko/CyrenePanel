import { Elysia } from "elysia";
import { spawn } from "bun-pty";
import type { IPty } from "bun-pty";
import { logger } from "../logger/index";
import { nodeCan } from "../node-auth/verifier";
import { resolveNodePrincipal } from "../node-auth/principal";
import { consumeTicket, issueTicket, type TicketPurpose } from "./ticket";

const TICKET_PURPOSES: TicketPurpose[] = ["system", "docker-exec", "instance"];

/**
 * 系统终端 WebSocket 路由
 * 通过 bun-pty 在服务器上创建伪终端，用户可在浏览器中交互
 */
export const terminalRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  /**
   * 签发终端 WS 一次性票据。三种终端（系统 / docker exec / 实例）共用这一个入口。
   * 走带 Bearer 头的普通 HTTP（经前端代理），JWT 不进 URL；返回的票据 20 秒内、
   * 一次性有效，前端拿到后立刻用它开 WS。
   */
  .post("/api/terminal/ticket", async ({ profile, body }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const purpose = body?.purpose;
    if (!TICKET_PURPOSES.includes(purpose)) {
      return { success: false, message: "无效的票据用途" };
    }
    // 系统终端 = root shell，签发时就要求管理员，不给非管理员留任何路径
    if (purpose === "system" && profile.role !== "admin") {
      logger.warn(`[安全] 用户 ${profile.username || "?"}(role=${profile.role || "?"}) 申请系统终端票据，已拒绝`);
      return { success: false, message: "需要管理员权限" };
    }
    const { ticket, expiresIn } = issueTicket({
      username: profile.username || "",
      role: profile.role || "",
      purpose,
    });
    return { success: true, ticket, expiresIn };
  })

  .ws("/api/terminal", {
    async beforeHandle({ request }: any) {
      // 节点间签名调用（主节点代理到子节点），能力校验已在 nodeCan 内完成
      const principal = await resolveNodePrincipal(request);
      if (principal && nodeCan(principal, "system:update")) return;

      const url = new URL(request.url);
      const ticket = consumeTicket(url.searchParams.get("ticket"), "system");
      if (!ticket) {
        return new Response("Unauthorized", { status: 401 });
      }
      // 票据在签发时已限管理员，这里再核一次做纵深防御
      if (ticket.role !== "admin") {
        logger.warn(`[安全] 用户 ${ticket.username || "?"}(role=${ticket.role || "?"}) 尝试打开系统终端，已拒绝`);
        return new Response("Forbidden", { status: 403 });
      }
    },

    open(ws) {
      logger.info("终端 WebSocket 客户端已连接");

      try {
        // 根据平台选择 shell
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "powershell.exe" : (process.env.SHELL || "/bin/bash");

        const ptyProcess: IPty = spawn(shell, [], {
          name: "xterm-256color",
          cols: 80,
          rows: 30,
          cwd: process.env.HOME || process.env.USERPROFILE || process.cwd(),
        });

        // 将 pty 实例挂到 ws.data 上
        (ws.data as any).ptyProcess = ptyProcess;
        (ws.data as any).connected = true;

        logger.info(`[PTY] 创建成功，pid=${ptyProcess.pid}, shell=${shell}`);

        // pty 输出 → WebSocket
        ptyProcess.onData((data: string) => {
          if ((ws.data as any).connected) {
            try {
              ws.send(JSON.stringify({ type: "output", data }));
            } catch {
              // 忽略发送失败
            }
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          if ((ws.data as any).connected) {
            try {
              ws.send(JSON.stringify({ type: "exit", code: exitCode }));
            } catch {
              // 忽略
            }
          }
          logger.info(`终端进程已退出，退出码: ${exitCode}`);
        });

        // 通知客户端终端已就绪
        ws.send(JSON.stringify({ type: "ready" }));

      } catch (err: any) {
        logger.err(`终端创建失败: ${err.message}`);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
        ws.close();
      }
    },

    message(ws, message: any) {
      const ptyProcess: IPty | undefined = (ws.data as any).ptyProcess;
      if (!ptyProcess) return;

      try {
        // Elysia/Bun 会自动将 JSON 字符串解析为对象
        if (typeof message === "object" && message !== null && !(message instanceof ArrayBuffer) && !(message instanceof Uint8Array)) {
          switch (message.type) {
            case "input":
              if (message.data) {
                ptyProcess.write(message.data);
              }
              return;
            case "resize":
              if (message.cols && message.rows) {
                try {
                  ptyProcess.resize(message.cols, message.rows);
                } catch {
                  // 忽略 resize 错误
                }
              }
              return;
            case "ping":
              ws.send(JSON.stringify({ type: "pong" }));
              return;
          }
        }

        // 处理字符串/Buffer 消息
        let text: string;
        if (typeof message === "string") {
          text = message;
        } else if (Buffer.isBuffer(message) || message instanceof Uint8Array) {
          text = new TextDecoder().decode(message);
        } else if (message instanceof ArrayBuffer) {
          text = new TextDecoder().decode(message);
        } else {
          text = String(message);
        }

        // 尝试解析为 JSON
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch {}

        if (parsed?.type) {
          switch (parsed.type) {
            case "input":
              if (parsed.data) ptyProcess.write(parsed.data);
              break;
            case "resize":
              if (parsed.cols && parsed.rows) {
                try { ptyProcess.resize(parsed.cols, parsed.rows); } catch {}
              }
              break;
            case "ping":
              ws.send(JSON.stringify({ type: "pong" }));
              break;
            default:
              ptyProcess.write(text);
              break;
          }
        } else {
          ptyProcess.write(text);
        }
      } catch (err: any) {
        logger.err(`终端消息处理错误: ${err.message}`);
      }
    },

    close(ws) {
      (ws.data as any).connected = false;
      const ptyProcess: IPty | undefined = (ws.data as any).ptyProcess;
      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch {
          // 忽略
        }
      }
      logger.info("终端 WebSocket 客户端已断开");
    },
  });