import { Elysia } from "elysia";
import { dbGetMysqlConn } from "../../db";
import { getPoolForConn } from "./pool";

export const mysqlUserRoutes = new Elysia()

  // 列出 MySQL 用户
  .get("/api/mysql/users", async ({ jwt, request, query }: any) => {
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

      const [rows] = await pool.query(
        `SELECT User, Host, authentication_string, account_locked, password_expired
         FROM mysql.user ORDER BY User, Host`
      );

      const users = (rows as any[]).map((r: any) => ({
        user: r.User,
        host: r.Host,
        hasPassword: !!r.authentication_string,
        locked: r.account_locked === "Y",
        passwordExpired: r.password_expired === "Y",
      }));

      return { success: true, users };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 创建用户
  .post("/api/mysql/users", async ({ jwt, request, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, username, host, password } = body || {};
    if (!connectionId || !username) return { success: false, message: "缺少 connectionId 或 username" };

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      const userHost = host || "%";
      const sql = password
        ? `CREATE USER ?@? IDENTIFIED BY ?`
        : `CREATE USER ?@?`;
      const params = password ? [username, userHost, password] : [username, userHost];
      await pool.query(sql, params);

      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 删除用户
  .post("/api/mysql/users/drop", async ({ jwt, request, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, username, host } = body || {};
    if (!connectionId || !username || !host) {
      return { success: false, message: "缺少 connectionId, username 或 host" };
    }

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      await pool.query(`DROP USER ?@?`, [username, host]);
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 查看用户权限
  .get("/api/mysql/users/privileges", async ({ jwt, request, query }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, username, host } = query || {};
    if (!connectionId || !username || !host) {
      return { success: false, message: "缺少 connectionId, username 或 host" };
    }

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      const [rows] = await pool.query(`SHOW GRANTS FOR ?@?`, [username, host]);
      const grants = (rows as any[]).map((r: any) => Object.values(r)[0] as string);

      return { success: true, grants };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 修改用户权限
  .put("/api/mysql/users/privileges", async ({ jwt, request, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, username, host, privileges, database } = body || {};
    if (!connectionId || !username || !host || !privileges) {
      return { success: false, message: "缺少必填字段" };
    }

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      // 先撤销旧权限
      const target = database ? `\`${database}\`.*` : "*.*";
      try {
        await pool.query(`REVOKE ALL PRIVILEGES ON ${target} FROM ?@?`, [username, host]);
      } catch {
        // 可能没有旧权限，忽略
      }

      // 授予新权限
      if (privileges.length > 0) {
        const privList = privileges.join(", ");
        await pool.query(`GRANT ${privList} ON ${target} TO ?@?`, [username, host]);
      }

      await pool.query("FLUSH PRIVILEGES");
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // 修改用户密码
  .put("/api/mysql/users/password", async ({ jwt, request, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, username, host, password } = body || {};
    if (!connectionId || !username || !host || password === undefined) {
      return { success: false, message: "缺少必填字段" };
    }

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      await pool.query(`ALTER USER ?@? IDENTIFIED BY ?`, [username, host, password]);
      await pool.query("FLUSH PRIVILEGES");
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });