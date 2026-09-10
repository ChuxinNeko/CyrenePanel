import { Elysia } from "elysia";
import { hostname, platform, release, arch, totalmem, freemem, cpus, uptime } from "os";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { spawn, execSync } from "child_process";
import { getOnlineNodesCount, getLocalMetrics, getLocalNetworkUsage, getLocalDiskIoUsage } from "../nodes/index";
import { parseLinuxMounts, type MountEntry } from "./mounts";
import { sampleLinuxProcesses, type ProcessInfo } from "./processes";
import {
  getCpuDetail,
  getCpuTopology,
  getLoadDetail,
  getMemoryDetail,
  sampleCpuDetail,
} from "./detail";
import { DATA_DIR, LOG_DIR } from "../runtime-paths";
import { getMemoryInfo } from "../memory";
import { CYRENE_VERSION } from "../version";
import { auditLog, getRequestIp } from "../audit/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { logger } from "../logger/index";

const startTime = Date.now();

// CPU 时间分布是两次 /proc/stat 快照做差算的，采样点必须等间隔。
// 挂在固定周期上而不是随请求触发，否则相邻几毫秒的两次请求会算出失真的值。
sampleCpuDetail();
setInterval(sampleCpuDetail, 5000);

interface OfficialPanelRelease {
  version?: unknown;
  latestVersion?: unknown;
  changelog?: unknown;
  changes?: unknown;
  content?: unknown;
  releaseDate?: unknown;
  downloadUrl?: unknown;
}

const UPDATE_REQUEST_PATH = join(DATA_DIR, "update-request.json");
const UPDATE_LOG_PATH = join(LOG_DIR, "update.log");
const UPDATE_STATUS_PATH = join(DATA_DIR, "update-status.json");

interface PanelUpdateStatus {
  status?: string;
  version?: string;
  message?: string;
  updatedAt?: string;
}

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
  const profile = await resolveRequestProfile(jwt, request);
  if (!profile) return { ok: false, message: "未授权" };
  if (profile.role !== "admin" && profile.role !== "node") return { ok: false, message: "仅管理员可执行此操作" };
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

function readUpdateStatus(): PanelUpdateStatus | null {
  if (!existsSync(UPDATE_STATUS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(UPDATE_STATUS_PATH, "utf-8")) as PanelUpdateStatus;
  } catch {
    return null;
  }
}

