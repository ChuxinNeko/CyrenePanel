/**
 * MySQL 运行状态、进程列表与配置
 *
 * 对标宝塔/1Panel 的「状态」页：关键指标、连接数、缓冲池命中率、
 * 慢查询、当前会话列表（可 kill）、以及 my.cnf 的查看与编辑。
 */

import { Elysia } from "elysia";
import { existsSync } from "node:fs";
import { readFile, writeFile, copyFile } from "node:fs/promises";

import { dbGetMysqlConn } from "../../db";
import { logger } from "../../logger/index";
import { resolveRequestProfile } from "../../node-auth/request-profile";
import { getPoolForConn } from "./pool";

/** my.cnf 的常见位置，按优先级探测 */
const CNF_CANDIDATES = [
  "/etc/my.cnf",
  "/etc/mysql/my.cnf",
  "/etc/mysql/mysql.conf.d/mysqld.cnf",
  "/usr/local/mysql/my.cnf",
  "/www/server/mysql/my.cnf",
];

async function withPool<T>(connId: string, fn: (pool: any) => Promise<T>): Promise<T> {
  const conn = dbGetMysqlConn(connId);
  if (!conn) throw new Error("连接不存在");
  return fn(getPoolForConn(conn));
}

/** 把 SHOW STATUS / SHOW VARIABLES 的结果转成 map */
function toMap(rows: any[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const key = row.Variable_name ?? row.VARIABLE_NAME;
    const value = row.Value ?? row.VARIABLE_VALUE;
    if (key !== undefined) map[String(key)] = String(value ?? "");
  }
  return map;
}

function num(map: Record<string, string>, key: string): number {
  const value = Number(map[key]);
  return Number.isFinite(value) ? value : 0;
}

