import { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { logger } from "./logger/index";
import { DATA_DIR } from "./runtime-paths";

const DB_PATH = join(DATA_DIR, "cyrene.db");
const dbExisted = existsSync(DB_PATH);

// ── 确保 data 目录存在 ──────────────────────────────────────────────

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ── 打开数据库并建表 ─────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
logger.info(
  `[启动] 数据目录=${DATA_DIR} 数据库=${DB_PATH} ` +
  (dbExisted
    ? "(复用已有数据库)"
    : "(未找到已有数据库，将新建；此前的 JWT 密钥/节点身份/已配对子节点/管理员密码都会失效)"),
);
db.exec(`
  CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS instances (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    command     TEXT NOT NULL,
    cwd         TEXT NOT NULL,
    env         TEXT NOT NULL DEFAULT '{}',
    autoRestart INTEGER NOT NULL DEFAULT 0,
    createdAt   INTEGER NOT NULL
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    createdAt  INTEGER NOT NULL
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    address   TEXT NOT NULL,
    isMain    INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS node_controllers (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    publicKeyPem TEXT NOT NULL,
    keyId        TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    createdAt    INTEGER NOT NULL,
    revokedAt    INTEGER
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS node_pairing_codes (
    codeHash   TEXT PRIMARY KEY,
    expiresAt  INTEGER NOT NULL,
    consumedAt INTEGER
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS node_request_nonces (
    controllerId TEXT NOT NULL,
    nonce        TEXT NOT NULL,
    expiresAt    INTEGER NOT NULL,
    PRIMARY KEY (controllerId, nonce)
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    username  TEXT NOT NULL,
    category  TEXT NOT NULL,
    action    TEXT NOT NULL,
    target    TEXT NOT NULL DEFAULT '',
    detail    TEXT NOT NULL DEFAULT '',
    ip        TEXT NOT NULL DEFAULT '',
    success   INTEGER NOT NULL DEFAULT 1
  );
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
`);

// ── 迁移：添加 nodeId / nodeName 列 ────────────────────────────────

function migrateColumns() {
  const instanceColumns = db.prepare("PRAGMA table_info(instances)").all() as { name: string }[];
  const hasNodeId = instanceColumns.some((c) => c.name === "nodeId");
  const hasNodeName = instanceColumns.some((c) => c.name === "nodeName");

  if (!hasNodeId) {
    db.exec("ALTER TABLE instances ADD COLUMN nodeId TEXT NOT NULL DEFAULT '__main__'");
    logger.info("已添加 instances.nodeId 列");
  }
  if (!hasNodeName) {
    db.exec("ALTER TABLE instances ADD COLUMN nodeName TEXT NOT NULL DEFAULT '主节点'");
    logger.info("已添加 instances.nodeName 列");
  }

  const nodeColumns = db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[];
  if (nodeColumns.some((column) => column.name === "apiKey" || column.name === "authVersion")) {
    db.exec(`
      BEGIN;
      CREATE TABLE nodes_v2 (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        address   TEXT NOT NULL,
        isMain    INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
      );
      INSERT INTO nodes_v2 (id, name, address, isMain, createdAt)
      SELECT id, name, address, isMain, createdAt FROM nodes;
      DROP TABLE nodes;
      ALTER TABLE nodes_v2 RENAME TO nodes;
      COMMIT;
    `);
    logger.warn("已移除旧节点凭据；现有子节点必须使用 v2 配对码重新绑定");
  }
}

migrateColumns();
db.exec("DELETE FROM app_config WHERE key = 'api_key'");

// ── JSON → SQLite 首次迁移 ───────────────────────────────────────────

function migrateFromJson() {
  // 实例配置迁移
  const instancesJsonPath = join(DATA_DIR, "instances.json");
  if (existsSync(instancesJsonPath)) {
    try {
      const raw = readFileSync(instancesJsonPath, "utf-8");
      const list: any[] = JSON.parse(raw);
      const insert = db.prepare(
        "INSERT OR IGNORE INTO instances (id, name, command, cwd, env, autoRestart, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const tx = db.transaction(() => {
        for (const item of list) {
          insert.run(
            item.id,
            item.name,
            item.command,
            item.cwd,
            JSON.stringify(item.env ?? {}),
            item.autoRestart ? 1 : 0,
            item.createdAt
          );
        }
      });
      tx();
      renameSync(instancesJsonPath, instancesJsonPath + ".bak");
      logger.info(`已将 ${list.length} 个实例配置从 JSON 迁移到 SQLite`);
    } catch (e: any) {
      logger.warn(`实例配置 JSON 迁移失败: ${e.message}`);
    }
  }

  // 应用配置迁移
  const configJsonPath = join(process.cwd(), "config.json");
  if (existsSync(configJsonPath)) {
    try {
      const raw = readFileSync(configJsonPath, "utf-8");
      const cfg = JSON.parse(raw);
      const insert = db.prepare(
        "INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)"
      );
      const tx = db.transaction(() => {
        if (cfg.username) insert.run("username", cfg.username);
        if (cfg.password) insert.run("password", cfg.password);
        if (cfg.logLevel) insert.run("logLevel", cfg.logLevel);
      });
      tx();
      renameSync(configJsonPath, configJsonPath + ".bak");
      logger.info("已将应用配置从 JSON 迁移到 SQLite");
    } catch (e: any) {
      logger.warn(`应用配置 JSON 迁移失败: ${e.message}`);
    }
  }
}

migrateFromJson();

// ── app_config 辅助函数 ──────────────────────────────────────────────

const cfgGetStmt = db.prepare("SELECT value FROM app_config WHERE key = ?");
const cfgSetStmt = db.prepare(
  "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)"
);

export function getConfig(key: string): string | undefined {
  const row = cfgGetStmt.get(key) as { value: string } | undefined;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  cfgSetStmt.run(key, value);
}

export function getAllConfig(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM app_config").all() as {
    key: string;
    value: string;
  }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ── instances 辅助函数 ───────────────────────────────────────────────

const instInsertStmt = db.prepare(
  "INSERT INTO instances (id, name, command, cwd, env, autoRestart, createdAt, nodeId, nodeName) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
const instGetStmt = db.prepare("SELECT * FROM instances WHERE id = ?");
const instAllStmt = db.prepare("SELECT * FROM instances");
const instDeleteStmt = db.prepare("DELETE FROM instances WHERE id = ?");
const instUpdateNameStmt = db.prepare("UPDATE instances SET name = ? WHERE id = ?");
const instUpdateCommandStmt = db.prepare("UPDATE instances SET command = ? WHERE id = ?");
const instUpdateCwdStmt = db.prepare("UPDATE instances SET cwd = ? WHERE id = ?");
const instUpdateEnvStmt = db.prepare("UPDATE instances SET env = ? WHERE id = ?");
const instUpdateAutoRestartStmt = db.prepare("UPDATE instances SET autoRestart = ? WHERE id = ?");

export interface InstanceRow {
  id: string;
  name: string;
  command: string;
  cwd: string;
  env: string;         // JSON string
  autoRestart: number; // 0 or 1
  createdAt: number;
  nodeId: string;
  nodeName: string;
}

function rowToConfig(row: InstanceRow) {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    cwd: row.cwd,
    env: JSON.parse(row.env || "{}"),
    autoRestart: row.autoRestart === 1,
    createdAt: row.createdAt,
    nodeId: row.nodeId ?? "__main__",
    nodeName: row.nodeName ?? "主节点",
  };
}

export function dbGetAllInstances(): any[] {
  const rows = instAllStmt.all() as InstanceRow[];
  return rows.map(rowToConfig);
}

export function dbGetInstance(id: string): any | undefined {
  const row = instGetStmt.get(id) as InstanceRow | undefined;
  return row ? rowToConfig(row) : undefined;
}

export function dbInsertInstance(cfg: {
  id: string;
  name: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  autoRestart: boolean;
  createdAt: number;
  nodeId?: string;
  nodeName?: string;
}): void {
  instInsertStmt.run(
    cfg.id,
    cfg.name,
    cfg.command,
    cfg.cwd,
    JSON.stringify(cfg.env),
    cfg.autoRestart ? 1 : 0,
    cfg.createdAt,
    cfg.nodeId ?? "__main__",
    cfg.nodeName ?? "主节点"
  );
}

export function dbUpdateInstance(
  id: string,
  fields: { name?: string; command?: string; cwd?: string; env?: Record<string, string>; autoRestart?: boolean }
): void {
  if (fields.name !== undefined) instUpdateNameStmt.run(fields.name, id);
  if (fields.command !== undefined) instUpdateCommandStmt.run(fields.command, id);
  if (fields.cwd !== undefined) instUpdateCwdStmt.run(fields.cwd, id);
  if (fields.env !== undefined) instUpdateEnvStmt.run(JSON.stringify(fields.env), id);
  if (fields.autoRestart !== undefined) instUpdateAutoRestartStmt.run(fields.autoRestart ? 1 : 0, id);
}

export function dbDeleteInstance(id: string): boolean {
  const result = instDeleteStmt.run(id);
  return result.changes > 0;
}

// ── users 辅助函数 ──────────────────────────────────────────────────

export interface UserRow {
  id: number;
  username: string;
  password: string;
  role: string;
  createdAt: number;
}

const userInsertStmt = db.prepare(
  "INSERT INTO users (username, password, role, createdAt) VALUES (?, ?, ?, ?)"
);
const userGetByUsernameStmt = db.prepare(
  "SELECT * FROM users WHERE username = ?"
);
const userGetByIdStmt = db.prepare(
  "SELECT * FROM users WHERE id = ?"
);
const userGetAllStmt = db.prepare(
  "SELECT id, username, role, createdAt FROM users"
);
const userUpdatePasswordStmt = db.prepare(
  "UPDATE users SET password = ? WHERE id = ?"
);
const userDeleteStmt = db.prepare(
  "DELETE FROM users WHERE id = ?"
);
const userCountStmt = db.prepare(
  "SELECT COUNT(*) as count FROM users"
);

export function dbGetUser(username: string): UserRow | undefined {
  return userGetByUsernameStmt.get(username) as UserRow | undefined;
}

export function dbGetUserById(id: number): UserRow | undefined {
  return userGetByIdStmt.get(id) as UserRow | undefined;
}

export function dbGetAllUsers(): Omit<UserRow, "password">[] {
  return userGetAllStmt.all() as Omit<UserRow, "password">[];
}

export function dbInsertUser(username: string, hashedPassword: string, role: string = "user"): void {
  userInsertStmt.run(username, hashedPassword, role, Date.now());
}

export function dbUpdateUserPassword(userId: number, hashedPassword: string): void {
  userUpdatePasswordStmt.run(hashedPassword, userId);
}

export function dbDeleteUser(userId: number): boolean {
  const result = userDeleteStmt.run(userId);
  return result.changes > 0;
}

export function dbUserCount(): number {
  const row = userCountStmt.get() as { count: number };
  return row.count;
}

export { db };

// ── nodes 辅助函数 ──────────────────────────────────────────────────

export interface NodeRow {
  id: string;
  name: string;
  address: string;
  isMain: number; // 0 or 1
  createdAt: number;
}

const nodeInsertStmt = db.prepare(
  "INSERT INTO nodes (id, name, address, isMain, createdAt) VALUES (?, ?, ?, ?, ?)"
);
const nodeGetStmt = db.prepare("SELECT * FROM nodes WHERE id = ?");
const nodeAllStmt = db.prepare("SELECT * FROM nodes");
const nodeDeleteStmt = db.prepare("DELETE FROM nodes WHERE id = ?");

export function dbGetAllNodes(): NodeRow[] {
  return nodeAllStmt.all() as NodeRow[];
}

export function dbGetNode(id: string): NodeRow | undefined {
  return nodeGetStmt.get(id) as NodeRow | undefined;
}

export function dbInsertNode(cfg: {
  id: string;
  name: string;
  address: string;
  isMain?: boolean;
  createdAt: number;
}): void {
  nodeInsertStmt.run(
    cfg.id,
    cfg.name,
    cfg.address,
    cfg.isMain ? 1 : 0,
    cfg.createdAt,
  );
}

export function dbDeleteNode(id: string): boolean {
  const result = nodeDeleteStmt.run(id);
  return result.changes > 0;
}

const nodeUpdateStmt = db.prepare(
  "UPDATE nodes SET name = ?, address = ? WHERE id = ?"
);

export interface NodeControllerRow {
  id: string;
  name: string;
  publicKeyPem: string;
  keyId: string;
  capabilities: string;
  createdAt: number;
  revokedAt: number | null;
}

const nodeControllerGetStmt = db.prepare("SELECT * FROM node_controllers WHERE id = ?");
const nodeControllerUpsertStmt = db.prepare(`
  INSERT INTO node_controllers (id, name, publicKeyPem, keyId, capabilities, createdAt, revokedAt)
  VALUES (?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    publicKeyPem = excluded.publicKeyPem,
    keyId = excluded.keyId,
    capabilities = excluded.capabilities,
    revokedAt = NULL
`);
const nodeControllerRevokeStmt = db.prepare("UPDATE node_controllers SET revokedAt = ? WHERE id = ?");
const nodePairingInsertStmt = db.prepare(
  "INSERT INTO node_pairing_codes (codeHash, expiresAt, consumedAt) VALUES (?, ?, NULL)"
);
const nodePairingGetStmt = db.prepare("SELECT * FROM node_pairing_codes WHERE codeHash = ?");
const nodePairingConsumeStmt = db.prepare("UPDATE node_pairing_codes SET consumedAt = ? WHERE codeHash = ? AND consumedAt IS NULL");
const nodeNonceInsertStmt = db.prepare(
  "INSERT OR IGNORE INTO node_request_nonces (controllerId, nonce, expiresAt) VALUES (?, ?, ?)"
);
const nodeNonceCleanupStmt = db.prepare("DELETE FROM node_request_nonces WHERE expiresAt <= ?");
const nodePairingCleanupStmt = db.prepare("DELETE FROM node_pairing_codes WHERE expiresAt <= ? OR consumedAt IS NOT NULL");

export function dbUpsertNodeController(controller: Omit<NodeControllerRow, "revokedAt">): void {
  nodeControllerUpsertStmt.run(
    controller.id,
    controller.name,
    controller.publicKeyPem,
    controller.keyId,
    controller.capabilities,
    controller.createdAt,
  );
}

export function dbGetNodeController(id: string): NodeControllerRow | undefined {
  return nodeControllerGetStmt.get(id) as NodeControllerRow | undefined;
}

export function dbRevokeNodeController(id: string, revokedAt = Date.now()): boolean {
  return nodeControllerRevokeStmt.run(revokedAt, id).changes > 0;
}

export function dbCreateNodePairingCode(codeHash: string, expiresAt: number): void {
  nodePairingInsertStmt.run(codeHash, expiresAt);
}

export function dbConsumeNodePairingCode(codeHash: string, now = Date.now()): boolean {
  const row = nodePairingGetStmt.get(codeHash) as { expiresAt: number; consumedAt: number | null } | undefined;
  if (!row || row.consumedAt !== null || row.expiresAt <= now) return false;
  return nodePairingConsumeStmt.run(now, codeHash).changes > 0;
}

export function dbConsumeNodeRequestNonce(controllerId: string, nonce: string, expiresAt: number): boolean {
  nodeNonceCleanupStmt.run(Date.now());
  return nodeNonceInsertStmt.run(controllerId, nonce, expiresAt).changes > 0;
}

export function dbCleanupNodeAuth(now = Date.now()): void {
  nodeNonceCleanupStmt.run(now);
  nodePairingCleanupStmt.run(now);
}

export function dbUpdateNode(
  id: string,
  fields: { name?: string; address?: string }
): boolean {
  const existing = dbGetNode(id);
  if (!existing) return false;
  nodeUpdateStmt.run(
    fields.name ?? existing.name,
    fields.address ?? existing.address,
    id
  );
  return true;
}

// ── audit_logs 辅助函数 ────────────────────────────────────────────

export interface AuditLogRow {
  id: number;
  timestamp: number;
  username: string;
  category: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  success: number;
}

const auditInsertStmt = db.prepare(
  "INSERT INTO audit_logs (timestamp, username, category, action, target, detail, ip, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);
const auditPruneStmt = db.prepare(
  "DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs ORDER BY timestamp ASC, id ASC LIMIT ?)"
);
const auditCountStmt = db.prepare("SELECT COUNT(*) as count FROM audit_logs");

const AUDIT_LOGS_MAX = 5000;

export function dbInsertAuditLog(entry: {
  timestamp: number;
  username: string;
  category: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
  success?: boolean;
}): void {
  auditInsertStmt.run(
    entry.timestamp,
    entry.username,
    entry.category,
    entry.action,
    entry.target ?? "",
    entry.detail ?? "",
    entry.ip ?? "",
    entry.success === false ? 0 : 1
  );

  // 容量上限：保持最多 AUDIT_LOGS_MAX 条
  const row = auditCountStmt.get() as { count: number };
  if (row.count > AUDIT_LOGS_MAX) {
    auditPruneStmt.run(row.count - AUDIT_LOGS_MAX);
  }
}

export interface AuditFilter {
  category?: string;
  username?: string;
  /** true 只看成功，false 只看失败，undefined 不限 */
  success?: boolean;
  /** 在 action / target / detail / ip 上做模糊匹配 */
  keyword?: string;
  /** 时间闭区间，毫秒时间戳 */
  from?: number;
  to?: number;
}

/**
 * 把筛选条件拼成 WHERE 子句。
 * 列名全部是这里写死的字面量，用户输入只进占位符，不存在拼接注入。
 */
function buildAuditWhere(filter: AuditFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.category) {
    clauses.push("category = ?");
    params.push(filter.category);
  }
  if (filter.username) {
    clauses.push("username = ?");
    params.push(filter.username);
  }
  if (filter.success !== undefined) {
    clauses.push("success = ?");
    params.push(filter.success ? 1 : 0);
  }
  if (filter.from !== undefined) {
    clauses.push("timestamp >= ?");
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push("timestamp <= ?");
    params.push(filter.to);
  }
  if (filter.keyword) {
    // LIKE 的通配符要转义，否则用户搜 "100%" 会变成前缀匹配
    const escaped = filter.keyword.replace(/[\\%_]/g, (c) => `\\${c}`);
    const like = `%${escaped}%`;
    clauses.push(
      "(action LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR ip LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/** 带筛选的分页查询。before 是时间戳游标，用于「加载更多」 */
export function dbQueryAuditLogsFiltered(
  limit: number,
  filter: AuditFilter = {},
  before?: number
): AuditLogRow[] {
  const cap = Math.min(Math.max(limit, 1), 500);
  const { sql: where, params } = buildAuditWhere(filter);

  const cursor = before !== undefined ? (where ? "AND timestamp < ?" : "WHERE timestamp < ?") : "";
  const cursorParams = before !== undefined ? [before] : [];

  const sql = `SELECT * FROM audit_logs ${where} ${cursor} ORDER BY timestamp DESC, id DESC LIMIT ?`;
  return db.prepare(sql).all(...params, ...cursorParams, cap) as AuditLogRow[];
}

export interface AuditStats {
  total: number;
  failed: number;
  byCategory: Record<string, number>;
  usernames: string[];
  earliest: number | null;
  latest: number | null;
}

/** 统计信息基于整表（受同一组筛选约束），不受分页 limit 影响 */
export function dbAuditStats(filter: AuditFilter = {}): AuditStats {
  const { sql: where, params } = buildAuditWhere(filter);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
              MIN(timestamp) AS earliest,
              MAX(timestamp) AS latest
       FROM audit_logs ${where}`
    )
    .get(...params) as {
    total: number;
    failed: number | null;
    earliest: number | null;
    latest: number | null;
  };

  const catRows = db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM audit_logs ${where} GROUP BY category`
    )
    .all(...params) as Array<{ category: string; count: number }>;

  // 用户下拉列表不跟随筛选，否则选了某个用户之后列表就只剩他自己
  const userRows = db
    .prepare("SELECT DISTINCT username FROM audit_logs ORDER BY username")
    .all() as Array<{ username: string }>;

  const byCategory: Record<string, number> = {};
  for (const row of catRows) byCategory[row.category] = row.count;

  return {
    total: totals.total ?? 0,
    failed: totals.failed ?? 0,
    byCategory,
    usernames: userRows.map((r) => r.username),
    earliest: totals.earliest ?? null,
    latest: totals.latest ?? null,
  };
}

// ── mysql_connections 表 ─────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS mysql_connections (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    host      TEXT NOT NULL DEFAULT '127.0.0.1',
    port      INTEGER NOT NULL DEFAULT 3306,
    username  TEXT NOT NULL DEFAULT 'root',
    password  TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL
  );
`);

// ── mysql_connections 辅助函数 ───────────────────────────────────────

export interface MysqlConnRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  createdAt: number;
}

const mysqlConnInsertStmt = db.prepare(
  "INSERT INTO mysql_connections (id, name, host, port, username, password, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const mysqlConnGetStmt = db.prepare("SELECT * FROM mysql_connections WHERE id = ?");
const mysqlConnAllStmt = db.prepare("SELECT * FROM mysql_connections ORDER BY createdAt DESC");
const mysqlConnDeleteStmt = db.prepare("DELETE FROM mysql_connections WHERE id = ?");
const mysqlConnUpdateStmt = db.prepare(
  "UPDATE mysql_connections SET name = ?, host = ?, port = ?, username = ?, password = ? WHERE id = ?"
);

export function dbListMysqlConns(): MysqlConnRow[] {
  return mysqlConnAllStmt.all() as MysqlConnRow[];
}

export function dbGetMysqlConn(id: string): MysqlConnRow | undefined {
  return mysqlConnGetStmt.get(id) as MysqlConnRow | undefined;
}

export function dbInsertMysqlConn(conn: MysqlConnRow): void {
  mysqlConnInsertStmt.run(conn.id, conn.name, conn.host, conn.port, conn.username, conn.password, conn.createdAt);
}

export function dbUpdateMysqlConn(id: string, fields: { name: string; host: string; port: number; username: string; password: string }): boolean {
  const result = mysqlConnUpdateStmt.run(fields.name, fields.host, fields.port, fields.username, fields.password, id);
  return result.changes > 0;
}

export function dbDeleteMysqlConn(id: string): boolean {
  const result = mysqlConnDeleteStmt.run(id);
  return result.changes > 0;
}

// ── mongodb_connections 表 ───────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS mongodb_connections (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    host      TEXT NOT NULL DEFAULT '127.0.0.1',
    port      INTEGER NOT NULL DEFAULT 27017,
    username  TEXT NOT NULL DEFAULT '',
    password  TEXT NOT NULL DEFAULT '',
    authDb    TEXT NOT NULL DEFAULT 'admin',
    uri       TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL
  );
`);

