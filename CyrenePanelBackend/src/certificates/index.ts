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
import { auditLog, getRequestIp } from "../audit/index";

interface CertificateInput {
  name?: string;
  certificate?: string;
  privateKey?: string;
}

interface DeployInput {
  certificateId?: string;
  forceHttps?: boolean;
}

type AcmeChallenge = "http" | "dns";

interface AcmeRequestInput {
  domains?: string[] | string;
  email?: string;
  challenge?: AcmeChallenge;
  dnsProvider?: string;
  dnsEnv?: Record<string, string>;
  staging?: boolean;
  forceHttps?: boolean;
}

interface RenewInput {
  certificateId?: string;
  forceHttps?: boolean;
}

interface AcmeInstallInput {
  email?: string;
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
const ACME_CHALLENGE_START = "# CyrenePanelAcmeChallengeStart";
const ACME_CHALLENGE_END = "# CyrenePanelAcmeChallengeEnd";
const DOMAIN_RE = /^(?:\*\.)?[a-zA-Z0-9][a-zA-Z0-9.-]{0,251}[a-zA-Z0-9]$/;

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

function normalizeAcmeDomains(input: string[] | string | undefined, fallback: string[]): string[] {
  const raw = Array.isArray(input) ? input : String(input || "").split(/[\s,]+/);
  const selected = raw.map((item) => item.trim().toLowerCase()).filter(Boolean);
  const domains = [...new Set((selected.length ? selected : fallback).filter((item) => item !== "_"))];
  if (domains.length === 0) throw new Error("请填写至少一个可申请证书的域名");
  for (const domain of domains) {
    if (!DOMAIN_RE.test(domain)) throw new Error(`域名格式不正确: ${domain}`);
  }
  return domains;
}

function parseSiteDomains(content: string, fallback: string): string[] {
  const serverNames = content.match(/server_name\s+([^;]+);/i)?.[1] || fallback;
  return serverNames.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function parseSiteRoot(content: string): string | null {
  return content.match(/\broot\s+([^;]+);/i)?.[1]?.trim() || null;
}

function getSiteContext(layout: NginxLayout, siteName: string) {
  const cleanSiteName = normalizeSiteName(siteName);
  const configPath = getSiteConfigPath(layout, cleanSiteName);
  if (!configPath) throw new Error("站点不存在");
  const content = readFileSync(configPath, "utf-8");
  return {
    siteName: cleanSiteName,
    configPath,
    content,
    root: parseSiteRoot(content),
    domains: parseSiteDomains(content, cleanSiteName),
  };
}

function detectCommand(name: string): string | null {
  if (name === "acme.sh") {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const bundled = home ? join(home, ".acme.sh", "acme.sh") : "";
    if (bundled && existsSync(bundled)) return bundled;
    for (const candidate of ["/root/.acme.sh/acme.sh", "/usr/local/bin/acme.sh"]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  const output = execCmdSafe(process.platform === "win32" ? `where ${name}` : `command -v ${name}`, 5000);
  const found = output
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^Command failed:/i.test(line) && !/not found|not recognized|找不到/i.test(line));
  return found || null;
}

function sanitizeDnsProvider(value: string | undefined): string {
  const provider = (value || "").trim();
  if (!/^dns_[a-zA-Z0-9_]+$/.test(provider)) {
    throw new Error("DNS API 标识必须类似 dns_cf、dns_dp、dns_ali");
  }
  return provider;
}

function sanitizeDnsEnv(input: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input || {})) {
    const cleanKey = key.trim();
    if (!/^[A-Z0-9_]+$/.test(cleanKey)) throw new Error(`DNS 环境变量名不合法: ${key}`);
    env[cleanKey] = String(value || "");
  }
  return env;
}

function redactArgs(args: string[]): string {
  return args
    .map((arg, index) => {
      const previous = args[index - 1] || "";
      if (/^email=/i.test(arg)) return "email=<email>";
      if (/email/i.test(previous)) return "<email>";
      if (/pass|secret|token|key/i.test(previous)) return "<secret>";
      return arg;
    })
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createSseResponse(run: (send: (data: Record<string, unknown>) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(send);
      } catch (e: any) {
        send({ type: "error", message: e.message || "证书申请失败" });
      } finally {
        controller.close();
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

async function runStreamingCommand(
  command: string,
  args: string[],
  send: (data: Record<string, unknown>) => void,
  env?: Record<string, string>,
  allowedExitCodes?: number[],
): Promise<void> {
  send({ type: "stage", stage: basename(command), message: `$ ${basename(command)} ${redactArgs(args)}` });
  const spawnEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") spawnEnv[key] = value;
  }
  const proc = (globalThis as any).Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...spawnEnv, ...(env || {}) },
  });

