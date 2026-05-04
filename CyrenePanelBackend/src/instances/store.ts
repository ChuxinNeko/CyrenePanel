import { randomUUID } from "crypto";
import { logger } from "../logger/index";
import {
  dbGetAllInstances,
  dbGetInstance,
  dbInsertInstance,
  dbUpdateInstance,
  dbDeleteInstance,
} from "../db";

// ── 类型 ─────────────────────────────────────────────────────────────

export interface InstanceConfig {
  id: string;
  name: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  autoRestart: boolean;
  createdAt: number;
  nodeId: string;
  nodeName: string;
}

export interface InstanceRuntime {
  status: "running" | "stopped" | "error";
  pid?: number;
  startedAt?: number;
  exitCode: number | null;
  logs: string[];
}

export type Instance = InstanceConfig & InstanceRuntime;

// ── 常量 ─────────────────────────────────────────────────────────────

const LOG_MAX_LINES = 500;

// ── 内存存储（仅运行时状态） ─────────────────────────────────────────

const runtimes = new Map<string, InstanceRuntime>();

// ── 初始化加载 ───────────────────────────────────────────────────────

export function loadStore() {
  const list = dbGetAllInstances();
  for (const cfg of list) {
    runtimes.set(cfg.id, {
      status: "stopped",
      exitCode: null,
      logs: [],
    });
  }
  logger.info(`已加载 ${list.length} 个实例配置`);
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function createInstance(input: {
  name: string;
  command: string;
  cwd: string;
  env?: Record<string, string>;
  autoRestart?: boolean;
  nodeId?: string;
  nodeName?: string;
}): InstanceConfig {
  const cfg: InstanceConfig = {
    id: randomUUID(),
    name: input.name,
    command: input.command,
    cwd: input.cwd,
    env: input.env ?? {},
    autoRestart: input.autoRestart ?? false,
    createdAt: Date.now(),
    nodeId: input.nodeId ?? "__main__",
    nodeName: input.nodeName ?? "主节点",
  };
  dbInsertInstance(cfg);
  runtimes.set(cfg.id, {
    status: "stopped",
    exitCode: null,
    logs: [],
  });
  logger.info(`实例已创建: ${cfg.name} (${cfg.id})`);
  return cfg;
}

export function getInstanceConfig(id: string): InstanceConfig | undefined {
  return dbGetInstance(id);
}

export function getInstance(id: string): Instance | undefined {
  const cfg = dbGetInstance(id);
  if (!cfg) return undefined;
  const rt = runtimes.get(id)!;
  return { ...cfg, ...rt };
}

export function getAllInstances(): Instance[] {
  const configs = dbGetAllInstances();
  return configs.map((cfg) => {
    const rt = runtimes.get(cfg.id) ?? {
      status: "stopped" as const,
      exitCode: null,
      logs: [],
    };
    return { ...cfg, ...rt };
  });
}

export function updateInstance(
  id: string,
  input: Partial<Pick<InstanceConfig, "name" | "command" | "cwd" | "env" | "autoRestart">>
): InstanceConfig | undefined {
  const cfg = dbGetInstance(id);
  if (!cfg) return undefined;
  dbUpdateInstance(id, input);
  return dbGetInstance(id)!;
}

export function removeInstance(id: string): boolean {
  const existed = dbDeleteInstance(id);
  runtimes.delete(id);
  return existed;
}

// ── 运行时状态管理 ───────────────────────────────────────────────────

export function getRuntime(id: string): InstanceRuntime | undefined {
  return runtimes.get(id);
}

export function setStatus(
  id: string,
  status: InstanceRuntime["status"],
  extra?: Partial<Omit<InstanceRuntime, "status" | "logs">>
) {
  const rt = runtimes.get(id);
  if (!rt) return;
  rt.status = status;
  if (extra?.pid !== undefined) rt.pid = extra.pid;
  if (extra?.startedAt !== undefined) rt.startedAt = extra.startedAt;
  if (extra?.exitCode !== undefined) rt.exitCode = extra.exitCode;
}

export function appendLog(id: string, data: string) {
  const rt = runtimes.get(id);
  if (!rt) return;
  const lines = data.split("\n");
  for (const line of lines) {
    if (line === "") continue;
    rt.logs.push(line);
  }
  while (rt.logs.length > LOG_MAX_LINES) {
    rt.logs.shift();
  }
}

export function getLogs(id: string): string[] {
  return runtimes.get(id)?.logs ?? [];
}

export function clearLogs(id: string) {
  const rt = runtimes.get(id);
  if (rt) rt.logs = [];
}

// ── WS 客户端管理 ─────────────────────────────────────────────────

const wsClients = new Map<string, Set<any>>();

export function getClients(id: string): Set<any> | undefined {
  return wsClients.get(id);
}

export function setClients(id: string, clients: Set<any>) {
  wsClients.set(id, clients);
}

export function removeClients(id: string) {
  const clients = wsClients.get(id);
  if (clients) {
    wsClients.delete(id);
    for (const ws of clients) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }
}