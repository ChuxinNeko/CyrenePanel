import { Elysia } from "elysia";
import { logger } from "../logger/index";
import {
  getLogs,
  setClients,
  getClients,
  removeClients,
} from "./store";
import { writeToInstance, isRunning } from "./manager";

export const instanceWsRoutes = new Elysia()
  .ws("/api/instances/:id/terminal", {
    // 从 URL query 参数验证 JWT
    async beforeHandle({ jwt, request, query }: any) {
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
      const id = (ws.data.params as any).id;
      if (!id) {
        ws.close();
        return;
      }

      // 注册为该实例的 WS 客户端
      let clients = getClients(id);
      if (!clients) {
        clients = new Set();
        setClients(id, clients);
      }
      clients.add(ws);

      logger.info(`WS 客户端已连接: 实例 ${id}`);

      // 先发送历史日志
      const logs = getLogs(id);
      if (logs.length > 0) {
        ws.send(logs.join("\n") + "\n");
      }

      // 如果实例未运行，通知客户端
      if (!isRunning(id)) {
        ws.send(
          JSON.stringify({ type: "exit", code: null })
        );
      }
    },

    message(ws, message) {
      const id = (ws.data.params as any).id;
      if (!id) return;

      // 用户输入 → 写入进程 stdin
      const text = typeof message === "string" ? message : String(message);
      writeToInstance(id, text);
    },

    close(ws) {
      const id = (ws.data.params as any).id;
      if (!id) return;

      const clients = getClients(id);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          removeClients(id);
        }
      }

      logger.info(`WS 客户端已断开: 实例 ${id}`);
    },
  });