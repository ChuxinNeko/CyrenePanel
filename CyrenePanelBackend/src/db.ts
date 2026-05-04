import { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { logger } from "./logger/index";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "cyrene.db");

// ── 确保 data 目录存在 ──────────────────────────────────────────────

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ── 打开数据库并建表 ─────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
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
    apiKey    TEXT NOT NULL,
    isMain    INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );
`);

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
  "INSERT INTO instances (id, name, command, cwd, env, autoRestart, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
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
}): void {
  instInsertStmt.run(
    cfg.id,
    cfg.name,
    cfg.command,
    cfg.cwd,
    JSON.stringify(cfg.env),
    cfg.autoRestart ? 1 : 0,
    cfg.createdAt
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
  apiKey: string;
  isMain: number; // 0 or 1
  createdAt: number;
}

const nodeInsertStmt = db.prepare(
  "INSERT INTO nodes (id, name, address, apiKey, isMain, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
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
  apiKey: string;
  isMain?: boolean;
  createdAt: number;
}): void {
  nodeInsertStmt.run(cfg.id, cfg.name, cfg.address, cfg.apiKey, cfg.isMain ? 1 : 0, cfg.createdAt);
}

export function dbDeleteNode(id: string): boolean {
  const result = nodeDeleteStmt.run(id);
  return result.changes > 0;
}