  const read = async (stream: ReadableStream<Uint8Array> | null, level: "stdout" | "stderr") => {
    if (!stream) return;
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
        if (line.trim()) send({ type: "progress", stage: level, message: line });
      }
    }
    if (buffer.trim()) send({ type: "progress", stage: level, message: buffer });
  };

  await Promise.all([read(proc.stdout, "stdout"), read(proc.stderr, "stderr")]);
  const exitCode = await proc.exited;
  if (exitCode !== 0 && !(allowedExitCodes || []).includes(exitCode)) {
    throw new Error(`${basename(command)} 执行失败，退出码 ${exitCode}`);
  }
}

function saveIssuedCertificate(certPath: string, keyPath: string, name: string): CertificateInfo {
  if (!existsSync(certPath) || !existsSync(keyPath)) throw new Error("证书签发完成，但未找到证书文件");
  return createCertificate({
    name,
    certificate: readFileSync(certPath, "utf-8"),
    privateKey: readFileSync(keyPath, "utf-8"),
  });
}

function getAcmeEnvironment() {
  const acmeSh = detectCommand("acme.sh");
  const certbot = detectCommand("certbot");
  const openssl = detectCommand("openssl");
  const curl = detectCommand("curl");
  const wget = detectCommand("wget");
  const sh = detectCommand("sh");
  const socat = detectCommand("socat");
  return {
    success: true,
    tools: {
      acmeSh,
      certbot,
      openssl,
      curl,
      wget,
      sh,
      socat,
    },
    ready: {
      http: !!openssl && (!!acmeSh || !!certbot),
      dns: !!openssl && !!acmeSh,
      installAcmeSh: !!sh && (!!curl || !!wget),
    },
  };
}

