/**
 * Linux 进程采集。
 *
 * 原来用 `ps aux --sort=-%cpu` 取，有两个问题：
 *
 * 1. ps 的 %CPU 是**生命周期均值**（累计 CPU 时间 ÷ 存活时长），不是瞬时占用。
 *    一个昨天跑满、此刻空闲的进程照样显示很高；反过来刚刚开始飙的进程又显示很低。
 * 2. ps 会把自己也列进结果。它刚 fork 出来、存活时间极短，均值算下来接近满核，
 *    在 4 核机器上归一化后就是一个凭空冒出来的 25%。
 *
 * 现在直接读两次 /proc 做差，得到区间内的真实占用；也不再 spawn 子进程。
 */

import { readFileSync, readdirSync } from "fs";

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  memoryBytes: number;
  user: string;
  command: string;
}

interface RawSample {
  pid: number;
  /** utime + stime，单位是时钟滴答 */
  jiffies: number;
  rssPages: number;
  comm: string;
}

/** 绝大多数 Linux 上 USER_HZ 固定为 100 */
const USER_HZ = 100;
const PAGE_SIZE = 4096;

function listPids(): number[] {
  try {
    return readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .map(Number);
  } catch {
    return [];
  }
}

/**
 * 解析 /proc/<pid>/stat。
 * comm 字段被小括号包住且可能自带空格甚至括号，所以按最后一个 ')' 切开，
 * 不能直接按空格 split。
 */
export function parseProcPidStat(content: string): { comm: string; jiffies: number; rssPages: number } | null {
  const close = content.lastIndexOf(")");
  const open = content.indexOf("(");
  if (open < 0 || close < 0 || close < open) return null;

  const comm = content.slice(open + 1, close);
  // close 之后是 state，即原始字段编号的第 3 项
  const rest = content.slice(close + 2).trim().split(/\s+/);
  // 原始编号 14=utime 15=stime 24=rss，rest[0] 对应编号 3
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  const rssPages = Number(rest[21]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;

  return {
    comm,
    jiffies: utime + stime,
    rssPages: Number.isFinite(rssPages) ? rssPages : 0,
  };
}

function readUid(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/^Uid:\s+(\d+)/m);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function snapshot(): Map<number, RawSample> {
  const map = new Map<number, RawSample>();
  for (const pid of listPids()) {
    try {
      const parsed = parseProcPidStat(readFileSync(`/proc/${pid}/stat`, "utf-8"));
      if (!parsed) continue;
      map.set(pid, { pid, jiffies: parsed.jiffies, rssPages: parsed.rssPages, comm: parsed.comm });
    } catch {
      // 进程在采样过程中退出属于常态，跳过即可
    }
  }
  return map;
}

/** uid → 用户名。/etc/passwd 基本不变，读一次缓存住 */
let uidCache: Map<number, string> | null = null;
function uidToName(uid: number): string {
  if (!uidCache) {
    uidCache = new Map();
    try {
      for (const line of readFileSync("/etc/passwd", "utf-8").split("\n")) {
        const parts = line.split(":");
        if (parts.length >= 3) uidCache.set(Number(parts[2]), parts[0]);
      }
    } catch {
      // 读不到就退回显示 uid 数字
    }
  }
  return uidCache.get(uid) ?? String(uid);
}

function readCmdline(pid: number, fallback: string): string {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    const joined = raw.split("\0").filter(Boolean).join(" ").trim();
    // 内核线程的 cmdline 是空的，退回 comm
    return joined || fallback;
  } catch {
    return fallback;
  }
}

/**
 * 两次采样之间的真实 CPU 占用。
 * intervalMs 越大越准，但接口响应也越慢；300ms 足以区分开忙闲。
 */
export async function sampleLinuxProcesses(
  cores: number,
  intervalMs = 300,
): Promise<ProcessInfo[]> {
  const totalMemory = (() => {
    try {
      const match = readFileSync("/proc/meminfo", "utf-8").match(/^MemTotal:\s+(\d+)/m);
      return match ? Number(match[1]) * 1024 : 0;
    } catch {
      return 0;
    }
  })();

  const first = snapshot();
  const startedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  const second = snapshot();
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);

  const safeCores = Math.max(cores, 1);
  const scored: Array<{ pid: number; comm: string; cpu: number; memoryBytes: number }> = [];

  for (const [pid, now] of second) {
    const before = first.get(pid);
    // 采样区间内新起的进程没有基准，这一轮先不计
    if (!before) continue;

    const deltaJiffies = Math.max(0, now.jiffies - before.jiffies);
    scored.push({
      pid,
      comm: now.comm,
      cpu: Math.round(Math.min((deltaJiffies / USER_HZ) / elapsedSeconds / safeCores * 100, 100) * 10) / 10,
      memoryBytes: now.rssPages * PAGE_SIZE,
    });
  }

  // 按 CPU 和内存各取前 50，只对这批补 user / cmdline ——
  // 全量补的话要为一千多个进程各读两个 /proc 文件，没必要
  scored.sort((a, b) => b.cpu - a.cpu);
  const topCpu = scored.slice(0, 50);
  const topMemory = [...scored].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 50);
  const needed = new Map(topCpu.concat(topMemory).map((p) => [p.pid, p]));

  const enriched = new Map<number, ProcessInfo>();
  for (const [pid, p] of needed) {
    enriched.set(pid, {
      pid,
      name: p.comm,
      cpu: p.cpu,
      memory: totalMemory > 0 ? Math.round((p.memoryBytes / totalMemory) * 1000) / 10 : 0,
      memoryBytes: p.memoryBytes,
      user: uidToName(readUid(pid)),
      command: readCmdline(pid, p.comm),
    });
  }

  // 返回两榜的并集：调用方要按内存重排时，光给 CPU 前 50 会漏掉
  // 那些内存大户（它们可能一点 CPU 都不占）。仍按 CPU 降序，与既有调用方一致。
  return [...enriched.values()].sort((a, b) => b.cpu - a.cpu);
}
