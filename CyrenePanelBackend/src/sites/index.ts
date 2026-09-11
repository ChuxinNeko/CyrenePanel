import { Elysia } from "elysia";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, join, resolve } from "path";
import { execSync } from "child_process";
import { logger } from "../logger/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { detectNginxLayout, NginxLayoutBase } from "./nginx-layout";
import { buildOverview, buildSiteRequests, type SiteLogTarget } from "./stats";
import { serverTimezone } from "../system/timezone";

type SiteStatus = "running" | "stopped";
type SiteType = "static" | "php" | "runtime" | "proxy";
type RuntimeKind = "node" | "java" | "python" | "go";

const RUNTIME_KINDS: RuntimeKind[] = ["node", "java", "python", "go"];
const SERVICE_PREFIX = "cyrene-site-";

interface NginxLayout extends NginxLayoutBase {
  rootBase: string;
  logDir: string;
}

interface SiteMeta {
  v: number;
  type: SiteType;
  runtime?: RuntimeKind;
  startCommand?: string;
  appPort?: number;
  user?: string;
  env?: [string, string][];
  autoStart?: boolean;
  proxyTarget?: string;
  root?: string;
}

interface SiteInfo {
  name: string;
  domains: string[];
  primaryDomain: string;
  port: number;
  root: string;
  status: SiteStatus;
  ssl: boolean;
  php: boolean;
  type: SiteType;
  runtime: RuntimeKind | null;
  appPort: number | null;
  startCommand: string | null;
  proxyTarget: string | null;
  configPath: string;
  enabledPath: string | null;
  rootExists: boolean;
  updatedAt: number | null;
  remark: string;
}

interface CreateSiteBody {
  type?: string;
  domain?: string;
  domains?: string[];
  root?: string;
  port?: number;
  index?: string;
  enablePhp?: boolean;
  phpUpstream?: string;
  remark?: string;
  runtime?: string;
  startCommand?: string;
  appPort?: number;
  user?: string;
  env?: [string, string][];
  autoStart?: boolean;
  proxyTarget?: string;
  proxyPath?: string;
}

interface ConfigBody {
  content?: string;
}

interface SiteRootBody {
  root?: string;
}

interface RedirectBody {
  enabled?: boolean;
  sourcePath?: string;
  targetUrl?: string;
  code?: number;
}

interface ProxyBody {
  enabled?: boolean;
  path?: string;
  target?: string;
}

const IS_WINDOWS = process.platform === "win32";
const DOMAIN_RE = /^(?:\*\.)?[a-zA-Z0-9][a-zA-Z0-9.-]{0,251}[a-zA-Z0-9]$/;
const REDIRECT_START = "# CyrenePanelRedirectStart";
const REDIRECT_END = "# CyrenePanelRedirectEnd";
const PROXY_START = "# CyrenePanelProxyStart";
const PROXY_END = "# CyrenePanelProxyEnd";
const APP_PROXY_START = "# CyrenePanelAppProxyStart";
const APP_PROXY_END = "# CyrenePanelAppProxyEnd";
const META_PREFIX = "# CyreneSiteMeta: ";

