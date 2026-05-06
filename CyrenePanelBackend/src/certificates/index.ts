import { Elysia } from "elysia";
import { randomBytes } from "crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";
import { execSync } from "child_process";
import { logger } from "../logger/index";

interface CertificateInput {
  name?: string;
  certificate?: string;
  privateKey?: string;
}

interface DeployInput {
  certificateId?: string;
  forceHttps?: boolean;
}

interface CertificateInfo {
  id: string;
  name: string;
  domains: string[];
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  expiresInDays: number | null;
  certPath: string;
  keyPath: string;
  createdAt: number;
}

interface NginxLayout {
  installed: boolean;
  binary: string | null;
  mode: "compiled" | "debian-sites" | "conf.d" | "unknown";
  availableDir: string | null;
  enabledDir: string | null;
  sslDir: string;
}

const DATA_DIR = join(process.cwd(), "data", "certificates");
const SSL_START = "# CyrenePanelSSLStart";
const SSL_END = "# CyrenePanelSSLEnd";
const HTTPS_REDIRECT_START = "# CyrenePanelHttpsRedirectStart";
const HTTPS_REDIRECT_END = "# CyrenePanelHttpsRedirectEnd";

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

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
    const out = [e.stdout, e.stderr, e.message]
      .filter(Boolean)
      .map((value) => Buffer.isBuffer(value) ? value.toString("utf-8") : String(value))
      .join("\n")
      .trim();
    return out || null;
  }
}

function safeId(value: string): string {
  return basename(value || "").replace(/[^a-zA-Z0-9._-]/g, "");
}

function detectNginxBinary(): string | null {
  const candidates = [
    "/www/server/nginx/sbin/nginx",
    "/usr/sbin/nginx",
    "/usr/local/sbin/nginx",
  ];
  for (const item of candidates) {
    if (existsSync(item)) return item;
  }
  return execCmdSafe(process.platform === "win32" ? "where nginx" : "command -v nginx", 5000)?.split(/\r?\n/)[0] || null;
}

function detectLayout(): NginxLayout {
  const binary = detectNginxBinary();
  const installed = !!binary;
  if (existsSync("/www/server/nginx")) {
    return {
      installed,
      binary,
      mode: "compiled",
      availableDir: "/www/server/nginx/conf/vhost",
      enabledDir: "/www/server/nginx/conf/vhost",
      sslDir: "/www/server/nginx/conf/ssl",
    };
  }
  if (existsSync("/etc/nginx/sites-available") || existsSync("/etc/nginx/sites-enabled")) {
    return {
      installed,
      binary,
      mode: "debian-sites",
      availableDir: "/etc/nginx/sites-available",
      enabledDir: "/etc/nginx/sites-enabled",
      sslDir: "/etc/nginx/ssl/cyrene",
    };
  }
  return {
    installed,
    binary,
    mode: installed ? "conf.d" : "unknown",
    availableDir: installed ? "/etc/nginx/conf.d" : null,
    enabledDir: installed ? "/etc/nginx/conf.d" : null,
    sslDir: "/etc/nginx/ssl/cyrene",
  };
}

function ensureLayout(): NginxLayout {
  const layout = detectLayout();
  if (!layout.installed || !layout.binary || !layout.availableDir) {
    throw new Error("Nginx 未安装或未检测到配置目录");
  }
  mkdirSync(layout.availableDir, { recursive: true });
  mkdirSync(layout.sslDir, { recursive: true });
  return layout;
}

function normalizeSiteName(name: string): string {
  const clean = basename(name || "").replace(/\.conf(?:\.disabled)?$/, "");
  if (!clean || clean.includes("/") || clean.includes("\\")) throw new Error("站点名称无效");
  return clean;
}

function getSiteConfigPath(layout: NginxLayout, siteName: string): string | null {
  if (!layout.availableDir) return null;
  const active = join(layout.availableDir, `${siteName}.conf`);
  if (existsSync(active)) return active;
  const disabled = join(layout.availableDir, `${siteName}.conf.disabled`);
  if (existsSync(disabled)) return disabled;
  return null;
}

function parseCertificate(certPath: string) {
  const subject = execCmdSafe(`openssl x509 -in "${certPath}" -noout -subject`, 5000)?.replace(/^subject=\s*/, "") || null;
  const issuer = execCmdSafe(`openssl x509 -in "${certPath}" -noout -issuer`, 5000)?.replace(/^issuer=\s*/, "") || null;
  const dates = execCmdSafe(`openssl x509 -in "${certPath}" -noout -dates`, 5000) || "";
  const validFrom = dates.match(/notBefore=(.+)/)?.[1] || null;
  const validTo = dates.match(/notAfter=(.+)/)?.[1] || null;
  const san = execCmdSafe(`openssl x509 -in "${certPath}" -noout -ext subjectAltName`, 5000) || "";
  const domains = [...san.matchAll(/DNS:([^,\s]+)/g)].map((match) => match[1]);
  const cn = subject?.match(/CN\s*=\s*([^,/]+)/)?.[1]?.trim();
  if (domains.length === 0 && cn) domains.push(cn);
  const expiresInDays = validTo ? Math.ceil((Date.parse(validTo) - Date.now()) / 86_400_000) : null;
  return { subject, issuer, validFrom, validTo, domains, expiresInDays };
}

