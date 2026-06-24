import { Elysia } from "elysia";
import { dbGetMysqlConn } from "../../db";
import { getPoolForConn } from "./pool";

// ── 通用查询执行器 ────────────────────────────────────────────────────

async function executeOnConn(connId: string, sql: string, params?: any[]) {
  const conn = dbGetMysqlConn(connId);
  if (!conn) throw new Error("连接不存在");
  const pool = getPoolForConn(conn);
  const start = performance.now();
  const [result, fields] = await pool.query(sql, params);
  const elapsed = Math.round(performance.now() - start);
  return { result, fields, elapsed };
}

export const mysqlQueryRoutes = new Elysia()

  // 通用 SQL 执行
  .post("/api/mysql/query", async ({ jwt, request, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, sql, database } = body || {};
    if (!connectionId || !sql) return { success: false, message: "缺少 connectionId 或 sql" };

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      const fullSql = database ? `USE \`${database}\`;\n${sql}` : sql;
      const start = performance.now();
      const [result, fields] = await pool.query(fullSql);
      const elapsed = Math.round(performance.now() - start);

      // 多语句返回数组
      if (Array.isArray(result) && Array.isArray(fields)) {
        // 过滤掉 USE 语句的结果
        const results = [];
        const startIdx = database ? 1 : 0;
        for (let i = startIdx; i < (result as any[]).length; i++) {
          const r = (result as any[])[i];
          const f = (fields as any[])[i];
          if (Array.isArray(r)) {
            results.push({
              type: "select",
              columns: f ? f.map((col: any) => ({ name: col.name, type: col.type })) : [],
              rows: r,
              rowCount: r.length,
            });
          } else {
            results.push({
              type: "execute",
              affectedRows: r?.affectedRows || 0,
              message: r?.message || "",
            });
          }
        }
        // 如果只有一个结果集且没有 database 前缀
        if (!database && results.length === 0) {
          if (Array.isArray(result)) {
            return {
              success: true,
              elapsed,
              results: [{
                type: "select",
                columns: fields ? (fields as any[]).map((col: any) => ({ name: col.name, type: col.type })) : [],
                rows: result,
                rowCount: (result as any[]).length,
              }],
            };
          }
        }
        return { success: true, elapsed, results };
      }

      // 单语句
      if (Array.isArray(result)) {
        return {
          success: true,
          elapsed,
          results: [{
            type: "select",
            columns: fields ? (fields as any[]).map((col: any) => ({ name: col.name, type: col.type })) : [],
            rows: result,
            rowCount: result.length,
          }],
        };
      }
      return {
        success: true,
        elapsed,
        results: [{
          type: "execute",
          affectedRows: (result as any)?.affectedRows || 0,
          message: (result as any)?.message || "",
        }],
      };
    } catch (e: any) {
      return { success: false, message: e.message || "查询失败" };
    }
  })

  // 列出数据库
  .get("/api/mysql/databases", async ({ jwt, request, query }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = query?.connectionId;
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      const { result } = await executeOnConn(connectionId, "SHOW DATABASES");
      const databases = (result as any[]).map((r: any) => r.Database || r.database || Object.values(r)[0]);
      return { success: true, databases };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 创建数据库
  .post("/api/mysql/databases", async ({ jwt, request, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, name, charset, collation } = body || {};
    if (!connectionId || !name) return { success: false, message: "缺少 connectionId 或 name" };

    try {
      let sql = `CREATE DATABASE \`${name}\``;
      if (charset) sql += ` CHARACTER SET ${charset}`;
      if (collation) sql += ` COLLATE ${collation}`;
      await executeOnConn(connectionId, sql);
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 删除数据库
  .delete("/api/mysql/databases/:db", async ({ jwt, request, params, query }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = query?.connectionId;
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      await executeOnConn(connectionId, `DROP DATABASE \`${params.db}\``);
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 列出表
  .get("/api/mysql/databases/:db/tables", async ({ jwt, request, params, query }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = query?.connectionId;
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      const { result } = await executeOnConn(
        connectionId,
        `SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, TABLE_COMMENT, ENGINE, TABLE_COLLATION
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
        [params.db]
      );
      const tables = (result as any[]).map((r: any) => ({
        name: r.TABLE_NAME,
        rows: r.TABLE_ROWS,
        size: r.DATA_LENGTH,
        comment: r.TABLE_COMMENT,
        engine: r.ENGINE,
        collation: r.TABLE_COLLATION,
      }));
      return { success: true, tables };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 创建表
  .post("/api/mysql/databases/:db/tables", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, sql } = body || {};
    if (!connectionId || !sql) return { success: false, message: "缺少 connectionId 或 sql" };

    try {
      await executeOnConn(connectionId, `USE \`${params.db}\`; ${sql}`);
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 删除表
  .delete("/api/mysql/databases/:db/tables/:table", async ({ jwt, request, params, query }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = query?.connectionId;
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      await executeOnConn(connectionId, `DROP TABLE \`${params.db}\`.\`${params.table}\``);
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 表结构
  .get("/api/mysql/databases/:db/tables/:table/structure", async ({ jwt, request, params, query }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = query?.connectionId;
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      // 字段信息
      const [columns] = await pool.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [params.db, params.table]
      );

      // 索引信息
      const [indexes] = await pool.query(
        `SHOW INDEX FROM \`${params.db}\`.\`${params.table}\``
      );

      // 建表语句
      const [createResult] = await pool.query(
        `SHOW CREATE TABLE \`${params.db}\`.\`${params.table}\``
      );
      const createSql = (createResult as any[])[0]?.["Create Table"] || "";

      return {
        success: true,
        columns: (columns as any[]).map((c: any) => ({
          name: c.COLUMN_NAME,
          type: c.COLUMN_TYPE,
          nullable: c.IS_NULLABLE === "YES",
          key: c.COLUMN_KEY,
          default: c.COLUMN_DEFAULT,
          extra: c.EXTRA,
          comment: c.COLUMN_COMMENT,
        })),
        indexes: (indexes as any[]).map((i: any) => ({
          name: i.Key_name,
          column: i.Column_name,
          unique: i.Non_unique === 0,
          type: i.Index_type,
        })),
        createSql,
      };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 修改表结构（执行 ALTER TABLE 语句）
  .put("/api/mysql/databases/:db/tables/:table/structure", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, sql } = body || {};
    if (!connectionId || !sql) return { success: false, message: "缺少 connectionId 或 sql" };

    try {
      await executeOnConn(connectionId, `USE \`${params.db}\`; ${sql}`);
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });