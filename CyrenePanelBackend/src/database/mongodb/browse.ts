/**
 * MongoDB 库 / 集合 / 文档 / 索引管理
 *
 * 对标宝塔与 1Panel 的数据库浏览：库和集合的增删、体积统计、
 * 文档的查询与增删改、索引的查看与增删。
 */

import { Elysia } from "elysia";
import { EJSON, ObjectId } from "bson";

import { logger } from "../../logger/index";
import { resolveRequestProfile } from "../../node-auth/request-profile";
import { getMongoClient } from "./client";

/** 库名/集合名白名单。MongoDB 自身限制较松，这里收紧以避免注入到命令里 */
const DB_NAME_RE = /^[A-Za-z0-9_-]{1,63}$/;
const COLL_NAME_RE = /^[A-Za-z0-9_.-]{1,120}$/;

/** MongoDB 内置库，不允许删除 */
const SYSTEM_DBS = new Set(["admin", "local", "config"]);

/**
 * 用 EJSON 解析前端传来的查询/文档。
 * 相比 JSON.parse，它能表达 ObjectId、Date 等 BSON 类型，
 * 例如 {"_id": {"$oid": "..."}}。
 */
function parseEjson(value: unknown, fallback: any = {}): any {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return EJSON.parse(String(value), { relaxed: false });
  } catch {
    // 宽松模式能接受普通 JSON
    return JSON.parse(String(value));
  }
}

/** 统一把 BSON 序列化成前端可读的形式 */
function toEjson(value: unknown) {
  return EJSON.serialize(value as any, { relaxed: false });
}

export const mongoBrowseRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 数据库列表 ────────────────────────────────────────────────────
  .get("/api/mongodb/databases", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };

    try {
      const client = await getMongoClient(connectionId);
      const result = await client.db("admin").admin().listDatabases();
      return {
        success: true,
        databases: (result.databases || []).map((d: any) => ({
          name: d.name,
          sizeOnDisk: Number(d.sizeOnDisk || 0),
          empty: !!d.empty,
          system: SYSTEM_DBS.has(d.name),
        })),
        totalSize: Number(result.totalSize || 0),
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "获取数据库列表失败" };
    }
  })

  // ── 集合列表（含统计）─────────────────────────────────────────────
  .get("/api/mongodb/databases/:db/collections", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(params.db)) return { success: false, message: "无效的数据库名" };

    try {
      const client = await getMongoClient(connectionId);
      const database = client.db(params.db);
      const infos = await database.listCollections().toArray();

      const collections = [];
      for (const info of infos) {
        // $collStats 比已废弃的 collStats 命令更通用，
        // 视图或权限不足时会失败，此时降级为只给出名称
        try {
          const [stats] = await database
            .collection(info.name)
            .aggregate([{ $collStats: { storageStats: {} } }])
            .toArray();
          const s = (stats as any)?.storageStats || {};
          collections.push({
            name: info.name,
            type: info.type || "collection",
            count: Number(s.count || 0),
            size: Number(s.size || 0),
            storageSize: Number(s.storageSize || 0),
            totalIndexSize: Number(s.totalIndexSize || 0),
            indexCount: Object.keys(s.indexSizes || {}).length,
            avgObjSize: Number(s.avgObjSize || 0),
          });
        } catch {
          collections.push({
            name: info.name,
            type: info.type || "collection",
            count: 0,
            size: 0,
            storageSize: 0,
            totalIndexSize: 0,
            indexCount: 0,
            avgObjSize: 0,
          });
        }
      }

      collections.sort((a, b) => b.storageSize - a.storageSize);
      return { success: true, collections };
    } catch (e: any) {
      return { success: false, message: e?.message || "获取集合列表失败" };
    }
  })

  // ── 创建数据库（MongoDB 需要建集合才会真正落库）────────────────────
  .post("/api/mongodb/databases", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const name = String(body?.name || "").trim();
    const collection = String(body?.collection || "").trim();

    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(name)) return { success: false, message: "无效的数据库名" };
    if (!COLL_NAME_RE.test(collection)) {
      return { success: false, message: "需要指定一个初始集合名，MongoDB 空库不会被保存" };
    }

    try {
      const client = await getMongoClient(connectionId);
      await client.db(name).createCollection(collection);
      logger.info(`[mongodb] 创建数据库 ${name}（初始集合 ${collection}）`);
      return { success: true, message: `数据库 ${name} 已创建` };
    } catch (e: any) {
      return { success: false, message: e?.message || "创建失败" };
    }
  })

  .delete("/api/mongodb/databases/:db", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(params.db)) return { success: false, message: "无效的数据库名" };
    if (SYSTEM_DBS.has(params.db)) {
      return { success: false, message: `${params.db} 是 MongoDB 内置库，不能删除` };
    }

    try {
      const client = await getMongoClient(connectionId);
      await client.db(params.db).dropDatabase();
      logger.warn(`[mongodb] 删除数据库 ${params.db}`);
      return { success: true, message: `数据库 ${params.db} 已删除` };
    } catch (e: any) {
      return { success: false, message: e?.message || "删除失败" };
    }
  })

  // ── 集合增删 ──────────────────────────────────────────────────────
  .post("/api/mongodb/databases/:db/collections", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const name = String(body?.name || "").trim();
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(params.db)) return { success: false, message: "无效的数据库名" };
    if (!COLL_NAME_RE.test(name)) return { success: false, message: "无效的集合名" };

    try {
      const client = await getMongoClient(connectionId);
      await client.db(params.db).createCollection(name);
      logger.info(`[mongodb] 创建集合 ${params.db}.${name}`);
      return { success: true, message: `集合 ${name} 已创建` };
    } catch (e: any) {
      return { success: false, message: e?.message || "创建失败" };
    }
  })

  .delete("/api/mongodb/databases/:db/collections/:coll", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(params.db) || !COLL_NAME_RE.test(params.coll)) {
      return { success: false, message: "无效的库名或集合名" };
    }

    try {
      const client = await getMongoClient(connectionId);
      await client.db(params.db).collection(params.coll).drop();
      logger.warn(`[mongodb] 删除集合 ${params.db}.${params.coll}`);
      return { success: true, message: "集合已删除" };
    } catch (e: any) {
      return { success: false, message: e?.message || "删除失败" };
    }
  })

  // 清空集合但保留索引
  .post("/api/mongodb/databases/:db/collections/:coll/truncate", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(params.db) || !COLL_NAME_RE.test(params.coll)) {
      return { success: false, message: "无效的库名或集合名" };
    }

    try {
      const client = await getMongoClient(connectionId);
      const result = await client.db(params.db).collection(params.coll).deleteMany({});
      logger.warn(`[mongodb] 清空集合 ${params.db}.${params.coll}，删除 ${result.deletedCount} 条`);
      return { success: true, message: `已清空 ${result.deletedCount} 条文档` };
    } catch (e: any) {
      return { success: false, message: e?.message || "清空失败" };
    }
  })

  // ── 文档查询 ──────────────────────────────────────────────────────
  .post("/api/mongodb/documents/find", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const db = String(body?.database || "");
    const coll = String(body?.collection || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(db) || !COLL_NAME_RE.test(coll)) {
      return { success: false, message: "无效的库名或集合名" };
    }

    const limitRaw = Number(body?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 20;
    const skipRaw = Number(body?.skip);
    const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? skipRaw : 0;

    try {
      const filter = parseEjson(body?.filter, {});
      const sort = parseEjson(body?.sort, {});
      const projection = parseEjson(body?.projection, undefined);

      const client = await getMongoClient(connectionId);
      const collection = client.db(db).collection(coll);

      let cursor = collection.find(filter).skip(skip).limit(limit);
      if (sort && Object.keys(sort).length > 0) cursor = cursor.sort(sort);
      if (projection) cursor = cursor.project(projection);

      const docs = await cursor.toArray();
      // 大集合上精确计数很慢，加超时上限；超时就退化为估算值
      let total: number;
      try {
        total = await collection.countDocuments(filter, { maxTimeMS: 3000 });
      } catch {
        total = await collection.estimatedDocumentCount();
      }

      return {
        success: true,
        documents: docs.map((d) => toEjson(d)),
        total,
        skip,
        limit,
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "查询失败" };
    }
  })

  // ── 文档增删改 ────────────────────────────────────────────────────
  .post("/api/mongodb/documents/insert", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const db = String(body?.database || "");
    const coll = String(body?.collection || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(db) || !COLL_NAME_RE.test(coll)) {
      return { success: false, message: "无效的库名或集合名" };
    }

    try {
      const doc = parseEjson(body?.document, null);
      if (!doc || typeof doc !== "object") return { success: false, message: "文档内容无效" };

      const client = await getMongoClient(connectionId);
      const collection = client.db(db).collection(coll);

      if (Array.isArray(doc)) {
        const result = await collection.insertMany(doc);
        return { success: true, message: `已插入 ${result.insertedCount} 条文档` };
      }
      const result = await collection.insertOne(doc);
      return { success: true, message: "已插入 1 条文档", id: String(result.insertedId) };
    } catch (e: any) {
      return { success: false, message: e?.message || "插入失败" };
    }
  })

  .post("/api/mongodb/documents/update", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const db = String(body?.database || "");
    const coll = String(body?.collection || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(db) || !COLL_NAME_RE.test(coll)) {
      return { success: false, message: "无效的库名或集合名" };
    }

    try {
      const client = await getMongoClient(connectionId);
      const collection = client.db(db).collection(coll);

      // 按 _id 整文档替换（编辑器里改完保存）
      if (body?.id) {
        const doc = parseEjson(body?.document, null);
        if (!doc || typeof doc !== "object") return { success: false, message: "文档内容无效" };
        delete (doc as any)._id;

        const id = ObjectId.isValid(String(body.id)) ? new ObjectId(String(body.id)) : body.id;
        const result = await collection.replaceOne({ _id: id as any }, doc);
        return {
          success: result.matchedCount > 0,
          message: result.matchedCount > 0 ? "文档已更新" : "未找到匹配的文档",
        };
      }

      // 按条件批量更新
      const filter = parseEjson(body?.filter, null);
      const update = parseEjson(body?.update, null);
      if (!filter || !update) return { success: false, message: "缺少 filter 或 update" };

      const result = body?.many
        ? await collection.updateMany(filter, update)
        : await collection.updateOne(filter, update);
      return { success: true, message: `匹配 ${result.matchedCount} 条，修改 ${result.modifiedCount} 条` };
    } catch (e: any) {
      return { success: false, message: e?.message || "更新失败" };
    }
  })

  .post("/api/mongodb/documents/delete", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    const db = String(body?.database || "");
    const coll = String(body?.collection || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(db) || !COLL_NAME_RE.test(coll)) {
      return { success: false, message: "无效的库名或集合名" };
    }

    try {
      const client = await getMongoClient(connectionId);
      const collection = client.db(db).collection(coll);

      if (body?.id) {
        const id = ObjectId.isValid(String(body.id)) ? new ObjectId(String(body.id)) : body.id;
        const result = await collection.deleteOne({ _id: id as any });
        return {
          success: result.deletedCount > 0,
          message: result.deletedCount > 0 ? "文档已删除" : "未找到匹配的文档",
        };
      }

      const filter = parseEjson(body?.filter, null);
      // 不允许无条件删除，避免误清空整个集合；要清空请走 truncate
      if (!filter || Object.keys(filter).length === 0) {
        return { success: false, message: "必须指定删除条件，清空集合请使用「清空」功能" };
      }

      const result = body?.many
        ? await collection.deleteMany(filter)
        : await collection.deleteOne(filter);
      return { success: true, message: `已删除 ${result.deletedCount} 条文档` };
    } catch (e: any) {
      return { success: false, message: e?.message || "删除失败" };
    }
  })

  // ── 索引管理 ──────────────────────────────────────────────────────
  .get("/api/mongodb/databases/:db/collections/:coll/indexes", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(params.db) || !COLL_NAME_RE.test(params.coll)) {
      return { success: false, message: "无效的库名或集合名" };
    }

    try {
      const client = await getMongoClient(connectionId);
      const indexes = await client.db(params.db).collection(params.coll).indexes();
      return {
        success: true,
        indexes: indexes.map((i: any) => ({
          name: i.name,
          keys: i.key,
          unique: !!i.unique,
          sparse: !!i.sparse,
          background: !!i.background,
          expireAfterSeconds: i.expireAfterSeconds,
        })),
      };
    } catch (e: any) {
      return { success: false, message: e?.message || "获取索引失败" };
    }
  })

  .post("/api/mongodb/databases/:db/collections/:coll/indexes", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(body?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (!DB_NAME_RE.test(params.db) || !COLL_NAME_RE.test(params.coll)) {
      return { success: false, message: "无效的库名或集合名" };
    }

    try {
      const keys = parseEjson(body?.keys, null);
      if (!keys || Object.keys(keys).length === 0) {
        return { success: false, message: "请指定索引字段，例如 {\"name\": 1}" };
      }

      const client = await getMongoClient(connectionId);
      const name = await client.db(params.db).collection(params.coll).createIndex(keys, {
        unique: body?.unique === true,
        sparse: body?.sparse === true,
        ...(Number.isFinite(Number(body?.expireAfterSeconds))
          ? { expireAfterSeconds: Number(body.expireAfterSeconds) }
          : {}),
      });
      logger.info(`[mongodb] 创建索引 ${params.db}.${params.coll} -> ${name}`);
      return { success: true, message: `索引 ${name} 已创建` };
    } catch (e: any) {
      return { success: false, message: e?.message || "创建索引失败" };
    }
  })

  .delete("/api/mongodb/databases/:db/collections/:coll/indexes/:name", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const connectionId = String(query?.connectionId || "");
    if (!connectionId) return { success: false, message: "缺少 connectionId" };
    if (params.name === "_id_") return { success: false, message: "_id 主键索引不能删除" };

    try {
      const client = await getMongoClient(connectionId);
      await client.db(params.db).collection(params.coll).dropIndex(params.name);
      logger.info(`[mongodb] 删除索引 ${params.db}.${params.coll}.${params.name}`);
      return { success: true, message: "索引已删除" };
    } catch (e: any) {
      return { success: false, message: e?.message || "删除索引失败" };
    }
  });
