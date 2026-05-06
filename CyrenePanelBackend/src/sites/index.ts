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

type SiteStatus = "running" | "stopped";

interface NginxLayout {
  installed: boolean;
  binary: string | null;
  version: string | null;
  mode: "compiled" | "debian-sites" | "conf.d" | "unknown";
  availableDir: string | null;
  enabledDir: string | null;
  rootBase: string;
  logDir: string;
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
  configPath: string;
  enabledPath: string | null;
  rootExists: boolean;
  updatedAt: number | null;
  remark: string;
}

interface CreateSiteBody {
  domain?: string;
  domains?: string[];
  root?: string;
  port?: number;
  index?: string;
  enablePhp?: boolean;
  phpUpstream?: string;
  remark?: string;
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

function detectNginxBinary(): string | null {
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

function getNginxVersion(binary: string | null): string | null {
  if (!binary) return null;
  const output = execCmdSafe(`${binary} -v 2>&1`, 5000);
  return output?.match(/nginx\/([^\s]+)/)?.[1] || null;
}

function detectLayout(): NginxLayout {
  const binary = detectNginxBinary();
  const installed = !!binary;

  if (existsSync("/www/server/nginx")) {
    return {
      installed,
      binary,
      version: getNginxVersion(binary),
      mode: "compiled",
      availableDir: "/www/server/nginx/conf/vhost",
      enabledDir: "/www/server/nginx/conf/vhost",
      rootBase: "/www/wwwroot",
      logDir: "/www/wwwlogs",
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
      rootBase: "/var/www",
      logDir: "/var/log/nginx",
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
      rootBase: "/var/www",
      logDir: "/var/log/nginx",
    };
  }

  return {
    installed,
    binary,
    version: null,
    mode: "unknown",
    availableDir: null,
    enabledDir: null,
    rootBase: "/var/www",
    logDir: "/var/log/nginx",
  };
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
    const name = basename(path).replace(/\.conf(?:\.disabled)?$/, "");
    const serverName = content.match(/server_name\s+([^;]+);/i)?.[1] || name;
    const domains = serverName.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const listen = content.match(/listen\s+([^;]+);/i)?.[1] || "80";
    const root = content.match(/root\s+([^;]+);/i)?.[1]?.trim() || "";
    const remark = content.match(/#\s*CyreneRemark:\s*(.+)/)?.[1]?.trim() || "";
    const ssl = /\blisten\s+443\b|ssl_certificate\s+/i.test(content);
    const php = /fastcgi_pass\s+/i.test(content);
    const enabledPath = disabled ? null : getEnabledPath(layout, name);
    const stats = existsSync(path) ? statSync(path) : null;

    return {
      name,
      domains,
      primaryDomain: domains[0] || name,
      port: parseFirstNumber(listen, 80),
      root,
      status: disabled || !enabledPath ? "stopped" : "running",
      ssl,
      php,
      configPath: path,
      enabledPath,
      rootExists: !!root && existsSync(root),
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

function listSites(): { sites: SiteInfo[]; nginx: NginxLayout; summary: Record<string, number> } {
  const layout = detectLayout();
  if (!layout.availableDir || !existsSync(layout.availableDir)) {
    return {
      sites: [],
      nginx: layout,
      summary: { total: 0, running: 0, stopped: 0, ssl: 0, php: 0 },
    };
  }

  const names = new Set<string>();
  const dirs = [layout.availableDir, layout.enabledDir].filter(Boolean) as string[];
  for (const dir of [...new Set(dirs)]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (/\.conf(?:\.disabled)?$/.test(entry)) {
        names.add(entry.replace(/\.conf(?:\.disabled)?$/, ""));
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
      php: sites.filter((site) => site.php).length,
    },
  };
}

function buildConfig(layout: NginxLayout, body: Required<CreateSiteBody> & { domains: string[]; root: string }): string {
  const serverNames = body.domains.join(" ");
  const accessLog = join(layout.logDir, `${body.domains[0]}.access.log`);
  const errorLog = join(layout.logDir, `${body.domains[0]}.error.log`);
  const index = body.index.trim() || "index.html index.htm index.php";
  const phpBlock = body.enablePhp
    ? `
    location ~ \\.php$ {
        try_files $uri =404;
        include fastcgi_params;
        fastcgi_pass ${body.phpUpstream};
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
`
    : "";

  return `# Managed by CyrenePanel
# CyreneRemark: ${body.remark.replace(/\r?\n/g, " ")}
server {
    listen ${body.port};
    server_name ${serverNames};
    root ${body.root};
    index ${index};

    access_log ${accessLog};
    error_log ${errorLog};

    location / {
        try_files $uri $uri/ /index.html;
    }
${phpBlock}
    location ~ /\\. {
        deny all;
    }
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

function createSite(body: CreateSiteBody) {
  const layout = ensureLayout();
  const domains = normalizeDomains(body.domains?.length ? body.domains : body.domain);
  const siteName = normalizeSiteName(domains[0]);
  const configPath = getConfPath(layout, siteName);
  const disabledPath = getDisabledConfPath(layout, siteName);
  if (existsSync(configPath) || existsSync(disabledPath)) {
    throw new Error("站点已存在");
  }

  const form = {
    domain: domains[0],
    domains,
    root: normalizeRoot(body.root, layout, domains[0]),
    port: Number(body.port || 80),
    index: body.index || "index.html index.htm index.php",
    enablePhp: !!body.enablePhp,
    phpUpstream: body.phpUpstream || "unix:/run/php/php-fpm.sock",
    remark: body.remark || "",
  };

  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
    throw new Error("端口范围必须在 1-65535 之间");
  }

  mkdirSync(form.root, { recursive: true });
  const indexPath = join(form.root, "index.html");
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `<h1>${domains[0]}</h1>\n<p>Created by CyrenePanel.</p>\n`, "utf-8");
  }

  const content = buildConfig(layout, form);
  writeFileSync(configPath, content, "utf-8");
  enableSite(layout, siteName);

  const test = testNginx(layout);
  if (!test.success) {
    disableSite(layout, siteName);
    if (existsSync(configPath)) unlinkSync(configPath);
    if (existsSync(disabledPath)) unlinkSync(disabledPath);
    throw new Error(test.message);
  }

  const reload = reloadNginx(layout);
  return {
    success: true,
    message: reload.success ? "网站创建成功，nginx 已重载" : `网站创建成功，但 ${reload.message}`,
    site: parseSiteConfig(configPath, false, layout),
  };
}

async function authProfile(jwt: any, request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  return await jwt.verify(token);
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
      return createSite(body || {});
    } catch (e: any) {
      logger.err(`网站创建失败: ${e.message}`);
      return { success: false, message: e.message || "网站创建失败" };
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
      const root = normalizeRoot(payload.root, layout, siteName);
      mkdirSync(root, { recursive: true });
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

  .delete("/api/sites/:name", async ({ jwt, request, params }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const layout = ensureLayout();
      const siteName = normalizeSiteParam(params.name);
      const config = findSiteConfig(layout, siteName);
      if (!config) return { success: false, message: "站点不存在" };

      disableSite(layout, siteName);
      if (existsSync(config.path)) unlinkSync(config.path);
      const disabledPath = getDisabledConfPath(layout, siteName);
      if (existsSync(disabledPath)) unlinkSync(disabledPath);

      const test = testNginx(layout);
      if (!test.success) return { success: false, message: test.message };
      const reload = reloadNginx(layout);
      return {
        success: reload.success,
        message: reload.success ? "站点配置已删除，nginx 已重载" : `站点配置已删除，但 ${reload.message}`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || "删除失败" };
    }
  });
