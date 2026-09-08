/**
 * MongoDB 运行状态与备份
 *
 * 状态：serverStatus 关键指标、当前操作（可 kill）、用户列表。
 * 备份：优先用 mongodump，宿主机没有该工具时回退为按集合导出 EJSON。
 */

import { Elysia } from "elysia";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EJSON } from "bson";

import { dbGetMongoConn } from "../../db";
import { logger } from "../../logger/index";
import { resolveRequestProfile } from "../../node-auth/request-profile";
import { DATA_DIR } from "../../runtime-paths";
import { buildMongoUri, getMongoClient } from "./client";

const BACKUP_ROOT = join(DATA_DIR, "backups", "mongodb");
const DB_NAME_RE = /^[A-Za-z0-9_-]{1,63}$/;
const FILE_RE = /^[A-Za-z0-9_.-]+\.(archive\.gz|ejson\.gz)$/;

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

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

const commandCache = new Map<string, boolean>();

async function hasCommand(name: string): Promise<boolean> {
  const cached = commandCache.get(name);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    const proc = Bun.spawn(["sh", "-c", `command -v ${name}`], { stdout: "pipe", stderr: "ignore" });
    ok = (await proc.exited) === 0;
  } catch {
    ok = false;
  }
  commandCache.set(name, ok);
  return ok;
}

