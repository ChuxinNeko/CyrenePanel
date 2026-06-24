import { Elysia } from "elysia";
import { dbGetMysqlConn } from "../../db";
import { getPoolForConn } from "./pool";

export const mysqlDataRoutes = new Elysia()

  // 分页查询数据
  .get("/api/mysql/databases/:db/tables/:table/data", async ({ jwt, request, params, query }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = query?.connectionId;
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    const page = Math.max(1, parseInt(query?.page || "1"));
    const pageSize = Math.min(500, Math.max(1, parseInt(query?.pageSize || "50")));
    const orderBy = query?.orderBy || "";
    const orderDir = query?.orderDir === "DESC" ? "DESC" : "ASC";
    const where = query?.where || "";

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      const table = `\`${params.db}\`.\`${params.table}\``;

      // 总行数
      const countSql = `SELECT COUNT(*) as total FROM ${table}${where ? ` WHERE ${where}` : ""}`;
      const [countResult] = await pool.query(countSql);
      const total = (countResult as any[])[0]?.total || 0;

      // 数据查询
      let dataSql = `SELECT * FROM ${table}`;
      if (where) dataSql += ` WHERE ${where}`;
      if (orderBy) dataSql += ` ORDER BY \`${orderBy}\` ${orderDir}`;
      dataSql += ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

      const [rows, fields] = await pool.query(dataSql);
      const columns = fields
        ? (fields as any[]).map((f: any) => ({
            name: f.name,
            type: f.type,
            columnType: f.columnType,
          }))
        : [];

      return {
        success: true,
        rows,
        columns,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 插入行
  .post("/api/mysql/databases/:db/tables/:table/data", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, row } = body || {};
    if (!connectionId || !row) return { success: false, message: "缺少 connectionId 或 row" };

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      const keys = Object.keys(row);
      const values = Object.values(row);
      const placeholders = keys.map(() => "?").join(", ");
      const columns = keys.map((k) => `\`${k}\``).join(", ");

      const sql = `INSERT INTO \`${params.db}\`.\`${params.table}\` (${columns}) VALUES (${placeholders})`;
      const [result] = await pool.query(sql, values);

      return {
        success: true,
        insertId: (result as any).insertId,
        affectedRows: (result as any).affectedRows,
      };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 更新行
  .put("/api/mysql/databases/:db/tables/:table/data", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, row, primaryKey } = body || {};
    if (!connectionId || !row || !primaryKey) {
      return { success: false, message: "缺少 connectionId, row 或 primaryKey" };
    }

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      const setClauses: string[] = [];
      const setValues: any[] = [];
      for (const [key, value] of Object.entries(row)) {
        if (key === primaryKey.column) continue;
        setClauses.push(`\`${key}\` = ?`);
        setValues.push(value);
      }

      if (setClauses.length === 0) return { success: false, message: "没有需要更新的字段" };

      const sql = `UPDATE \`${params.db}\`.\`${params.table}\` SET ${setClauses.join(", ")} WHERE \`${primaryKey.column}\` = ?`;
      setValues.push(primaryKey.value);

      const [result] = await pool.query(sql, setValues);
      return { success: true, affectedRows: (result as any).affectedRows };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 删除行
  .delete("/api/mysql/databases/:db/tables/:table/data", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, primaryKey } = body || {};
    if (!connectionId || !primaryKey) {
      return { success: false, message: "缺少 connectionId 或 primaryKey" };
    }

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      // 支持批量删除
      const conditions = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
      let totalAffected = 0;

      for (const pk of conditions) {
        const sql = `DELETE FROM \`${params.db}\`.\`${params.table}\` WHERE \`${pk.column}\` = ?`;
        const [result] = await pool.query(sql, [pk.value]);
        totalAffected += (result as any).affectedRows || 0;
      }

      return { success: true, affectedRows: totalAffected };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });