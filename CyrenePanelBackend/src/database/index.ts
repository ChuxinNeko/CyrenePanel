import { Elysia } from "elysia";
import { platform } from "os";
import { execSync } from "child_process";

// ── 类型定义 ──────────────────────────────────────────────────────────

interface DatabaseInfo {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  installed: boolean;
  version: string | null;
  port: number;
  running: boolean;
  description: string;
}

// ── 工具函数 ──────────────────────────────────────────────────────────

function execCmdSafe(cmd: string, timeoutMs = 15000): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function isLinuxPlatform(): boolean {
  return platform() !== "win32";
}

function getOfficialServerUrl(): string {
  return (
    process.env.CYRENE_OFFICIAL_SERVER_URL ||
    process.env.OFFICIAL_SERVER_URL ||
    "https://dockerhub.nekofun.top"
  ).replace(/\/+$/, "");
}

function getDbInstallCommand(
  dbId: string,
  action: "install" | "remove" | "versions",
  version?: string,
  mode?: string,
): string {
  const scriptUrl = `${getOfficialServerUrl()}/environments/${dbId}/script`;
  const versionArg = version ? ` ${version}` : "";
  const modeArg = mode ? ` ${mode}` : "";
  const scriptArgs = action === "remove" ? "remove" : `${action}${versionArg}${modeArg}`;
  return `tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT; curl -fsSL ${scriptUrl} -o "$tmp"; if [ "$(id -u)" -eq 0 ]; then bash "$tmp" ${scriptArgs}; elif sudo -n true >/dev/null 2>&1; then sudo bash "$tmp" ${scriptArgs}; else echo "Current panel process is not root and sudo is unavailable." >&2; exit 1; fi`;
}

// ── 数据库检测器 ──────────────────────────────────────────────────────

interface DbDetector {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  description: string;
  defaultPort: number;
  detectVersion: () => string | null;
  detectRunning: () => boolean;
}

function getMysqlDetector(): DbDetector {
  return {
    id: "mysql",
    name: "MySQL",
    displayName: "MySQL",
    icon: "logos:mysql",
    description: "开源关系型数据库管理系统",
    defaultPort: 3306,
    detectVersion: () => {
      // 标准 PATH
      const v = execCmdSafe("mysql --version 2>/dev/null");
      if (v) {
        const match = v.match(/(\d+\.\d+\.\d+)/);
        if (match) return match[1];
      }
      // 宝塔面板路径
      const btPaths = ["/www/server/mysql/bin/mysql", "/usr/local/mysql/bin/mysql"];
      for (const p of btPaths) {
        const bv = execCmdSafe(`${p} --version 2>/dev/null`);
        if (bv) {
          const match = bv.match(/(\d+\.\d+\.\d+)/);
          if (match) return match[1];
        }
      }
      return null;
    },
    detectRunning: () => {
      if (!isLinuxPlatform()) {
        return execCmdSafe("sc query MySQL") !== null;
      }
      // systemctl 检测
      const status = execCmdSafe("systemctl is-active mysql 2>/dev/null || systemctl is-active mysqld 2>/dev/null");
      if (status === "active") return true;
      // 进程级 fallback（覆盖宝塔等非标准安装）
      const pgrep = execCmdSafe("pgrep -x mysqld 2>/dev/null");
      return pgrep !== null && pgrep.length > 0;
    },
  };
}

function getPostgresDetector(): DbDetector {
  return {
    id: "postgresql",
    name: "PostgreSQL",
    displayName: "PostgreSQL",
    icon: "vscode-icons:file-type-pgsql",
    description: "强大的开源对象关系型数据库",
    defaultPort: 5432,
    detectVersion: () => {
      const v = execCmdSafe("psql --version 2>/dev/null");
      if (v) {
        const match = v.match(/(\d+\.\d+(?:\.\d+)?)/);
        if (match) return match[1];
      }
      const btPaths = ["/www/server/pgsql/bin/psql", "/usr/local/pgsql/bin/psql"];
      for (const p of btPaths) {
        const bv = execCmdSafe(`${p} --version 2>/dev/null`);
        if (bv) {
          const match = bv.match(/(\d+\.\d+(?:\.\d+)?)/);
          if (match) return match[1];
        }
      }
      return null;
    },
    detectRunning: () => {
      if (!isLinuxPlatform()) {
        return execCmdSafe("sc query postgresql") !== null;
      }
      const status = execCmdSafe("systemctl is-active postgresql 2>/dev/null");
      if (status === "active") return true;
      const pgrep = execCmdSafe("pgrep -x postgres 2>/dev/null");
      return pgrep !== null && pgrep.length > 0;
    },
  };
}

function getMongoDetector(): DbDetector {
  return {
    id: "mongodb",
    name: "MongoDB",
    displayName: "MongoDB",
    icon: "logos:mongodb",
    description: "面向文档的 NoSQL 数据库",
    defaultPort: 27017,
    detectVersion: () => {
      const v = execCmdSafe("mongod --version 2>/dev/null");
      if (v) {
        const match = v.match(/v?(\d+\.\d+\.\d+)/);
        if (match) return match[1];
      }
      // 宝塔面板路径
      const btPaths = ["/www/server/mongodb/bin/mongod", "/usr/local/mongodb/bin/mongod"];
      for (const p of btPaths) {
        const bv = execCmdSafe(`${p} --version 2>/dev/null`);
        if (bv) {
          const match = bv.match(/v?(\d+\.\d+\.\d+)/);
          if (match) return match[1];
        }
      }
      return null;
    },
    detectRunning: () => {
      if (!isLinuxPlatform()) {
        return execCmdSafe("sc query MongoDB") !== null;
      }
      const status = execCmdSafe("systemctl is-active mongod 2>/dev/null");
      if (status === "active") return true;
      // 进程级 fallback
      const pgrep = execCmdSafe("pgrep -x mongod 2>/dev/null");
      return pgrep !== null && pgrep.length > 0;
    },
  };
}

function getRedisDetector(): DbDetector {
  return {
    id: "redis",
    name: "Redis",
    displayName: "Redis",
    icon: "devicon:redis-wordmark",
    description: "高性能键值存储数据库",
    defaultPort: 6379,
    detectVersion: () => {
      const v = execCmdSafe("redis-server --version 2>/dev/null");
      if (v) {
        const match = v.match(/v=(\d+\.\d+\.\d+)/);
        if (match) return match[1];
      }
      const btPaths = ["/www/server/redis/bin/redis-server"];
      for (const p of btPaths) {
        const bv = execCmdSafe(`${p} --version 2>/dev/null`);
        if (bv) {
          const match = bv.match(/v=(\d+\.\d+\.\d+)/);
          if (match) return match[1];
        }
      }
      return null;
    },
    detectRunning: () => {
      if (!isLinuxPlatform()) {
        return execCmdSafe("sc query Redis") !== null;
      }
      const status = execCmdSafe("systemctl is-active redis 2>/dev/null || systemctl is-active redis-server 2>/dev/null");
      if (status === "active") return true;
      const pgrep = execCmdSafe("pgrep -x redis-server 2>/dev/null");
      return pgrep !== null && pgrep.length > 0;
    },
  };
}

function getAllDbDetectors(): DbDetector[] {
  return [
    getMysqlDetector(),
    getPostgresDetector(),
    getMongoDetector(),
    getRedisDetector(),
  ];
}

function scanDatabases(): DatabaseInfo[] {
  return getAllDbDetectors().map((detector) => {
    const version = detector.detectVersion();
    return {
      id: detector.id,
      name: detector.name,
      displayName: detector.displayName,
      icon: detector.icon,
      installed: version !== null,
      version,
      port: detector.defaultPort,
      running: version !== null ? detector.detectRunning() : false,
      description: detector.description,
    };
  });
}

// ── SSE 流式命令执行 ──────────────────────────────────────────────────

async function commandStream(command: string, onLine: (line: string) => void): Promise<number> {
  const proc = Bun.spawn(["bash", "-lc", command], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const read = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    }
    if (buffer.trim()) onLine(buffer);
  };

  await Promise.all([read(proc.stdout), read(proc.stderr)]);
  return await proc.exited;
}