function metaPath(id: string): string {
  return join(DATA_DIR, id, "meta.json");
}

function loadCertificate(id: string): CertificateInfo | null {
  const clean = safeId(id);
  if (!clean) return null;
  const path = metaPath(clean);
  if (!existsSync(path)) return null;
  try {
    const meta = JSON.parse(readFileSync(path, "utf-8")) as CertificateInfo;
    if (!existsSync(meta.certPath) || !existsSync(meta.keyPath)) return null;
    return meta;
  } catch {
    return null;
  }
}

function listCertificates(): CertificateInfo[] {
  ensureDataDir();
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadCertificate(entry.name))
    .filter((item): item is CertificateInfo => !!item)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function createCertificate(body: CertificateInput): CertificateInfo {
  ensureDataDir();
  const cert = (body.certificate || "").trim();
  const key = (body.privateKey || "").trim();
  if (!cert.includes("BEGIN CERTIFICATE")) throw new Error("证书内容不是有效 PEM 格式");
  if (!key.includes("PRIVATE KEY")) throw new Error("私钥内容不是有效 PEM 格式");

  const id = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const dir = join(DATA_DIR, id);
  mkdirSync(dir, { recursive: true });
  const certPath = join(dir, "fullchain.pem");
  const keyPath = join(dir, "privkey.pem");
  writeFileSync(certPath, `${cert}\n`, { encoding: "utf-8", mode: 0o600 });
  writeFileSync(keyPath, `${key}\n`, { encoding: "utf-8", mode: 0o600 });

  const parsed = parseCertificate(certPath);
  const name = (body.name || parsed.domains[0] || `cert-${id}`).trim();
  const meta: CertificateInfo = {
    id,
    name,
    domains: parsed.domains,
    subject: parsed.subject,
    issuer: parsed.issuer,
    validFrom: parsed.validFrom,
    validTo: parsed.validTo,
    expiresInDays: parsed.expiresInDays,
    certPath,
    keyPath,
    createdAt: Date.now(),
  };
  writeFileSync(metaPath(id), JSON.stringify(meta, null, 2), "utf-8");
  return meta;
}

function testNginx(layout: NginxLayout): { success: boolean; message: string } {
  if (!layout.binary) return { success: false, message: "未检测到 nginx 命令" };
  try {
    const output = execCmd(`${layout.binary} -t 2>&1`, 15000);
    return { success: true, message: output || "nginx 配置检查通过" };
  } catch (e: any) {
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
    return { success: false, message: output || "nginx 配置检查失败" };
  }
}

function reloadNginx(layout: NginxLayout): { success: boolean; message: string } {
  if (!layout.binary) return { success: false, message: "未检测到 nginx 命令" };
  for (const command of [`${layout.binary} -s reload`, "systemctl reload nginx", "service nginx reload"]) {
    try {
      const output = execCmd(command, 15000);
      return { success: true, message: output || "nginx 已重载" };
    } catch {
      // try next
    }
  }
  return { success: false, message: "nginx 重载失败，请检查服务是否正在运行" };
}

function replaceManagedSslBlock(content: string, block: string): string {
  const escapedStart = SSL_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = SSL_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\n?\\s*${escapedStart}[\\s\\S]*?${escapedEnd}\\s*\\n?`, "m");
  if (pattern.test(content)) return content.replace(pattern, `\n${block}\n`);
  const insertAt = content.lastIndexOf("\n}");
  if (insertAt === -1) return `${content.trimEnd()}\n${block}\n`;
  return `${content.slice(0, insertAt)}\n${block}${content.slice(insertAt)}`;
}

function removeManagedHttpsRedirect(content: string): string {
  const escapedStart = HTTPS_REDIRECT_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = HTTPS_REDIRECT_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.replace(new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\s*`, "m"), "\n").trimStart();
}

function serverNamesFromConfig(content: string, fallback: string): string {
  return content.match(/server_name\s+([^;]+);/i)?.[1]?.trim() || fallback;
}

function withHttpsRedirectServer(content: string, serverNames: string): string {
  const clean = removeManagedHttpsRedirect(content);
  const redirectBlock = `${HTTPS_REDIRECT_START}
server {
    listen 80;
    server_name ${serverNames};
    return 301 https://$host$request_uri;
}
${HTTPS_REDIRECT_END}

`;
  return `${redirectBlock}${clean}`;
}

