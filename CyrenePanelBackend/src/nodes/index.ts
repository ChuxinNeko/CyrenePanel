import { Elysia, t } from "elysia";
import { randomBytes } from "crypto";
import { cpus, hostname, platform, totalmem, freemem } from "os";
import { readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import {
  dbCreateNodePairingCode,
  dbDeleteNode,
  dbGetAllNodes,
  dbGetNode,
  dbInsertNode,
  dbUpdateNode,
  type NodeRow,
} from "../db";
import { auditLog, getRequestIp } from "../audit/index";
import { getAllInstances } from "../instances/store";
import { logger } from "../logger/index";
import { getNodePublicIdentity } from "../node-auth/identity";
import { nodeFetchAt } from "../node-auth/client";
import { nodeProfile, resolveNodePrincipal } from "../node-auth/principal";
import {
  consumeNodePairingCode,
  hashPairingCode,
  registerNodeController,
} from "../node-auth/verifier";
import { CYRENE_VERSION } from "../version";

/** /proc/diskstats 的扇区计数按惯例固定是 512 字节，与实际物理扇区大小无关 */
const SECTOR_SIZE = 512;

interface NodeReachability {
  online: boolean;
  reason?: string;
}

export interface MetricPoint {
  timestamp: number;
  cpu: number;
  memoryPercentage: number;
  networkDownload: number;
  networkUpload: number;
  diskRead: number;
  diskWrite: number;
  diskReadOps: number;
  diskWriteOps: number;
  diskLatency: number;
}

export interface NetworkUsage {
  download: number;
  upload: number;
  downloadFormatted: string;
  uploadFormatted: string;
  receivedFormatted: string;
  transmittedFormatted: string;
  receivedBytes: number;
  transmittedBytes: number;
}

export interface DiskIoUsage {
  read: number;
  write: number;
  readFormatted: string;
  writeFormatted: string;
  readOps: number;
  writeOps: number;
  readLatencyMs: number;
  writeLatencyMs: number;
  latencyMs: number;
}

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
  panelVersion?: string;
  metrics?: MetricPoint[];
  statusReason?: string;
}

const METRICS_MAX_POINTS = 60;
const METRICS_INTERVAL_MS = 10_000;
const localMetrics: MetricPoint[] = [];
let previousCpuSnapshot: { idle: number; total: number } | null = null;
let previousNetworkSnapshot: { timestamp: number; receivedBytes: number; transmittedBytes: number } | null = null;
let lastNetworkUsage: NetworkUsage = {
  download: 0,
  upload: 0,
  downloadFormatted: "0 B/s",
  uploadFormatted: "0 B/s",
  receivedFormatted: "0 B",
  transmittedFormatted: "0 B",
  receivedBytes: 0,
  transmittedBytes: 0,
};
let lastDiskIoUsage: DiskIoUsage = {
  read: 0,
  write: 0,
  readFormatted: "0 B/s",
  writeFormatted: "0 B/s",
  readOps: 0,
  writeOps: 0,
  readLatencyMs: 0,
  writeLatencyMs: 0,
  latencyMs: 0,
};

interface DiskIoSnapshot {
  timestamp: number;
  readBytes: number;
  writeBytes: number;
  readOps: number;
  writeOps: number;
  readMs: number;
  writeMs: number;
}

let previousDiskIoSnapshot: DiskIoSnapshot | null = null;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getCpuUsage(): number {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  const current = { idle, total };
  if (!previousCpuSnapshot) {
    previousCpuSnapshot = current;
    return 0;
  }
  const totalDelta = current.total - previousCpuSnapshot.total;
  const idleDelta = current.idle - previousCpuSnapshot.idle;
  previousCpuSnapshot = current;
  return totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
}

