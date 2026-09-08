/**
 * MongoDB 连接管理
 *
 * 与 MySQL 连接管理对齐：增删改查 + 连接测试。
 * 返回给前端时一律不带密码。
 */

import { Elysia } from "elysia";
import { randomUUID } from "node:crypto";

import {
  dbDeleteMongoConn,
  dbGetMongoConn,
  dbInsertMongoConn,
  dbListMongoConns,
  dbUpdateMongoConn,
  type MongoConnRow,
} from "../../db";
import { logger } from "../../logger/index";
import { resolveRequestProfile } from "../../node-auth/request-profile";
import { closeMongoClient, testMongoConnection } from "./client";

/** 剥掉密码后再返回，避免明文密码经接口外泄 */
function toSafe(conn: MongoConnRow) {
  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    authDb: conn.authDb,
    hasUri: !!conn.uri,
    hasPassword: !!conn.password,
    createdAt: conn.createdAt,
  };
}

function parseFields(body: any) {
  return {
    name: String(body?.name || "").trim(),
    host: String(body?.host || "127.0.0.1").trim(),
    port: Number(body?.port) || 27017,
    username: String(body?.username || "").trim(),
    password: typeof body?.password === "string" ? body.password : "",
    authDb: String(body?.authDb || "admin").trim(),
    uri: String(body?.uri || "").trim(),
  };
}

export const mongoConnectionRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  .get("/api/mongodb/connections", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return { success: true, connections: dbListMongoConns().map(toSafe) };
  })

  .post("/api/mongodb/connections", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const fields = parseFields(body);
    if (!fields.name) return { success: false, message: "连接名称不能为空" };
    if (!fields.uri && !fields.host) return { success: false, message: "请填写主机地址或完整连接串" };

    const conn: MongoConnRow = { id: randomUUID(), ...fields, createdAt: Date.now() };
    dbInsertMongoConn(conn);
    logger.info(`[mongodb] 新增连接 ${fields.name}`);
    return { success: true, message: "连接已保存", connection: toSafe(conn) };
  })

  .put("/api/mongodb/connections/:id", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const existing = dbGetMongoConn(params.id);
    if (!existing) return { success: false, message: "连接不存在" };

    const fields = parseFields(body);
    if (!fields.name) return { success: false, message: "连接名称不能为空" };
    // 密码留空表示不修改，否则用户每次编辑都得重新输入
    if (!fields.password) fields.password = existing.password;

    const ok = dbUpdateMongoConn(params.id, fields);
    // 配置变了，缓存的客户端必须失效，否则还在用旧凭据
    closeMongoClient(params.id);

    return ok
      ? { success: true, message: "连接已更新" }
      : { success: false, message: "更新失败" };
  })

  .delete("/api/mongodb/connections/:id", ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    closeMongoClient(params.id);
    return dbDeleteMongoConn(params.id)
      ? { success: true, message: "连接已删除" }
      : { success: false, message: "连接不存在" };
  })

  .post("/api/mongodb/connections/:id/test", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const conn = dbGetMongoConn(params.id);
    if (!conn) return { success: false, message: "连接不存在" };
    const result = await testMongoConnection(conn);
    return { success: result.ok, message: result.message, version: result.version };
  })

  // 保存前先测：用表单里的临时配置直接试连
  .post("/api/mongodb/connections/test-new", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const fields = parseFields(body);
    const result = await testMongoConnection({
      id: "temp",
      createdAt: 0,
      ...fields,
    } as MongoConnRow);
    return { success: result.ok, message: result.message, version: result.version };
  });
