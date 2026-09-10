/**
 * 概览页状态卡悬停详情所需的采集。
 *
 * 和 mounts.ts 一样刻意做成低副作用模块：解析函数都是纯函数，
 * 只有 CPU 时间分布需要保存上一次快照（速率必须靠差值算）。
 */

import { cpus, platform, totalmem, freemem, loadavg } from "os";
import { readFileSync } from "fs";

// ── 负载 ─────────────────────────────────────────────────────────────

export interface LoadDetail {
  one: number;
  five: number;
  fifteen: number;
  /** 按核心数归一化的百分比，环形进度条用 */
  percentage: number;
  /** 当前可运行进程数 */
  runningProcesses: number;
  /** 系统进程总数 */
  totalProcesses: number;
  supported: boolean;
}

/** /proc/loadavg 第 4 个字段形如 "1/298"，即 可运行数/总数 */
export function parseLoadAvgProcesses(content: string): { running: number; total: number } {
  const field = content.trim().split(/\s+/)[3] ?? "";
  const [running, total] = field.split("/").map((n) => Number(n));
  return {
    running: Number.isFinite(running) ? running : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

export function getLoadDetail(): LoadDetail {
  const [one = 0, five = 0, fifteen = 0] = loadavg();
  const cores = Math.max(cpus().length, 1);
  let running = 0;
  let total = 0;
  try {
    if (platform() !== "win32") {
      ({ running, total } = parseLoadAvgProcesses(readFileSync("/proc/loadavg", "utf-8")));
    }
  } catch {
    // 读不到就留 0，前端显示 —
  }
  return {
    one: Number(one.toFixed(2)),
    five: Number(five.toFixed(2)),
    fifteen: Number(fifteen.toFixed(2)),
    percentage: Math.min(100, Math.round((one / cores) * 100)),
    runningProcesses: running,
    totalProcesses: total,
    // Windows 上 loadavg 恒为 0 且无等价概念
    supported: platform() !== "win32",
  };
}

// ── CPU 时间分布与每核占用 ────────────────────────────────────────────

export interface CpuTimes {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
  guest: number;
  guestNice: number;
}

export interface CpuStatSnapshot {
  /** 各字段的累计 jiffies */
  total: number[];
  /** 每个逻辑核的累计 jiffies */
  cores: number[][];
}

const CPU_FIELDS: Array<keyof CpuTimes> = [
  "user", "nice", "system", "idle", "iowait",
  "irq", "softirq", "steal", "guest", "guestNice",
];

/**
 * 解析 /proc/stat 的 cpu 行。
 * 第一行 "cpu " 是汇总，后面 "cpu0" "cpu1" … 是每个逻辑核。
 */
export function parseProcStat(content: string): CpuStatSnapshot | null {
  let total: number[] | null = null;
  const cores: number[][] = [];

  for (const line of content.split("\n")) {
    if (!line.startsWith("cpu")) continue;
    const parts = line.trim().split(/\s+/);
    const label = parts[0];
    const nums = parts.slice(1).map(Number);
    if (nums.some(Number.isNaN)) continue;
    if (label === "cpu") total = nums;
    else if (/^cpu\d+$/.test(label)) cores.push(nums);
  }

  return total ? { total, cores } : null;
}

function readCpuStatSnapshot(): CpuStatSnapshot | null {
  try {
    if (platform() !== "win32") {
      return parseProcStat(readFileSync("/proc/stat", "utf-8"));
    }
    // Windows 没有 /proc/stat，退回 os.cpus()。它只有 5 档，
    // iowait / steal / guest 这些拿不到，留 0 并由 supported 标记
    const list = cpus();
    const cores = list.map((c) => [
      c.times.user, c.times.nice, c.times.sys, c.times.idle, 0, c.times.irq, 0, 0, 0, 0,
    ]);
    const total = cores.reduce(
      (acc, cur) => acc.map((v, i) => v + cur[i]),
      new Array(10).fill(0) as number[],
    );
    return { total, cores };
  } catch {
    return null;
  }
}

let previousCpuStat: CpuStatSnapshot | null = null;
let lastCpuTimes: CpuTimes | null = null;
let lastCoreUsage: number[] = [];

function toPercentages(current: number[], previous: number[]): CpuTimes {
  const deltas = current.map((v, i) => Math.max(0, v - (previous[i] ?? 0)));
  const sum = deltas.reduce((a, b) => a + b, 0);
  const pct = (i: number) =>
    sum > 0 ? Number(((deltas[i] ?? 0) / sum * 100).toFixed(1)) : 0;
  const result = {} as CpuTimes;
  CPU_FIELDS.forEach((field, i) => {
    result[field] = pct(i);
  });
  return result;
}

export interface CpuDetail {
  times: CpuTimes | null;
  /** 每个逻辑核的占用率，顺序即 cpu0..cpuN */
  coreUsage: number[];
  /** Windows 上 iowait / steal / guest 等字段拿不到 */
  fullTimesSupported: boolean;
}

/**
 * 采样 CPU 时间分布。只应由定时循环调用 —— 百分比是两次快照做差算的，
 * 采样点必须等间隔，被请求随机触发会算出失真的值。
 */
export function sampleCpuDetail(): CpuDetail {
  const current = readCpuStatSnapshot();
  if (!current) {
    return { times: lastCpuTimes, coreUsage: lastCoreUsage, fullTimesSupported: platform() !== "win32" };
  }

  if (previousCpuStat) {
    lastCpuTimes = toPercentages(current.total, previousCpuStat.total);
    lastCoreUsage = current.cores.map((core, i) => {
      const prev = previousCpuStat!.cores[i];
      if (!prev) return 0;
      const deltas = core.map((v, j) => Math.max(0, v - (prev[j] ?? 0)));
      const sum = deltas.reduce((a, b) => a + b, 0);
      // idle 是第 4 个字段（索引 3）
      const idle = deltas[3] ?? 0;
      return sum > 0 ? Math.round((1 - idle / sum) * 100) : 0;
    });
  }

  previousCpuStat = current;
  return {
    times: lastCpuTimes,
    coreUsage: lastCoreUsage,
    fullTimesSupported: platform() !== "win32",
  };
}

export function getCpuDetail(): CpuDetail {
  return {
    times: lastCpuTimes,
    coreUsage: lastCoreUsage,
    fullTimesSupported: platform() !== "win32",
  };
}

// ── CPU 拓扑 ─────────────────────────────────────────────────────────

export interface CpuTopology {
  model: string;
  /** 物理 CPU（插槽）数 */
  physicalCount: number;
  /** 物理核心总数 */
  physicalCores: number;
  /** 逻辑核心数 */
  logicalCores: number;
}

/** 从 /proc/cpuinfo 数插槽和物理核心：physical id 去重、(physical id, core id) 对去重 */
export function parseCpuTopology(content: string, fallbackLogical: number): Omit<CpuTopology, "model"> {
  const sockets = new Set<string>();
  const coreKeys = new Set<string>();
  let logical = 0;
  let currentPhysical = "";

  for (const line of content.split("\n")) {
    const [rawKey, rawValue] = line.split(":");
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (key === "processor") logical++;
    else if (key === "physical id") {
      currentPhysical = value;
      sockets.add(value);
    } else if (key === "core id") {
      coreKeys.add(`${currentPhysical}:${value}`);
    }
  }

  const logicalCores = logical || fallbackLogical;
  return {
    // 容器或部分虚拟机里 /proc/cpuinfo 没有 physical id，退回 1 个插槽
    physicalCount: sockets.size || 1,
    physicalCores: coreKeys.size || logicalCores,
    logicalCores,
  };
}

export function getCpuTopology(): CpuTopology {
  const list = cpus();
  const model = list[0]?.model?.trim() || "Unknown";
  const logical = list.length || 1;
  if (platform() === "win32") {
    return { model, physicalCount: 1, physicalCores: logical, logicalCores: logical };
  }
  try {
    return { model, ...parseCpuTopology(readFileSync("/proc/cpuinfo", "utf-8"), logical) };
  } catch {
    return { model, physicalCount: 1, physicalCores: logical, logicalCores: logical };
  }
}

// ── 内存明细 ─────────────────────────────────────────────────────────

export interface MemoryDetail {
  total: number;
  free: number;
  used: number;
  shared: number;
  available: number;
  buffers: number;
  cached: number;
  percentage: number;
  /** Windows 上 shared / buffers / cached 无对应概念 */
  detailSupported: boolean;
}

/** /proc/meminfo 的值单位是 kB */
export function parseMemInfo(content: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of content.split("\n")) {
    const [key, rest] = line.split(":");
    if (!key || !rest) continue;
    const value = Number(rest.trim().split(/\s+/)[0]);
    if (Number.isFinite(value)) result[key.trim()] = value * 1024;
  }
  return result;
}

export function getMemoryDetail(): MemoryDetail {
  const fallbackTotal = totalmem();
  const fallbackFree = freemem();

  if (platform() === "win32") {
    const used = fallbackTotal - fallbackFree;
    return {
      total: fallbackTotal,
      free: fallbackFree,
      used,
      shared: 0,
      available: fallbackFree,
      buffers: 0,
      cached: 0,
      percentage: fallbackTotal > 0 ? Math.round((used / fallbackTotal) * 100) : 0,
      detailSupported: false,
    };
  }

  try {
    const info = parseMemInfo(readFileSync("/proc/meminfo", "utf-8"));
    const total = info.MemTotal ?? fallbackTotal;
    const free = info.MemFree ?? fallbackFree;
    const buffers = info.Buffers ?? 0;
    // free(1) 把 SReclaimable 也算进 cache
    const cached = (info.Cached ?? 0) + (info.SReclaimable ?? 0);
    const available = info.MemAvailable ?? free;
    // 与 free(1) 的口径一致：used = total - free - buffers - cache
    const used = Math.max(0, total - free - buffers - cached);
    return {
      total,
      free,
      used,
      shared: info.Shmem ?? 0,
      available,
      buffers,
      cached,
      percentage: total > 0 ? Math.round((used / total) * 100) : 0,
      detailSupported: true,
    };
  } catch {
    const used = fallbackTotal - fallbackFree;
    return {
      total: fallbackTotal,
      free: fallbackFree,
      used,
      shared: 0,
      available: fallbackFree,
      buffers: 0,
      cached: 0,
      percentage: fallbackTotal > 0 ? Math.round((used / fallbackTotal) * 100) : 0,
      detailSupported: false,
    };
  }
}
