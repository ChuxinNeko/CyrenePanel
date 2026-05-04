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

// ── 用 API Key 在远端节点换取 JWT token ────────────────────────────

export async function exchangeApiKeyForToken(
  address: string,
  apiKey: string
): Promise<string | null> {
  try {
    const res = await fetch(`${address}/api/auth/key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: apiKey }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as any;
    if (data?.success && data.token) return data.token;
  } catch {
    // ignore
  }
  return null;
}

export async function getOnlineNodesCount() {
  const nodes = dbGetAllNodes();
  const checks = nodes.map(async (node) => {
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return false;
      const res = await fetch(`${node.address}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000), // 缩短超时时间
      });
      const data = await res.json() as any;
      return !!data?.success;
    } catch {
      return false;
    }
  });
  
  const results = await Promise.all(checks);
  const onlineCount = results.filter(Boolean).length;
  
  return {
    total: nodes.length + 1, // 主节点 + 子节点
    online: onlineCount + 1, // 主节点始终在线 + 在线子节点
  };
}

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

      // 验证子节点连通性：先换 JWT，再调 /api/me
      try {
        const token = await exchangeApiKeyForToken(normalizedAddress, apiKey);
        if (!token) {
          return { success: false, message: "连接失败：API Key 无效或节点不可达" };
        }
        const res = await fetch(`${normalizedAddress}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
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
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: true, online: false };
      const res = await fetch(`${node.address}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json() as any;
      return { success: true, online: !!data?.success };
    } catch {
      return { success: true, online: false };
    }
  })

  // ── 子节点文件代理：辅助函数 ─────────────────────────────────────
  .derive(async ({ params, profile }: any) => {
    // 为子节点文件代理提供通用的节点认证辅助
    return {};
  })

  // ── 子节点文件代理：列出目录 ─────────────────────────────────────
  .get("/api/nodes/:id/files", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };

    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };

      const pathParam = (query.path as string) || "";
      const url = `${node.address}/api/files?path=${encodeURIComponent(pathParam)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点文件列表代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  // ── 子节点文件代理：读取文件 ─────────────────────────────────────
  .get("/api/nodes/:id/files/read", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };

    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };

      const pathParam = query.path as string;
      if (!pathParam) return { success: false, message: "缺少 path 参数" };

      const url = `${node.address}/api/files/read?path=${encodeURIComponent(pathParam)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点文件读取代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  // ── 子节点文件代理：写入文件 ─────────────────────────────────────
  .put("/api/nodes/:id/files/write", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };

    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };

      const res = await fetch(`${node.address}/api/files/write`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点文件写入代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  // ── 子节点文件代理：创建目录 ─────────────────────────────────────
  .post("/api/nodes/:id/files/mkdir", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };

    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };

      const res = await fetch(`${node.address}/api/files/mkdir`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点创建目录代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  // ── 子节点文件代理：删除文件/目录 ────────────────────────────────
  .delete("/api/nodes/:id/files", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };

    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };

      const res = await fetch(`${node.address}/api/files`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点删除文件代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  // ── 子节点文件代理：重命名 ───────────────────────────────────────
  .patch("/api/nodes/:id/files/rename", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };

    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };

      const res = await fetch(`${node.address}/api/files/rename`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点重命名代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  // ── 子节点文件代理：下载文件 ─────────────────────────────────────
  .get("/api/nodes/:id/files/download", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };

    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };

      const pathParam = query.path as string;
      if (!pathParam) return { success: false, message: "缺少 path 参数" };

      const url = `${node.address}/api/files/download?path=${encodeURIComponent(pathParam)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点文件下载代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  });
