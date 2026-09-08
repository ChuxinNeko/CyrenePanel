/**
 * MongoDB 客户端池
 *
 * 按连接 ID 缓存 MongoClient（驱动自带连接池），闲置一段时间后关闭，
 * 避免长期占着到数据库的 socket。
 */

import { MongoClient } from "mongodb";

import { dbGetMongoConn, type MongoConnRow } from "../../db";

interface Entry {
  client: MongoClient;
  lastUsed: number;
}

const clients = new Map<string, Entry>();

/** 闲置超过这个时长就关闭，和 MySQL 池的做法保持一致 */
const IDLE_TTL = 5 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of clients) {
    if (now - entry.lastUsed > IDLE_TTL) {
      entry.client.close().catch(() => {});
      clients.delete(id);
    }
  }
}, 60_000).unref?.();

/** 由连接配置拼出 mongodb:// 连接串 */
export function buildMongoUri(conn: MongoConnRow): string {
  if (conn.uri?.trim()) return conn.uri.trim();

  const auth = conn.username
    ? `${encodeURIComponent(conn.username)}:${encodeURIComponent(conn.password || "")}@`
    : "";
  const authDb = conn.authDb?.trim() || "admin";
  const query = conn.username ? `?authSource=${encodeURIComponent(authDb)}` : "";
  return `mongodb://${auth}${conn.host}:${conn.port}/${query}`;
}

export async function getMongoClient(connId: string): Promise<MongoClient> {
  const existing = clients.get(connId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.client;
  }

  const conn = dbGetMongoConn(connId);
  if (!conn) throw new Error("连接不存在");

  const client = new MongoClient(buildMongoUri(conn), {
    // 连不上时尽快失败，否则请求会挂到默认的 30 秒
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  await client.connect();

  clients.set(connId, { client, lastUsed: Date.now() });
  return client;
}

export function closeMongoClient(connId: string): void {
  const entry = clients.get(connId);
  if (entry) {
    entry.client.close().catch(() => {});
    clients.delete(connId);
  }
}

/** 测试连接是否可用，顺带返回服务端版本 */
export async function testMongoConnection(
  conn: MongoConnRow,
): Promise<{ ok: boolean; message: string; version?: string }> {
  const client = new MongoClient(buildMongoUri(conn), {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  try {
    await client.connect();
    const info = await client.db("admin").command({ buildInfo: 1 });
    return { ok: true, message: "连接成功", version: info?.version };
  } catch (e: any) {
    return { ok: false, message: e?.message || "连接失败" };
  } finally {
    await client.close().catch(() => {});
  }
}