export const mysqlStatusRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 运行状态总览 ──────────────────────────────────────────────────
  .get("/api/mysql/status", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      return await withPool(connectionId, async (pool) => {
        const [statusRows] = await pool.query("SHOW GLOBAL STATUS");
        const [varRows] = await pool.query("SHOW GLOBAL VARIABLES");
        const status = toMap(statusRows as any[]);
        const variables = toMap(varRows as any[]);

        const uptime = num(status, "Uptime");
        const queries = num(status, "Queries");
        // QPS 用累计查询数除以运行时长，是平均值而非瞬时值
        const qps = uptime > 0 ? queries / uptime : 0;

        const readHits = num(status, "Innodb_buffer_pool_read_requests");
        const readDisk = num(status, "Innodb_buffer_pool_reads");
        const bufferHitRate =
          readHits > 0 ? ((readHits - readDisk) / readHits) * 100 : 0;

        const keyReadRequests = num(status, "Key_read_requests");
        const keyReads = num(status, "Key_reads");
        const keyHitRate =
          keyReadRequests > 0 ? ((keyReadRequests - keyReads) / keyReadRequests) * 100 : 0;

        const maxConnections = num(variables, "max_connections");
        const maxUsedConnections = num(status, "Max_used_connections");

        const tmpTables = num(status, "Created_tmp_tables");
        const tmpDiskTables = num(status, "Created_tmp_disk_tables");

        return {
          success: true,
          status: {
            version: variables["version"] || "",
            versionComment: variables["version_comment"] || "",
            uptime,
            // 关键计数器
            queries,
            qps: Number(qps.toFixed(2)),
            slowQueries: num(status, "Slow_queries"),
            threadsConnected: num(status, "Threads_connected"),
            threadsRunning: num(status, "Threads_running"),
            threadsCached: num(status, "Threads_cached"),
            threadsCreated: num(status, "Threads_created"),
            maxConnections,
            maxUsedConnections,
            connectionUsage:
              maxConnections > 0 ? Number(((maxUsedConnections / maxConnections) * 100).toFixed(1)) : 0,
            abortedConnects: num(status, "Aborted_connects"),
            abortedClients: num(status, "Aborted_clients"),
            // 缓冲与命中率
            bufferPoolSize: num(variables, "innodb_buffer_pool_size"),
            bufferHitRate: Number(bufferHitRate.toFixed(2)),
            keyBufferSize: num(variables, "key_buffer_size"),
            keyHitRate: Number(keyHitRate.toFixed(2)),
            // 临时表落盘比例偏高说明需要调大 tmp_table_size
            tmpTables,
            tmpDiskTables,
            tmpDiskRatio: tmpTables > 0 ? Number(((tmpDiskTables / tmpTables) * 100).toFixed(1)) : 0,
            // 流量
            bytesReceived: num(status, "Bytes_received"),
            bytesSent: num(status, "Bytes_sent"),
            openTables: num(status, "Open_tables"),
            openedTables: num(status, "Opened_tables"),
            tableOpenCache: num(variables, "table_open_cache"),
            // 慢查询日志配置，前端据此提示是否已开启
            slowLogEnabled: (variables["slow_query_log"] || "").toUpperCase() === "ON",
            slowLogFile: variables["slow_query_log_file"] || "",
            longQueryTime: Number(variables["long_query_time"] || 0),
          },
        };
      });
    } catch (e: any) {
      return { success: false, message: e?.message || "获取状态失败" };
    }
  })

  // ── 全部变量（可搜索）─────────────────────────────────────────────
  .get("/api/mysql/variables", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      return await withPool(connectionId, async (pool) => {
        const [rows] = await pool.query("SHOW GLOBAL VARIABLES");
        const map = toMap(rows as any[]);
        return {
          success: true,
          variables: Object.entries(map).map(([name, value]) => ({ name, value })),
        };
      });
    } catch (e: any) {
      return { success: false, message: e?.message || "获取变量失败" };
    }
  })

  // ── 进程列表 ──────────────────────────────────────────────────────
  .get("/api/mysql/processlist", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      return await withPool(connectionId, async (pool) => {
        // FULL 才能拿到完整 SQL，否则长语句会被截断到 100 字符
        const [rows] = await pool.query("SHOW FULL PROCESSLIST");
        return {
          success: true,
          processes: (rows as any[]).map((r) => ({
            id: r.Id,
            user: r.User,
            host: r.Host,
            db: r.db,
            command: r.Command,
            time: r.Time,
            state: r.State,
            info: r.Info,
          })),
        };
      });
    } catch (e: any) {
      return { success: false, message: e?.message || "获取进程列表失败" };
    }
  })

  // ── 终止会话 ──────────────────────────────────────────────────────
  .post("/api/mysql/processlist/kill", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const id = Number(body?.id);
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!Number.isInteger(id) || id <= 0) return { success: false, message: "无效的会话 ID" };

    try {
      return await withPool(connectionId, async (pool) => {
        // KILL 不支持占位符，但 id 已确认是正整数
        await pool.query(`KILL ${id}`);
        logger.info(`[mysql] 终止会话 ${id}`);
        return { success: true, message: `会话 ${id} 已终止` };
      });
    } catch (e: any) {
      return { success: false, message: e?.message || "终止会话失败" };
    }
  })

  // ── 慢查询日志 ────────────────────────────────────────────────────
  .get("/api/mysql/slow-log", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    const parsed = parseInt(query?.lines || "200");
    const lines = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 5000) : 200;

    try {
      return await withPool(connectionId, async (pool) => {
        const [rows] = await pool.query(
          "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('slow_query_log','slow_query_log_file','long_query_time')",
        );
        const map = toMap(rows as any[]);
        const enabled = (map["slow_query_log"] || "").toUpperCase() === "ON";
        const file = map["slow_query_log_file"] || "";

        if (!enabled) {
          return {
            success: true,
            enabled: false,
            file,
            content: "",
            message: "慢查询日志未开启",
          };
        }
        if (!file || !existsSync(file)) {
          // 远程 MySQL 时日志在对端机器上，面板读不到
          return {
            success: true,
            enabled: true,
            file,
            content: "",
            message: file ? "日志文件不在本机，无法读取" : "未配置日志文件路径",
          };
        }

        const raw = await readFile(file, "utf-8");
        const all = raw.split("\n");
        return {
          success: true,
          enabled: true,
          file,
          longQueryTime: Number(map["long_query_time"] || 0),
          content: all.slice(-lines).join("\n"),
        };
      });
    } catch (e: any) {
      return { success: false, message: e?.message || "读取慢查询日志失败" };
    }
  })

  // ── 配置文件 ──────────────────────────────────────────────────────
  .get("/api/mysql/config", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const path = CNF_CANDIDATES.find((p) => existsSync(p));
    if (!path) {
      return { success: false, message: "未找到 MySQL 配置文件（远程实例无法在此编辑）" };
    }

    try {
      return { success: true, path, content: await readFile(path, "utf-8") };
    } catch (e: any) {
      return { success: false, message: e?.message || "读取配置文件失败" };
    }
  })

  .post("/api/mysql/config", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const content = typeof body?.content === "string" ? body.content : null;
    if (content === null) return { success: false, message: "缺少配置内容" };

    const path = CNF_CANDIDATES.find((p) => existsSync(p));
    if (!path) return { success: false, message: "未找到 MySQL 配置文件" };

    try {
      // 改坏配置会导致 MySQL 起不来，先留一份备份
      const backup = `${path}.cyrene.bak`;
      await copyFile(path, backup);
      await writeFile(path, content, "utf-8");
      logger.info(`[mysql] 更新配置文件 ${path}，原文件已备份到 ${backup}`);
      return {
        success: true,
        message: "配置已保存，重启 MySQL 后生效",
        backup,
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "保存配置失败" };
    }
  });