function execCmd(cmd: string, timeoutMs = 15000): string {
  return execSync(cmd, {
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function execCmdSafe(cmd: string, timeoutMs = 15000): string | null {
  try {
    return execCmd(cmd, timeoutMs);
  } catch (e: any) {
    const out = [e.stdout, e.stderr]
      .filter(Boolean)
      .map((value) => Buffer.isBuffer(value) ? value.toString("utf-8") : String(value))
      .join("\n")
      .trim();
    return out || null;
  }
}

// ── 站点元数据（写入 conf 头部注释，随配置文件派生，天然兼容远程节点） ──

function encodeSiteMeta(meta: SiteMeta): string {
  return Buffer.from(JSON.stringify(meta), "utf-8").toString("base64");
}

function decodeSiteMeta(content: string): SiteMeta | null {
  const line = content.split(/\r?\n/).find((item) => item.startsWith(META_PREFIX));
  if (!line) return null;
  try {
    const raw = line.slice(META_PREFIX.length).trim();
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (!["static", "php", "runtime", "proxy"].includes(parsed.type)) return null;
    return parsed as SiteMeta;
  } catch {
    return null;
  }
}

function normalizeSiteType(input: string | undefined, hasPhp = false): SiteType {
  const value = (input || "").toLowerCase();
  if (value === "static" || value === "php" || value === "runtime" || value === "proxy") return value;
  return hasPhp ? "php" : "static";
}

function normalizeRuntimeKind(input: string | undefined): RuntimeKind {
  const value = (input || "").toLowerCase();
  return (RUNTIME_KINDS as string[]).includes(value) ? (value as RuntimeKind) : "node";
}

// ── systemd 应用服务管理（运行环境网站） ──────────────────────────

function getServiceName(siteName: string): string {
  return `${SERVICE_PREFIX}${siteName}.service`;
}

function unitFilePath(serviceName: string): string {
  return `/etc/systemd/system/${serviceName}`;
}

function systemdAvailable(): boolean {
  if (IS_WINDOWS) return false;
  return !!execCmdSafe("systemctl --version", 5000);
}

function escapeUnitValue(value: string): string {
  return value.replace(/%/g, "%%");
}

function buildUnitContent(options: {
  description: string;
  workingDir: string;
  user: string;
  startCommand: string;
  env: [string, string][];
  restart: string;
}): string {
  const execStart = options.startCommand.trim().startsWith("/")
    ? escapeUnitValue(options.startCommand.trim())
    : `/bin/bash -lc '${options.startCommand.trim().replace(/'/g, "'\\''")}'`;
  const envLines = options.env
    .filter(([key]) => key && key.trim())
    .map(([key, value]) => `Environment="${escapeUnitValue(`${key.trim()}=${value ?? ""}`)}"`);

  return [
    "[Unit]",
    `Description=${options.description}`,
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${options.workingDir}`,
    `User=${options.user || "root"}`,
    ...(envLines.length ? ["", ...envLines] : []),
    "",
    `ExecStart=${execStart}`,
    `Restart=${options.restart}`,
    "RestartSec=3",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

function writeUnitFile(serviceName: string, content: string): void {
  const path = unitFilePath(serviceName);
  try {
    writeFileSync(path, content, "utf-8");
  } catch {
    // 生产环境面板可能以非 root 运行，退回 sudo tee（与服务管理模块一致）
    const escaped = content.replace(/'/g, "'\\''");
    execCmd(`printf '%s' '${escaped}' | sudo tee ${path} > /dev/null`, 15000);
  }
}

function removeUnitFile(serviceName: string): void {
  const path = unitFilePath(serviceName);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    execCmdSafe(`sudo rm -f ${path}`, 15000);
  }
}

function daemonReload(): void {
  execCmdSafe("systemctl daemon-reload", 15000);
}

function createAppService(options: {
  siteName: string;
  description: string;
  workingDir: string;
  user: string;
  startCommand: string;
  env: [string, string][];
  autoStart: boolean;
}): { success: boolean; message: string; serviceName: string } {
  if (!systemdAvailable()) {
    throw new Error("系统未安装 systemd，无法创建运行环境网站（仅支持 Linux）");
  }
  const serviceName = getServiceName(options.siteName);
  if (existsSync(unitFilePath(serviceName))) {
    throw new Error(`应用服务 ${serviceName} 已存在`);
  }
  const content = buildUnitContent({
    description: options.description,
    workingDir: options.workingDir,
    user: options.user,
    startCommand: options.startCommand,
    env: options.env,
    restart: "on-failure",
  });
  writeUnitFile(serviceName, content);
  daemonReload();
  if (options.autoStart) {
    const enable = execCmdSafe(`systemctl enable --now ${serviceName}`, 30000);
    if (enable === null) {
      return { success: true, message: `应用服务已创建，但自启动失败，请手动启动`, serviceName };
    }
  }
  return { success: true, message: "应用服务已创建", serviceName };
}

function updateAppService(options: {
  siteName: string;
  description: string;
  workingDir: string;
  user: string;
  startCommand: string;
  env: [string, string][];
  autoStart: boolean;
}): { success: boolean; message: string; serviceName: string } {
  const serviceName = getServiceName(options.siteName);
  if (!existsSync(unitFilePath(serviceName))) {
    return createAppService(options);
  }
  const content = buildUnitContent({
    description: options.description,
    workingDir: options.workingDir,
    user: options.user,
    startCommand: options.startCommand,
    env: options.env,
    restart: "on-failure",
  });
  writeUnitFile(serviceName, content);
  daemonReload();
  if (options.autoStart) {
    execCmdSafe(`systemctl enable ${serviceName}`, 15000);
    const restart = execCmdSafe(`systemctl restart ${serviceName}`, 30000);
    if (restart === null) {
      return { success: true, message: "应用配置已更新，但重启失败，请手动启动", serviceName };
    }
  } else {
    execCmdSafe(`systemctl disable ${serviceName}`, 15000);
  }
  return { success: true, message: "应用配置已更新", serviceName };
}

function removeAppService(siteName: string): { success: boolean; message: string } {
  const serviceName = getServiceName(siteName);
  if (!existsSync(unitFilePath(serviceName))) {
    return { success: true, message: "无应用服务" };
  }
  execCmdSafe(`systemctl stop ${serviceName}`, 30000);
  execCmdSafe(`systemctl disable ${serviceName}`, 15000);
  removeUnitFile(serviceName);
  daemonReload();
  return { success: true, message: "应用服务已删除" };
}

function appServiceAction(siteName: string, action: "start" | "stop" | "restart"): { success: boolean; message: string } {
  const serviceName = getServiceName(siteName);
  if (!existsSync(unitFilePath(serviceName))) {
    return { success: false, message: "应用服务不存在" };
  }
  const output = execCmdSafe(`systemctl ${action} ${serviceName}`, 30000);
  if (output === null) {
    return { success: false, message: `应用${action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}失败，请查看日志` };
  }
  return { success: true, message: `应用已${action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}` };
}

function appServiceStatus(siteName: string) {
  const serviceName = getServiceName(siteName);
  if (!existsSync(unitFilePath(serviceName))) {
    return { exists: false, name: serviceName, status: "unknown" as const };
  }
  const output = execCmdSafe(`systemctl show ${serviceName} --no-pager`, 10000) || "";
  const props: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) props[line.slice(0, idx)] = line.slice(idx + 1);
  }
  const activeState = props["ActiveState"] || "unknown";
  const subState = props["SubState"] || "";
  let status: "running" | "stopped" | "failed" | "unknown" = "unknown";
  if (activeState === "active") status = subState === "exited" ? "stopped" : "running";
  else if (activeState === "failed") status = "failed";
  else if (activeState === "inactive" || activeState === "deactivating") status = "stopped";
  const memoryCurrent = Number(props["MemoryCurrent"]);
  return {
    exists: true,
    name: serviceName,
    status,
    activeState,
    subState,
    pid: props["MainPID"] && props["MainPID"] !== "0" ? Number(props["MainPID"]) : null,
    memory: Number.isFinite(memoryCurrent) && memoryCurrent > 0 ? memoryCurrent : null,
    enabled: props["UnitFileState"] === "enabled",
    since: props["ExecMainStartTimestamp"] || null,
  };
}

function appServiceLogs(siteName: string, lines = 200): string {
  const serviceName = getServiceName(siteName);
  if (!existsSync(unitFilePath(serviceName))) return "";
  const count = Math.min(Math.max(lines, 20), 1000);
  return execCmdSafe(`journalctl -u ${serviceName} -n ${count} --no-pager -o short`, 15000) || "";
}

// ── 端口占用检测 ───────────────────────────────────────────────────

function isPortOccupied(port: number): { occupied: boolean; detail: string | null } {
  if (IS_WINDOWS) return { occupied: false, detail: null };
  const output = execCmdSafe(`ss -H -tlnp sport = :${port}`, 8000);
  if (!output || !output.trim()) return { occupied: false, detail: null };
  const line = output.trim().split("\n")[0];
  return { occupied: true, detail: line.trim() };
}

// ── PHP 运行环境检测 ───────────────────────────────────────────────

function detectPhpUpstreams(): { version: string; upstream: string }[] {
  const found: { version: string; upstream: string }[] = [];
  const push = (version: string, upstream: string) => {
    if (!found.some((item) => item.version === version)) found.push({ version, upstream });
  };
  if (!IS_WINDOWS && existsSync("/run/php")) {
    for (const entry of readdirSync("/run/php")) {
      const match = entry.match(/^php(\d+(?:\.\d+)*)-fpm\.sock$/);
      if (match) push(match[1], `unix:/run/php/${entry}`);
    }
  }
  if (!IS_WINDOWS && existsSync("/tmp")) {
    for (const entry of readdirSync("/tmp")) {
      const match = entry.match(/^php-cgi-(\d+(?:\.\d+)*)\.sock$/);
      if (match) push(match[1], `unix:/tmp/${entry}`);
    }
  }
  return found.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
}

function detectLayout(): NginxLayout {
  const base = detectNginxLayout();
  const extra = base.mode === "compiled"
    ? { rootBase: "/www/wwwroot", logDir: "/www/wwwlogs" }
    : { rootBase: "/var/www", logDir: "/var/log/nginx" };
  return { ...base, ...extra };
}

function ensureLayout(layout = detectLayout()): NginxLayout {
  if (!layout.installed || !layout.binary || !layout.availableDir || !layout.enabledDir) {
    throw new Error("Nginx 未安装或未检测到可写配置目录，请先在环境管理中安装 Nginx");
  }
  mkdirSync(layout.availableDir, { recursive: true });
  mkdirSync(layout.enabledDir, { recursive: true });
  mkdirSync(layout.rootBase, { recursive: true });
  mkdirSync(layout.logDir, { recursive: true });
  return layout;
}

function normalizeDomains(input: string[] | string | undefined): string[] {
  const raw = Array.isArray(input) ? input : String(input || "").split(/[\s,]+/);
  const domains = [...new Set(raw.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (domains.length === 0) throw new Error("请填写至少一个域名");
  for (const domain of domains) {
    if (domain !== "_" && !DOMAIN_RE.test(domain)) {
      throw new Error(`域名格式不正确: ${domain}`);
    }
  }
  return domains;
}

function normalizeSiteName(domain: string): string {
  const clean = domain
    .replace(/^\*\./, "wildcard.")
    .replace(/[^a-zA-Z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120);
  if (!clean) throw new Error("站点名称无效");
  return clean;
}

function normalizeSiteParam(name: string): string {
  const clean = basename(name || "").replace(/\.conf(?:\.disabled)?$/, "");
  if (!clean || clean.includes("/") || clean.includes("\\")) {
    throw new Error("站点名称无效");
  }
  return clean;
}

function normalizeRoot(root: string | undefined, layout: NginxLayout, domain: string): string {
  const selected = root?.trim() || join(layout.rootBase, domain);
  if (!selected.startsWith("/")) throw new Error("网站根目录必须是绝对路径");
  const resolved = resolve(selected);
  if (resolved === "/" || resolved === "/etc" || resolved === "/usr" || resolved === "/var") {
    throw new Error("网站根目录过于宽泛");
  }
  return resolved;
}

function getConfPath(layout: NginxLayout, siteName: string): string {
  if (!layout.availableDir) throw new Error("Nginx 配置目录不可用");
  return join(layout.availableDir, `${siteName}.conf`);
}

function getDisabledConfPath(layout: NginxLayout, siteName: string): string {
  if (!layout.availableDir) throw new Error("Nginx 配置目录不可用");
  return join(layout.availableDir, `${siteName}.conf.disabled`);
}

function getEnabledPath(layout: NginxLayout, siteName: string): string | null {
  if (!layout.enabledDir) return null;
  if (layout.mode === "conf.d" || layout.mode === "compiled") {
    const enabled = join(layout.enabledDir, `${siteName}.conf`);
    return existsSync(enabled) ? enabled : null;
  }
  const enabled = join(layout.enabledDir, `${siteName}.conf`);
  return existsSync(enabled) ? enabled : null;
}

function findSiteConfig(layout: NginxLayout, siteName: string): { path: string; disabled: boolean } | null {
  const activePath = getConfPath(layout, siteName);
  if (existsSync(activePath)) return { path: activePath, disabled: false };
  const disabledPath = getDisabledConfPath(layout, siteName);
  if (existsSync(disabledPath)) return { path: disabledPath, disabled: true };
  return null;
}

function parseFirstNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const match = value.match(/\b(\d{1,5})\b/);
  return match ? Number(match[1]) : fallback;
}

function parseSiteConfig(path: string, disabled: boolean, layout: NginxLayout): SiteInfo | null {
  try {
    const content = readFileSync(path, "utf-8");
    // 没有 server 块的文件（map/log_format 等辅助配置）不是网站
    if (!/\bserver\s*\{/.test(content)) return null;
    const name = basename(path).replace(/\.conf(?:\.disabled)?$/, "");
    const serverName = content.match(/server_name\s+([^;]+);/i)?.[1] || name;
    const domains = serverName.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const listen = content.match(/listen\s+([^;]+);/i)?.[1] || "80";
    const root = content.match(/root\s+([^;]+);/i)?.[1]?.trim() || "";
    const remark = content.match(/#[ \t]*CyreneRemark:[ \t]*(.+)/)?.[1]?.trim() || "";
    const ssl = /\blisten\s+443\b|ssl_certificate\s+/i.test(content);
    const hasPhp = /fastcgi_pass\s+/i.test(content);
    const enabledPath = disabled ? null : getEnabledPath(layout, name);
    const stats = existsSync(path) ? statSync(path) : null;

    const meta = decodeSiteMeta(content);
    let type = meta?.type || normalizeSiteType(undefined, hasPhp);
    let runtime: RuntimeKind | null = meta?.runtime && (RUNTIME_KINDS as string[]).includes(meta.runtime) ? meta.runtime : null;
    let proxyTarget: string | null = meta?.proxyTarget || null;

    // 旧站点（无元数据）按配置内容推断类型，保持向后兼容
    if (!meta) {
      const userProxy = extractManagedBlock(content, PROXY_START, PROXY_END);
      const appProxy = extractManagedBlock(content, APP_PROXY_START, APP_PROXY_END);
      if (appProxy.trim()) {
        type = "runtime";
        runtime = normalizeRuntimeKind(undefined);
        proxyTarget = appProxy.match(/proxy_pass\s+([^;]+);/i)?.[1]?.trim() || null;
      } else if (userProxy.trim() && /location\s+\^~\s+\/\s*\{/i.test(userProxy)) {
        type = "proxy";
        proxyTarget = userProxy.match(/proxy_pass\s+([^;]+);/i)?.[1]?.trim() || null;
      }
    }

    // 运行环境/代理站点没有 root 指令，项目目录从元数据读取
    const effectiveRoot = root || meta?.root || "";

    return {
      name,
      domains,
      primaryDomain: domains[0] || name,
      port: parseFirstNumber(listen, 80),
      root: effectiveRoot,
      status: disabled || !enabledPath ? "stopped" : "running",
      ssl,
      php: hasPhp,
      type,
      runtime,
      appPort: meta?.appPort ?? null,
      startCommand: meta?.startCommand || null,
      proxyTarget,
      configPath: path,
      enabledPath,
      rootExists: !!effectiveRoot && existsSync(effectiveRoot),
      updatedAt: stats?.mtimeMs || null,
      remark,
    };
  } catch {
    return null;
  }
}

function parseLogPath(content: string, directive: "access_log" | "error_log"): string | null {
  const match = content.match(new RegExp(`${directive}\\s+([^\\s;]+)`, "i"));
  return match?.[1] || null;
}

function replaceFirstDirective(content: string, directive: string, value: string): string {
  const line = `    ${directive} ${value};`;
  const pattern = new RegExp(`^\\s*${directive}\\s+[^;]+;`, "im");
  if (pattern.test(content)) return content.replace(pattern, line);
  return content.replace(/\n\s*index\s+[^;]+;/i, (match) => `${match}\n${line}`);
}

function replaceManagedBlock(content: string, start: string, end: string, block: string): string {
  const pattern = new RegExp(`\\n?\\s*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\s*\\n?`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, block ? `\n${block}\n` : "\n");
  }
  if (!block) return content;
  const insertAt = content.lastIndexOf("\n}");
  if (insertAt === -1) return `${content.trimEnd()}\n${block}\n`;
  return `${content.slice(0, insertAt)}\n${block}${content.slice(insertAt)}`;
}

function removeDefaultRootLocation(content: string): string {
  return content.replace(
    /\n\s*location\s+\/\s*\{\s*\n\s*try_files\s+\$uri\s+\$uri\/\s+\/index\.html;\s*\n\s*\}\s*\n?/m,
    "\n",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLocationPath(value: string | undefined, fallback = "/"): string {
  const selected = (value || fallback).trim() || fallback;
  if (!selected.startsWith("/")) throw new Error("路径必须以 / 开头");
  if (/\s/.test(selected) || selected.includes(";") || selected.includes("{") || selected.includes("}")) {
    throw new Error("路径包含非法字符");
  }
  return selected;
}

function normalizeRedirectUrl(value: string | undefined): string {
  const selected = (value || "").trim();
  if (!/^https?:\/\//i.test(selected)) throw new Error("重定向目标必须以 http:// 或 https:// 开头");
  if (selected.includes(";") || selected.includes("{") || selected.includes("}")) {
    throw new Error("重定向目标包含非法字符");
  }
  return selected;
}

function normalizeProxyTarget(value: string | undefined): string {
  const selected = (value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(selected)) throw new Error("反向代理目标必须以 http:// 或 https:// 开头");
  if (selected.includes(";") || selected.includes("{") || selected.includes("}")) {
    throw new Error("反向代理目标包含非法字符");
  }
  return selected;
}

function proxyUpstreamHost(target: string): string {
  try {
    return new URL(target).host;
  } catch {
    throw new Error("反向代理目标地址无效");
  }
}

function extractManagedBlock(content: string, start: string, end: string): string {
  const pattern = new RegExp(`${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`, "m");
  return content.match(pattern)?.[1] || "";
}

function parseRedirect(content: string) {
  const block = extractManagedBlock(content, REDIRECT_START, REDIRECT_END);
  return {
    enabled: !!block.trim(),
    sourcePath: block.match(/CyrenePanelRedirectPath:\s*([^\s]+)/i)?.[1] || "/",
    targetUrl: block.match(/return\s+\d{3}\s+([^;]+);/i)?.[1] || "",
    code: Number(block.match(/return\s+(\d{3})\s+/i)?.[1] || 301),
  };
}

function parseProxy(content: string) {
  const block = extractManagedBlock(content, PROXY_START, PROXY_END);
  const location = block.match(/location\s+(?:=|~\*?|\^~)?\s*([^\s{]+)\s*\{/i)?.[1];
  return {
    enabled: !!block.trim(),
    path: location || "/api/",
    target: block.match(/proxy_pass\s+([^;]+);/i)?.[1] || "",
  };
}

function saveConfigWithTest(layout: NginxLayout, configPath: string, content: string): { success: boolean; message: string } {
  const backupPath = `${configPath}.bak.${Date.now()}`;
  copyFileSync(configPath, backupPath);
  writeFileSync(configPath, content, "utf-8");
  const test = testNginx(layout);
  if (!test.success) {
    copyFileSync(backupPath, configPath);
    unlinkSync(backupPath);
    return { success: false, message: test.message };
  }
  unlinkSync(backupPath);
  const reload = reloadNginx(layout);
  return {
    success: true,
    message: reload.success ? "配置已保存，nginx 已重载" : `配置已保存，但 ${reload.message}`,
  };
}

function readTail(filePath: string | null, lines = 200): string {
  if (!filePath || !existsSync(filePath)) return "";
  const stats = statSync(filePath);
  const maxBytes = 1024 * 1024;
  const start = Math.max(0, stats.size - maxBytes);
  const content = readFileSync(filePath, { encoding: "utf-8" }).slice(start ? -maxBytes : 0);
  return content.split(/\r?\n/).slice(-lines).join("\n");
}

// 宝塔等面板的内部配置文件，不属于用户网站
const INTERNAL_SITE_RE = /^(0\.|phpfpm_|waf)/i;

function listSites(): { sites: SiteInfo[]; nginx: NginxLayout; summary: Record<string, number>; phpUpstreams: { version: string; upstream: string }[] } {
  const layout = detectLayout();
  if (!layout.availableDir || !existsSync(layout.availableDir)) {
    return {
      sites: [],
      nginx: layout,
      summary: { total: 0, running: 0, stopped: 0, ssl: 0, php: 0, runtime: 0, proxy: 0 },
      phpUpstreams: detectPhpUpstreams(),
    };
  }

  const names = new Set<string>();
  const dirs = [layout.availableDir, layout.enabledDir].filter(Boolean) as string[];
  for (const dir of [...new Set(dirs)]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (/\.conf(?:\.disabled)?$/.test(entry)) {
        const name = entry.replace(/\.conf(?:\.disabled)?$/, "");
        if (INTERNAL_SITE_RE.test(name)) continue;
        names.add(name);
      }
    }
  }

  const sites = [...names]
    .map((name) => {
      const config = findSiteConfig(layout, name);
      return config ? parseSiteConfig(config.path, config.disabled, layout) : null;
    })
    .filter((site): site is SiteInfo => !!site)
    .sort((a, b) => a.primaryDomain.localeCompare(b.primaryDomain, "zh-CN"));

  return {
    sites,
    nginx: layout,
    summary: {
      total: sites.length,
      running: sites.filter((site) => site.status === "running").length,
      stopped: sites.filter((site) => site.status === "stopped").length,
      ssl: sites.filter((site) => site.ssl).length,
      php: sites.filter((site) => site.type === "php").length,
      runtime: sites.filter((site) => site.type === "runtime").length,
      proxy: sites.filter((site) => site.type === "proxy").length,
    },
    phpUpstreams: detectPhpUpstreams(),
  };
}

function buildProxyLocationBlock(
  startMarker: string,
  endMarker: string,
  path: string,
  target: string,
  hostHeader?: string,
): string {
  let upstreamHost: string;
  try {
    upstreamHost = hostHeader || new URL(target).host;
  } catch {
    throw new Error("反向代理目标地址无效");
  }
  return `    ${startMarker}
    location ^~ ${path} {
        proxy_pass ${target};
        proxy_http_version 1.1;
        proxy_set_header Host ${upstreamHost};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        add_header X-Cyrene-Site $server_name always;
    }
    ${endMarker}`;
}

function buildConfig(
  layout: NginxLayout,
  body: CreateSiteBody & { domains: string[]; root: string },
  meta: SiteMeta,
): string {
  const serverNames = body.domains.join(" ");
  const accessLog = join(layout.logDir, `${body.domains[0]}.access.log`);
  const errorLog = join(layout.logDir, `${body.domains[0]}.error.log`);
  const metaLine = `${META_PREFIX}${encodeSiteMeta(meta)}`;
  const remarkLine = `# CyreneRemark: ${(body.remark || "").replace(/\r?\n/g, " ")}`;

  let bodyBlocks = "";

  if (meta.type === "static" || meta.type === "php") {
    const index = body.index?.trim() || "index.html index.htm index.php";
    let rootBlock = `
    location / {
        try_files $uri $uri/ /index.html;
    }`;
    if (meta.type === "php") {
      const upstream = body.phpUpstream || "unix:/run/php/php-fpm.sock";
      rootBlock = `
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
    location ~ \\.php$ {
        try_files $uri =404;
        include fastcgi_params;
        fastcgi_pass ${upstream};
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }`;
    }
    bodyBlocks = `    root ${body.root};
    index ${index};
${rootBlock}

    location ~ /\\. {
        deny all;
    }`;
  } else if (meta.type === "runtime") {
    const target = `http://127.0.0.1:${meta.appPort}`;
    // 应用代理保留原始域名 Host，便于后端按域名路由
    bodyBlocks = buildProxyLocationBlock(APP_PROXY_START, APP_PROXY_END, "/", target, "$host");
  } else {
    // proxy 类型：整站反向代理
    const path = body.proxyPath?.trim() || "/";
    bodyBlocks = buildProxyLocationBlock(PROXY_START, PROXY_END, path, meta.proxyTarget || "");
  }

  return `# Managed by CyrenePanel
${metaLine}
${remarkLine}
server {
    listen ${body.port};
    server_name ${serverNames};

    access_log ${accessLog};
    error_log ${errorLog};
${bodyBlocks}
}
`;
}

function testNginx(layout = detectLayout()): { success: boolean; message: string } {
  if (!layout.binary) return { success: false, message: "未检测到 nginx 命令" };
  try {
    const output = execCmd(`${layout.binary} -t 2>&1`, 15000);
    return { success: true, message: output || "nginx 配置检查通过" };
  } catch (e: any) {
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
    return { success: false, message: output || "nginx 配置检查失败" };
  }
}

function reloadNginx(layout = detectLayout()): { success: boolean; message: string } {
  if (!layout.binary) return { success: false, message: "未检测到 nginx 命令" };
  const commands = [
    `${layout.binary} -s reload`,
    "systemctl reload nginx",
    "service nginx reload",
  ];
  for (const command of commands) {
    try {
      const output = execCmd(command, 15000);
      return { success: true, message: output || "nginx 已重载" };
    } catch {
      // try next
    }
  }
  return { success: false, message: "nginx 重载失败，请检查服务是否正在运行" };
}

function diagnoseSiteRuntime(layout: NginxLayout, siteName: string, configPath: string) {
  const configContent = readFileSync(configPath, "utf-8");
  const primaryDomain = configContent.match(/server_name\s+([^;]+);/i)?.[1]?.split(/\s+/)[0] || siteName;
  const test = testNginx(layout);
  const dump = layout.binary ? execCmdSafe(`${layout.binary} -T 2>&1`, 15000) || "" : "";
  const lines = dump.split(/\r?\n/);
  const matchedLines = lines
    .map((line, index) => ({ line: index + 1, content: line }))
    .filter((item) => item.content.includes(primaryDomain) || item.content.includes(configPath))
    .slice(0, 80);

  return {
    success: true,
    nginx: {
      binary: layout.binary,
      mode: layout.mode,
      availableDir: layout.availableDir,
      enabledDir: layout.enabledDir,
    },
    site: {
      name: siteName,
      primaryDomain,
      configPath,
      hasListen80: /listen\s+80\s*;/i.test(configContent),
      hasListen443: /listen\s+443\b/i.test(configContent),
      hasProxyMarker: configContent.includes(PROXY_START),
      hasCyreneDebugHeader: configContent.includes("X-Cyrene-Proxy-Target"),
    },
    test,
    loadedMatches: matchedLines,
    hint:
      matchedLines.length === 0
        ? "nginx -T 未发现该域名或配置路径，当前请求大概率没有加载这份站点配置"
        : "nginx -T 已发现该域名或配置路径；若响应仍无 X-Cyrene-*，请检查访问协议、端口和是否命中其他同名 server",
  };
}

function enableSite(layout: NginxLayout, siteName: string): void {
  const disabledPath = getDisabledConfPath(layout, siteName);
  const activePath = getConfPath(layout, siteName);
  if (existsSync(disabledPath) && !existsSync(activePath)) {
    renameSync(disabledPath, activePath);
  }
  if (layout.mode === "debian-sites" && layout.enabledDir) {
    const enabledPath = join(layout.enabledDir, `${siteName}.conf`);
    if (!existsSync(enabledPath)) {
      try {
        symlinkSync(activePath, enabledPath);
      } catch {
        copyFileSync(activePath, enabledPath);
      }
    }
  }
}

function disableSite(layout: NginxLayout, siteName: string): void {
  if (layout.mode === "debian-sites" && layout.enabledDir) {
    const enabledPath = join(layout.enabledDir, `${siteName}.conf`);
    if (existsSync(enabledPath)) unlinkSync(enabledPath);
    return;
  }

  const activePath = getConfPath(layout, siteName);
  const disabledPath = getDisabledConfPath(layout, siteName);
  if (existsSync(activePath) && !existsSync(disabledPath)) {
    renameSync(activePath, disabledPath);
  }
}

function normalizeEnvPairs(input: [string, string][] | undefined): [string, string][] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((pair) => Array.isArray(pair) && typeof pair[0] === "string" && pair[0].trim())
    .slice(0, 64)
    .map(([key, value]) => [key.trim(), String(value ?? "")] as [string, string]);
}

function createSite(body: CreateSiteBody) {
  const layout = ensureLayout();
  const domains = normalizeDomains(body.domains?.length ? body.domains : body.domain);
  const siteName = normalizeSiteName(domains[0]);
  const configPath = getConfPath(layout, siteName);
  const disabledPath = getDisabledConfPath(layout, siteName);
  if (existsSync(configPath) || existsSync(disabledPath)) {
    throw new Error("站点已存在，请更换域名或先删除同名站点");
  }

  // 兼容旧客户端：enablePhp=true 视为 php 类型
  const type = normalizeSiteType(body.type, !!body.enablePhp);
  const nginxPort = Number(body.port || 80);
  if (!Number.isInteger(nginxPort) || nginxPort < 1 || nginxPort > 65535) {
    throw new Error("监听端口范围必须在 1-65535 之间");
  }

  const form = {
    domain: domains[0],
    domains,
    root: "",
    port: nginxPort,
    index: body.index || "",
    enablePhp: type === "php",
    phpUpstream: body.phpUpstream || "",
    remark: body.remark || "",
    proxyPath: body.proxyPath || "/",
    runtime: "",
    startCommand: "",
    appPort: 0,
    user: "",
    env: [] as [string, string][],
    autoStart: body.autoStart !== false,
    proxyTarget: "",
  };

  const meta: SiteMeta = { v: 1, type };
  let appServiceResult: { success: boolean; message: string; serviceName: string } | null = null;

  const rollback = () => {
    disableSite(layout, siteName);
    if (existsSync(configPath)) unlinkSync(configPath);
    if (existsSync(disabledPath)) unlinkSync(disabledPath);
    if (appServiceResult) removeAppService(siteName);
  };

  if (type === "static" || type === "php") {
    form.root = normalizeRoot(body.root, layout, domains[0]);
    if (type === "php") {
      form.phpUpstream = body.phpUpstream?.trim() || "unix:/run/php/php-fpm.sock";
    }
    mkdirSync(form.root, { recursive: true });
    const indexPath = join(form.root, "index.html");
    if (!existsSync(indexPath)) {
      writeFileSync(indexPath, `<h1>${domains[0]}</h1>\n<p>Created by CyrenePanel.</p>\n`, "utf-8");
    }
  } else if (type === "runtime") {
    if (IS_WINDOWS) throw new Error("运行环境网站仅支持 Linux 系统");
    const runtime = normalizeRuntimeKind(body.runtime);
    const startCommand = (body.startCommand || "").trim();
    const appPort = Number(body.appPort);
    if (!startCommand) throw new Error("请填写应用启动命令");
    if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) {
      throw new Error("应用端口范围必须在 1-65535 之间");
    }
    if (appPort === nginxPort) {
      throw new Error("应用端口不能与网站监听端口相同");
    }
    const occupied = isPortOccupied(appPort);
    if (occupied.occupied) {
      throw new Error(`应用端口 ${appPort} 已被占用（${occupied.detail || "未知进程"}），请更换端口`);
    }

    form.root = normalizeRoot(body.root, layout, domains[0]);
    form.runtime = runtime;
    form.startCommand = startCommand;
    form.appPort = appPort;
    form.user = (body.user || "").trim();
    form.env = normalizeEnvPairs(body.env);
    mkdirSync(form.root, { recursive: true });

    meta.runtime = runtime;
    meta.startCommand = startCommand;
    meta.appPort = appPort;
    meta.user = form.user || undefined;
    meta.env = form.env;
    meta.root = form.root;
    meta.autoStart = form.autoStart;

    appServiceResult = createAppService({
      siteName,
      description: `CyrenePanel ${runtime} app for ${domains[0]}`,
      workingDir: form.root,
      user: form.user,
      startCommand,
      env: form.env,
      autoStart: form.autoStart,
    });
  } else if (type === "proxy") {
    const target = normalizeProxyTarget(body.proxyTarget);
    form.proxyTarget = target;
    meta.proxyTarget = target;
    normalizeLocationPath(body.proxyPath, "/");
  } else {
    throw new Error("不支持的网站类型");
  }

  const content = buildConfig(layout, form, meta);
  writeFileSync(configPath, content, "utf-8");
  enableSite(layout, siteName);

  const test = testNginx(layout);
  if (!test.success) {
    rollback();
    throw new Error(test.message);
  }

  const reload = reloadNginx(layout);
  if (!reload.success) {
    logger.warn(`网站 ${siteName} 创建成功，但 nginx 重载失败: ${reload.message}`);
  }

  const messages = ["网站创建成功"];
  if (appServiceResult) messages.push(appServiceResult.message);
  if (!reload.success) messages.push(`nginx 重载失败: ${reload.message}`);

  return {
    success: true,
    message: messages.join("，"),
    site: parseSiteConfig(configPath, false, layout),
  };
}

function updateSiteMeta(content: string, meta: SiteMeta): string {
  const line = `${META_PREFIX}${encodeSiteMeta(meta)}`;
  if (content.includes(META_PREFIX)) {
    return content.replace(new RegExp(`^${escapeRegExp(META_PREFIX)}.*$`, "m"), line);
  }
  return content.replace(/^(# Managed by CyrenePanel)\r?\n/, `$1\n${line}\n`);
}

async function authProfile(jwt: any, request: Request) {
  return resolveRequestProfile(jwt, request);
}

/**
 * 站点配置里通常有好几条 access_log：静态资源那些 location 会写 `access_log off;`。
 * 取第一条绝对路径，才是这个站真正在写的日志。
 */
function parseAccessLogPath(content: string): string | null {
  for (const match of content.matchAll(/access_log\s+([^\s;]+)/gi)) {
    if (match[1].startsWith("/")) return match[1];
  }
  return null;
}

/** 列出每个站点对应的访问日志，给统计模块用 */
function collectLogTargets(): SiteLogTarget[] {
  const { sites, nginx } = listSites();
  return sites.map((site) => {
    let logPath: string | null = null;
    try {
      logPath = parseAccessLogPath(readFileSync(site.configPath, "utf-8"));
    } catch {
      // 配置读不了就退到按域名猜
    }
    if (!logPath && nginx.logDir) {
      // 面板建的站写 {域名}.access.log，宝塔建的写 {域名}.log
      logPath =
        [`${site.primaryDomain}.access.log`, `${site.primaryDomain}.log`]
          .map((file) => join(nginx.logDir, file))
          .find((candidate) => existsSync(candidate)) ?? null;
    }
    return { name: site.name, domain: site.primaryDomain, logPath };
  });
}

export const siteRoutes = new Elysia()
  .get("/api/sites", async ({ jwt, request }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      return { success: true, ...listSites() };
    } catch (e: any) {
      logger.err(`网站列表读取失败: ${e.message}`);
      return { success: false, message: e.message || "网站列表读取失败" };
    }
  })

  .post("/api/sites", async ({ jwt, request, body }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const result = createSite(body || {});
      logger.info(`网站创建成功: ${(body || {}).type || "static"} ${result?.site?.primaryDomain}`);
      return result;
    } catch (e: any) {
      logger.err(`网站创建失败: ${e.message}`);
      return { success: false, message: e.message || "网站创建失败" };
    }
  })

  /**
   * 访问统计总览：今日/昨日/前日的流量、请求数、IP、UV、PV，外加今日站点排行。
   * 数据来自 nginx 访问日志，统计窗口只有三天，再往前日志多半已经被轮转走了。
   */
  .get("/api/sites/stats/overview", async ({ jwt, request }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      return {
        success: true,
        generatedAt: Date.now(),
        timezone: serverTimezone(),
        ...buildOverview(collectLogTargets()),
      };
    } catch (e: any) {
      logger.err(`访问统计读取失败: ${e.message}`);
      return { success: false, message: e.message || "访问统计读取失败" };
    }
  })

  /** 单站点的请求明细 + 归属地聚合（画地图用） */
  .get("/api/sites/stats/requests", async ({ jwt, request, query }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const siteName = normalizeSiteParam(String(query?.site || ""));
      const target = collectLogTargets().find((item) => item.name === siteName);
      if (!target) return { success: false, message: "站点不存在" };
      if (!target.logPath) {
        return { success: false, message: "该站点没有配置访问日志" };
      }

      const statusClass = String(query?.statusClass || "");
      const result = await buildSiteRequests(target, {
        range: String(query?.range || "today"),
        page: Math.max(Number(query?.page) || 1, 1),
        pageSize: Math.min(Math.max(Number(query?.pageSize) || 20, 1), 200),
        keyword: String(query?.keyword || ""),
        statusClass: /^[2345]$/.test(statusClass) ? statusClass : "",
      });
      return {
        success: true,
        site: { name: target.name, domain: target.domain, logPath: target.logPath },
        timezone: serverTimezone(),
        ...result,
      };
    } catch (e: any) {
      logger.err(`站点请求日志读取失败: ${e.message}`);
      return { success: false, message: e.message || "站点请求日志读取失败" };
    }
  })

  .get("/api/sites/:name/app", async ({ jwt, request, params }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      const site = parseSiteConfig(config.path, config.disabled, layout);
      if (!site || site.type !== "runtime") {
        return { success: false, message: "该站点不是运行环境网站" };
      }
      const meta = decodeSiteMeta(readFileSync(config.path, "utf-8")) || { v: 1, type: "runtime" };
      return {
        success: true,
        site: { name: site.name, primaryDomain: site.primaryDomain, type: site.type, runtime: site.runtime },
        app: {
          ...appServiceStatus(siteName),
          runtime: site.runtime,
          startCommand: meta.startCommand || site.startCommand || "",
          appPort: meta.appPort ?? site.appPort,
          user: meta.user || "",
          env: meta.env || [],
          autoStart: meta.autoStart !== false,
          workingDir: site.root,
        },
      };
    } catch (e: any) {
      return { success: false, message: e.message || "应用状态读取失败" };
    }
  })

  .post("/api/sites/:name/app/:action", async ({ jwt, request, params }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const action = String(params.action || "");
      if (!["start", "stop", "restart"].includes(action)) {
        return { success: false, message: "不支持的操作" };
      }
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      const site = parseSiteConfig(config.path, config.disabled, layout);
      if (!site || site.type !== "runtime") {
        return { success: false, message: "该站点不是运行环境网站" };
      }
      return appServiceAction(siteName, action as "start" | "stop" | "restart");
    } catch (e: any) {
      return { success: false, message: e.message || "操作失败" };
    }
  })

  .get("/api/sites/:name/app/logs", async ({ jwt, request, params, query }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      const site = parseSiteConfig(config.path, config.disabled, layout);
      if (!site || site.type !== "runtime") {
        return { success: false, message: "该站点不是运行环境网站" };
      }
      const lines = Math.min(Math.max(Number(query?.lines || 200), 20), 1000);
      return { success: true, logs: appServiceLogs(siteName, lines) };
    } catch (e: any) {
      return { success: false, message: e.message || "应用日志读取失败" };
    }
  })

  .put("/api/sites/:name/app", async ({ jwt, request, params, body }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const payload = (body || {}) as CreateSiteBody;
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      const site = parseSiteConfig(config.path, config.disabled, layout);
      if (!site || site.type !== "runtime") {
        return { success: false, message: "该站点不是运行环境网站" };
      }

      const content = readFileSync(config.path, "utf-8");
      const meta = decodeSiteMeta(content) || { v: 1, type: "runtime" as SiteType };
      const startCommand = (payload.startCommand ?? meta.startCommand ?? "").trim();
      const appPort = Number(payload.appPort ?? meta.appPort);
      const user = (payload.user ?? meta.user ?? "").trim();
      const env = payload.env ? normalizeEnvPairs(payload.env) : meta.env || [];
      const autoStart = payload.autoStart !== undefined ? payload.autoStart !== false : meta.autoStart !== false;

      if (!startCommand) throw new Error("请填写应用启动命令");
      if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) {
        throw new Error("应用端口范围必须在 1-65535 之间");
      }
      if (appPort === site.port) {
        throw new Error("应用端口不能与网站监听端口相同");
      }
      if (appPort !== meta.appPort) {
        const occupied = isPortOccupied(appPort);
        if (occupied.occupied) {
          throw new Error(`应用端口 ${appPort} 已被占用（${occupied.detail || "未知进程"}），请更换端口`);
        }
      }

      const nextMeta: SiteMeta = { ...meta, type: "runtime", startCommand, appPort, user: user || undefined, env, autoStart };
      let nextContent = updateSiteMeta(content, nextMeta);
      if (appPort !== meta.appPort) {
        const block = buildProxyLocationBlock(APP_PROXY_START, APP_PROXY_END, "/", `http://127.0.0.1:${appPort}`, "$host");
        nextContent = replaceManagedBlock(nextContent, APP_PROXY_START, APP_PROXY_END, block);
      }

      const saved = saveConfigWithTest(layout, config.path, nextContent);
      if (!saved.success) return saved;

      const serviceResult = updateAppService({
        siteName,
        description: `CyrenePanel ${site.runtime || "app"} app for ${site.primaryDomain}`,
        workingDir: site.root,
        user,
        startCommand,
        env,
        autoStart,
      });
      const messages = [saved.message, serviceResult.message];
      return { success: true, message: messages.join("，") };
    } catch (e: any) {
      return { success: false, message: e.message || "应用配置保存失败" };
    }
  })

  .get("/api/sites/:name/settings", async ({ jwt, request, params }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      const content = readFileSync(config.path, "utf-8");
      const site = parseSiteConfig(config.path, config.disabled, layout);
      const accessLog = parseLogPath(content, "access_log");
      const errorLog = parseLogPath(content, "error_log");
      return {
        success: true,
        site,
        config: { path: config.path, content },
        redirect: parseRedirect(content),
        proxy: parseProxy(content),
        logs: {
          accessPath: accessLog,
          errorPath: errorLog,
          access: readTail(accessLog, 200),
          error: readTail(errorLog, 200),
        },
      };
    } catch (e: any) {
      return { success: false, message: e.message || "设置读取失败" };
    }
  })

  .put("/api/sites/:name/root", async ({ jwt, request, params, body }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const payload = (body || {}) as SiteRootBody;
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      const site = parseSiteConfig(config.path, config.disabled, layout);
      const root = normalizeRoot(payload.root, layout, siteName);
      mkdirSync(root, { recursive: true });

      if (site?.type === "proxy") {
        return { success: false, message: "反向代理站点没有网站目录" };
      }

      if (site?.type === "runtime") {
        // 运行环境站点：目录是应用工作目录，写入元数据并同步 systemd WorkingDirectory
        const content = readFileSync(config.path, "utf-8");
        const meta = decodeSiteMeta(content) || { v: 1, type: "runtime" as SiteType };
        const nextContent = updateSiteMeta(content, { ...meta, type: "runtime", root });
        writeFileSync(config.path, nextContent, "utf-8");
        const serviceResult = updateAppService({
          siteName,
          description: `CyrenePanel ${site.runtime || "app"} app for ${site.primaryDomain}`,
          workingDir: root,
          user: meta.user || "",
          startCommand: meta.startCommand || "",
          env: meta.env || [],
          autoStart: meta.autoStart !== false,
        });
        return {
          success: true,
          message: `项目目录已更新，${serviceResult.message}`,
        };
      }

      const content = replaceFirstDirective(readFileSync(config.path, "utf-8"), "root", root);
      return saveConfigWithTest(layout, config.path, content);
    } catch (e: any) {
      return { success: false, message: e.message || "网站目录保存失败" };
    }
  })

  .put("/api/sites/:name/redirect", async ({ jwt, request, params, body }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const payload = (body || {}) as RedirectBody;
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      let block = "";
      if (payload.enabled) {
        const sourcePath = normalizeLocationPath(payload.sourcePath, "/");
        const targetUrl = normalizeRedirectUrl(payload.targetUrl);
        const code = payload.code === 302 ? 302 : 301;
        block = `    ${REDIRECT_START}
    # CyrenePanelRedirectPath: ${sourcePath}
    if ($request_uri ~ ^${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}) {
        return ${code} ${targetUrl};
    }
    ${REDIRECT_END}`;
      }
      const content = replaceManagedBlock(readFileSync(config.path, "utf-8"), REDIRECT_START, REDIRECT_END, block);
      return saveConfigWithTest(layout, config.path, content);
    } catch (e: any) {
      return { success: false, message: e.message || "重定向保存失败" };
    }
  })

  .put("/api/sites/:name/proxy", async ({ jwt, request, params, body }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const payload = (body || {}) as ProxyBody;
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      let block = "";
      let content = readFileSync(config.path, "utf-8");
      const existingProxy = parseProxy(content);
      if (payload.enabled) {
        const path = normalizeLocationPath(payload.path, "/api/");
        const target = normalizeProxyTarget(payload.target);
        const upstreamHost = proxyUpstreamHost(target);
        if (path === "/") content = removeDefaultRootLocation(content);
        block = `    ${PROXY_START}
    location ^~ ${path} {
        proxy_pass ${target};
        proxy_http_version 1.1;
        proxy_set_header Host ${upstreamHost};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        add_header X-Cyrene-Site $server_name always;
        add_header X-Cyrene-Proxy-Target "${target}" always;
    }
    ${PROXY_END}`;
      } else if (existingProxy.path === "/") {
        content = replaceManagedBlock(content, PROXY_START, PROXY_END, "");
        if (!/location\s+\/\s*\{/i.test(content)) {
          const insertAt = content.lastIndexOf("\n}");
          const rootBlock = `
    location / {
        try_files $uri $uri/ /index.html;
    }
`;
          if (insertAt !== -1) {
            content = `${content.slice(0, insertAt)}${rootBlock}${content.slice(insertAt)}`;
          }
        }
      }
      content = block ? replaceManagedBlock(content, PROXY_START, PROXY_END, block) : content;
      return saveConfigWithTest(layout, config.path, content);
    } catch (e: any) {
      return { success: false, message: e.message || "反向代理保存失败" };
    }
  })

  .get("/api/sites/:name/logs", async ({ jwt, request, params, query }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      const content = readFileSync(config.path, "utf-8");
      const lines = Math.min(Math.max(Number(query?.lines || 200), 20), 1000);
      const accessPath = parseLogPath(content, "access_log");
      const errorPath = parseLogPath(content, "error_log");
      return {
        success: true,
        accessPath,
        errorPath,
        access: readTail(accessPath, lines),
        error: readTail(errorPath, lines),
      };
    } catch (e: any) {
      return { success: false, message: e.message || "日志读取失败" };
    }
  })

  .get("/api/sites/:name/config", async ({ jwt, request, params }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      return {
        success: true,
        name: siteName,
        path: config.path,
        content: readFileSync(config.path, "utf-8"),
      };
    } catch (e: any) {
      return { success: false, message: e.message || "配置读取失败" };
    }
  })

  .put("/api/sites/:name/config", async ({ jwt, request, params, body }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const payload = (body || {}) as ConfigBody;
      if (typeof payload.content !== "string" || !payload.content.trim()) {
        return { success: false, message: "配置内容不能为空" };
      }
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };

      const backupPath = `${config.path}.bak.${Date.now()}`;
      copyFileSync(config.path, backupPath);
      writeFileSync(config.path, payload.content, "utf-8");
      const test = testNginx(layout);
      if (!test.success) {
        copyFileSync(backupPath, config.path);
        unlinkSync(backupPath);
        return { success: false, message: test.message };
      }
      unlinkSync(backupPath);
      const reload = reloadNginx(layout);
      return {
        success: true,
        message: reload.success ? "配置已保存，nginx 已重载" : `配置已保存，但 ${reload.message}`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || "配置保存失败" };
    }
  })

  .post("/api/sites/:name/:action", async ({ jwt, request, params }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const action = String(params.action || "");
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);

      if (action === "test") return testNginx(layout);
      if (action === "reload") return reloadNginx(layout);

      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };
      if (action === "diagnose") return diagnoseSiteRuntime(layout, siteName, config.path);

      if (action === "enable") {
        enableSite(layout, siteName);
      } else if (action === "disable") {
        disableSite(layout, siteName);
      } else {
        return { success: false, message: "不支持的操作" };
      }

      const test = testNginx(layout);
      if (!test.success) return { success: false, message: test.message };
      const reload = reloadNginx(layout);
      return {
        success: reload.success,
        message: reload.success ? "操作成功，nginx 已重载" : reload.message,
      };
    } catch (e: any) {
      return { success: false, message: e.message || "操作失败" };
    }
  })

  .delete("/api/sites/:name", async ({ jwt, request, params, query }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };

      const site = parseSiteConfig(config.path, config.disabled, layout);
      const purgeApp = query?.purgeApp === "1" || query?.purgeApp === "true";
      let appMessage = "";
      if (site?.type === "runtime" && purgeApp) {
        const removed = removeAppService(siteName);
        appMessage = `，${removed.message}`;
      }

      disableSite(layout, siteName);
      if (existsSync(config.path)) unlinkSync(config.path);
      const disabledPath = getDisabledConfPath(layout, siteName);
      if (existsSync(disabledPath)) unlinkSync(disabledPath);

      const test = testNginx(layout);
      if (!test.success) return { success: false, message: test.message };
      const reload = reloadNginx(layout);
      return {
        success: reload.success,
        message: reload.success
          ? `站点配置已删除，nginx 已重载${appMessage}`
          : `站点配置已删除，但 ${reload.message}${appMessage}`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || "删除失败" };
    }
  });