function createDbActionStream(
  dbId: string,
  action: "install" | "remove",
  version?: string,
  mode?: string,
): Response {
  const detectors = getAllDbDetectors();
  const detector = detectors.find((d) => d.id === dbId);

  if (!detector) {
    return new Response(JSON.stringify({ success: false, message: `未找到数据库: ${dbId}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isLinuxPlatform()) {
    return new Response(JSON.stringify({ success: false, message: `${detector.displayName} 安装脚本仅支持 Linux` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const command = getDbInstallCommand(dbId, action, version, mode);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };

      try {
        send({
          type: "stage",
          stage: action,
          message: `开始${action === "install" ? "安装" : "卸载"} ${detector.displayName}...`,
        });

        const exitCode = await commandStream(command, (line) => {
          send({ type: "progress", layer: "", status: "info", detail: line.trim() });
        });

        if (exitCode !== 0) {
          send({ type: "error", message: `${detector.displayName} 操作失败 (退出码 ${exitCode})` });
          return;
        }

        send({ type: "done", message: `${detector.displayName} ${action === "install" ? "安装" : "卸载"}完成` });
      } catch (e: any) {
        send({ type: "error", message: e.message || "操作失败" });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── 路由 ──────────────────────────────────────────────────────────────

export const databaseRoutes = new Elysia()
  .get("/api/databases", async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    try {
      const databases = scanDatabases();
      return {
        success: true,
        databases,
        platform: isLinuxPlatform() ? "linux" : "windows",
      };
    } catch (e: any) {
      return { success: false, message: `扫描数据库失败: ${e.message}` };
    }
  })

  .get("/api/databases/:id", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const detectors = getAllDbDetectors();
    const detector = detectors.find((d) => d.id === params.id);
    if (!detector) return { success: false, message: "未找到数据库" };

    const version = detector.detectVersion();
    return {
      success: true,
      database: {
        id: detector.id,
        name: detector.name,
        displayName: detector.displayName,
        icon: detector.icon,
        description: detector.description,
        installed: version !== null,
        version,
        port: detector.defaultPort,
        running: version !== null ? detector.detectRunning() : false,
      },
    };
  })

  .get("/api/databases/:id/versions", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const detectors = getAllDbDetectors();
    const detector = detectors.find((d) => d.id === params.id);
    if (!detector) return { success: false, message: "未找到数据库" };

    if (!isLinuxPlatform()) {
      return { success: false, message: "仅 Linux 支持版本查询" };
    }

    // 执行脚本的 versions 子命令获取可用版本列表
    try {
      const command = getDbInstallCommand(params.id, "versions");
      const output = execCmdSafe(`bash -c '${command}'`, 30000);
      if (output) {
        const parsed = JSON.parse(output);
        return { success: true, ...parsed };
      }
    } catch {}

    // fallback: 内置版本列表
    const fallbackVersions: Record<string, any> = {
      mysql: {
        versions: [
          { value: "8.4", label: "MySQL 8.4 (LTS)" },
          { value: "8.0", label: "MySQL 8.0 (LTS)" },
          { value: "5.7", label: "MySQL 5.7 (Legacy)" },
        ],
        default: "8.0",
      },
      postgresql: {
        versions: [
          { value: "17", label: "PostgreSQL 17 (Latest)" },
          { value: "16", label: "PostgreSQL 16 (LTS)" },
          { value: "15", label: "PostgreSQL 15" },
          { value: "14", label: "PostgreSQL 14" },
          { value: "13", label: "PostgreSQL 13" },
        ],
        default: "16",
      },
      mongodb: {
        versions: [
          { value: "8.0", label: "MongoDB 8.0 (Latest)" },
          { value: "7.0", label: "MongoDB 7.0 (LTS)" },
          { value: "6.0", label: "MongoDB 6.0" },
          { value: "5.0", label: "MongoDB 5.0" },
        ],
        default: "7.0",
      },
      redis: {
        versions: [
          { value: "7.4", label: "Redis 7.4 (Latest)" },
          { value: "7.2", label: "Redis 7.2 (LTS)" },
          { value: "7.0", label: "Redis 7.0" },
          { value: "6.2", label: "Redis 6.2 (Legacy)" },
        ],
        default: "7.2",
      },
    };

    const fb = fallbackVersions[params.id] || { versions: [], default: "" };
    return {
      success: true,
      ...fb,
      modes: [
        { value: "fast", label: "极速安装 (官方仓库)" },
        { value: "compile", label: "编译安装 (源码编译)" },
      ],
    };
  })

  .post("/api/databases/:id/:action/stream", async ({ jwt, request, params }: any) => {
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

    if (!["install", "remove"].includes(params.action)) {
      return new Response(JSON.stringify({ success: false, message: "不支持的操作" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 从请求体读取 version 和 mode
    let version: string | undefined;
    let mode: string | undefined;
    try {
      const body = await request.json();
      version = body?.version;
      mode = body?.mode;
    } catch {}

    return createDbActionStream(params.id, params.action, version, mode);
  });