function readNetworkSnapshot() {
  try {
    if (platform() === "win32") {
      const output = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", "Get-NetAdapterStatistics | Select ReceivedBytes,SentBytes | ConvertTo-Json -Compress"],
        { encoding: "utf-8", timeout: 3000, windowsHide: true },
      );
      const value = JSON.parse(output || "[]");
      const rows = Array.isArray(value) ? value : [value];
      return rows.reduce(
        (snapshot, row) => ({
          ...snapshot,
          receivedBytes: snapshot.receivedBytes + Number(row?.ReceivedBytes || 0),
          transmittedBytes: snapshot.transmittedBytes + Number(row?.SentBytes || 0),
        }),
        { timestamp: Date.now(), receivedBytes: 0, transmittedBytes: 0 },
      );
    }

    const lines = readFileSync("/proc/net/dev", "utf-8").split("\n").slice(2);
    return lines.reduce(
      (snapshot, line) => {
        const [name, rawStats] = line.split(":");
        if (!name || !rawStats || name.trim() === "lo") return snapshot;
        const stats = rawStats.trim().split(/\s+/).map(Number);
        if (stats.length < 16 || stats.some(Number.isNaN)) return snapshot;
        return {
          ...snapshot,
          receivedBytes: snapshot.receivedBytes + stats[0],
          transmittedBytes: snapshot.transmittedBytes + stats[8],
        };
      },
      { timestamp: Date.now(), receivedBytes: 0, transmittedBytes: 0 },
    );
  } catch {
    return null;
  }
}

export function getLocalNetworkUsage(): NetworkUsage {
  const current = readNetworkSnapshot();
  if (!current) return lastNetworkUsage;
  if (!previousNetworkSnapshot) {
    previousNetworkSnapshot = current;
    lastNetworkUsage = {
      ...lastNetworkUsage,
      receivedBytes: current.receivedBytes,
      transmittedBytes: current.transmittedBytes,
      receivedFormatted: formatBytes(current.receivedBytes),
      transmittedFormatted: formatBytes(current.transmittedBytes),
    };
    return lastNetworkUsage;
  }
  const elapsedSeconds = Math.max((current.timestamp - previousNetworkSnapshot.timestamp) / 1000, 1);
  const download = Math.max(0, (current.receivedBytes - previousNetworkSnapshot.receivedBytes) / elapsedSeconds);
  const upload = Math.max(0, (current.transmittedBytes - previousNetworkSnapshot.transmittedBytes) / elapsedSeconds);
  previousNetworkSnapshot = current;
  lastNetworkUsage = {
    download: Math.round(download),
    upload: Math.round(upload),
    downloadFormatted: `${formatBytes(download)}/s`,
    uploadFormatted: `${formatBytes(upload)}/s`,
    receivedFormatted: formatBytes(current.receivedBytes),
    transmittedFormatted: formatBytes(current.transmittedBytes),
    receivedBytes: current.receivedBytes,
    transmittedBytes: current.transmittedBytes,
  };
  return lastNetworkUsage;
}

/**
 * 采集磁盘累计 IO 计数器。和网络一样只取快照，速率靠两次快照做差。
 *
 * Linux 读 /proc/diskstats。那里既有整盘（sda）也有分区（sda1），
 * 两者的计数是重复的，全加会翻倍，所以只统计 /sys/block 下存在的整盘，
 * 并排除 loop / ram / zram 这些不落到物理介质上的设备。
 */
