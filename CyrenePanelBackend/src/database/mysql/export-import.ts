import { Elysia } from "elysia";
import { spawn } from "child_process";
import { dbGetMysqlConn } from "../../db";
import { getPoolForConn } from "./pool";

export const mysqlExportImportRoutes = new Elysia()

  // 导出数据库 (mysqldump)
  .get("/api/mysql/databases/:db/export", async ({ jwt, request, params, query }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const profile = await jwt.verify(token);
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const connectionId = query?.connectionId;
    if (!connectionId) {
      return new Response(JSON.stringify({ success: false, message: "缺少 connectionId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conn = dbGetMysqlConn(connectionId);
    if (!conn) {
      return new Response(JSON.stringify({ success: false, message: "连接不存在" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const args = [
      `-h${conn.host}`,
      `-P${conn.port}`,
      `-u${conn.username}`,
      `--databases`, params.db,
      `--single-transaction`,
      `--routines`,
      `--triggers`,
      `--events`,
    ];
    if (conn.password) args.push(`-p${conn.password}`);

    // 尝试用 mysqldump
    const stream = new ReadableStream({
      start(controller) {
        const proc = spawn("mysqldump", args, { stdio: ["pipe", "pipe", "pipe"] });
        proc.stdout.on("data", (chunk: Buffer) => {
          controller.enqueue(chunk);
        });
        proc.stderr.on("data", () => {});
        proc.on("close", (code) => {
          if (code !== 0) {
            controller.enqueue(Buffer.from(`\n-- mysqldump exited with code ${code}\n`));
          }
          controller.close();
        });
        proc.on("error", (err) => {
          controller.enqueue(Buffer.from(`-- Error: ${err.message}\n`));
          controller.close();
        });
      },
    });

    const filename = `${params.db}_${new Date().toISOString().slice(0, 10)}.sql`;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/sql",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache",
      },
    });
  })

  // 导入 SQL 文件
  .post("/api/mysql/databases/:db/import", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { connectionId, sql } = body || {};
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    // sql 可以直接传 SQL 文本，或通过 formData 上传文件
    let sqlContent = sql || "";

    // 如果是 multipart 上传
    if (!sqlContent && request.headers.get("content-type")?.includes("multipart")) {
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (file && file instanceof Blob) {
          sqlContent = await file.text();
        }
      } catch {
        return { success: false, message: "文件解析失败" };
      }
    }

    if (!sqlContent) return { success: false, message: "缺少 SQL 内容" };

    try {
      const conn = dbGetMysqlConn(connectionId);
      if (!conn) return { success: false, message: "连接不存在" };
      const pool = getPoolForConn(conn);

      const fullSql = `USE \`${params.db}\`;\n${sqlContent}`;
      const start = performance.now();
      await pool.query(fullSql);
      const elapsed = Math.round(performance.now() - start);

      return { success: true, message: `导入完成 (${elapsed}ms)` };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });