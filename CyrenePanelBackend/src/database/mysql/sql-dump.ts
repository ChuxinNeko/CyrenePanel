/**
 * 不依赖 mysqldump 的 SQL 级导出/导入
 *
 * 很多部署里 MySQL 跑在容器或远程主机上，宿主机根本没有 mysqldump/mysql
 * 客户端（本项目的目标服务器就是这种情况）。这里通过已有的 mysql2 连接
 * 直接生成 dump，作为 CLI 不可用时的回退路径。
 *
 * 相比 mysqldump 慢一些，但胜在只要连接可用就能工作。
 */

import mysql from "mysql2/promise";

/** 每批读取的行数，避免大表一次性进内存 */
const BATCH_SIZE = 500;

/** 单条 INSERT 拼接的最大行数 */
const INSERT_CHUNK = 100;

function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

/** 把一行的各列值转成 SQL 字面量 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) {
    // 用本地时间格式化，与 MySQL DATETIME 的存储语义一致
    const pad = (n: number) => String(n).padStart(2, "0");
    return `'${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(
      value.getHours(),
    )}:${pad(value.getMinutes())}:${pad(value.getSeconds())}'`;
  }
  if (Buffer.isBuffer(value)) return `0x${value.toString("hex")}`;
  // mysql.escape 会正确处理引号与反斜杠
  return mysql.escape(String(value));
}

export interface SqlDumpOptions {
  /** 只导出结构，不含数据 */
  schemaOnly?: boolean;
}

/**
 * 生成整库的 SQL dump，分块通过回调输出，便于边生成边写文件。
 */
export async function dumpDatabaseToSql(
  pool: mysql.Pool,
  database: string,
  write: (chunk: string) => void | Promise<void>,
  options: SqlDumpOptions = {},
): Promise<void> {
  const ident = quoteIdent(database);

  await write(
    [
      `-- CyrenePanel SQL dump`,
      `-- 数据库: ${database}`,
      `-- 生成时间: ${new Date().toISOString()}`,
      `-- 说明: 由面板通过数据库连接生成（宿主机无 mysqldump 时的回退方式）`,
      ``,
      `SET NAMES utf8mb4;`,
      `SET FOREIGN_KEY_CHECKS=0;`,
      `SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';`,
      ``,
      `CREATE DATABASE IF NOT EXISTS ${ident} DEFAULT CHARACTER SET utf8mb4;`,
      `USE ${ident};`,
      ``,
    ].join("\n"),
  );

  // 区分基础表与视图：视图必须在表之后创建，否则依赖的表还不存在
  const [objects] = await pool.query(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_TYPE, TABLE_NAME`,
    [database],
  );

  const tables = (objects as any[]).filter((o) => o.type === "BASE TABLE").map((o) => o.name);
  const views = (objects as any[]).filter((o) => o.type === "VIEW").map((o) => o.name);

  for (const table of tables) {
    const tableIdent = `${ident}.${quoteIdent(table)}`;

    const [createRows] = await pool.query(`SHOW CREATE TABLE ${tableIdent}`);
    const ddl = (createRows as any[])[0]?.["Create Table"];
    if (!ddl) continue;

    await write(
      [
        ``,
        `-- ----------------------------`,
        `-- 表结构: ${table}`,
        `-- ----------------------------`,
        `DROP TABLE IF EXISTS ${quoteIdent(table)};`,
        `${ddl};`,
        ``,
      ].join("\n"),
    );

    if (options.schemaOnly) continue;

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM ${tableIdent}`);
    const total = Number((countRows as any[])[0]?.total || 0);
    if (total === 0) continue;

    await write(`-- 表数据: ${table}（${total} 行）\n`);

    let offset = 0;
    let buffer: string[] = [];

    const flush = async () => {
      if (buffer.length === 0) return;
      await write(`INSERT INTO ${quoteIdent(table)} VALUES\n${buffer.join(",\n")};\n`);
      buffer = [];
    };

    while (offset < total) {
      const [rows] = await pool.query(
        `SELECT * FROM ${tableIdent} LIMIT ${BATCH_SIZE} OFFSET ${offset}`,
      );
      const batch = rows as any[];
      if (batch.length === 0) break;

      for (const row of batch) {
        const values = Object.values(row).map(formatValue).join(", ");
        buffer.push(`(${values})`);
        if (buffer.length >= INSERT_CHUNK) await flush();
      }

      offset += batch.length;
    }

    await flush();
    await write(`\n`);
  }

  for (const view of views) {
    const [createRows] = await pool.query(`SHOW CREATE VIEW ${ident}.${quoteIdent(view)}`);
    const ddl = (createRows as any[])[0]?.["Create View"];
    if (!ddl) continue;
    await write(
      [
        ``,
        `-- ----------------------------`,
        `-- 视图: ${view}`,
        `-- ----------------------------`,
        `DROP VIEW IF EXISTS ${quoteIdent(view)};`,
        `${ddl};`,
        ``,
      ].join("\n"),
    );
  }

  await write(`\nSET FOREIGN_KEY_CHECKS=1;\n`);
}

/**
 * 执行 dump 文本。连接池已开启 multipleStatements，可以整段执行；
 * 过大的脚本按语句边界切块，避免单次请求超过 max_allowed_packet。
 */
export async function restoreSqlToDatabase(
  pool: mysql.Pool,
  sqlText: string,
): Promise<{ statements: number }> {
  const statements = splitStatements(sqlText);
  if (statements.length === 0) return { statements: 0 };

  const conn = await pool.getConnection();
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    for (const statement of statements) {
      await conn.query(statement);
    }
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    return { statements: statements.length };
  } finally {
    conn.release();
  }
}

/**
 * 按分号切分 SQL 语句，跳过字符串字面量、反引号标识符和注释里的分号。
 * 不做完整 SQL 解析，但足以正确处理 dump 文件和常见手写脚本。
 */
export function splitStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const next = sqlText[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      current += char;
      continue;
    }
    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        i++;
        blockComment = false;
      }
      continue;
    }

    if (!quote) {
      if (char === "-" && next === "-") {
        lineComment = true;
        current += char;
        continue;
      }
      if (char === "#") {
        lineComment = true;
        current += char;
        continue;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        current += char + next;
        i++;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        current += char;
        continue;
      }
      if (char === ";") {
        const trimmed = current.trim();
        if (trimmed) statements.push(trimmed);
        current = "";
        continue;
      }
    } else {
      if (char === "\\" && quote !== "`") {
        // 转义字符，连同下一个字符一起吃掉
        current += char;
        if (next !== undefined) {
          current += next;
          i++;
        }
        continue;
      }
      if (char === quote) {
        // 连续两个同类引号是转义写法，不算结束
        if (next === quote) {
          current += char + next;
          i++;
          continue;
        }
        quote = null;
      }
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
