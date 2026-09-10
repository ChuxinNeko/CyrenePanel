import { Elysia } from "elysia";
import { hostname } from "os";
import {
  dbInsertAuditLog,
  dbQueryAuditLogsFiltered,
  dbAuditStats,
  dbGetAllNodes,
  type AuditFilter,
  type AuditLogRow,
  type AuditStats,
  type NodeRow,
} from "../db";
import { logger } from "../logger/index";
import { fetchNode } from "../nodes/index";
import { resolveRequestProfile } from "../node-auth/request-profile";

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

/**
 * 从 query 里解析筛选条件。未提供或空串一律视为「不限」，
 * 避免前端传 category="" 时被当成要匹配空分类。
 */
function parseAuditFilter(query: Record<string, unknown> | undefined): AuditFilter {
  const str = (key: string): string | undefined => {
    const raw = query?.[key];
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed ? trimmed : undefined;
  };
  const num = (key: string): number | undefined => {
    const raw = str(key);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const successRaw = str("success");
  return {
    category: str("category"),
    username: str("username"),
    keyword: str("keyword"),
    from: num("from"),
    to: num("to"),
    success:
      successRaw === "true" ? true : successRaw === "false" ? false : undefined,
  };
}

/** 主节点在聚合结果里的固定标识 */
const MAIN_NODE_ID = "__main__";

function parseNodeId(query: Record<string, unknown> | undefined): string | undefined {
  const raw = query?.nodeId;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/** 把筛选条件重新序列化，转发给子节点 */
function filterToQuery(filter: AuditFilter, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (filter.category) params.set("category", filter.category);
  if (filter.username) params.set("username", filter.username);
  if (filter.keyword) params.set("keyword", filter.keyword);
  if (filter.from !== undefined) params.set("from", String(filter.from));
  if (filter.to !== undefined) params.set("to", String(filter.to));
  if (filter.success !== undefined) params.set("success", String(filter.success));
  return params.toString();
}

async function fetchNodeAuditLogs(
  node: NodeRow,
  limit: number,
  filter: AuditFilter,
  before?: number
): Promise<AuditLogRow[]> {
  try {
    const extra: Record<string, string> = { limit: String(limit) };
    if (before !== undefined) extra.before = String(before);
    const qs = filterToQuery(filter, extra);
    const res = await fetchNode(node, `/api/audit/logs?${qs}`, {}, 5000);
    const data = (await res.json()) as { success?: boolean; logs?: AuditLogRow[] };
    if (data?.success && Array.isArray(data.logs)) return data.logs;
  } catch {
    // ignore
  }
  return [];
}

async function fetchNodeAuditStats(
  node: NodeRow,
  filter: AuditFilter
): Promise<AuditStats | null> {
  try {
    const res = await fetchNode(node, `/api/audit/stats?${filterToQuery(filter)}`, {}, 5000);
    const data = (await res.json()) as { success?: boolean; stats?: AuditStats };
    if (data?.success && data.stats) return data.stats;
  } catch {
    // ignore
  }
  return null;
}

export const auditRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // 本机审计日志（包含主节点和子节点都可调用）
  .get("/api/audit/logs", ({ profile, query }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const limit = Math.min(Math.max(Number(query?.limit) || 100, 1), 500);
    const before = query?.before ? Number(query.before) : undefined;
    const logs = dbQueryAuditLogsFiltered(limit, parseAuditFilter(query), before);
    return { success: true, logs };
  })

  // 本机统计（子节点提供给主节点汇总用）
  .get("/api/audit/stats", ({ profile, query }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return { success: true, stats: dbAuditStats(parseAuditFilter(query)) };
  })

  // 汇总：本地 + 所有子节点（仅主节点提供，但子节点也能调用一份只含本地）
  .get("/api/audit/aggregate", async ({ profile, query }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const limit = Math.min(Math.max(Number(query?.limit) || 100, 1), 500);
    const before = query?.before ? Number(query.before) : undefined;
    const filter = parseAuditFilter(query);
    const nodeId = parseNodeId(query);

    // 按节点筛选也放在服务端做，否则前端过滤出来的行数会和统计接口对不上
    const localItems =
      !nodeId || nodeId === MAIN_NODE_ID
        ? dbQueryAuditLogsFiltered(limit, filter, before).map((row) =>
            rowToItem(row, MAIN_NODE_ID, `${hostname()} (主节点)`),
          )
        : [];

    const nodes = dbGetAllNodes().filter((node) => !nodeId || node.id === nodeId);
    const remoteResults = await Promise.all(
      nodes.map(async (node) => {
        const rows = await fetchNodeAuditLogs(node, limit, filter, before);
        return rows.map((row) => rowToItem(row, node.id, node.name));
      }),
    );

    const all = [...localItems, ...remoteResults.flat()];
    all.sort((a, b) => b.timestamp - a.timestamp);

    // 每个来源各自最多取 limit 条。只要有任何一个来源取满了，
    // 它那边就可能还有更早的记录 —— 用它驱动前端的「加载更多」
    const hasMore = [localItems.length, ...remoteResults.map((r) => r.length)].some(
      (count) => count >= limit,
    );
    return { success: true, logs: all.slice(0, limit), hasMore };
  })

  // 汇总统计：把各节点的计数相加
  .get("/api/audit/stats/aggregate", async ({ profile, query }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const filter = parseAuditFilter(query);
    const nodeId = parseNodeId(query);

    const local =
      !nodeId || nodeId === MAIN_NODE_ID
        ? dbAuditStats(filter)
        : { total: 0, failed: 0, byCategory: {}, usernames: [], earliest: null, latest: null };

    const nodes = dbGetAllNodes().filter((node) => !nodeId || node.id === nodeId);
    const remote = (
      await Promise.all(nodes.map((node) => fetchNodeAuditStats(node, filter)))
    ).filter((s): s is AuditStats => s !== null);

    const merged: AuditStats = {
      total: local.total,
      failed: local.failed,
      byCategory: { ...local.byCategory },
      usernames: [...local.usernames],
      earliest: local.earliest,
      latest: local.latest,
    };

    for (const stats of remote) {
      merged.total += stats.total;
      merged.failed += stats.failed;
      for (const [cat, count] of Object.entries(stats.byCategory)) {
        merged.byCategory[cat] = (merged.byCategory[cat] ?? 0) + count;
      }
      merged.usernames.push(...stats.usernames);
      if (stats.earliest !== null) {
        merged.earliest =
          merged.earliest === null ? stats.earliest : Math.min(merged.earliest, stats.earliest);
      }
      if (stats.latest !== null) {
        merged.latest =
          merged.latest === null ? stats.latest : Math.max(merged.latest, stats.latest);
      }
    }

    merged.usernames = [...new Set(merged.usernames)].sort();
    return { success: true, stats: merged, nodeCount: nodes.length + 1 };
  });