function ensureSslListen(content: string): string {
  let next = content.replace(/^\s*listen\s+80\s*;\s*$/im, "    listen 443 ssl http2;");
  if (/listen\s+443\s+ssl/i.test(next)) return next;
  const listenLine = next.match(/^\s*listen\s+[^;]+;/im)?.[0];
  if (!listenLine) return next.replace(/server\s*\{/, "server {\n    listen 443 ssl http2;");
  return next.replace(listenLine, `${listenLine}\n    listen 443 ssl http2;`);
}

function deployCertificate(siteName: string, body: DeployInput) {
  const cert = body.certificateId ? loadCertificate(body.certificateId) : null;
  if (!cert) throw new Error("证书不存在");
  const layout = ensureLayout();
  const cleanSiteName = normalizeSiteName(siteName);
  const configPath = getSiteConfigPath(layout, cleanSiteName);
  if (!configPath) throw new Error("站点不存在");

  const targetDir = join(layout.sslDir, cleanSiteName);
  mkdirSync(targetDir, { recursive: true });
  const certPath = join(targetDir, "fullchain.pem");
  const keyPath = join(targetDir, "privkey.pem");
  copyFileSync(cert.certPath, certPath);
  copyFileSync(cert.keyPath, keyPath);

  let content = readFileSync(configPath, "utf-8");
  const forceHttps = body.forceHttps !== false;
  const serverNames = serverNamesFromConfig(content, cleanSiteName);
  content = removeManagedHttpsRedirect(content);
  content = ensureSslListen(content);
  const block = `    ${SSL_START}
    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ${SSL_END}`;
  content = replaceManagedSslBlock(content, block);
  if (forceHttps) content = withHttpsRedirectServer(content, serverNames);

  const backupPath = `${configPath}.bak.${Date.now()}`;
  copyFileSync(configPath, backupPath);
  writeFileSync(configPath, content, "utf-8");
  const test = testNginx(layout);
  if (!test.success) {
    copyFileSync(backupPath, configPath);
    unlinkSync(backupPath);
    throw new Error(test.message);
  }
  unlinkSync(backupPath);
  const reload = reloadNginx(layout);
  return {
    success: reload.success,
    message: reload.success ? "证书已部署，nginx 已重载" : `证书已部署，但 ${reload.message}`,
    certificate: cert,
  };
}

function getSiteCertificate(siteName: string) {
  const layout = ensureLayout();
  const configPath = getSiteConfigPath(layout, normalizeSiteName(siteName));
  if (!configPath) throw new Error("站点不存在");
  const content = readFileSync(configPath, "utf-8");
  const certPath = content.match(/ssl_certificate\s+([^;]+);/i)?.[1]?.trim() || null;
  const keyPath = content.match(/ssl_certificate_key\s+([^;]+);/i)?.[1]?.trim() || null;
  const forceHttps = content.includes(HTTPS_REDIRECT_START) || /\$scheme\s*=\s*http[\s\S]*?return\s+301\s+https:\/\//i.test(content);
  const parsed = certPath && existsSync(certPath) ? parseCertificate(certPath) : null;
  return {
    success: true,
    enabled: !!certPath,
    certPath,
    keyPath,
    forceHttps,
    certificate: parsed,
  };
}

async function authProfile(jwt: any, request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  return await jwt.verify(token);
}

export const certificateRoutes = new Elysia()
  .get("/api/certificates", async ({ jwt, request }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      return { success: true, certificates: listCertificates() };
    } catch (e: any) {
      return { success: false, message: e.message || "证书列表读取失败" };
    }
  })

  .post("/api/certificates", async ({ jwt, request, body }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      return { success: true, message: "证书已保存", certificate: createCertificate(body || {}) };
    } catch (e: any) {
      logger.err(`证书保存失败: ${e.message}`);
      return { success: false, message: e.message || "证书保存失败" };
    }
  })

  .delete("/api/certificates/:id", async ({ jwt, request, params }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const id = safeId(params.id);
      if (!id) return { success: false, message: "证书 ID 无效" };
      const dir = join(DATA_DIR, id);
      if (!existsSync(dir)) return { success: false, message: "证书不存在" };
      rmSync(dir, { recursive: true, force: true });
      return { success: true, message: "证书已删除" };
    } catch (e: any) {
      return { success: false, message: e.message || "证书删除失败" };
    }
  })

  .get("/api/sites/:name/certificate", async ({ jwt, request, params }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      return getSiteCertificate(params.name);
    } catch (e: any) {
      return { success: false, message: e.message || "站点证书读取失败" };
    }
  })

  .post("/api/sites/:name/certificate/deploy", async ({ jwt, request, params, body }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      return deployCertificate(params.name, body || {});
    } catch (e: any) {
      logger.err(`证书部署失败: ${e.message}`);
      return { success: false, message: e.message || "证书部署失败" };
    }
  });
