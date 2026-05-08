import { Elysia } from "elysia";
import { hostname, platform, release, arch, totalmem, freemem, cpus, uptime } from "os";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getOnlineNodesCount, getLocalMetrics, getLocalNetworkUsage, getLocalDiskIoUsage } from "../nodes/index";
import { getMemoryInfo } from "../memory";
import { CYRENE_VERSION } from "../version";

const startTime = Date.now();

interface OfficialPanelRelease {
  version?: unknown;
  latestVersion?: unknown;
  changelog?: unknown;
  changes?: unknown;
  content?: unknown;
  releaseDate?: unknown;
  downloadUrl?: unknown;
}

const DATA_DIR = join(process.cwd(), "data");
const LOG_DIR = join(process.cwd(), "logs");
const UPDATE_REQUEST_PATH = join(DATA_DIR, "update-request.json");
const UPDATE_LOG_PATH = join(LOG_DIR, "update.log");

function getOfficialServerUrl(): string {
  return (
    process.env.CYRENE_OFFICIAL_SERVER_URL ||
    process.env.OFFICIAL_SERVER_URL ||
    "https://dockerhub.nekofun.top"
  ).replace(/\/+$/, "");
}

function getGitHubRepo(): string {
  return (process.env.CYRENE_REPO || "ChuxinNeko/CyrenePanel").replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
}

function getSystemReleaseArch(): string | null {
  const systemArch = arch();
  if (systemArch === "x64" || systemArch === "amd64") return "x64";
  if (systemArch === "arm64" || systemArch === "aarch64") return "arm64";
  return null;
}

function getGitHubReleaseDownloadUrl(version: string): string | null {
  if (platform() !== "linux") return null;
  const releaseArch = getSystemReleaseArch();
  if (!releaseArch) return null;
  const releaseVersion = version.replace(/^v/i, "");
  const releaseTag = `v${releaseVersion}`;
  const assetName = `CyrenePanel${releaseVersion}-linux-${releaseArch}.zip`;
  return `https://github.com/${getGitHubRepo()}/releases/download/${releaseTag}/${assetName}`;
}

async function requireAdmin(jwt: any, request: Request): Promise<{ ok: true; profile: any } | { ok: false; message: string }> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { ok: false, message: "未授权" };
  const profile = await jwt.verify(token);
  if (!profile) return { ok: false, message: "未授权" };
  if (profile.role !== "admin") return { ok: false, message: "仅管理员可执行此操作" };
  return { ok: true, profile };
}

function readUpdateLogs(): string[] {
  if (!existsSync(UPDATE_LOG_PATH)) return [];
  return readFileSync(UPDATE_LOG_PATH, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-80);
}