function readDiskIoSnapshot(): DiskIoSnapshot | null {
  try {
    if (platform() === "win32") {
      // _Total 实例本身就是各物理盘的汇总，不需要再挑设备
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter \"Name='_Total'\" | Select DiskReadBytesPerSec,DiskWriteBytesPerSec,DiskReadsPerSec,DiskWritesPerSec,PercentDiskReadTime,PercentDiskWriteTime | ConvertTo-Json -Compress",
        ],
        { encoding: "utf-8", timeout: 3000, windowsHide: true },
      );
      const row = JSON.parse(output || "{}");
      // PerfRawData 里这些字段是累计原始值，不是"每秒"，正好当计数器用
      return {
        timestamp: Date.now(),
        readBytes: Number(row?.DiskReadBytesPerSec || 0),
        writeBytes: Number(row?.DiskWriteBytesPerSec || 0),
        readOps: Number(row?.DiskReadsPerSec || 0),
        writeOps: Number(row?.DiskWritesPerSec || 0),
        // 单位是 100ns 刻度，换算成毫秒
        readMs: Number(row?.PercentDiskReadTime || 0) / 10_000,
        writeMs: Number(row?.PercentDiskWriteTime || 0) / 10_000,
      };
    }

    const content = readFileSync("/proc/diskstats", "utf-8");
    const snapshot: DiskIoSnapshot = {
      timestamp: Date.now(),
      readBytes: 0,
      writeBytes: 0,
      readOps: 0,
      writeOps: 0,
      readMs: 0,
      writeMs: 0,
    };

    for (const line of content.split("\n")) {
      const parts = line.trim().split(/\s+/);
      // major minor name reads merged sectors ms writes merged sectors ms …
      if (parts.length < 11) continue;
      const name = parts[2];
      if (!name) continue;
      if (/^(loop|ram|zram|fd)\d/.test(name)) continue;
      // 只认整盘：分区在 /sys/block 下没有同名目录
      if (!existsSync(`/sys/block/${name}`)) continue;

      const nums = parts.slice(3).map(Number);
      if (nums.some(Number.isNaN)) continue;

      snapshot.readOps += nums[0];
      snapshot.readBytes += nums[2] * SECTOR_SIZE;
      snapshot.readMs += nums[3];
      snapshot.writeOps += nums[4];
      snapshot.writeBytes += nums[6] * SECTOR_SIZE;
      snapshot.writeMs += nums[7];
    }

    return snapshot;
  } catch {
    return null;
  }
}

/**
 * 只在定时采集里调用，不对外暴露。
 *
 * 速率是两次快照做差算出来的，采样点必须等间隔。如果放开给 /api/system
 * 每次请求都触发，就会和 10 秒一次的采集循环交错出相邻几毫秒的调用，
 * 差值被钳到 1 秒后算出接近零的速率，图上会冒出虚假的凹陷。
 */
function sampleDiskIoUsage(): DiskIoUsage {
  const current = readDiskIoSnapshot();
  if (!current) return lastDiskIoUsage;

  // 第一次只留基准，没有前一份快照就算不出速率
  if (!previousDiskIoSnapshot) {
    previousDiskIoSnapshot = current;
    return lastDiskIoUsage;
  }

  const elapsedSeconds = Math.max(
    (current.timestamp - previousDiskIoSnapshot.timestamp) / 1000,
    1,
  );
  const delta = (key: keyof Omit<DiskIoSnapshot, "timestamp">) =>
    Math.max(0, current[key] - previousDiskIoSnapshot![key]);

  const readBytes = delta("readBytes");
  const writeBytes = delta("writeBytes");
  const readOps = delta("readOps");
  const writeOps = delta("writeOps");
  const readMs = delta("readMs");
  const writeMs = delta("writeMs");

  // 平均单次耗时：区间内花的毫秒数 ÷ 区间内的请求数
  const readLatency = readOps > 0 ? readMs / readOps : 0;
  const writeLatency = writeOps > 0 ? writeMs / writeOps : 0;
  const totalOps = readOps + writeOps;
  const latency = totalOps > 0 ? (readMs + writeMs) / totalOps : 0;

  previousDiskIoSnapshot = current;
  lastDiskIoUsage = {
    read: Math.round(readBytes / elapsedSeconds),
    write: Math.round(writeBytes / elapsedSeconds),
    readFormatted: `${formatBytes(readBytes / elapsedSeconds)}/s`,
    writeFormatted: `${formatBytes(writeBytes / elapsedSeconds)}/s`,
    readOps: Math.round(readOps / elapsedSeconds),
    writeOps: Math.round(writeOps / elapsedSeconds),
    readLatencyMs: Number(readLatency.toFixed(2)),
    writeLatencyMs: Number(writeLatency.toFixed(2)),
    latencyMs: Number(latency.toFixed(2)),
  };
  return lastDiskIoUsage;
}

/** 对外只读最近一次采样结果，不触发新的采样 */
export function getLocalDiskIoUsage(): DiskIoUsage {
  return lastDiskIoUsage;
}

