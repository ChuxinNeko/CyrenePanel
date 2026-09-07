/**
 * MySQL 表维护
 *
 * 对标宝塔的表操作：优化(OPTIMIZE) / 修复(REPAIR) / 分析(ANALYZE) /
 * 检查(CHECK) / 清空(TRUNCATE)，支持批量。
 * 另提供库/表体积统计，便于定位占空间的大表。
 */

import { Elysia } from "elysia";

import { dbGetMysqlConn } from "../../db";
import { logger } from "../../logger/index";
import { resolveRequestProfile } from "../../node-auth/request-profile";
import { getPoolForConn } from "./pool";

/** 标识符白名单：库名/表名只允许常规字符，避免拼接进 SQL 时被注入 */
const IDENT_RE = /^[A-Za-z0-9_$一-龥-]+$/;

function validIdent(value: string): boolean {
  return IDENT_RE.test(value) && value.length <= 64;
}

/** 反引号包裹，内部反引号双写 */
function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

async function withPool<T>(connId: string, fn: (pool: any) => Promise<T>): Promise<T> {
  const conn = dbGetMysqlConn(connId);
  if (!conn) throw new Error("连接不存在");
  return fn(getPoolForConn(conn));
}

const ACTIONS: Record<string, { sql: string; label: string }> = {
  optimize: { sql: "OPTIMIZE TABLE", label: "优化" },
  repair: { sql: "REPAIR TABLE", label: "修复" },
  analyze: { sql: "ANALYZE TABLE", label: "分析" },
  check: { sql: "CHECK TABLE", label: "检查" },
};

export const mysqlMaintenanceRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 表维护（可批量）───────────────────────────────────────────────
  .post("/api/mysql/maintenance", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = String(body?.connectionId || "");
    const database = String(body?.database || "");
    const action = String(body?.action || "");
    const tables: string[] = Array.isArray(body?.tables) ? body.tables.map(String) : [];

    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!validIdent(database)) return { success: false, message: "无效的数据库名" };
    if (!ACTIONS[action]) return { success: false, message: "无效的操作" };
    if (tables.length === 0) return { success: false, message: "未选择数据表" };
    if (tables.some((t) => !validIdent(t))) return { success: false, message: "包含无效的表名" };

    try {
      return await withPool(connectionId, async (pool) => {
        const { sql, label } = ACTIONS[action];
        const list = tables.map((t) => `${quoteIdent(database)}.${quoteIdent(t)}`).join(", ");
        const [rows] = await pool.query(`${sql} ${list}`);

        logger.info(`[mysql] ${label} ${database} 的 ${tables.length} 张表`);
        return {
          success: true,
          message: `已${label} ${tables.length} 张表`,
          // MySQL 会为每张表返回一行结果，含 Msg_type / Msg_text
          results: (rows as any[]).map((r) => ({
            table: r.Table,
            operation: r.Op,
            type: r.Msg_type,
            message: r.Msg_text,
          })),
        };
      });
    } catch (e: any) {
      return { success: false, message: e?.message || "维护操作失败" };
    }
  })

  // ── 清空表（单独出来，风险更高）────────────────────────────────────
  .post("/api/mysql/maintenance/truncate", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = String(body?.connectionId || "");
    const database = String(body?.database || "");
    const tables: string[] = Array.isArray(body?.tables) ? body.tables.map(String) : [];

    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!validIdent(database)) return { success: false, message: "无效的数据库名" };
    if (tables.length === 0) return { success: false, message: "未选择数据表" };
    if (tables.some((t) => !validIdent(t))) return { success: false, message: "包含无效的表名" };

    try {
      return await withPool(connectionId, async (pool) => {
        const succeeded: string[] = [];
        const failed: { table: string; message: string }[] = [];

        // TRUNCATE 不支持一次多表，逐张执行
        for (const table of tables) {
          try {
            await pool.query(`TRUNCATE TABLE ${quoteIdent(database)}.${quoteIdent(table)}`);
            succeeded.push(table);
          } catch (e: any) {
            failed.push({ table, message: (e?.message || "清空失败").trim() });
          }
        }

        logger.warn(`[mysql] 清空 ${database} 的表：成功 ${succeeded.length}，失败 ${failed.length}`);
        return {
          success: failed.length === 0,
          message:
            failed.length === 0
              ? `已清空 ${succeeded.length} 张表`
              : `成功 ${succeeded.length} 张，失败 ${failed.length} 张`,
          succeeded,
          failed,
        };
      });
    } catch (e: any) {
      return { success: false, message: e?.message || "清空失败" };
    }
  })

  // ── 库/表体积统计 ─────────────────────────────────────────────────
  .get("/api/mysql/sizes", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = String(query?.connectionId || "");
    const database = query?.database ? String(query.database) : "";
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (database && !validIdent(database)) return { success: false, message: "无效的数据库名" };

    try {
      return await withPool(connectionId, async (pool) => {
        if (database) {
          // 单库：按表统计，用于找出占空间的大表
          const [rows] = await pool.query(
            // rows 在 MySQL 8 是保留字，别名必须加反引号
            `SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS \`rows\`,
                    DATA_LENGTH AS dataSize, INDEX_LENGTH AS indexSize,
                    DATA_FREE AS freeSize, TABLE_COLLATION AS collation,
                    UPDATE_TIME AS updatedAt
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ?
             ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC`,
            [database],
          );
          return {
            success: true,
            tables: (rows as any[]).map((r) => ({
              name: r.name,
              engine: r.engine,
              rows: Number(r.rows || 0),
              dataSize: Number(r.dataSize || 0),
              indexSize: Number(r.indexSize || 0),
              // DATA_FREE 是碎片空间，偏大说明该表值得 OPTIMIZE
              freeSize: Number(r.freeSize || 0),
              totalSize: Number(r.dataSize || 0) + Number(r.indexSize || 0),
              collation: r.collation,
              updatedAt: r.updatedAt,
            })),
          };
        }

        const [rows] = await pool.query(
          `SELECT TABLE_SCHEMA AS name, COUNT(*) AS tableCount,
                  SUM(DATA_LENGTH) AS dataSize, SUM(INDEX_LENGTH) AS indexSize,
                  SUM(DATA_FREE) AS freeSize
           FROM information_schema.TABLES
           GROUP BY TABLE_SCHEMA
           ORDER BY (SUM(DATA_LENGTH) + SUM(INDEX_LENGTH)) DESC`,
        );
        return {
          success: true,
          databases: (rows as any[]).map((r) => ({
            name: r.name,
            tableCount: Number(r.tableCount || 0),
            dataSize: Number(r.dataSize || 0),
            indexSize: Number(r.indexSize || 0),
            freeSize: Number(r.freeSize || 0),
            totalSize: Number(r.dataSize || 0) + Number(r.indexSize || 0),
          })),
        };
      });
    } catch (e: any) {
      return { success: false, message: e?.message || "统计失败" };
    }
  });