async function installAcmeSh(body: AcmeInstallInput, send: (data: Record<string, unknown>) => void) {
  const email = String(body.email || "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("请填写有效邮箱用于安装 acme.sh");
  const sh = detectCommand("sh");
  const curl = detectCommand("curl");
  const wget = detectCommand("wget");
  if (!sh) throw new Error("未检测到 sh，无法安装 acme.sh");
  if (!curl && !wget) throw new Error("未检测到 curl 或 wget，无法下载安装 acme.sh");

  ensureDataDir();
  const scriptPath = join(DATA_DIR, "acme-install.sh");
  send({ type: "stage", stage: "prepare", message: "准备安装 acme.sh" });
  if (curl) {
    await runStreamingCommand(curl, ["-fsSL", "https://get.acme.sh", "-o", scriptPath], send);
  } else if (wget) {
    await runStreamingCommand(wget, ["-O", scriptPath, "https://get.acme.sh"], send);
  }
  await runStreamingCommand(sh, [scriptPath, `email=${email}`], send);

  const acmeSh = detectCommand("acme.sh");
  if (!acmeSh) throw new Error("acme.sh 安装命令已执行，但仍未检测到 acme.sh");
  send({ type: "done", message: `acme.sh 已安装: ${acmeSh}` });
}

async function requestCertificate(
  siteName: string,
  body: AcmeRequestInput,
  send: (data: Record<string, unknown>) => void,
) {
  const layout = ensureLayout();
  const site = getSiteContext(layout, siteName);
  const domains = normalizeAcmeDomains(body.domains, site.domains);
  const challenge = body.challenge === "dns" ? "dns" : "http";
  const hasWildcard = domains.some((domain) => domain.startsWith("*."));
  const email = String(body.email || "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("请填写有效邮箱用于 ACME 注册");
  if (hasWildcard && challenge !== "dns") throw new Error("通配符证书必须使用 DNS 验证");

  const id = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const workDir = join(DATA_DIR, id);
  mkdirSync(workDir, { recursive: true });
  const issuedCertPath = join(workDir, "issued-fullchain.pem");
  const issuedKeyPath = join(workDir, "issued-privkey.pem");

  const acmeSh = detectCommand("acme.sh");
  const certbot = detectCommand("certbot");
  const domainArgs = domains.flatMap((domain) => ["-d", domain]);

  send({ type: "stage", stage: "prepare", message: `准备申请 ${domains.join(", ")} 的证书` });

  if (acmeSh) {
    const common = ["--issue", ...domainArgs, "--accountemail", email, "--keylength", "ec-256", "--server", "letsencrypt"];
    const issueArgs =
      challenge === "dns"
        ? [...common, "--dns", sanitizeDnsProvider(body.dnsProvider)]
        : [...common, "--webroot", site.root || ""];
    if (body.staging) issueArgs.push("--staging");
    if (challenge === "http") prepareHttpChallengeConfig(layout, site, send);

    await runStreamingCommand(acmeSh, issueArgs, send, challenge === "dns" ? sanitizeDnsEnv(body.dnsEnv) : undefined, [2]);
    await runStreamingCommand(
      acmeSh,
      ["--install-cert", "-d", domains[0], "--ecc", "--fullchain-file", issuedCertPath, "--key-file", issuedKeyPath],
      send,
    );
  } else if (certbot && challenge === "http") {
    prepareHttpChallengeConfig(layout, site, send);
    const webroot = site.root;
    if (!webroot) throw new Error("当前站点未配置 root，无法使用文件验证");
    const certName = domains[0].replace(/^\*\./, "").replace(/[^a-zA-Z0-9.-]/g, "-");
    const args = [
      "certonly",
      "--webroot",
      "-w",
      webroot,
      ...domainArgs,
      "--non-interactive",
      "--agree-tos",
      "--email",
      email,
      "--cert-name",
      certName,
      "--keep-until-expiring",
      "--preferred-challenges",
      "http",
    ];
    if (body.staging) args.push("--staging");
    await runStreamingCommand(certbot, args, send);
    copyFileSync(`/etc/letsencrypt/live/${certName}/fullchain.pem`, issuedCertPath);
    copyFileSync(`/etc/letsencrypt/live/${certName}/privkey.pem`, issuedKeyPath);
  } else {
    throw new Error(challenge === "dns" ? "DNS 验证需要先安装 acme.sh" : "未检测到 acme.sh 或 certbot");
  }

  send({ type: "stage", stage: "save", message: "证书签发成功，正在保存并部署到站点" });
  const cert = saveIssuedCertificate(issuedCertPath, issuedKeyPath, domains[0]);
  const deployed = deployCertificate(site.siteName, {
    certificateId: cert.id,
    forceHttps: body.forceHttps !== false,
  });
  send({
    type: "done",
    message: deployed.success ? "证书已申请并部署完成" : deployed.message,
    certificateId: cert.id,
  });
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

function acmeChallengeBlock(root: string): string {
  return `    ${ACME_CHALLENGE_START}
    location ^~ /.well-known/acme-challenge/ {
        root ${root};
        default_type "text/plain";
        try_files $uri =404;
    }
    ${ACME_CHALLENGE_END}`;
}

function replaceManagedAcmeChallenge(content: string, root: string): string {
  const block = acmeChallengeBlock(root);
  const pattern = new RegExp(`\\n?\\s*${escapeRegExp(ACME_CHALLENGE_START)}[\\s\\S]*?${escapeRegExp(ACME_CHALLENGE_END)}\\s*\\n?`, "m");
  if (pattern.test(content)) return content.replace(pattern, `\n${block}\n`);
  const insertAt = content.lastIndexOf("\n}");
  if (insertAt === -1) return `${content.trimEnd()}\n${block}\n`;
  return `${content.slice(0, insertAt)}\n${block}${content.slice(insertAt)}`;
}

function withHttpsRedirectServer(content: string, serverNames: string, acmeRoot?: string | null): string {
  const clean = removeManagedHttpsRedirect(content);
  const challenge = acmeRoot ? `${acmeChallengeBlock(acmeRoot)}

    location / {
        return 301 https://$host$request_uri;
    }` : "    return 301 https://$host$request_uri;";
  const redirectBlock = `${HTTPS_REDIRECT_START}
server {
    listen 80;
    server_name ${serverNames};
${challenge}
}
${HTTPS_REDIRECT_END}

`;
  return `${redirectBlock}${clean}`;
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
    message: reload.success ? "nginx 已写入 ACME 验证规则并重载" : `ACME 验证规则已写入，但 ${reload.message}`,
  };
}

function prepareHttpChallengeConfig(
  layout: NginxLayout,
  site: ReturnType<typeof getSiteContext>,
  send: (data: Record<string, unknown>) => void,
) {
  if (!site.root) throw new Error("当前站点未配置 root，无法使用文件验证");
  const challengeDir = join(site.root, ".well-known", "acme-challenge");
  mkdirSync(challengeDir, { recursive: true });
  let content = readFileSync(site.configPath, "utf-8");
  content = replaceManagedAcmeChallenge(content, site.root);
  if (content.includes(HTTPS_REDIRECT_START)) {
    const serverNames = serverNamesFromConfig(content, site.siteName);
    content = withHttpsRedirectServer(content, serverNames, site.root);
  }
  const saved = saveConfigWithTest(layout, site.configPath, content);
  if (!saved.success) throw new Error(saved.message);
  send({ type: "stage", stage: "nginx", message: saved.message });
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
  const acmeRoot = parseSiteRoot(content);
  content = removeManagedHttpsRedirect(content);
  content = ensureSslListen(content);
  const block = `    ${SSL_START}
    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ${SSL_END}`;
  content = replaceManagedSslBlock(content, block);
  if (forceHttps) content = withHttpsRedirectServer(content, serverNames, acmeRoot);

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

async function renewCertificate(
  certificateId: string,
  forceHttps: boolean,
  send: (data: Record<string, unknown>) => void,
) {
  const cert = loadCertificate(certificateId);
  if (!cert) throw new Error("证书不存在");

  const acmeSh = detectCommand("acme.sh");
  if (!acmeSh) throw new Error("未检测到 acme.sh，无法续签证书");

  if (cert.domains.length === 0) throw new Error("证书未包含域名信息，无法续签");

  send({ type: "stage", stage: "prepare", message: `准备续签证书: ${cert.domains.join(", ")}` });

  const domainArgs = cert.domains.flatMap((domain) => ["-d", domain]);

  const id = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const workDir = join(DATA_DIR, id);
  mkdirSync(workDir, { recursive: true });
  const issuedCertPath = join(workDir, "issued-fullchain.pem");
  const issuedKeyPath = join(workDir, "issued-privkey.pem");

  // Use acme.sh --renew --force to force renewal
  const renewArgs = ["--renew", ...domainArgs, "--ecc", "--force"];
  await runStreamingCommand(acmeSh, renewArgs, send, undefined, [2]);

  // Install the renewed cert
  await runStreamingCommand(
    acmeSh,
    ["--install-cert", "-d", cert.domains[0], "--ecc", "--fullchain-file", issuedCertPath, "--key-file", issuedKeyPath],
    send,
  );

  if (!existsSync(issuedCertPath) || !existsSync(issuedKeyPath)) {
    throw new Error("续签完成，但未找到证书文件");
  }

  send({ type: "stage", stage: "save", message: "证书续签成功，正在保存并部署" });
  const newCert = saveIssuedCertificate(issuedCertPath, issuedKeyPath, cert.name);

  // Find all sites that use this certificate and redeploy
  const layout = ensureLayout();
  if (layout.availableDir) {
    const siteFiles = readdirSync(layout.availableDir).filter((f) => f.endsWith(".conf") && !f.endsWith(".disabled"));
    for (const file of siteFiles) {
      try {
        const siteContent = readFileSync(join(layout.availableDir, file), "utf-8");
        if (siteContent.includes(SSL_START) && siteContent.includes(cert.certPath)) {
          const siteName = file.replace(/\.conf$/, "");
          send({ type: "stage", stage: "deploy", message: `重新部署到站点: ${siteName}` });
          deployCertificate(siteName, { certificateId: newCert.id, forceHttps });
        }
      } catch {
        // skip sites that fail
      }
    }
  }

  send({
    type: "done",
    message: `证书续签成功并已部署`,
    certificateId: newCert.id,
  });
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

  .get("/api/certificates/acme/environment", async ({ jwt, request }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      return getAcmeEnvironment();
    } catch (e: any) {
      return { success: false, message: e.message || "ACME 环境读取失败" };
    }
  })

  .post("/api/certificates/acme/install-stream", async ({ jwt, request, body, server }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    auditLog({
      username: profile.username,
      category: "certificate",
      action: "安装 acme.sh",
      target: "ACME 客户端",
      ip: getRequestIp(request, server),
    });
    return createSseResponse(async (send) => {
      try {
        await installAcmeSh(body || {}, send);
      } catch (e: any) {
        logger.err(`acme.sh 安装失败: ${e.message}`);
        send({ type: "error", message: e.message || "acme.sh 安装失败" });
      }
    });
  })

  .post("/api/certificates", async ({ jwt, request, body, server }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const cert = createCertificate(body || {});
      auditLog({
        username: profile.username,
        category: "certificate",
        action: "添加证书",
        target: cert?.name || "(未命名)",
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "证书已保存", certificate: cert };
    } catch (e: any) {
      logger.err(`证书保存失败: ${e.message}`);
      return { success: false, message: e.message || "证书保存失败" };
    }
  })

  .delete("/api/certificates/:id", async ({ jwt, request, params, server }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const id = safeId(params.id);
      if (!id) return { success: false, message: "证书 ID 无效" };
      const dir = join(DATA_DIR, id);
      if (!existsSync(dir)) return { success: false, message: "证书不存在" };
      rmSync(dir, { recursive: true, force: true });
      auditLog({
        username: profile.username,
        category: "certificate",
        action: "删除证书",
        target: id,
        ip: getRequestIp(request, server),
      });
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

  .post("/api/sites/:name/certificate/deploy", async ({ jwt, request, params, body, server }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };
    try {
      const result = deployCertificate(params.name, body || {});
      auditLog({
        username: profile.username,
        category: "certificate",
        action: "部署证书",
        target: params.name,
        detail: body?.certificateId ? `证书 ${body.certificateId}` : "",
        ip: getRequestIp(request, server),
      });
      return result;
    } catch (e: any) {
      logger.err(`证书部署失败: ${e.message}`);
      return { success: false, message: e.message || "证书部署失败" };
    }
  })

  .post("/api/sites/:name/certificate/request-stream", async ({ jwt, request, params, body, server }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    auditLog({
      username: profile.username,
      category: "certificate",
      action: "申请证书",
      target: params.name,
      detail: body?.challenge ? `验证: ${body.challenge}` : "",
      ip: getRequestIp(request, server),
    });
    return createSseResponse(async (send) => {
      try {
        await requestCertificate(params.name, body || {}, send);
      } catch (e: any) {
        logger.err(`自动申请证书失败: ${e.message}`);
        send({ type: "error", message: e.message || "自动申请证书失败" });
      }
    });
  })

  .post("/api/certificates/:id/renew-stream", async ({ jwt, request, params, body, server }: any) => {
    const profile = await authProfile(jwt, request);
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    auditLog({
      username: profile.username,
      category: "certificate",
      action: "续签证书",
      target: params.id,
      ip: getRequestIp(request, server),
    });
    return createSseResponse(async (send) => {
      try {
        await renewCertificate(params.id, body?.forceHttps !== false, send);
      } catch (e: any) {
        logger.err(`证书续签失败: ${e.message}`);
        send({ type: "error", message: e.message || "证书续签失败" });
      }
    });
  });