export interface MongoConnRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  /** 认证库，副本集/分片场景常常不是 admin */
  authDb: string;
  /** 填了就直接用完整连接串，忽略上面的 host/port 等字段 */
  uri: string;
  createdAt: number;
}

const mongoConnInsertStmt = db.prepare(
  "INSERT INTO mongodb_connections (id, name, host, port, username, password, authDb, uri, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
const mongoConnGetStmt = db.prepare("SELECT * FROM mongodb_connections WHERE id = ?");
const mongoConnAllStmt = db.prepare("SELECT * FROM mongodb_connections ORDER BY createdAt DESC");
const mongoConnDeleteStmt = db.prepare("DELETE FROM mongodb_connections WHERE id = ?");
const mongoConnUpdateStmt = db.prepare(
  "UPDATE mongodb_connections SET name = ?, host = ?, port = ?, username = ?, password = ?, authDb = ?, uri = ? WHERE id = ?"
);

export function dbListMongoConns(): MongoConnRow[] {
  return mongoConnAllStmt.all() as MongoConnRow[];
}

export function dbGetMongoConn(id: string): MongoConnRow | undefined {
  return mongoConnGetStmt.get(id) as MongoConnRow | undefined;
}

export function dbInsertMongoConn(conn: MongoConnRow): void {
  mongoConnInsertStmt.run(
    conn.id, conn.name, conn.host, conn.port, conn.username,
    conn.password, conn.authDb, conn.uri, conn.createdAt,
  );
}

export function dbUpdateMongoConn(
  id: string,
  fields: { name: string; host: string; port: number; username: string; password: string; authDb: string; uri: string },
): boolean {
  const result = mongoConnUpdateStmt.run(
    fields.name, fields.host, fields.port, fields.username,
    fields.password, fields.authDb, fields.uri, id,
  );
  return result.changes > 0;
}

export function dbDeleteMongoConn(id: string): boolean {
  const result = mongoConnDeleteStmt.run(id);
  return result.changes > 0;
}

// ── file_shares 表 ───────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS file_shares (
    id            TEXT PRIMARY KEY,
    filePath      TEXT NOT NULL,
    fileName      TEXT NOT NULL,
    nodeId        TEXT,
    fileSize      INTEGER NOT NULL DEFAULT 0,
    mimeType      TEXT NOT NULL DEFAULT '',
    shareCodeHash TEXT,
    hasShareCode  INTEGER NOT NULL DEFAULT 0,
    allowDirectLink INTEGER NOT NULL DEFAULT 0,
    expiresAt     INTEGER,
    createdBy     TEXT NOT NULL,
    createdAt     INTEGER NOT NULL,
    downloadCount INTEGER NOT NULL DEFAULT 0
  );
