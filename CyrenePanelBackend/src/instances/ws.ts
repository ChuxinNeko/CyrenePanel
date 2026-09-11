import { Elysia } from "elysia";
import { logger } from "../logger/index";
import { resolveNodePrincipal } from "../node-auth/principal";
import {
  getLogs,
  setClients,
  getClients,
  removeClients,
} from "./store";
import { writeToInstance, isRunning } from "./manager";
import { dbGetAllNodes } from "../db";
import { nodeFetch as fetchNode, nodeRequestHeaders } from "../node-auth/client";
import { consumeTicket } from "../terminal/ticket";

export const instanceWsRoutes = new Elysia()
  .ws("/api/instances/:id/terminal", {
    // 浏览器→主节点：一次性票据；主节点→子节点：节点签名（resolveNodePrincipal）
    async beforeHandle({ request }: any) {
      const principal = await resolveNodePrincipal(request);
      if (principal) return;

      const url = new URL(request.url);
      if (!consumeTicket(url.searchParams.get("ticket"), "instance")) {
        return new Response("Unauthorized", { status: 401 });
      }
    },

    async open(ws: any) {
      const id = ws.data.params?.id;
      if (!id) {
        ws.close();
        return;
      }

      // 判断是否在本地
      const isLocal = !!getLogs(id) || isRunning(id);
      if (!isLocal) {
        // 尝试在子节点中寻找该实例并建立代理
        const nodes = dbGetAllNodes();
        let targetNode = null;

        for (const node of nodes) {
          try {
            const res = await fetchNode(node.id, `/api/instances/${id}`, {}, 2_000);
            if (res.ok) {
              const data = await res.json();
              if (data.success) {
                targetNode = node;
                break;
              }
            }
          } catch {}
        }

        if (targetNode) {
          logger.info(`[实例终端代理] 正在代理实例 ${id} 到节点 ${targetNode.name}`);
          const remotePath = `/api/instances/${id}/terminal`;
          const remoteWsUrl = `${targetNode.address.replace(/^http/, "ws")}${remotePath}`;
          let alive = true;
          let connected = false;

          const connectTimeout = setTimeout(() => {
            if (!connected && alive) {
              alive = false;
              try {
                ws.send(JSON.stringify({ type: "exit", code: null }));
                ws.close();
              } catch {}
              logger.err(`[实例终端代理] 连接超时`);
            }
          }, 10000);

          const remoteWs = new WebSocket(remoteWsUrl, {
            headers: nodeRequestHeaders(remotePath),
          });
          ws.data._remoteWs = remoteWs;
          ws.data._alive = alive;
          ws.data._connectTimeout = connectTimeout;

          remoteWs.addEventListener("open", () => {
            connected = true;
            clearTimeout(connectTimeout);
            logger.info(`[实例终端代理] 连接已建立: 实例 ${id}`);
          });

          remoteWs.addEventListener("message", (event: any) => {
            if (ws.data._alive) {
              try {
                const sendData = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
                ws.send(sendData);
              } catch {}
            }
          });

          remoteWs.addEventListener("close", () => {
            ws.data._alive = false;
            try { ws.close(); } catch {}
          });

          remoteWs.addEventListener("error", () => {
            ws.data._alive = false;
            try { ws.close(); } catch {}
          });

          return;
        }
      }

      // 如果是本地实例，执行正常的逻辑
      ws.data._isLocal = true;
      let clients = getClients(id);
      if (!clients) {
        clients = new Set();
        setClients(id, clients);
      }
      clients.add(ws);

      logger.info(`WS 客户端已连接: 实例 ${id}`);

      const logs = getLogs(id);
      if (logs.length > 0) {
        ws.send(logs.join("\n") + "\n");
      }

      if (!isRunning(id)) {
        ws.send(JSON.stringify({ type: "exit", code: null }));
      }
    },

    message(ws: any, message) {
      if (ws.data._remoteWs && ws.data._alive) {
        try {
          ws.data._remoteWs.send(message);
        } catch {}
        return;
      }

      if (ws.data._isLocal) {
        const id = ws.data.params?.id;
        if (!id) return;
        const text = typeof message === "string" ? message : String(message);
        writeToInstance(id, text);
      }
    },

    close(ws: any) {
      if (ws.data._remoteWs) {
        ws.data._alive = false;
        try {
          ws.data._remoteWs.close();
        } catch {}
      }

      if (ws.data._isLocal) {
        const id = ws.data.params?.id;
        if (!id) return;
        const clients = getClients(id);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            removeClients(id);
          }
        }
        logger.info(`WS 客户端已断开: 实例 ${id}`);
      }
    },
  });