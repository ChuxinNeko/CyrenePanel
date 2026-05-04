import { Elysia, t } from "elysia";
import { randomBytes } from "crypto";
import { hostname, platform, cpus, totalmem, freemem } from "os";
import {
  getConfig,
  setConfig,
  dbGetAllNodes,
  dbGetNode,
  dbInsertNode,
  dbDeleteNode,
} from "../db";
import { logger } from "../logger/index";
import { getAllInstances } from "../instances/store";

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

// ── 获取 CPU 使用率 ────────────────────────────────────────────────

function getCpuUsage(): number {
  const cpuInfo = cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpuInfo) {
    for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  return totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── 获取所有节点概览信息 ──────────────────────────────────────────

export interface NodeOverview {
  id: string;
  name: string;
  address: string;
  isMain: boolean;
  online: boolean;
  cpu?: number;
  memory?: { used: number; total: number; usedFormatted: string; totalFormatted: string; percentage: number };
  runningInstances?: number;
  totalInstances?: number;
  version?: string;
}

export async function getNodesOverview(): Promise<NodeOverview[]> {
  const results: NodeOverview[] = [];

  // 1. 主节点信息（本地）
  const totalMem = totalmem();
  const usedMem = totalMem - freemem();
  const localInstances = getAllInstances();
  const port = process.env.PORT || 5677;
  const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";

  results.push({
    id: "__main__",
    name: `${hostname()} (主节点)`,
    address: `${hostname()}:${port}`,
    isMain: true,
    online: true,
    cpu: getCpuUsage(),
    memory: {
      used: usedMem,
      total: totalMem,
      usedFormatted: formatBytes(usedMem),
      totalFormatted: formatBytes(totalMem),
      percentage: Math.round((usedMem / totalMem) * 100),
    },
    runningInstances: localInstances.filter((i) => i.status === "running").length,
    totalInstances: localInstances.length,
    version: `Bun ${bunVersion}`,
  });

  // 2. 子节点信息（远程）
  const nodes = dbGetAllNodes();
  const checks = nodes.map(async (node) => {
    const overview: NodeOverview = {
      id: node.id,
      name: node.name,
      address: node.address.replace(/^https?:\/\//, ""),
      isMain: false,
      online: false,
    };

    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return overview;

      // 检查连通性
      const meRes = await fetch(`${node.address}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      const meData = (await meRes.json()) as any;
      if (!meData?.success) return overview;

      overview.online = true;

      // 获取系统信息
      try {
        const sysRes = await fetch(`${node.address}/api/system`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        const sysData = (await sysRes.json()) as any;
        if (sysData?.success && sysData.system) {
          const sys = sysData.system;
          overview.cpu = sys.cpu?.usage ?? 0;
          overview.memory = {
            used: sys.memory?.used ?? 0,
            total: sys.memory?.total ?? 0,
            usedFormatted: sys.memory?.usedFormatted ?? "—",
            totalFormatted: sys.memory?.totalFormatted ?? "—",
            percentage: sys.memory?.percentage ?? 0,
          };
          overview.version = sys.runtimeVersion ?? "未知";
        }
      } catch {
        // 系统信息获取失败不影响连接状态
      }

      // 获取实例信息
      try {
        const instRes = await fetch(`${node.address}/api/instances`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        });
        const instData = (await instRes.json()) as any;
        if (instData?.success && Array.isArray(instData.instances)) {
          overview.totalInstances = instData.instances.length;
          overview.runningInstances = instData.instances.filter(
            (i: any) => i.status === "running"
          ).length;
        }
      } catch {
        // 实例信息获取失败不影响
      }
    } catch {
      // 节点完全不可达
    }

    return overview;
  });

  const remoteResults = await Promise.all(checks);
  results.push(...remoteResults);

  return results;
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

  // ── 节点状态总览 ──────────────────────────────────────────────────
  .get("/api/nodes/overview", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const nodes = await getNodesOverview();
    return { success: true, nodes };
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