`);
// 兼容已有库：补列
try {
  db.exec(`ALTER TABLE file_shares ADD COLUMN allowDirectLink INTEGER NOT NULL DEFAULT 0`);
} catch {
  // 列已存在
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_file_shares_created_by ON file_shares(createdBy);
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_file_shares_created_at ON file_shares(createdAt DESC);
`);

// ── file_shares 辅助函数 ─────────────────────────────────────────────

export interface FileShareRow {
  id: string;
  filePath: string;
  fileName: string;
  nodeId: string | null;
  fileSize: number;
  mimeType: string;
  shareCodeHash: string | null;
  hasShareCode: number;
  allowDirectLink: number;
  expiresAt: number | null;
  createdBy: string;
  createdAt: number;
  downloadCount: number;
}

const shareInsertStmt = db.prepare(`
  INSERT INTO file_shares (
    id, filePath, fileName, nodeId, fileSize, mimeType,
    shareCodeHash, hasShareCode, allowDirectLink, expiresAt, createdBy, createdAt, downloadCount
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);
const shareGetStmt = db.prepare("SELECT * FROM file_shares WHERE id = ?");
const shareListByUserStmt = db.prepare(
  "SELECT * FROM file_shares WHERE createdBy = ? ORDER BY createdAt DESC LIMIT ?"
);
const shareListAllStmt = db.prepare(
  "SELECT * FROM file_shares ORDER BY createdAt DESC LIMIT ?"
);
const shareDeleteStmt = db.prepare("DELETE FROM file_shares WHERE id = ?");
const shareIncDownloadStmt = db.prepare(
  "UPDATE file_shares SET downloadCount = downloadCount + 1 WHERE id = ?"
);

export function dbInsertFileShare(row: {
  id: string;
  filePath: string;
  fileName: string;
  nodeId?: string | null;
  fileSize: number;
  mimeType: string;
  shareCodeHash?: string | null;
  hasShareCode: boolean;
  allowDirectLink?: boolean;
  expiresAt?: number | null;
  createdBy: string;
  createdAt: number;
}): void {
  shareInsertStmt.run(
    row.id,
    row.filePath,
    row.fileName,
    row.nodeId ?? null,
    row.fileSize,
    row.mimeType,
    row.shareCodeHash ?? null,
    row.hasShareCode ? 1 : 0,
    row.allowDirectLink ? 1 : 0,
    row.expiresAt ?? null,
    row.createdBy,
    row.createdAt,
  );
}

export function dbGetFileShare(id: string): FileShareRow | undefined {
  return shareGetStmt.get(id) as FileShareRow | undefined;
}

export function dbListFileShares(createdBy: string | null, limit = 100): FileShareRow[] {
  const cap = Math.min(Math.max(limit, 1), 500);
  if (createdBy) {
    return shareListByUserStmt.all(createdBy, cap) as FileShareRow[];
  }
  return shareListAllStmt.all(cap) as FileShareRow[];
}

export function dbDeleteFileShare(id: string): boolean {
  return shareDeleteStmt.run(id).changes > 0;
}

export function dbIncFileShareDownload(id: string): void {
  shareIncDownloadStmt.run(id);
}