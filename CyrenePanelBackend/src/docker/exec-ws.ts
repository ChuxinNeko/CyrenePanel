/**
 * 容器内终端（docker exec）WebSocket
 *
 * 复用 bun-pty，在伪终端里跑 `docker exec -it <container> <shell>`，
 * 与系统终端 (terminal/index.ts) 同一套协议：
 *   客户端 -> { type: "input" | "resize" | "ping" }
 *   服务端 -> { type: "ready" | "output" | "exit" | "error" }
 */

import { Elysia } from "elysia";
import { spawn } from "bun-pty";
import type { IPty } from "bun-pty";

import { logger } from "../logger/index";
import { nodeCan } from "../node-auth/verifier";
import { resolveNodePrincipal } from "../node-auth/principal";
import { consumeTicket } from "../terminal/ticket";

/** 容器 ID/名称白名单，防止参数被注入到 docker 命令 */
const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/** 允许的 shell，避免用户传入任意命令 */
const ALLOWED_SHELLS = new Set(["sh", "bash", "ash", "zsh", "/bin/sh", "/bin/bash", "/bin/ash", "/bin/zsh"]);

export const dockerExecRoutes = new Elysia()
  .ws("/api/docker/exec", {
    async beforeHandle({ request }: any) {
      const principal = await resolveNodePrincipal(request);
      if (principal && nodeCan(principal, "system:update")) return;

      const url = new URL(request.url);
      if (!consumeTicket(url.searchParams.get("ticket"), "docker-exec")) {
        return new Response("Unauthorized", { status: 401 });
      }
    },

    open(ws) {
      // Elysia 会把查询参数放到 ws.data.query；个别版本拿不到时回落到解析 URL
      const query = (ws.data as any).query || {};
      let container = String(query.container || "");
      let requestedShell = String(query.shell || "sh");

      if (!container) {
        try {
          const url = new URL((ws.data as any).request?.url || "");
          container = url.searchParams.get("container") || "";
          requestedShell = url.searchParams.get("shell") || requestedShell;
        } catch {
          // 保持为空，下面的校验会拒绝
        }
      }

      if (!CONTAINER_RE.test(container)) {
        ws.send(JSON.stringify({ type: "error", message: "无效的容器标识" }));
        ws.close();
        return;
      }
      if (!ALLOWED_SHELLS.has(requestedShell)) {
        ws.send(JSON.stringify({ type: "error", message: "不支持的 shell" }));
        ws.close();
        return;
      }

      try {
        const ptyProcess: IPty = spawn(
          "docker",
          ["exec", "-it", container, requestedShell],
          {
            name: "xterm-256color",
            cols: 80,
            rows: 30,
            cwd: process.cwd(),
          },
        );

        (ws.data as any).ptyProcess = ptyProcess;
        (ws.data as any).connected = true;

        logger.info(`[docker] 容器终端已连接 container=${container} shell=${requestedShell}`);

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
          logger.info(`[docker] 容器终端退出 container=${container} code=${exitCode}`);
        });

        ws.send(JSON.stringify({ type: "ready", container, shell: requestedShell }));
      } catch (err: any) {
        logger.err(`[docker] 容器终端创建失败: ${err.message}`);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
        ws.close();
      }
    },

    message(ws, message: any) {
      const ptyProcess: IPty | undefined = (ws.data as any).ptyProcess;
      if (!ptyProcess) return;

      const handle = (payload: any) => {
        switch (payload?.type) {
          case "input":
            if (payload.data) ptyProcess.write(payload.data);
            return true;
          case "resize":
            if (payload.cols && payload.rows) {
              try {
                ptyProcess.resize(payload.cols, payload.rows);
              } catch {
                // 忽略 resize 失败
              }
            }
            return true;
          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            return true;
          default:
            return false;
        }
      };

      try {
        // Elysia 可能已经把 JSON 解析成对象
        if (typeof message === "object" && message !== null && !(message instanceof ArrayBuffer)) {
          if (handle(message)) return;
        }

        const text =
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message as ArrayBuffer | Uint8Array);

        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          // 非 JSON，按原始输入处理
        }

        if (!parsed || !handle(parsed)) {
          ptyProcess.write(text);
        }
      } catch (err: any) {
        logger.err(`[docker] 容器终端消息处理错误: ${err.message}`);
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
      logger.info("[docker] 容器终端已断开");
    },
  });
