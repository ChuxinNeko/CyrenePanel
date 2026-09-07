import { existsSync, readFileSync, statSync } from "fs";
import { execSync } from "child_process";

// ── Nginx 布局检测（sites 与 certificates 模块共享） ────────────────

export interface NginxLayoutBase {
  installed: boolean;
  binary: string | null;
  version: string | null;
  mode: "compiled" | "debian-sites" | "conf.d" | "unknown";
  availableDir: string | null;
  enabledDir: string | null;
}

const IS_WINDOWS = process.platform === "win32";

function execCmdSafe(cmd: string, timeoutMs = 15000): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    const out = [e.stdout, e.stderr]
      .filter(Boolean)
      .map((value) => Buffer.isBuffer(value) ? value.toString("utf-8") : String(value))
      .join("\n")
      .trim();
    return out || null;
  }
}

export function detectNginxBinary(): string | null {
  if (IS_WINDOWS) return execCmdSafe("where nginx", 5000)?.split(/\r?\n/)[0] || null;
  const candidates = [
    "/www/server/nginx/sbin/nginx",
    "/usr/sbin/nginx",
    "/usr/local/sbin/nginx",
  ];
  for (const item of candidates) {
    if (existsSync(item)) return item;
  }
  return execCmdSafe("command -v nginx", 5000)?.split(/\r?\n/)[0] || null;
}

export function getNginxVersion(binary: string | null): string | null {
  if (!binary) return null;
  const output = execCmdSafe(`${binary} -v 2>&1`, 5000);
  return output?.match(/nginx\/([^\s]+)/)?.[1] || null;
}

// 解析 nginx.conf 中的绝对路径 include 指令，找出真正会被加载的 vhost 目录
export function detectIncludeVhostDirs(confPath: string): string[] {
  try {
    if (!existsSync(confPath)) return [];
    const content = readFileSync(confPath, "utf-8");
    const dirs: string[] = [];
    for (const match of content.matchAll(/include\s+([^;]+);/g)) {
      const raw = match[1].trim().replace(/^["']|["']$/g, "");
      if (!raw.startsWith("/")) continue;
      const dir = raw.replace(/\/[^/]*[*][^/]*$/, "");
      if (!dir || !existsSync(dir)) continue;
      if (statSync(dir).isDirectory() && !dirs.includes(dir)) dirs.push(dir);
    }
    // 优先返回 vhost 目录（排除 stream 块的 tcp 子目录）
    const preferred = dirs.filter((dir) => /vhost\/nginx$/.test(dir));
    const others = dirs.filter((dir) => !/vhost\/nginx$/.test(dir) && /vhost/.test(dir));
    return [...preferred, ...others];
  } catch {
    return [];
  }
}

export function detectNginxLayout(): NginxLayoutBase {
  const binary = detectNginxBinary();
  const installed = !!binary;

  if (existsSync("/www/server/nginx")) {
    // 宝塔风格编译安装：vhost 目录以 nginx.conf 中的 include 指令为准
    // （可能是 /www/server/panel/vhost/nginx，也可能是 /www/server/nginx/conf/vhost）
    const vhostDirs = detectIncludeVhostDirs("/www/server/nginx/conf/nginx.conf");
    const availableDir = vhostDirs[0] || "/www/server/nginx/conf/vhost";
    return {
      installed,
      binary,
      version: getNginxVersion(binary),
      mode: "compiled",
      availableDir,
      enabledDir: availableDir,
    };
  }

  if (existsSync("/etc/nginx/sites-available") || existsSync("/etc/nginx/sites-enabled")) {
    return {
      installed,
      binary,
      version: getNginxVersion(binary),
      mode: "debian-sites",
      availableDir: "/etc/nginx/sites-available",
      enabledDir: "/etc/nginx/sites-enabled",
    };
  }

  if (existsSync("/etc/nginx/conf.d") || installed) {
    return {
      installed,
      binary,
      version: getNginxVersion(binary),
      mode: "conf.d",
      availableDir: "/etc/nginx/conf.d",
      enabledDir: "/etc/nginx/conf.d",
    };
  }

  return {
    installed,
    binary,
    version: null,
    mode: "unknown",
    availableDir: null,
    enabledDir: null,
  };
}