export const mongoStatusRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 运行状态 ──────────────────────────────────────────────────────
  .get("/api/mongodb/status", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      const client = await getMongoClient(connectionId);
      const admin = client.db("admin");
      const status: any = await admin.command({ serverStatus: 1 });

      const opcounters = status.opcounters || {};
      const conn = status.connections || {};
      const mem = status.mem || {};
      const network = status.network || {};

      return {
        success: true,
        status: {
          version: status.version || "",
          host: status.host || "",
          process: status.process || "",
          uptime: Number(status.uptime || 0),
          // 副本集信息，单机时为空
          replicaSet: status.repl?.setName || "",
          isPrimary: status.repl ? !!status.repl.isWritablePrimary : true,
          connectionsCurrent: Number(conn.current || 0),
          connectionsAvailable: Number(conn.available || 0),
          connectionsTotalCreated: Number(conn.totalCreated || 0),
          opInsert: Number(opcounters.insert || 0),
          opQuery: Number(opcounters.query || 0),
          opUpdate: Number(opcounters.update || 0),
          opDelete: Number(opcounters.delete || 0),
          opGetmore: Number(opcounters.getmore || 0),
          opCommand: Number(opcounters.command || 0),
          // mem 单位是 MB
          memResident: Number(mem.resident || 0),
          memVirtual: Number(mem.virtual || 0),
          networkBytesIn: Number(network.bytesIn || 0),
          networkBytesOut: Number(network.bytesOut || 0),
          networkRequests: Number(network.numRequests || 0),
        },
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "获取状态失败" };
    }
  })

  // ── 当前操作 ──────────────────────────────────────────────────────
  .get("/api/mongodb/operations", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      const client = await getMongoClient(connectionId);
      const result: any = await client.db("admin").command({ currentOp: 1, $all: false });
      return {
        success: true,
        operations: (result.inprog || []).map((op: any) => ({
          opid: String(op.opid),
          active: !!op.active,
          op: op.op,
          ns: op.ns,
          secsRunning: Number(op.secs_running || 0),
          client: op.client || op.client_s || "",
          desc: op.desc || "",
          // command 可能很大，序列化后截断展示
          command: JSON.stringify(EJSON.serialize(op.command || {}, { relaxed: true })).slice(0, 500),
        })),
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "获取操作列表失败" };
    }
  })

  .post("/api/mongodb/operations/kill", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const opid = body?.opid;
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (opid === undefined || opid === null || opid === "") {
      return { success: false, message: "缺少 opid" };
    }

    try {
      const client = await getMongoClient(connectionId);
      // opid 可能是数字或形如 "shard:123" 的字符串，数字优先
      const numeric = Number(opid);
      await client.db("admin").command({
        killOp: 1,
        op: Number.isFinite(numeric) ? numeric : String(opid),
      });
      logger.info(`[mongodb] 终止操作 ${opid}`);
      return { success: true, message: `操作 ${opid} 已终止` };
    } catch (e: any) {
      return { success: false, message: e?.message || "终止失败" };
    }
  })

  // ── 用户列表 ──────────────────────────────────────────────────────
  .get("/api/mongodb/users", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      const client = await getMongoClient(connectionId);
      const result: any = await client.db("admin").command({ usersInfo: 1, forAllDBs: true });
      return {
        success: true,
        users: (result.users || []).map((u: any) => ({
          user: u.user,
          db: u.db,
          roles: (u.roles || []).map((r: any) => `${r.role}@${r.db}`),
          mechanisms: u.mechanisms || [],
        })),
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "获取用户列表失败（可能权限不足）" };
    }
  })

  // ── 备份列表 ──────────────────────────────────────────────────────
  .get("/api/mongodb/backups", async ({ query, profile }: any) => {
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
          database: name.replace(/_\d{8}_\d{6}\.(archive|ejson)\.gz$/, ""),
          // archive = mongodump 归档，ejson = 面板自己导出的
          format: name.endsWith(".archive.gz") ? "archive" : "ejson",
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
  .post("/api/mongodb/backups", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const database = String(body?.database || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(database)) return { success: false, message: "无效的数据库名" };

    const conn = dbGetMongoConn(connectionId);
    if (!conn) return { success: false, message: "连接不存在" };

    let tempDir: string | null = null;
    try {
      const dir = connDir(connectionId);
      await mkdir(dir, { recursive: true });

      if (await hasCommand("mongodump")) {
        const fileName = `${database}_${timestamp()}.archive.gz`;
        const target = join(dir, fileName);

        // 连接串含密码，放进临时配置文件而不是命令行参数
        tempDir = await mkdtemp(join(tmpdir(), "cyrene-mongo-"));
        const cfgFile = join(tempDir, "mongo.conf");
        await writeFile(cfgFile, `uri: "${buildMongoUri(conn)}"\n`, "utf-8");
        await chmod(cfgFile, 0o600);

        const proc = Bun.spawn(
          ["mongodump", `--config=${cfgFile}`, `--db=${database}`, "--archive=" + target, "--gzip"],
          { stdout: "pipe", stderr: "pipe" },
        );
        const code = await proc.exited;
        if (code !== 0) {
          const stderr = await new Response(proc.stderr).text();
          await rm(target, { force: true });
          return { success: false, message: stderr.trim() || `mongodump 退出码 ${code}` };
        }

        const info = await stat(target);
        logger.info(`[mongodb] 备份 ${database} -> ${fileName}（mongodump）`);
        return {
          success: true,
          message: `备份完成：${fileName}`,
          method: "mongodump",
          backup: {
            file: fileName,
            database,
            format: "archive",
            size: info.size,
            createdAt: info.mtime.toISOString(),
          },
        };
      }

      // 没有 mongodump 时，按集合导出 EJSON
      const fileName = `${database}_${timestamp()}.ejson.gz`;
      const target = join(dir, fileName);

      const client = await getMongoClient(connectionId);
      const mongoDb = client.db(database);
      const collections = await mongoDb.listCollections().toArray();

      const payload: Record<string, unknown[]> = {};
      for (const info of collections) {
        if (info.type === "view") continue;
        const docs = await mongoDb.collection(info.name).find({}).toArray();
        payload[info.name] = docs.map((d) => EJSON.serialize(d, { relaxed: false }));
      }

      const json = JSON.stringify({
        meta: {
          database,
          exportedAt: new Date().toISOString(),
          format: "cyrene-mongo-ejson-v1",
        },
        collections: payload,
      });

      const gzipped = new Response(
        new Blob([new TextEncoder().encode(json) as unknown as BlobPart])
          .stream()
          .pipeThrough(
            new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
          ) as any,
      );
      await Bun.write(target, gzipped);

      const info = await stat(target);
      logger.info(`[mongodb] 备份 ${database} -> ${fileName}（EJSON 回退）`);
      return {
        success: true,
        message: `备份完成：${fileName}`,
        method: "ejson",
        backup: {
          file: fileName,
          database,
          format: "ejson",
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
  .post("/api/mongodb/backups/restore", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const file = String(body?.file || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    const conn = dbGetMongoConn(connectionId);
    if (!conn) return { success: false, message: "连接不存在" };

    let tempDir: string | null = null;
    try {
      const path = backupPath(connectionId, file);
      if (!existsSync(path)) return { success: false, message: "备份文件不存在" };

      if (file.endsWith(".archive.gz")) {
        if (!(await hasCommand("mongorestore"))) {
          return {
            success: false,
            message: "该备份是 mongodump 归档格式，恢复需要 mongorestore，但宿主机未安装",
          };
        }

        tempDir = await mkdtemp(join(tmpdir(), "cyrene-mongo-"));
        const cfgFile = join(tempDir, "mongo.conf");
        await writeFile(cfgFile, `uri: "${buildMongoUri(conn)}"\n`, "utf-8");
        await chmod(cfgFile, 0o600);

        const proc = Bun.spawn(
          ["mongorestore", `--config=${cfgFile}`, `--archive=${path}`, "--gzip", "--drop"],
          { stdout: "pipe", stderr: "pipe" },
        );
        const code = await proc.exited;
        if (code !== 0) {
          const stderr = await new Response(proc.stderr).text();
          return { success: false, message: stderr.trim() || `mongorestore 退出码 ${code}` };
        }
        logger.warn(`[mongodb] 从 ${file} 恢复（mongorestore）`);
        return { success: true, message: `已从 ${file} 恢复`, method: "mongorestore" };
      }

      // EJSON 格式：解压后逐集合写回
      const decompressed = Bun.file(path)
        .stream()
        .pipeThrough(new DecompressionStream("gzip") as any);
      const text = await new Response(decompressed as any).text();
      const parsed = JSON.parse(text);

      const database = String(parsed?.meta?.database || "");
      if (!DB_NAME_RE.test(database)) {
        return { success: false, message: "备份文件缺少有效的数据库名" };
      }

      const client = await getMongoClient(connectionId);
      const mongoDb = client.db(database);

      let restored = 0;
      for (const [name, docs] of Object.entries(parsed.collections || {})) {
        const list = (docs as unknown[]).map((d) => EJSON.deserialize(d as any));
        const collection = mongoDb.collection(name);
        // 与 mongorestore --drop 行为一致：先清空再写入
        await collection.deleteMany({});
        if (list.length > 0) {
          await collection.insertMany(list as any[], { ordered: false });
          restored += list.length;
        }
      }

      logger.warn(`[mongodb] 从 ${file} 恢复（EJSON，${restored} 条文档）`);
      return {
        success: true,
        message: `已恢复 ${database}，共 ${restored} 条文档`,
        method: "ejson",
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "恢复失败" };
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  })

  .get("/api/mongodb/backups/download", async ({ query, profile }: any) => {
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

  .delete("/api/mongodb/backups", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const path = backupPath(String(query?.connectionId || ""), String(query?.file || ""));
      await rm(path, { force: true });
      logger.info(`[mongodb] 删除备份 ${query.file}`);
      return { success: true, message: "备份已删除" };
    } catch (e: any) {
      return { success: false, message: e?.message || "删除失败" };
    }
  });
