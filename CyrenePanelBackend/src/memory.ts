import { totalmem, freemem, platform } from "os";
import { readFileSync } from "fs";

/**
 * 获取准确的内存信息。
 * Linux 上读取 /proc/meminfo 的 MemAvailable（排除 buffers/cache），
 * Windows 或不可用时降级使用 os.freemem()。
 */
export function getMemoryInfo(): { total: number; used: number; free: number } {
  const total = totalmem();

  if (platform() !== "win32") {
    try {
      const content = readFileSync("/proc/meminfo", "utf-8");
      const match = content.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (match) {
        const availableKB = parseInt(match[1], 10);
        const available = availableKB * 1024;
        return { total, used: total - available, free: available };
      }
    } catch {
      // /proc/meminfo 不可用 (macOS 等)，降级
    }
  }

  const free = freemem();
  return { total, used: total - free, free };
}
