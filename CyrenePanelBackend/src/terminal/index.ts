import { Elysia } from "elysia";
import { spawn } from "bun-pty";
import type { IPty } from "bun-pty";
import { logger } from "../logger/index";

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

  .ws("/api/terminal", {
    async beforeHandle({ jwt, request }: any) {
      const url = new URL(request.url);
      const token =
        url.searchParams.get("token") ||
        request.headers.get("authorization")?.replace("Bearer ", "");

      if (!token) {
        return new Response("Unauthorized", { status: 401 });
      }

      const profile = await jwt.verify(token);
      if (!profile) {
        return new Response("Unauthorized", { status: 401 });
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