/**
 * Docker CLI 共享封装
 *
 * 各 docker 子模块（containers / images / networks / volumes / compose / system）
 * 统一走这里，避免每个文件各写一份 spawn 逻辑。
 */

import { logger } from "../logger/index";

export async function docker(args: string[]): Promise<string> {
  const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(stderr.trim() || `docker 命令失败，退出码: ${exitCode}`);
  }
  return stdout;
}

/** 用于 `docker inspect` 这类输出单个合法 JSON 的命令 */
export async function dockerJson<T = any>(args: string[]): Promise<T> {
  const out = await docker(args);
  return JSON.parse(out);
}

/**
 * 用于 `--format={{json .}}` 这类**每行一个 JSON** 的命令。
 * 注意不能直接对整段输出做 JSON.parse——多于一条记录时那不是合法 JSON。
 */
export async function dockerJsonLines<T = any>(args: string[]): Promise<T[]> {
  const out = await docker(args);
  const result: T[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      result.push(JSON.parse(trimmed));
    } catch {
      // 跳过无法解析的行
    }
  }
  return result;
}

/** 流式读取 docker 输出，逐行回调；同时合并 stderr（pull/build 的进度走 stderr） */
export async function dockerStream(
  args: string[],
  onLine: (line: string) => void,
): Promise<number> {
  const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });

  const pump = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    }
    if (buffer.trim()) onLine(buffer);
  };

  await Promise.all([pump(proc.stdout as any), pump(proc.stderr as any)]);
  return await proc.exited;
}

/** docker 是否可用 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker(["version", "--format={{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 统一的路由响应包装：把异常转成 { success:false, message }，
 * 免得每个路由都写一遍 try/catch。
 */
export async function guard<T extends Record<string, unknown>>(
  action: string,
  fn: () => Promise<T>,
): Promise<T | { success: false; message: string }> {
  try {
    return await fn();
  } catch (e: any) {
    const message = (e?.message || "未知错误").trim();
    logger.err(`[docker] ${action} 失败: ${message}`);
    return { success: false, message };
  }
}

/** 解析 docker 返回的人类可读体积（如 "1.23GB"）为字节数，失败返回 0 */
export function parseSize(text: string | undefined): number {
  if (!text) return 0;
  const match = String(text).trim().match(/^([\d.]+)\s*([KMGT]?B)$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const factor: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return Math.round(value * (factor[unit] ?? 1));
}
