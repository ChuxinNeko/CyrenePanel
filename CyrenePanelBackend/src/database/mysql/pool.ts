import mysql from "mysql2/promise";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { platform } from "os";
import { dbGetMysqlConn, type MysqlConnRow } from "../../db";

// ── MySQL socket 检测（多策略） ───────────────────────────────────────

const SOCKET_PATHS = [
  "/var/run/mysqld/mysqld.sock",
  "/tmp/mysql.sock",
  "/var/lib/mysql/mysql.sock",
  "/usr/local/mysql/data/mysqld.sock",
  "/run/mysqld/mysqld.sock",
  "/var/mysql/mysql.sock",
  "/www/server/data/mysql.sock",
];

const MYSQL_CNF_PATHS = [
  "/etc/mysql/mysql.conf.d/mysqld.cnf",
  "/etc/mysql/my.cnf",
  "/etc/my.cnf",
  "/usr/local/mysql/my.cnf",
  "/www/server/mysql/my.cnf",
];

let _cachedSocketPath: string | undefined | null = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000;

function detectSocketPath(): string | undefined {
  if (_cachedSocketPath !== null && Date.now() - _cacheTime < CACHE_TTL) {
    return _cachedSocketPath || undefined;
  }

  let found: string | undefined;

  // 1. 静态路径列表
  for (const p of SOCKET_PATHS) {
    if (existsSync(p)) { found = p; break; }
  }

  // 2. 从 MySQL 配置文件读取 socket 路径
  if (!found && platform() !== "win32") {
    for (const cnf of MYSQL_CNF_PATHS) {
      if (!existsSync(cnf)) continue;
      try {
        const content = readFileSync(cnf, "utf-8");
        const match = content.match(/^\s*socket\s*=\s*(.+)/m);
        if (match) {
          const sockPath = match[1].trim();
          if (existsSync(sockPath)) { found = sockPath; break; }
        }
      } catch {}
    }
  }

  // 3. 通过 mysqld 进程查找 socket（最可靠）
  if (!found && platform() !== "win32") {
    try {
      const out = execSync(
        "ss -lnx 2>/dev/null | grep mysql || netstat -lnx 2>/dev/null | grep mysql || true",
        { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      const match = out.match(/(\S*mysql\S*\.sock\S*)/);
      if (match && existsSync(match[1])) found = match[1];
    } catch {}
  }

  // 4. find 命令兜底
  if (!found && platform() !== "win32") {
    try {
      const out = execSync(
        "find /var/run /tmp /var/lib/mysql /run -name '*.sock' -path '*mysql*' 2>/dev/null | head -1",
        { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      if (out && existsSync(out)) found = out;
    } catch {}
  }

  _cachedSocketPath = found || "";
  _cacheTime = Date.now();
  return found;
}

/** 检测 MySQL 服务是否在运行，返回诊断信息 */
function diagnoseMysql(): { running: boolean; socket: string | undefined; tcpListening: boolean; detail: string } {
  if (platform() === "win32") {
    return { running: false, socket: undefined, tcpListening: false, detail: "Windows 环境暂不支持诊断" };
  }

  let running = false;
  let tcpListening = false;
  const details: string[] = [];

  // 检查进程
  try {
    const pgrep = execSync("pgrep -x mysqld 2>/dev/null", { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    running = pgrep.length > 0;
  } catch { running = false; }

  if (!running) {
    // 尝试 systemctl
    try {
      const status = execSync("systemctl is-active mysql 2>/dev/null || systemctl is-active mysqld 2>/dev/null", { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      running = status === "active";
    } catch {}
  }

  if (!running) {
    details.push("MySQL 进程未运行");
  } else {
    details.push("MySQL 进程正在运行");
  }

  // 检查 TCP 3306
  try {
    const out = execSync("ss -tlnp 2>/dev/null | grep ':3306' || netstat -tlnp 2>/dev/null | grep ':3306' || true", { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    tcpListening = out.length > 0;
  } catch {}

  if (!tcpListening) {
    details.push("TCP 3306 未监听");
  }

  const socket = detectSocketPath();
  if (socket) {
    details.push(`Socket: ${socket}`);
  } else {
    details.push("未找到 MySQL socket 文件");
  }

  return { running, socket, tcpListening, detail: details.join("; ") };
}

// ── 连接池管理 ────────────────────────────────────────────────────────

const pools = new Map<string, { pool: mysql.Pool; lastUsed: number }>();
const POOL_IDLE_TIMEOUT = 120_000;

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pools) {
    if (now - entry.lastUsed > POOL_IDLE_TIMEOUT) {
      entry.pool.end().catch(() => {});
      pools.delete(id);
    }
  }
}, 30_000);

function buildPoolOptions(conn: MysqlConnRow): mysql.PoolOptions {
  const opts: mysql.PoolOptions = {
    user: conn.username,
    password: conn.password,
    connectionLimit: 5,
    connectTimeout: 10_000,
    multipleStatements: true,
  };

  const isLocalhost = conn.host === "127.0.0.1" || conn.host === "localhost";

  if (isLocalhost) {
    const socketPath = detectSocketPath();
    if (socketPath) {
      opts.socketPath = socketPath;
    } else {
      opts.host = conn.host;
      opts.port = conn.port;
    }
  } else {
    opts.host = conn.host;
    opts.port = conn.port;
  }

  return opts;
}

export function getPoolForConn(conn: MysqlConnRow): mysql.Pool {
  const existing = pools.get(conn.id);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.pool;
  }
  const pool = mysql.createPool(buildPoolOptions(conn));
  pools.set(conn.id, { pool, lastUsed: Date.now() });
  return pool;
}

export function getPoolById(connId: string): mysql.Pool | null {
  const conn = dbGetMysqlConn(connId);
  if (!conn) return null;
  return getPoolForConn(conn);
}

export function closePool(connId: string) {
  const entry = pools.get(connId);
  if (entry) {
    entry.pool.end().catch(() => {});
    pools.delete(connId);
  }
}

export async function testConnection(conn: MysqlConnRow): Promise<{ ok: boolean; message: string; version?: string }> {
  const isLocalhost = conn.host === "127.0.0.1" || conn.host === "localhost";

  // 对本地连接，按优先级尝试：socket → TCP
  const attempts: mysql.ConnectionOptions[] = [];

  if (isLocalhost) {
    const socketPath = detectSocketPath();
    if (socketPath) {
      attempts.push({
        user: conn.username,
        password: conn.password,
        connectTimeout: 5_000,
        socketPath,
      });
    }
    attempts.push({
      user: conn.username,
      password: conn.password,
      connectTimeout: 5_000,
      host: conn.host,
      port: conn.port,
    });
  } else {
    attempts.push({
      user: conn.username,
      password: conn.password,
      connectTimeout: 5_000,
      host: conn.host,
      port: conn.port,
    });
  }

  let lastError: string = "连接失败";

  for (const opts of attempts) {
    let connection: mysql.Connection | null = null;
    try {
      connection = await mysql.createConnection(opts);
      const [rows] = await connection.query("SELECT VERSION() as version");
      const version = (rows as any[])[0]?.version || "unknown";
      const method = opts.socketPath ? "socket" : "TCP";
      return { ok: true, message: `连接成功 (${method})`, version };
    } catch (e: any) {
      lastError = e.message || "连接失败";
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  }

  // 所有尝试失败，附加诊断信息
  if (isLocalhost) {
    const diag = diagnoseMysql();
    if (!diag.running) {
      return { ok: false, message: `${lastError} [诊断: MySQL 服务未运行，请先启动 MySQL]` };
    }
    if (!diag.tcpListening && !diag.socket) {
      return { ok: false, message: `${lastError} [诊断: ${diag.detail}]` };
    }
    return { ok: false, message: `${lastError} [诊断: ${diag.detail}]` };
  }

  return { ok: false, message: lastError };
}

export { detectSocketPath, diagnoseMysql };