function normalizeVersion(version: string): number[] {
  const match = version.trim().replace(/^v/i, "").match(/\d+(?:\.\d+)*/);
  if (!match) return [0];
  return match[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeChangelog(release: OfficialPanelRelease): string[] {
  const source = release.changelog ?? release.changes ?? release.content;
  if (Array.isArray(source)) {
    return source
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof source === "string") {
    return source
      .split(/\r?\n/)
      .map((item) => item.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

async function fetchOfficialPanelRelease(): Promise<OfficialPanelRelease> {
  const url = `${getOfficialServerUrl()}/panel/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`official server responded ${res.status}`);
    return await res.json() as OfficialPanelRelease;
  } finally {
    clearTimeout(timer);
  }
}

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

interface DiskInfo {
  filesystem: string;
  mount: string;
  total: number;
  used: number;
  free: number;
  percentage: number;
  totalFormatted: string;
  usedFormatted: string;
  freeFormatted: string;
}

function getDiskUsage(): DiskInfo[] {
  try {
    if (platform() === "win32") {
      return getWindowsDisks();
    }
    return getLinuxDisks();
  } catch {
    return [];
  }
}

function getWindowsDisks(): DiskInfo[] {
  const disks: DiskInfo[] = [];
  // Windows: check A-Z drive letters
  const { statfsSync } = require("fs");
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const mount = `${letter}:\\`;
    try {
      if (!existsSync(mount)) continue;
      const stats = statfsSync(mount);
      const total = Number(stats.blocks) * Number(stats.bsize);
      if (total === 0) continue;
      const free = Number(stats.bfree) * Number(stats.bsize);
      const used = total - free;
      disks.push({
        filesystem: `${letter}:`,
        mount,
        total,
        used,
        free,
        percentage: Math.round((used / total) * 100),
        totalFormatted: formatBytes(total),
        usedFormatted: formatBytes(used),
        freeFormatted: formatBytes(free),
      });
    } catch {
      // drive not ready or inaccessible, skip
    }
  }
  return disks;
}

function getLinuxDisks(): DiskInfo[] {
  const disks: DiskInfo[] = [];
  const { statfsSync, readFileSync } = require("fs");

  // Parse /proc/mounts to find real mount points
  let mountPoints: string[] = [];
  try {
    const content = readFileSync("/proc/mounts", "utf-8");
    const seen = new Set<string>();
    for (const line of content.split("\n")) {
      const parts = line.split(" ");
      if (parts.length < 2) continue;
      const device = parts[0];
      const mount = parts[1];
      // Only consider real block devices (e.g. /dev/sda1, /dev/nvme0n1p2)
      if (!device.startsWith("/dev/")) continue;
      if (seen.has(mount)) continue;
      seen.add(mount);
      mountPoints.push(mount);
    }
  } catch {
    // fallback: just check root
    mountPoints = ["/"];
  }

  for (const mount of mountPoints) {
    try {
      const stats = statfsSync(mount);
      const total = Number(stats.blocks) * Number(stats.bsize);
      if (total === 0) continue;
      const free = Number(stats.bfree) * Number(stats.bsize);
      const used = total - free;
      disks.push({
        filesystem: mount,
        mount,
        total,
        used,
        free,
        percentage: Math.round((used / total) * 100),
        totalFormatted: formatBytes(total),
        usedFormatted: formatBytes(used),
        freeFormatted: formatBytes(free),
      });
    } catch {
      // inaccessible mount, skip
    }
  }

  // If no /dev/ mounts found, fallback to root
  if (disks.length === 0) {
    try {
      const stats = statfsSync("/");
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bfree) * Number(stats.bsize);
      const used = total - free;
      disks.push({
        filesystem: "/",
        mount: "/",
        total,
        used,
        free,
        percentage: Math.round((used / total) * 100),
        totalFormatted: formatBytes(total),
        usedFormatted: formatBytes(used),
        freeFormatted: formatBytes(free),
      });
    } catch {
      // ignore
    }
  }

  return disks;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时 ${minutes}分钟`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

export const systemRoutes = new Elysia()
  .get("/api/system/version", () => ({ success: true, version: CYRENE_VERSION }))
  .get("/api/system/update", async () => {
    try {
      const release = await fetchOfficialPanelRelease();
      const latestVersion =
        typeof release.version === "string"
          ? release.version
          : typeof release.latestVersion === "string"
            ? release.latestVersion
            : "";

      if (!latestVersion) {
        return {
          success: false,
          message: "官方服务器未返回有效版本号",
          currentVersion: CYRENE_VERSION,
        };
      }

      return {
        success: true,
        currentVersion: CYRENE_VERSION,
        latestVersion,
        hasUpdate: compareVersions(latestVersion, CYRENE_VERSION) > 0,
        changelog: normalizeChangelog(release),
        releaseDate: typeof release.releaseDate === "string" ? release.releaseDate : null,
        downloadUrl: typeof release.downloadUrl === "string" ? release.downloadUrl : null,
        githubDownloadUrl: getGitHubReleaseDownloadUrl(latestVersion),
        canAutoUpdate: platform() === "linux" && !!getSystemReleaseArch() && existsSync("/usr/local/bin/cyp-update-apply"),
      };
    } catch (e: any) {
      return {
        success: false,
        message: `检查更新失败: ${e?.message || "unknown error"}`,
        currentVersion: CYRENE_VERSION,
      };
    }
  })
  .post("/api/system/update/apply", async ({ jwt, request }: any) => {
    const auth = await requireAdmin(jwt, request);
    if (!auth.ok) return { success: false, message: auth.message };
    if (platform() !== "linux") return { success: false, message: "自动更新仅支持 Linux 部署环境" };

    const releaseArch = getSystemReleaseArch();
    if (!releaseArch) return { success: false, message: `不支持的系统架构：${arch()}` };
    if (!existsSync("/usr/local/bin/cyp-update-apply")) {
      return { success: false, message: "未安装自动更新助手，请先使用新版一键脚本重新部署一次" };
    }

    try {
      const release = await fetchOfficialPanelRelease();
      const latestVersion =
        typeof release.version === "string"
          ? release.version
          : typeof release.latestVersion === "string"
            ? release.latestVersion
            : "";

      if (!latestVersion) {
        return { success: false, message: "官方服务器未返回有效版本号" };
      }

      if (compareVersions(latestVersion, CYRENE_VERSION) <= 0) {
        return {
          success: false,
          message: "当前已经是最新版本",
          currentVersion: CYRENE_VERSION,
          latestVersion,
        };
      }

      const githubDownloadUrl = getGitHubReleaseDownloadUrl(latestVersion);
      if (!githubDownloadUrl) return { success: false, message: "无法生成 GitHub Release 下载地址" };

      mkdirSync(DATA_DIR, { recursive: true });
      mkdirSync(LOG_DIR, { recursive: true });
      writeFileSync(
        UPDATE_LOG_PATH,
        `[${new Date().toLocaleString()}] Update requested for ${latestVersion} by ${auth.profile.username}\n`,
      );
      writeFileSync(
        UPDATE_REQUEST_PATH,
        JSON.stringify(
          {
            version: latestVersion,
            currentVersion: CYRENE_VERSION,
            repo: getGitHubRepo(),
            downloadUrl: githubDownloadUrl,
            requestedBy: auth.profile.username,
            requestedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      return {
        success: true,
        message: "更新任务已提交，面板将自动下载并重启",
        currentVersion: CYRENE_VERSION,
        latestVersion,
        githubDownloadUrl,
      };
    } catch (e: any) {
      return {
        success: false,
        message: `提交更新失败: ${e?.message || "unknown error"}`,
        currentVersion: CYRENE_VERSION,
      };
    }
  })
  .get("/api/system/update/logs", async ({ jwt, request }: any) => {
    const auth = await requireAdmin(jwt, request);
    if (!auth.ok) return { success: false, message: auth.message, logs: [] };
    const logs = readUpdateLogs();
    const lastLine = logs[logs.length - 1] || "";
    const failed = /failed|invalid|refusing|unsupported|required|not found|missing|must run|error/i.test(lastLine);
    const completed = /completed/i.test(lastLine);
    return {
      success: true,
      logs,
      running: existsSync(UPDATE_REQUEST_PATH) && !completed && !failed,
      completed,
      failed,
      lastLine,
    };
  })
  .get("/api/system", async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const mem = getMemoryInfo();
    const disks = getDiskUsage();
    const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";
    const metrics = getLocalMetrics();
    const latestMetric = metrics[metrics.length - 1];
    const network = getLocalNetworkUsage();
    const diskIo = getLocalDiskIoUsage();

    const { total: nodeCount, online: onlineNodeCount } = await getOnlineNodesCount();
    
    return {
      success: true,
      system: {
        hostname: hostname(),
        platform: platform(),
        osVersion: release(),
        architecture: arch(),
        uptime: formatUptime(uptime()),
        uptimeSeconds: Math.floor(uptime()),
        serverUptime: formatUptime((Date.now() - startTime) / 1000),
        runtimeVersion: `Bun ${bunVersion}`,
        panelVersion: CYRENE_VERSION,
        cpu: {
          cores: cpus().length,
          model: cpus()[0]?.model || "Unknown",
          usage: latestMetric?.cpu ?? getCpuUsage(),
        },
        memory: {
          total: mem.total,
          used: mem.used,
          free: mem.free,
          totalFormatted: formatBytes(mem.total),
          usedFormatted: formatBytes(mem.used),
          freeFormatted: formatBytes(mem.free),
          percentage: Math.round((mem.used / mem.total) * 100),
        },
        disks,
        network,
        diskIo,
        nodeCount,
        onlineNodeCount,
        metrics,
      },
    };
  });
