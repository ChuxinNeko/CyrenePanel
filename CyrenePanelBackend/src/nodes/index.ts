import { Elysia, t } from "elysia";
import { randomBytes } from "crypto";
import { hostname } from "os";
import {
  getConfig,
  setConfig,
  dbGetAllNodes,
  dbGetNode,
  dbInsertNode,
  dbDeleteNode,
} from "../db";
import { logger } from "../logger/index";

export const nodeRoutes = new Elysia()
  // ── JWT 鉴权辅助 ──────────────────────────────────────────────────
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // ── 获取主节点 API key ────────────────────────────────────────────
  .get("/api/key", async ({ profile }: any) => {
    if (!profile || profile.role !== "admin") {
      return { success: false, message: "无权限" };
    }
    const apiKey = getConfig("api_key");
    return {
      success: true,
      key: apiKey || null,
      hostname: hostname(),
      address: `http://localhost:${process.env.PORT || 5677}`,
    };
  })

  // ── 重新生成 API key ─────────────────────────────────────────────
  .post("/api/key/regenerate", async ({ profile }: any) => {
    if (!profile || profile.role !== "admin") {
      return { success: false, message: "无权限" };
    }
    const newKey = randomBytes(16).toString("hex");
    setConfig("api_key", newKey);
    logger.info(`管理员 ${profile.username} 重新生成了 API key`);
    return { success: true, key: newKey };
  })

  // ── 列出所有子节点 ───────────────────────────────────────────────
  .get("/api/nodes", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const nodes = dbGetAllNodes();
    return { success: true, nodes };
  })

  // ── 添加子节点（验证连通性后存入）────────────────────────────────
  .post(
    "/api/nodes",
    async ({ body, profile }: any) => {
      if (!profile || profile.role !== "admin") {
        return { success: false, message: "无权限" };
      }

      const { name, address, apiKey } = body;
      const normalizedAddress = address.replace(/\/+$/, "");

      // 验证子节点连通性：调用对方的 /api/me
      try {
        const res = await fetch(`${normalizedAddress}/api/me`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json() as any;
        if (!data?.success) {
          return { success: false, message: "连接失败：对方节点未返回有效响应" };
        }
      } catch (e: any) {
        return { success: false, message: `连接失败：${e.message || "无法访问目标地址"}` };
      }

      const id = randomBytes(8).toString("hex");
      dbInsertNode({
        id,
        name,
        address: normalizedAddress,
        apiKey,
        isMain: false,
        createdAt: Date.now(),
      });
      logger.info(`管理员 ${profile.username} 添加了子节点 ${name}`);
      return { success: true, message: "节点添加成功", id };
    },
    {
      body: t.Object({
        name: t.String(),
        address: t.String(),
        apiKey: t.String(),
      }),
    }
  )

  // ── 删除子节点 ───────────────────────────────────────────────────
  .delete("/api/nodes/:id", async ({ params, profile }: any) => {
    if (!profile || profile.role !== "admin") {
      return { success: false, message: "无权限" };
    }
    const node = dbGetNode(params.id);
    if (!node) {
      return { success: false, message: "节点不存在" };
    }
    dbDeleteNode(params.id);
    logger.info(`管理员 ${profile.username} 删除了子节点 ${node.name}`);
    return { success: true, message: "节点已删除" };
  })

  // ── 检查子节点在线状态 ───────────────────────────────────────────
  .get("/api/nodes/:id/status", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) {
      return { success: false, message: "节点不存在" };
    }

    try {
      const res = await fetch(`${node.address}/api/me`, {
        headers: { Authorization: `Bearer ${node.apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json() as any;
      return { success: true, online: !!data?.success };
    } catch {
      return { success: true, online: false };
    }
  });