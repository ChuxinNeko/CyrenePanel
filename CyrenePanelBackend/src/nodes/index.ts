import { Elysia, t } from "elysia";
import { randomBytes } from "crypto";
import { hostname, platform, cpus, totalmem } from "os";
import {
  getConfig,
  setConfig,
  dbGetAllNodes,
  dbGetNode,
  dbInsertNode,
  dbDeleteNode,
  dbUpdateNode,
} from "../db";
import { logger } from "../logger/index";
import { getAllInstances } from "../instances/store";
import { getMemoryInfo } from "../memory";

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

// ── 获取 CPU 使用率（基于两次采样间增量）─────────────────────────

let prevCpuSnapshot: { idle: number; total: number } | null = null;

function getCpuUsage(): number {
  const cpuInfo = cpus();
  let idle = 0, total = 0;
  for (const cpu of cpuInfo) {
    for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }

  const current = { idle, total };
  if (!prevCpuSnapshot) {
    prevCpuSnapshot = current;
    return 0;
  }

  const idleDelta = idle - prevCpuSnapshot.idle;
  const totalDelta = total - prevCpuSnapshot.total;
  prevCpuSnapshot = current;
  return totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── 本地系统指标历史采集（10 分钟，每 10 秒一次 = 60 条） ────────

interface MetricPoint {
  timestamp: number;
  cpu: number;
  memoryPercentage: number;
}

const METRICS_MAX_POINTS = 60;
const METRICS_INTERVAL_MS = 10_000;
const localMetrics: MetricPoint[] = [];

function collectLocalMetrics() {
  const mem = getMemoryInfo();
  localMetrics.push({
    timestamp: Date.now(),
    cpu: getCpuUsage(),
    memoryPercentage: Math.round((mem.used / mem.total) * 100),
  });
  while (localMetrics.length > METRICS_MAX_POINTS) {
    localMetrics.shift();
  }
}

// 启动时立即采集一次，然后每 30 秒采集
collectLocalMetrics();
setInterval(collectLocalMetrics, METRICS_INTERVAL_MS);

export function getLocalMetrics(): MetricPoint[] {
  return [...localMetrics];
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
  metrics?: MetricPoint[];
}

export async function getNodesOverview(): Promise<NodeOverview[]> {
  const results: NodeOverview[] = [];

  // 1. 主节点信息（本地）
  const mem = getMemoryInfo();
  const localInstances = getAllInstances();
  const port = process.env.PORT || 5677;
  const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";

  results.push({
    id: "__main__",
    name: `${hostname()} (主节点)`,
    address: process.env.NEXT_PUBLIC_API_URL || `http://127.0.0.1:${port}`,
    isMain: true,
    online: true,
    cpu: getCpuUsage(),
    memory: {
      used: mem.used,
      total: mem.total,
      usedFormatted: formatBytes(mem.used),
      totalFormatted: formatBytes(mem.total),
      percentage: Math.round((mem.used / mem.total) * 100),
    },
    runningInstances: localInstances.filter((i) => i.status === "running").length,
    totalInstances: localInstances.length,
    version: `Bun ${bunVersion}`,
    metrics: [...localMetrics],
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
          if (Array.isArray(sys.metrics)) {
            overview.metrics = sys.metrics;
          }
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
      address: process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5677}`,
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

  // ── 编辑子节点 ───────────────────────────────────────────────────
  .patch(
    "/api/nodes/:id",
    async ({ params, body, profile }: any) => {
      if (!profile || profile.role !== "admin") {
        return { success: false, message: "无权限" };
      }
      const node = dbGetNode(params.id);
      if (!node) {
        return { success: false, message: "节点不存在" };
      }

      const updates: { name?: string; address?: string; apiKey?: string } = {};
      if (body.name?.trim()) updates.name = body.name.trim();
      if (body.address?.trim()) updates.address = body.address.trim().replace(/\/+$/, "");
      if (body.apiKey?.trim()) updates.apiKey = body.apiKey.trim();

      if (Object.keys(updates).length === 0) {
        return { success: false, message: "没有需要更新的字段" };
      }

      dbUpdateNode(params.id, updates);
      logger.info(`管理员 ${profile.username} 编辑了子节点 ${node.name}`);
      return { success: true, message: "节点已更新" };
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        address: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
      }),
    }
  )

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
  })

  // ── 子节点 Docker 代理 ────────────────────────────────────────────

  .derive(async ({ params, profile }: any) => {
    return {};
  })

  .get("/api/nodes/:id/docker/info", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/info`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 信息代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .get("/api/nodes/:id/docker/containers", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const qs = query?.all ? "?all=true" : "";
      const res = await fetch(`${node.address}/api/docker/containers${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 容器列表代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .get("/api/nodes/:id/docker/containers/:cid", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/containers/${params.cid}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 容器详情代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .post("/api/nodes/:id/docker/containers/:cid/start", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/containers/${params.cid}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 启动容器代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .post("/api/nodes/:id/docker/containers/:cid/stop", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/containers/${params.cid}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 停止容器代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .post("/api/nodes/:id/docker/containers/:cid/restart", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/containers/${params.cid}/restart`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 重启容器代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .delete("/api/nodes/:id/docker/containers/:cid", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const qsParts: string[] = [];
      if (query?.force === "true") qsParts.push("force=true");
      if (query?.alsoDeleteImage === "true") qsParts.push("alsoDeleteImage=true");
      const qs = qsParts.length > 0 ? `?${qsParts.join("&")}` : "";
      const res = await fetch(`${node.address}/api/docker/containers/${params.cid}${qs}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 删除容器代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .get("/api/nodes/:id/docker/containers/:cid/logs", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const tail = query?.tail || "200";
      const timestamps = query?.timestamps === "true" ? "&timestamps=true" : "";
      const res = await fetch(`${node.address}/api/docker/containers/${params.cid}/logs?tail=${tail}${timestamps}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 日志代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .get("/api/nodes/:id/docker/images", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/images`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 镜像列表代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .delete("/api/nodes/:id/docker/images/:iid", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const qs = query?.force === "true" ? "?force=true" : "";
      const res = await fetch(`${node.address}/api/docker/images/${params.iid}${qs}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 删除镜像代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .get("/api/nodes/:id/docker/store", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const qs = query?.category ? `?category=${encodeURIComponent(query.category)}` : "";
      const res = await fetch(`${node.address}/api/docker/store${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 应用商店列表代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .get("/api/nodes/:id/docker/store/:sid", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/store/${params.sid}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 应用商店详情代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .post("/api/nodes/:id/docker/store/deploy", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/store/deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 应用商店部署代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .post("/api/nodes/:id/docker/store/deploy-stream", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/store/deploy-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      // 透传 SSE 流
      return new Response(res.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (e: any) {
      logger.err(`子节点 Docker 应用商店流式部署代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .post("/api/nodes/:id/docker/compose/deploy-stream", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/compose/deploy-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      // 透传 SSE 流
      return new Response(res.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (e: any) {
      logger.err(`子节点 Docker Compose 流式部署代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .get("/api/nodes/:id/docker/settings", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/settings`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 设置获取代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .put("/api/nodes/:id/docker/settings", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/docker/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点 Docker 设置更新代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  // ── 子节点服务管理代理 ─────────────────────────────────────────────

  .get("/api/nodes/:id/services", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/services`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点服务列表代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .get("/api/nodes/:id/services/logs/:name", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const lines = query?.lines || "200";
      const res = await fetch(`${node.address}/api/services/logs/${encodeURIComponent(params.name)}?lines=${lines}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点服务日志代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  })

  .post("/api/nodes/:id/services/:name/:action", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    try {
      const token = await exchangeApiKeyForToken(node.address, node.apiKey);
      if (!token) return { success: false, message: "子节点不可达" };
      const res = await fetch(`${node.address}/api/services/${encodeURIComponent(params.name)}/${params.action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      return await res.json();
    } catch (e: any) {
      logger.err(`子节点服务操作代理失败: ${e.message}`);
      return { success: false, message: `子节点请求失败: ${e.message}` };
    }
  });
