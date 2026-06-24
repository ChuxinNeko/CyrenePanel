import { Elysia } from "elysia";
import { randomBytes } from "crypto";
import { readFileSync, existsSync } from "fs";
import {
  dbListMysqlConns,
  dbGetMysqlConn,
  dbInsertMysqlConn,
  dbUpdateMysqlConn,
  dbDeleteMysqlConn,
} from "../../db";
import { testConnection, closePool, detectSocketPath, diagnoseMysql } from "./pool";

export const mysqlConnectionRoutes = new Elysia()

  .get("/api/mysql/connections", async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const connections = dbListMysqlConns().map((c) => ({
      ...c,
      password: "••••••",
    }));
    return { success: true, connections };
  })

  .post("/api/mysql/connections", async ({ jwt, request, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { name, host, port, username, password } = body || {};
    if (!name || !host || !username) {
      return { success: false, message: "缺少必填字段 (name, host, username)" };
    }

    const id = randomBytes(8).toString("hex");
    dbInsertMysqlConn({
      id,
      name,
      host: host || "127.0.0.1",
      port: port || 3306,
      username,
      password: password || "",
      createdAt: Date.now(),
    });
    return { success: true, id };
  })

  .put("/api/mysql/connections/:id", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const existing = dbGetMysqlConn(params.id);
    if (!existing) return { success: false, message: "连接不存在" };

    const { name, host, port, username, password } = body || {};
    const updated = dbUpdateMysqlConn(params.id, {
      name: name || existing.name,
      host: host || existing.host,
      port: port ?? existing.port,
      username: username || existing.username,
      password: password !== undefined ? password : existing.password,
    });

    if (updated) closePool(params.id);
    return { success: updated };
  })

  .delete("/api/mysql/connections/:id", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    closePool(params.id);
    const deleted = dbDeleteMysqlConn(params.id);
    return { success: deleted };
  })

  .post("/api/mysql/connections/:id/test", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const conn = dbGetMysqlConn(params.id);
    if (!conn) return { success: false, message: "连接不存在" };

    const result = await testConnection(conn);
    return { success: result.ok, message: result.message, version: result.version };
  })

  .post("/api/mysql/connections/test-new", async ({ jwt, request, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { host, port, username, password } = body || {};
    if (!host || !username) return { success: false, message: "缺少必填字段" };

    const result = await testConnection({
      id: "__test__",
      name: "test",
      host,
      port: port || 3306,
      username,
      password: password || "",
      createdAt: 0,
    });
    return { success: result.ok, message: result.message, version: result.version };
  })

  .post("/api/mysql/connections/auto-setup", async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    // 读取安装脚本写入的密码文件
    const PASSWORD_FILE = "/etc/cyrene/.mysql_root_password";
    let rootPassword = "";
    if (existsSync(PASSWORD_FILE)) {
      try {
        rootPassword = readFileSync(PASSWORD_FILE, "utf-8").trim();
      } catch {}
    }

    // 尝试多种方式连接 MySQL（testConnection 内部已优先 socket）
    const candidates = [
      { password: rootPassword, label: "密码文件" },
      { password: "", label: "空密码" },
    ];

    // 也尝试 localhost（某些配置下 socket 认证只接受 localhost）
    const hosts = ["127.0.0.1", "localhost"];

    let workingPassword: string | null = null;
    let workingHost = "127.0.0.1";
    let version = "";

    for (const c of candidates) {
      for (const host of hosts) {
        const result = await testConnection({
          id: "__auto__",
          name: "auto",
          host,
          port: 3306,
          username: "root",
          password: c.password,
          createdAt: 0,
        });
        if (result.ok) {
          workingPassword = c.password;
          workingHost = host;
          version = result.version || "";
          break;
        }
      }
      if (workingPassword !== null) break;
    }

    if (workingPassword === null) {
      const diag = diagnoseMysql();
      let hint = "无法自动连接 MySQL";
      if (!diag.running) {
        hint += "：MySQL 服务未运行，请先启动 (systemctl start mysql)";
      } else if (!diag.tcpListening && !diag.socket) {
        hint += "：服务已运行但无法找到连接方式（TCP 3306 未监听且未找到 socket 文件）";
      } else {
        hint += `：${diag.detail}`;
      }
      return { success: false, message: hint };
    }

    // 检查是否已有本地连接，有则更新密码，无则创建
    const existing = dbListMysqlConns().find(
      (c) => (c.host === "127.0.0.1" || c.host === "localhost") && c.username === "root"
    );

    if (existing) {
      dbUpdateMysqlConn(existing.id, { password: workingPassword, host: workingHost });
      closePool(existing.id);
      return { success: true, connection: { id: existing.id }, version, updated: true };
    }

    const id = randomBytes(8).toString("hex");
    dbInsertMysqlConn({
      id,
      name: "本地 MySQL",
      host: workingHost,
      port: 3306,
      username: "root",
      password: workingPassword,
      createdAt: Date.now(),
    });

    return { success: true, connection: { id }, version, created: true };
  })

  .put("/api/mysql/connections/:id/root-password", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { newPassword } = body || {};
    if (!newPassword) return { success: false, message: "新密码不能为空" };

    const conn = dbGetMysqlConn(params.id);
    if (!conn) return { success: false, message: "连接不存在" };

    try {
      const { getPoolForConn } = await import("./pool");
      const pool = getPoolForConn(conn);

      // 修改所有 root 用户的密码（localhost + 127.0.0.1 + %）
      const [rows] = await pool.query(
        "SELECT Host FROM mysql.user WHERE User = 'root'"
      );
      const hosts = (rows as any[]).map((r: any) => r.Host);

      for (const host of hosts) {
        await pool.query("ALTER USER ?@? IDENTIFIED BY ?", ["root", host, newPassword]);
      }
      await pool.query("FLUSH PRIVILEGES");

      // 更新面板存储的连接密码
      dbUpdateMysqlConn(params.id, { password: newPassword });
      closePool(params.id);

      // 更新密码文件
      try {
        const { writeFileSync, mkdirSync } = await import("fs");
        mkdirSync("/etc/cyrene", { recursive: true });
        writeFileSync("/etc/cyrene/.mysql_root_password", newPassword, { mode: 0o600 });
      } catch {
        // 非 Linux 或无权限，忽略
      }

      return { success: true, message: "root 密码已修改" };
    } catch (e: any) {
      return { success: false, message: e.message || "修改失败" };
    }
  });