function collectLocalMetrics(): void {
  const network = getLocalNetworkUsage();
  const diskIo = sampleDiskIoUsage();
  const total = totalmem();
  localMetrics.push({
    timestamp: Date.now(),
    cpu: getCpuUsage(),
    memoryPercentage: total > 0 ? Math.round(((total - freemem()) / total) * 100) : 0,
    networkDownload: network.download,
    networkUpload: network.upload,
    diskRead: diskIo.read,
    diskWrite: diskIo.write,
    diskReadOps: diskIo.readOps,
    diskWriteOps: diskIo.writeOps,
    diskLatency: diskIo.latencyMs,
  });
  while (localMetrics.length > METRICS_MAX_POINTS) localMetrics.shift();
}

collectLocalMetrics();
setInterval(collectLocalMetrics, METRICS_INTERVAL_MS);

export function getLocalMetrics(): MetricPoint[] {
  return [...localMetrics];
}

async function readJson(response: Response): Promise<any | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchNode(
  node: NodeRow,
  endpoint: string,
  init: RequestInit = {},
  timeout = 30_000,
): Promise<Response> {
  return nodeFetchAt(node.address, endpoint, init, timeout);
}

async function checkNodeReachability(node: NodeRow, timeout = 5000): Promise<NodeReachability> {
  try {
    const response = await fetchNode(node, "/api/system", {}, timeout);
    const data = await readJson(response);
    const ok = response.ok && data?.success;
    if (!ok) {
      // [诊断] 临时日志：探活失败时打印主节点当前签名身份 + 子节点原始回复
      logger.warn(
        `[诊断] 探活失败 node=${node.name} addr=${node.address} ` +
        `http=${response.status} masterKeyId=${getNodePublicIdentity().keyId} ` +
        `body=${JSON.stringify(data)?.slice(0, 160)}`,
      );
    }
    return ok
      ? { online: true }
      : { online: false, reason: data?.message || `节点返回 HTTP ${response.status}` };
  } catch (error: any) {
    logger.warn(`[诊断] 探活异常 node=${node.name} addr=${node.address} err=${error?.message}`);
    return { online: false, reason: error?.message || "节点请求超时" };
  }
}

export async function getOnlineNodesCount() {
  const checks = await Promise.all(dbGetAllNodes().map((node) => checkNodeReachability(node, 2000)));
  return {
    total: checks.length + 1,
    online: checks.filter((check) => check.online).length + 1,
  };
}

export async function getNodesOverview(): Promise<NodeOverview[]> {
  const port = process.env.PORT || "5677";
  const localInstances = getAllInstances();
  const total = totalmem();
  const results: NodeOverview[] = [{
    id: "__main__",
    name: `${hostname()} (主节点)`,
    address: process.env.CYRENE_PUBLIC_API_URL || process.env.BACKEND_PUBLIC_URL || `http://127.0.0.1:${port}`,
    isMain: true,
    online: true,
    cpu: getCpuUsage(),
    memory: {
      used: total - freemem(),
      total,
      usedFormatted: formatBytes(total - freemem()),
      totalFormatted: formatBytes(total),
      percentage: total > 0 ? Math.round(((total - freemem()) / total) * 100) : 0,
    },
    runningInstances: localInstances.filter((instance) => instance.status === "running").length,
    totalInstances: localInstances.length,
    version: CYRENE_VERSION,
    panelVersion: CYRENE_VERSION,
    metrics: getLocalMetrics(),
  }];

  const remotes = await Promise.all(dbGetAllNodes().map(async (node): Promise<NodeOverview> => {
    const overview: NodeOverview = {
      id: node.id,
      name: node.name,
      address: node.address.replace(/^https?:\/\//, ""),
      isMain: false,
      online: false,
    };
    const status = await checkNodeReachability(node);
    if (!status.online) return { ...overview, statusReason: status.reason };
    overview.online = true;
    try {
      const [systemResponse, instancesResponse] = await Promise.all([
        fetchNode(node, "/api/system", {}, 5000),
        fetchNode(node, "/api/instances", {}, 5000),
      ]);
      const [system, instances] = await Promise.all([readJson(systemResponse), readJson(instancesResponse)]);
      if (system?.success && system.system) {
        overview.cpu = system.system.cpu?.usage ?? 0;
        overview.memory = system.system.memory;
        overview.version = system.system.panelVersion;
        overview.panelVersion = system.system.panelVersion;
        overview.metrics = Array.isArray(system.system.metrics) ? system.system.metrics : undefined;
      }
      if (instances?.success && Array.isArray(instances.instances)) {
        overview.totalInstances = instances.instances.length;
        overview.runningInstances = instances.instances.filter((instance: any) => instance.status === "running").length;
      }
    } catch (error: any) {
      overview.statusReason = error?.message || "节点信息获取失败";
    }
    return overview;
  }));

  return [...results, ...remotes];
}

function relayResponse(response: Response): Response {
  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
    "content-disposition",
    "x-content-type-options",
  ]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

function requestBody(request: Request): Promise<string> {
  return request.method === "GET" || request.method === "HEAD" ? Promise.resolve("") : request.clone().text();
}

export interface StartupPairingCode {
  code: string;
  expiresAt: number;
}

export function createStartupPairingCode(): StartupPairingCode {
  const code = randomBytes(18).toString("base64url");
  const expiresAt = Date.now() + 10 * 60_000;
  dbCreateNodePairingCode(hashPairingCode(code), expiresAt);
  return { code, expiresAt };
}

export const nodeRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (token) {
      const profile = await jwt.verify(token);
      if (profile) return { profile };
    }
    return { profile: nodeProfile(await resolveNodePrincipal(request)) };
  })
  .get("/api/node-auth/v2/identity", () => ({ success: true, identity: getNodePublicIdentity() }))
  .post("/api/node-auth/v2/pairing-code", ({ profile, request, server }: any) => {
    if (!profile || profile.role !== "admin") return { success: false, message: "无权限" };
    const code = randomBytes(18).toString("base64url");
    const expiresAt = Date.now() + 10 * 60_000;
    dbCreateNodePairingCode(hashPairingCode(code), expiresAt);
    auditLog({
      username: profile.username,
      category: "node",
      action: "生成节点配对码",
      target: hostname(),
      ip: getRequestIp(request, server),
    });
    return { success: true, code, expiresAt };
  })
  .post(
    "/api/node-auth/v2/pair",
    ({ body, request, server }: any) => {
      if (!consumeNodePairingCode(body.code)) {
        return { success: false, message: "配对码无效、已使用或已过期" };
      }
      try {
        registerNodeController({
          id: body.controller.id,
          name: body.controller.name,
          keyId: body.controller.keyId,
          publicKeyPem: body.controller.publicKeyPem,
          capabilities: body.capabilities,
        });
      } catch {
        return { success: false, message: "主节点公钥无效" };
      }
      auditLog({
        username: "node-pairing",
        category: "node",
        action: "配对主节点",
        target: body.controller.name,
        detail: body.controller.id,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "节点配对成功" };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 16, maxLength: 128 }),
        controller: t.Object({
          id: t.String({ minLength: 1, maxLength: 128 }),
          name: t.String({ minLength: 1, maxLength: 128 }),
          keyId: t.String({ minLength: 1, maxLength: 128 }),
          publicKeyPem: t.String({ minLength: 1, maxLength: 8192 }),
        }),
        capabilities: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 64 }))),
      }),
    },
  )
  .post(
    "/api/nodes/v2/pair",
    async ({ body, profile, request, server }: any) => {
      if (!profile || profile.role !== "admin") return { success: false, message: "无权限" };
      let address: string;
      try {
        address = new URL(body.address).toString().replace(/\/$/, "");
      } catch {
        return { success: false, message: "节点地址无效" };
      }
      if (!address.startsWith("http://") && !address.startsWith("https://")) {
        return { success: false, message: "节点地址必须使用 HTTP 或 HTTPS" };
      }
      try {
        const pairResponse = await fetch(`${address}/api/node-auth/v2/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: body.code, controller: getNodePublicIdentity() }),
          signal: AbortSignal.timeout(10_000),
        });
        const pairResult = await readJson(pairResponse);
        if (!pairResponse.ok || !pairResult?.success) {
          return { success: false, message: pairResult?.message || "子节点拒绝配对" };
        }
        const system = await nodeFetchAt(address, "/api/system", {}, 10_000);
        const systemResult = await readJson(system);
        if (!system.ok || !systemResult?.success) {
          return { success: false, message: "子节点未确认签名信任关系" };
        }
        const id = randomBytes(8).toString("hex");
        dbInsertNode({ id, name: body.name.trim(), address, createdAt: Date.now() });
        auditLog({
          username: profile.username,
          category: "node",
          action: "配对 v2 节点",
          target: body.name.trim(),
          detail: address,
          ip: getRequestIp(request, server),
        });
        return { success: true, id, message: "节点配对成功" };
      } catch (error: any) {
        return { success: false, message: `配对失败：${error?.message || "无法访问子节点"}` };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 128 }),
        address: t.String({ minLength: 1, maxLength: 2048 }),
        code: t.String({ minLength: 16, maxLength: 128 }),
      }),
    },
  )
  .get("/api/nodes/overview", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return { success: true, nodes: await getNodesOverview() };
  })
  .get("/api/nodes", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return { success: true, nodes: dbGetAllNodes() };
  })
  .patch(
    "/api/nodes/:id",
    ({ params, body, profile, request, server }: any) => {
      if (!profile || profile.role !== "admin") return { success: false, message: "无权限" };
      const node = dbGetNode(params.id);
      if (!node) return { success: false, message: "节点不存在" };
      const updates = {
        name: body.name?.trim() || undefined,
        address: body.address?.trim().replace(/\/+$/, "") || undefined,
      };
      if (!updates.name && !updates.address) return { success: false, message: "没有需要更新的字段" };
      dbUpdateNode(node.id, updates);
      auditLog({
        username: profile.username,
        category: "node",
        action: "编辑节点",
        target: node.name,
        detail: Object.keys(updates).filter((key) => updates[key as keyof typeof updates]).join(", "),
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "节点已更新" };
    },
    { body: t.Object({ name: t.Optional(t.String()), address: t.Optional(t.String()) }) },
  )
  .delete("/api/nodes/:id", ({ params, profile, request, server }: any) => {
    if (!profile || profile.role !== "admin") return { success: false, message: "无权限" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    dbDeleteNode(node.id);
    auditLog({
      username: profile.username,
      category: "node",
      action: "删除节点",
      target: node.name,
      detail: node.address,
      ip: getRequestIp(request, server),
    });
    return { success: true, message: "节点已删除" };
  })
  .get("/api/nodes/:id/status", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const node = dbGetNode(params.id);
    if (!node) return { success: false, message: "节点不存在" };
    const status = await checkNodeReachability(node, 3000);
    return { success: true, ...status };
  })
  .all("/api/nodes/:id/*", async ({ params, request, profile }: any) => {
    if (!profile) return new Response(JSON.stringify({ success: false, message: "未授权" }), { status: 401 });
    const node = dbGetNode(params.id);
    if (!node) return new Response(JSON.stringify({ success: false, message: "节点不存在" }), { status: 404 });
    const suffix = String((params as Record<string, string>)["*"] || "");
    if (!suffix || suffix.includes("..")) {
      return new Response(JSON.stringify({ success: false, message: "无效节点路径" }), { status: 400 });
    }
    const url = new URL(request.url);
    const body = await requestBody(request);
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    const range = request.headers.get("range");
    if (contentType) headers.set("content-type", contentType);
    if (range) headers.set("range", range);
    try {
      const response = await fetchNode(node, `/api/${suffix}${url.search}`, {
        method: request.method,
        headers,
        body: body || undefined,
      }, request.method === "GET" ? 30_000 : 5 * 60_000);
      return relayResponse(response);
    } catch (error: any) {
      logger.err(`子节点请求失败: ${error?.message || "unknown"}`);
      return new Response(JSON.stringify({ success: false, message: `子节点请求失败: ${error?.message || "未知错误"}` }), {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  });