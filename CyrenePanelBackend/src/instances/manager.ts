import {
  getInstance,
  getInstanceConfig,
  setStatus,
  appendLog,
  getLogs,
  setClients,
  getClients,
  removeClients,
  clearLogs,
  type InstanceConfig,
} from "./store";
import { logger } from "../logger/index";

// ── 类型 ─────────────────────────────────────────────────────────────────

interface RunningProcess {
  proc: ReturnType<typeof Bun.spawn>;
}

// ── 内部状态 ─────────────────────────────────────────────────────────────

const processes = new Map<string, RunningProcess>();

/** 记录每个实例正在执行的 stop 操作的 Promise，防止重复 stop */
const stopLocks = new Map<string, Promise<void>>();

// ── 命令解析 ─────────────────────────────────────────────────────────────

function parseCommand(command: string): string[] {
  // 支持引号包裹的参数
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of command) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

// ── 读取进程 stdout/stderr 的异步循环 ────────────────────────────────────

async function pipeStream(
  id: string,
  stream: ReadableStream<Uint8Array>,
  prefix: string
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      appendLog(id, text);
      // 广播给所有已连接的 WS 客户端
      const clients = getClients(id);
      if (clients) {
        for (const ws of clients) {
          try {
            ws.send(text);
          } catch {
            // 客户端已断开，忽略
          }
        }
      }
    }
  } catch {
    // stream 关闭
  }
}

// ── 启动实例 ─────────────────────────────────────────────────────────────

export async function startInstance(id: string): Promise<{ ok: boolean; message: string }> {
  const cfg = getInstanceConfig(id);
  if (!cfg) return { ok: false, message: "实例不存在" };

  // 已在运行
  if (processes.has(id)) return { ok: false, message: "实例已在运行" };

  clearLogs(id);

  const args = parseCommand(cfg.command);
  if (args.length === 0) return { ok: false, message: "启动命令为空" };

  const program = args[0];
  const programArgs = args.slice(1);

  try {
    // Windows 需要使用 shell 来执行命令
    const isWindows = process.platform === "win32";
    const proc = Bun.spawn(isWindows ? ["cmd", "/c", cfg.command] : [program, ...programArgs], {
      cwd: cfg.cwd,
      env: { ...process.env, ...cfg.env },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      ...(isWindows ? {} : { shell: false }),
    });

    processes.set(id, { proc });
    setStatus(id, "running", {
      pid: proc.pid,
      startedAt: Date.now(),
      exitCode: null,
    });

    logger.info(`实例已启动: ${cfg.name} (PID: ${proc.pid})`);

    // 异步读取 stdout 和 stderr（不阻塞主线程）
    pipeStream(id, proc.stdout, "stdout");
    pipeStream(id, proc.stderr, "stderr");

    // 监听进程退出
    proc.exited.then((code) => {
      processes.delete(id);
      setStatus(id, "stopped", { exitCode: code });
      logger.info(`实例已退出: ${cfg.name} (code: ${code})`);

      // 先通知所有 WS 客户端进程退出，再清理客户端集合
      const clients = getClients(id);
      if (clients) {
        const exitMsg = JSON.stringify({ type: "exit", code });
        for (const ws of clients) {
          try {
            ws.send(exitMsg);
          } catch {
            // ignore
          }
        }
      }
      removeClients(id);

      // 自动重启
      if (cfg.autoRestart && code !== 0) {
        // 只有当实例仍然存在于配置中时才重启
        const currentCfg = getInstanceConfig(id);
        if (!currentCfg) {
          logger.info(`实例 ${cfg.name} 已被删除，停止自动重启。`);
          return;
        }

        logger.info(`实例 ${cfg.name} 崩溃，3 秒后自动重启...`);
        setTimeout(() => {
          // 再次检查，防止在等待期间被删除
          if (getInstanceConfig(id)) {
            startInstance(id);
          }
        }, 3000);
      }
    });

    return { ok: true, message: "启动成功" };
  } catch (e: any) {
    setStatus(id, "error", { exitCode: -1 });
    appendLog(id, `启动失败: ${e.message}`);
    logger.err(`实例启动失败: ${cfg.name} - ${e.message}`);
    return { ok: false, message: `启动失败: ${e.message}` };
  }
}

// ── 停止实例 ─────────────────────────────────────────────────────────────

export async function stopInstance(id: string): Promise<{ ok: boolean; message: string }> {
  const entry = processes.get(id);
  if (!entry) return { ok: false, message: "实例未在运行" };

  // 如果已经在执行 stop，等待其完成
  const existingLock = stopLocks.get(id);
  if (existingLock) {
    await existingLock;
    return { ok: true, message: "停止成功" };
  }

  let resolveLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  stopLocks.set(id, lockPromise);

  try {
    const { proc } = entry;
    const cfg = getInstanceConfig(id);

    // 1. 尝试优雅关闭
    try {
      // 关闭标准输入，有些程序在 stdin 关闭时会自动退出
      proc.stdin.end();
      // 发送 SIGTERM (Windows 下等同于立即终止，但习惯性保留)
      proc.kill("SIGTERM");
    } catch {
      // 进程可能已退出
    }

    // 等待最多 3 秒
    await Promise.race([
      proc.exited,
      new Promise((r) => setTimeout(r, 3000)),
    ]);

    // 2. 如果还在运行，强制杀死
    if (processes.has(id)) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      // 给一点时间让 OS 回收资源
      await Promise.race([
        proc.exited,
        new Promise((r) => setTimeout(r, 1000)),
      ]);
    }

    // 3. 强制清理状态，不论进程是否真的完全消失 (防止后端挂起)
    processes.delete(id);
    setStatus(id, "stopped", { exitCode: null });
    removeClients(id);

    if (cfg) logger.info(`实例已停止: ${cfg.name}`);
    return { ok: true, message: "停止成功" };
  } finally {
    stopLocks.delete(id);
    resolveLock!();
  }
}

// ── 重启实例 ─────────────────────────────────────────────────────────────

export async function restartInstance(id: string): Promise<{ ok: boolean; message: string }> {
  const stopResult = await stopInstance(id);
  if (!stopResult.ok && stopResult.message !== "实例未在运行") {
    return stopResult;
  }
  // 短暂等待确保资源释放
  await new Promise((r) => setTimeout(r, 500));
  return startInstance(id);
}

// ── 向进程写入输入 ───────────────────────────────────────────────────────

export function writeToInstance(id: string, data: string): boolean {
  const entry = processes.get(id);
  if (!entry) return false;
  try {
    entry.proc.stdin.write(new TextEncoder().encode(data));
    return true;
  } catch {
    return false;
  }
}

// ── 删除实例（先停止） ──────────────────────────────────────────────────

export async function deleteInstanceManager(id: string): Promise<{ ok: boolean; message: string }> {
  if (processes.has(id)) {
    const stopResult = await stopInstance(id);
    if (!stopResult.ok) return stopResult;
  }
  return { ok: true, message: "已停止" };
}

// ── 查询运行中进程 ───────────────────────────────────────────────────────

export function isRunning(id: string): boolean {
  return processes.has(id);
}