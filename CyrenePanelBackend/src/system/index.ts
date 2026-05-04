import { Elysia } from "elysia";
import { hostname, platform, release, arch, totalmem, freemem, cpus, uptime } from "os";
import { readFileSync, existsSync } from "fs";
import { getOnlineNodesCount } from "../nodes/index";

const startTime = Date.now();

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
  .get("/api/system", async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const totalMem = totalmem();
    const freeMem = freemem();
    const usedMem = totalMem - freeMem;
    const disks = getDiskUsage();
    const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";

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
        panelVersion: "1.0.50",
        cpu: {
          cores: cpus().length,
          model: cpus()[0]?.model || "Unknown",
          usage: getCpuUsage(),
        },
        memory: {
          total: totalMem,
          used: usedMem,
          free: freeMem,
          totalFormatted: formatBytes(totalMem),
          usedFormatted: formatBytes(usedMem),
          freeFormatted: formatBytes(freeMem),
          percentage: Math.round((usedMem / totalMem) * 100),
        },
        disks,
        nodeCount,
        onlineNodeCount,
      },
    };
  });