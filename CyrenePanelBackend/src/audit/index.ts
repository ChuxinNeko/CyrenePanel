import { Elysia } from "elysia";
import { hostname } from "os";
import {
  dbInsertAuditLog,
  dbQueryAuditLogs,
  dbGetAllNodes,
  type AuditLogRow,
} from "../db";
import { logger } from "../logger/index";

async function fetchNodeToken(address: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${address}/api/auth/key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: apiKey }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as any;
    if (data?.success && data.token) return data.token;
  } catch {
    // ignore
  }
  return null;
}

export type AuditCategory =
  | "auth"
  | "user"
  | "file"
  | "certificate"
  | "node"
  | "instance"
  | "service"
  | "site"
  | "docker"
  | "system";

export interface AuditEntry {
  username: string;
  category: AuditCategory;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
  success?: boolean;
}

export function getRequestIp(request: Request, server?: any): string {
  try {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "";
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return realIp;
    const direct = server?.requestIP?.(request)?.address;
    if (direct) return direct;
  } catch {
    // ignore
  }
  return "";
}

// 告警钩子（由 alerts 模块注入，避免循环依赖）
let alertHook: ((entry: AuditEntry) => void) | null = null;

export function setAuditAlertHook(fn: ((entry: AuditEntry) => void) | null): void {
  alertHook = fn;
}

export function auditLog(entry: AuditEntry): void {
  try {
    dbInsertAuditLog({
      timestamp: Date.now(),
      username: entry.username || "(匿名)",
      category: entry.category,
      action: entry.action,
      target: entry.target,
      detail: entry.detail,
      ip: entry.ip,
      success: entry.success,
    });
  } catch (e: any) {
    logger.warn(`审计日志写入失败: ${e.message}`);
  }

  try {
    alertHook?.(entry);
  } catch (e: any) {
    logger.debug(`告警钩子执行异常: ${e.message}`);
  }
}

export interface AuditLogItem {
  id: string; // 节点 + 自增 id
  timestamp: number;
  username: string;
  category: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  success: boolean;
  nodeId: string;
  nodeName: string;
}

function rowToItem(row: AuditLogRow, nodeId: string, nodeName: string): AuditLogItem {
  return {
    id: `${nodeId}:${row.id}`,
    timestamp: row.timestamp,
    username: row.username,
    category: row.category,
    action: row.action,
    target: row.target,
    detail: row.detail,
    ip: row.ip,
    success: row.success === 1,
    nodeId,
    nodeName,
  };
}

async function fetchNodeAuditLogs(
  address: string,
  apiKey: string,
  limit: number,
): Promise<AuditLogRow[]> {
  try {
    const token = await fetchNodeToken(address, apiKey);
    if (!token) return [];
    const res = await fetch(
      `${address}/api/audit/logs?limit=${encodeURIComponent(String(limit))}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    const data = (await res.json()) as { success?: boolean; logs?: AuditLogRow[] };
    if (data?.success && Array.isArray(data.logs)) return data.logs;
  } catch {
    // ignore
  }
  return [];
}

export const auditRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // 本机审计日志（包含主节点和子节点都可调用）
  .get("/api/audit/logs", ({ profile, query }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const limit = Math.min(Math.max(Number(query?.limit) || 100, 1), 500);
    const before = query?.before ? Number(query.before) : undefined;
    const logs = dbQueryAuditLogs(limit, before);
    return { success: true, logs };
  })

  // 汇总：本地 + 所有子节点（仅主节点提供，但子节点也能调用一份只含本地）
  .get("/api/audit/aggregate", async ({ profile, query }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const limit = Math.min(Math.max(Number(query?.limit) || 100, 1), 500);

    const localLogs = dbQueryAuditLogs(limit);
    const localItems = localLogs.map((row) =>
      rowToItem(row, "__main__", `${hostname()} (主节点)`),
    );

    const nodes = dbGetAllNodes();
    const remoteResults = await Promise.all(
      nodes.map(async (node) => {
        const rows = await fetchNodeAuditLogs(node.address, node.apiKey, limit);
        return rows.map((row) => rowToItem(row, node.id, node.name));
      }),
    );

    const all = [...localItems, ...remoteResults.flat()];
    all.sort((a, b) => b.timestamp - a.timestamp);
    return { success: true, logs: all.slice(0, limit) };
  });