function writeUpdateStatus(status: PanelUpdateStatus) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    UPDATE_STATUS_PATH,
    JSON.stringify(
      {
        ...status,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
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

interface DiskInode {
  total: number;
  used: number;
  free: number;
  percentage: number;
}

interface DiskInfo {
  filesystem: string;
  mount: string;
  /** 文件系统类型，如 ext4；Windows 上留空 */
  fstype: string;
  total: number;
  used: number;
  free: number;
  percentage: number;
  totalFormatted: string;
  usedFormatted: string;
  freeFormatted: string;
  /** statfs 报不出 inode 的文件系统（如 vfat）为 null */
  inodes: DiskInode | null;
}

/** statfs 的 files/ffree 就是 inode 总数与空闲数；vfat 之类会返回 0 */
function readInodes(stats: any): DiskInode | null {
  const total = Number(stats.files ?? 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const free = Number(stats.ffree ?? 0);
  const used = Math.max(0, total - free);
  return {
    total,
    used,
    free,
    percentage: Math.round((used / total) * 10000) / 100,
  };
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
        fstype: "",
        total,
        used,
        free,
        percentage: Math.round((used / total) * 100),
        totalFormatted: formatBytes(total),
        usedFormatted: formatBytes(used),
        freeFormatted: formatBytes(free),
        inodes: readInodes(stats),
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

  let mounts: MountEntry[];
  try {
    mounts = parseLinuxMounts(readFileSync("/proc/mounts", "utf-8"));
  } catch {
    // 读不到就退回只看根分区
    mounts = [{ device: "/", mount: "/", fstype: "" }];
  }

  for (const { device, mount, fstype } of mounts) {
    try {
      const stats = statfsSync(mount);
      const total = Number(stats.blocks) * Number(stats.bsize);
      if (total === 0) continue;
      const free = Number(stats.bfree) * Number(stats.bsize);
      const used = total - free;
      disks.push({
        // 这里以前填的是挂载点，导致界面上同一个路径显示两遍
        filesystem: device,
        mount,
        fstype,
        total,
        used,
        free,
        percentage: Math.round((used / total) * 100),
        totalFormatted: formatBytes(total),
        usedFormatted: formatBytes(used),
        freeFormatted: formatBytes(free),
        inodes: readInodes(stats),
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
        fstype: "",
        total,
        used,
        free,
        percentage: Math.round((used / total) * 100),
        totalFormatted: formatBytes(total),
        usedFormatted: formatBytes(used),
        freeFormatted: formatBytes(free),
        inodes: readInodes(stats),
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

// ── 进程列表采集 ─────────────────────────────────────────────────

async function getProcessList(): Promise<ProcessInfo[]> {
  if (platform() === "win32") {
    return getWindowsProcessList();
  }
  // Linux 走 /proc 两次采样，得到瞬时占用；ps 给的是生命周期均值
  return sampleLinuxProcesses(cpus().length);
}

function getWindowsProcessList(): ProcessInfo[] {
  try {
    const output = execSync(
      'powershell.exe -NoProfile -Command "Get-Process | ForEach-Object { $p = $_; [PSCustomObject]@{ Id = $p.Id; ProcessName = $p.ProcessName; CpuPct = 0; WorkingSet64 = $p.WorkingSet64; User = try { (Get-Process -Id $p.Id -IncludeUserName -ErrorAction SilentlyContinue).UserName } catch { $null } } } | ConvertTo-Json -Compress"',
      { encoding: "utf-8", timeout: 10000, windowsHide: true }
    );
    const parsed = JSON.parse(output || "[]");
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const totalMem = totalmem();

    // Get per-process CPU% via Get-Counter (snapshot)
    let cpuByPid: Record<number, number> = {};
    try {
      const cpuOutput = execSync(
        'powershell.exe -NoProfile -Command "$procs = Get-Counter \'\\Process(*)\\% Processor Time\' -ErrorAction SilentlyContinue; if ($procs) { $procs.CounterSamples | Where-Object { $_.InstanceName -ne \'_total\' -and $_.InstanceName -ne \'idle\' } | ForEach-Object { [PSCustomObject]@{ Name = $_.InstanceName; Pct = [math]::Round($_.CookedValue, 1) } } | ConvertTo-Json -Compress }"',
        { encoding: "utf-8", timeout: 8000, windowsHide: true }
      );
      if (cpuOutput.trim()) {
        const cpuRows = JSON.parse(cpuOutput);
        const cpuArr = Array.isArray(cpuRows) ? cpuRows : [cpuRows];
        // Map process name -> cpu%. Multiple instances get same name; distribute later.
        const nameCpuMap: Record<string, number[]> = {};
        for (const r of cpuArr) {
          const n = String(r?.Name ?? "").toLowerCase();
          const pct = Number(r?.Pct ?? 0);
          if (n && pct >= 0) {
            if (!nameCpuMap[n]) nameCpuMap[n] = [];
            nameCpuMap[n].push(pct);
          }
        }
        // Assign CPU% to rows by matching process name (round-robin for duplicates)
        const nameIndex: Record<string, number> = {};
        for (const row of rows) {
          const pName = String(row?.ProcessName ?? "").toLowerCase();
          if (nameCpuMap[pName]) {
            const idx = nameIndex[pName] ?? 0;
            cpuByPid[Number(row?.Id ?? 0)] = nameCpuMap[pName][idx % nameCpuMap[pName].length] ?? 0;
            nameIndex[pName] = idx + 1;
          }
        }
      }
    } catch {
      // CPU counter unavailable, leave all at 0
    }

    const numCores = cpus().length || 1;
    const processes: ProcessInfo[] = [];
    for (const row of rows) {
      const pid = Number(row?.Id ?? 0);
      const name = String(row?.ProcessName ?? "");
      const rawCpu = cpuByPid[pid] ?? 0;
      // Normalize: Get-Counter returns % across all cores (0-100*cores), normalize to 0-100
      const cpu = Math.round(Math.min(rawCpu / numCores, 100) * 10) / 10;
      const memBytes = Number(row?.WorkingSet64 ?? 0);
      const user = String(row?.User ?? "");
      const memPct = totalMem > 0 ? Math.round((memBytes / totalMem) * 1000) / 10 : 0;
      processes.push({
        pid,
        name,
        cpu,
        memory: memPct,
        memoryBytes: memBytes,
        user: user || "SYSTEM",
        command: name,
      });
    }
    // Sort by CPU descending
    processes.sort((a, b) => b.cpu - a.cpu);
    return processes.slice(0, 50);
  } catch {
    return [];
  }
}

function formatUptime(seconds: number): string {
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}天 ${hours}小时 ${minutes}分钟 ${secs}秒`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟 ${secs}秒`;
  if (minutes > 0) return `${minutes}分钟 ${secs}秒`;
  return `${secs}秒`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 发行版本。Linux 上 release() 拿到的是内核版本（5.15.0-92-generic），
 * 面板要显示的是「Ubuntu 22.04.3 LTS」这种发行版名，得读 /etc/os-release。
 */
function getDistroName(): string {
  if (platform() === "win32") return `Windows ${release()}`;
  if (platform() === "darwin") return `macOS ${release()}`;
  try {
    const content = readFileSync("/etc/os-release", "utf-8");
    const pretty = content.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (pretty?.[1]) return pretty[1];
    const name = content.match(/^NAME="?([^"\n]+)"?/m);
    if (name?.[1]) return name[1];
  } catch {
    // 非标准发行版或读不到，退回内核信息
  }
  return `${platform()} ${release()}`;
}

/** 主机地址：第一个非回环 IPv4，用于在面板上标识这台机器 */
function getHostAddress(): string {
  try {
    const { networkInterfaces } = require("os");
    for (const nets of Object.values(networkInterfaces()) as any[]) {
      for (const net of nets ?? []) {
        if ((net.family === "IPv4" || net.family === 4) && !net.internal) {
          return net.address;
        }
      }
    }
  } catch {
    // ignore
  }
  return "";
}

interface LoadAverage {
  one: number;
  five: number;
  fifteen: number;
  /** 按核心数归一化的百分比，供环形进度条直接使用 */
  percentage: number;
}

/**
 * 运行负载。Windows 上 os.loadavg() 恒返回 [0,0,0]，没有等价概念，
 * 前端据此隐藏该项而不是画一个永远为 0 的环。
 */
function getLoadAverage(): LoadAverage & { supported: boolean } {
  const { loadavg } = require("os");
  const [one = 0, five = 0, fifteen = 0] = loadavg() as number[];
  const cores = Math.max(cpus().length, 1);
  return {
    one: Number(one.toFixed(2)),
    five: Number(five.toFixed(2)),
    fifteen: Number(fifteen.toFixed(2)),
    percentage: Math.min(100, Math.round((one / cores) * 100)),
    supported: platform() !== "win32",
  };
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
      writeUpdateStatus({
        status: "submitted",
        version: latestVersion,
        message: "Update request submitted, waiting for updater service",
      });
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
    const status = readUpdateStatus();
    const lastLine = logs[logs.length - 1] || "";
    const failed = status?.status === "failed" || /failed|invalid|refusing|unsupported|required|not found|missing|must run|error/i.test(lastLine);
    const completed = status?.status === "completed" || /completed/i.test(lastLine);
    const requestExists = existsSync(UPDATE_REQUEST_PATH);
    const statusRunning = !!status?.status && ["submitted", "running", "downloading", "installing", "restarting"].includes(status.status);
    return {
      success: true,
      logs,
      running: (requestExists || statusRunning) && !completed && !failed,
      completed,
      failed,
      lastLine,
      status,
    };
  })
  .get("/api/system", async ({ jwt, request }: any) => {
    const profile = await resolveRequestProfile(jwt, request);
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
        // osVersion 历史上就是内核版本，保留字段名避免破坏既有调用；
        // kernelVersion 是语义更清楚的别名，distro 才是发行版名
        osVersion: release(),
        kernelVersion: release(),
        distro: getDistroName(),
        architecture: arch(),
        hostAddress: getHostAddress(),
        bootTime: formatDateTime(Date.now() - uptime() * 1000),
        loadAverage: getLoadDetail(),
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
        memory: (() => {
          const detail = getMemoryDetail();
          return {
            ...detail,
            totalFormatted: formatBytes(detail.total),
            usedFormatted: formatBytes(detail.used),
            freeFormatted: formatBytes(detail.free),
            sharedFormatted: formatBytes(detail.shared),
            availableFormatted: formatBytes(detail.available),
            buffersFormatted: formatBytes(detail.buffers),
            cachedFormatted: formatBytes(detail.cached),
          };
        })(),
        cpuDetail: getCpuDetail(),
        cpuTopology: getCpuTopology(),
        disks,
        network,
        diskIo,
        nodeCount,
        onlineNodeCount,
        metrics,
      },
    };
  })

  // ── 重启面板（仅当前节点） ────────────────────────────────────────
  .post("/api/system/restart/panel", async ({ jwt, request, server }: any) => {
    const auth = await requireAdmin(jwt, request);
    if (!auth.ok) return { success: false, message: auth.message };
    const ip = getRequestIp(request, server);
    auditLog({
      username: auth.profile.username,
      category: "system",
      action: "重启面板",
      target: hostname(),
      ip,
    });
    logger.warn(`管理员 ${auth.profile.username} 触发了面板重启`);

    setTimeout(() => {
      try {
        if (platform() === "linux") {
          // systemd 会重新拉起进程
          spawn("systemctl", ["restart", "cyrene-backend", "cyrene-frontend"], {
            detached: true,
            stdio: "ignore",
          }).unref();
        } else {
          // Windows / 其他平台：直接退出，依赖外部进程管理器拉起
          process.exit(0);
        }
      } catch (e: any) {
        logger.err(`面板重启失败: ${e.message}`);
      }
    }, 500);

    return {
      success: true,
      message:
        platform() === "linux"
          ? "面板重启指令已发送，约 5 秒后服务恢复"
          : "面板进程将退出，请确认有外部进程管理器（如服务/守护进程）会重新拉起。",
    };
  })

  // ── 重启服务器（整机） ─────────────────────────────────────────────
  .post("/api/system/restart/server", async ({ jwt, request, server }: any) => {
    const auth = await requireAdmin(jwt, request);
    if (!auth.ok) return { success: false, message: auth.message };
    const ip = getRequestIp(request, server);
    auditLog({
      username: auth.profile.username,
      category: "system",
      action: "重启服务器",
      target: hostname(),
      ip,
    });
    logger.warn(`管理员 ${auth.profile.username} 触发了服务器重启`);

    setTimeout(() => {
      try {
        if (platform() === "win32") {
          spawn("shutdown", ["/r", "/t", "5", "/c", "CyrenePanel restart"], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          }).unref();
        } else {
          // 优先 systemctl reboot；失败回退到 /sbin/shutdown
          const child = spawn("systemctl", ["reboot"], {
            detached: true,
            stdio: "ignore",
          });
          child.on("error", () => {
            spawn("shutdown", ["-r", "now"], {
              detached: true,
              stdio: "ignore",
            }).unref();
          });
          child.unref();
        }
      } catch (e: any) {
        logger.err(`服务器重启失败: ${e.message}`);
      }
    }, 500);

    return {
      success: true,
      message:
        platform() === "win32"
          ? "服务器将在约 5 秒后重启"
          : "重启指令已发送，服务器即将重启",
    };
  })

  // ── 进程列表（按 CPU/内存排序） ──────────────────────────────────
  /**
   * 状态卡悬停用的 top5。单独成端点而不是塞进 /api/system，
   * 是因为取进程要 spawn 一次 ps/Get-Process，跟着 5 秒轮询跑太浪费；
   * 这里只在鼠标悬停时拉一次。
   */
  .get("/api/system/top-processes", async ({ jwt, request }: any) => {
    const profile = await resolveRequestProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const all = await getProcessList();
      return {
        success: true,
        // getProcessList 已按 CPU 降序，内存榜要另排一次
        byCpu: all.slice(0, 5),
        byMemory: [...all].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 5),
      };
    } catch (e: any) {
      return { success: false, message: `获取进程列表失败: ${e.message}` };
    }
  })

  .get("/api/system/processes", async ({ jwt, request }: any) => {
    const profile = await resolveRequestProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };

    try {
      const processes = await getProcessList();
      return { success: true, processes };
    } catch (e: any) {
      return { success: false, message: `获取进程列表失败: ${e.message}` };
    }
  })

  // ── 关闭进程 ─────────────────────────────────────────────────────
  .post("/api/system/processes/:pid/kill", async ({ params, jwt, request, server }: any) => {
    const auth = await requireAdmin(jwt, request);
    if (!auth.ok) return { success: false, message: auth.message };

    const pid = parseInt(params.pid, 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      return { success: false, message: "无效的 PID" };
    }

    try {
      if (platform() === "win32") {
        execSync(`taskkill /PID ${pid} /F`, { encoding: "utf-8", timeout: 5000, windowsHide: true });
      } else {
        process.kill(pid, "SIGKILL");
      }
      auditLog({
        username: auth.profile.username,
        category: "system",
        action: "终止进程",
        target: `PID ${pid}`,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: `进程 ${pid} 已终止` };
    } catch (e: any) {
      return { success: false, message: `终止进程失败: ${e.message}` };
    }
  });
