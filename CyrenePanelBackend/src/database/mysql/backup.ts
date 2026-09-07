/**
 * MySQL 备份管理
 *
 * 对标宝塔/1Panel 的备份页：手动备份、备份列表、恢复、下载、删除。
 * 备份落在 <DATA_DIR>/backups/mysql/<连接ID>/ 下，gzip 压缩存储。
 *
 * 密码通过临时 defaults-extra-file 传给 mysqldump/mysql，
 * 而不是 -p<password>——后者会暴露在进程列表里，任何用户 ps 都能看到。
 */

import { Elysia } from "elysia";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { dbGetMysqlConn, type MysqlConnRow } from "../../db";
import { logger } from "../../logger/index";
import { resolveRequestProfile } from "../../node-auth/request-profile";
import { DATA_DIR } from "../../runtime-paths";

const BACKUP_ROOT = join(DATA_DIR, "backups", "mysql");

/** 库名白名单 */
const IDENT_RE = /^[A-Za-z0-9_$一-龥-]+$/;
/** 备份文件名白名单，杜绝路径穿越 */
const FILE_RE = /^[A-Za-z0-9_.一-龥-]+\.sql\.gz$/;

function connDir(connId: string): string {
  const dir = resolve(join(BACKUP_ROOT, connId));
  if (!dir.startsWith(resolve(BACKUP_ROOT))) throw new Error("非法的备份路径");
  return dir;
}

function backupPath(connId: string, file: string): string {
  if (!FILE_RE.test(file)) throw new Error("非法的备份文件名");
  const path = resolve(join(connDir(connId), file));
  if (!path.startsWith(connDir(connId))) throw new Error("非法的备份路径");
  return path;
}

/**
 * 生成只含凭据的临时配置文件，权限 600。
 * 调用方必须在 finally 里删掉返回的目录。
 */
async function createDefaultsFile(conn: MysqlConnRow): Promise<{ file: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "cyrene-mysql-"));
  const file = join(dir, "client.cnf");
  const lines = [
    "[client]",
    `host=${conn.host}`,
    `port=${conn.port}`,
    `user=${conn.username}`,
  ];
  if (conn.password) lines.push(`password="${String(conn.password).replace(/"/g, '\\"')}"`);
  await writeFile(file, `${lines.join("\n")}\n`, "utf-8");
  await chmod(file, 0o600);
  return { file, dir };
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

export const mysqlBackupRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 备份列表 ──────────────────────────────────────────────────────
  .get("/api/mysql/backups", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      const dir = connDir(connectionId);
      await mkdir(dir, { recursive: true });
      const names = await readdir(dir);

      const backups = [];
      for (const name of names) {
        if (!FILE_RE.test(name)) continue;
        const info = await stat(join(dir, name));
        backups.push({
          file: name,
          // 文件名形如 <库名>_20260907_143000.sql.gz
          database: name.replace(/_\d{8}_\d{6}\.sql\.gz$/, ""),
          size: info.size,
          createdAt: info.mtime.toISOString(),
        });
      }

      backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { success: true, backups };
    } catch (e: any) {
      return { success: false, message: e?.message || "读取备份列表失败" };
    }
  })

  // ── 创建备份 ──────────────────────────────────────────────────────
  .post("/api/mysql/backups", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = String(body?.connectionId || "");
    const database = String(body?.database || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!IDENT_RE.test(database)) return { success: false, message: "无效的数据库名" };

    const conn = dbGetMysqlConn(connectionId);
    if (!conn) return { success: false, message: "连接不存在" };

    let tempDir: string | null = null;
    try {
      const dir = connDir(connectionId);
      await mkdir(dir, { recursive: true });

      const fileName = `${database}_${timestamp()}.sql.gz`;
      const target = join(dir, fileName);

      const { file: defaults, dir: tmp } = await createDefaultsFile(conn);
      tempDir = tmp;

      const proc = Bun.spawn(
        [
          "mysqldump",
          `--defaults-extra-file=${defaults}`,
          "--single-transaction",
          "--routines",
          "--triggers",
          "--events",
          "--set-gtid-purged=OFF",
          "--databases",
          database,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );

      // 边导边压，避免整个 dump 进内存。
      // CompressionStream 的 TS 定义与 Bun 的流类型对不上，运行时是兼容的
      const gzipped = (proc.stdout as ReadableStream<Uint8Array>).pipeThrough(
        new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
      );
      await Bun.write(target, new Response(gzipped as any));

      const code = await proc.exited;
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        await rm(target, { force: true });
        return {
          success: false,
          message: stderr.trim() || `mysqldump 退出码 ${code}`,
        };
      }

      const info = await stat(target);
      logger.info(`[mysql] 备份 ${database} -> ${fileName}（${info.size} 字节）`);
      return {
        success: true,
        message: `备份完成：${fileName}`,
        backup: {
          file: fileName,
          database,
          size: info.size,
          createdAt: info.mtime.toISOString(),
        },
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "备份失败" };
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  })

  // ── 恢复备份 ──────────────────────────────────────────────────────
  .post("/api/mysql/backups/restore", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const connectionId = String(body?.connectionId || "");
    const file = String(body?.file || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    const conn = dbGetMysqlConn(connectionId);
    if (!conn) return { success: false, message: "连接不存在" };

    let tempDir: string | null = null;
    try {
      const path = backupPath(connectionId, file);
      if (!existsSync(path)) return { success: false, message: "备份文件不存在" };

      const { file: defaults, dir: tmp } = await createDefaultsFile(conn);
      tempDir = tmp;

      // dump 里带 CREATE DATABASE / USE，因此不需要再指定库名
      const decompressed = Bun.file(path)
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));

      const proc = Bun.spawn(["mysql", `--defaults-extra-file=${defaults}`], {
        stdin: decompressed as any,
        stdout: "pipe",
        stderr: "pipe",
      });

      const code = await proc.exited;
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        return { success: false, message: stderr.trim() || `mysql 退出码 ${code}` };
      }

      logger.warn(`[mysql] 从备份 ${file} 恢复数据`);
      return { success: true, message: `已从 ${file} 恢复` };
    } catch (e: any) {
      return { success: false, message: e?.message || "恢复失败" };
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  })

  // ── 下载备份 ──────────────────────────────────────────────────────
  .get("/api/mysql/backups/download", async ({ query, profile }: any) => {
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const path = backupPath(String(query?.connectionId || ""), String(query?.file || ""));
      if (!existsSync(path)) {
        return new Response(JSON.stringify({ success: false, message: "备份文件不存在" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(Bun.file(path), {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${query.file}"`,
        },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, message: e?.message || "下载失败" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  })

  // ── 删除备份 ──────────────────────────────────────────────────────
  .delete("/api/mysql/backups", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    try {
      const path = backupPath(String(query?.connectionId || ""), String(query?.file || ""));
      await rm(path, { force: true });
      logger.info(`[mysql] 删除备份 ${query.file}`);
      return { success: true, message: "备份已删除" };
    } catch (e: any) {
      return { success: false, message: e?.message || "删除失败" };
    }
  });
