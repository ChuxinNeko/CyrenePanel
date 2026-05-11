import { Elysia, t } from "elysia";
import { platform } from "os";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { dirname } from "path";
import { logger } from "../logger/index";
import { auditLog, getRequestIp } from "../audit/index";

// ── 工具 ──────────────────────────────────────────────────────────

function execCmd(cmd: string, timeoutMs = 15000): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, stdout: stdout.toString().trim(), stderr: "" };
  } catch (e: any) {
    return {
      ok: false,
      stdout: (e.stdout ? e.stdout.toString() : "").trim(),
      stderr: (e.stderr ? e.stderr.toString() : (e.message || "")).trim(),
    };
  }
}

function hasBin(cmd: string): boolean {
  if (platform() === "win32") {
    return execCmd(`where ${cmd}`, 3000).ok;
  }
  return execCmd(`command -v ${cmd}`, 3000).ok;
}

// ── 防火墙后端检测 ────────────────────────────────────────────────

export type FirewallBackend = "ufw" | "firewalld" | "iptables" | "netsh" | "none";

function detectFirewall(): FirewallBackend {
  if (platform() === "win32") {
    if (hasBin("netsh")) return "netsh";
    return "none";
  }
  if (hasBin("ufw")) return "ufw";
  if (hasBin("firewall-cmd")) return "firewalld";
  if (hasBin("iptables")) return "iptables";
  return "none";
}

interface FirewallStatus {
  backend: FirewallBackend;
  installed: boolean;
  enabled: boolean;
  pingBlocked: boolean;
  message?: string;
}

function getFirewallEnabled(backend: FirewallBackend): boolean {
  switch (backend) {
    case "ufw": {
      const r = execCmd("ufw status", 5000);
      return /Status:\s*active/i.test(r.stdout);
    }
    case "firewalld": {
      const r = execCmd("firewall-cmd --state", 5000);
      return r.ok && /running/i.test(r.stdout);
    }
    case "iptables": {
      // iptables 没有"启用"概念，认为有规则就算"启用"
      const r = execCmd("iptables -S", 5000);
      return r.ok && r.stdout.split("\n").length > 3;
    }
    case "netsh": {
      const r = execCmd("netsh advfirewall show allprofiles state", 5000);
      return /ON/i.test(r.stdout);
    }
    default:
      return false;
  }
}

// 通过 sysctl 判断/控制 ping
function isPingBlocked(): boolean {
  if (platform() === "win32") {
    const r = execCmd(
      `netsh advfirewall firewall show rule name="CyrenePanel-Block-ICMPv4"`,
      5000,
    );
    return r.ok && /Enabled:\s*Yes/i.test(r.stdout);
  }
  try {
    const v = readFileSync("/proc/sys/net/ipv4/icmp_echo_ignore_all", "utf-8").trim();
    return v === "1";
  } catch {
    return false;
  }
}

function setPingBlocked(block: boolean): { ok: boolean; message?: string } {
  if (platform() === "win32") {
    if (block) {
      const cmd = `netsh advfirewall firewall add rule name="CyrenePanel-Block-ICMPv4" protocol=icmpv4:8,any dir=in action=block`;
      const r = execCmd(cmd, 5000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "添加阻止规则失败" };
    }
    const cmd = `netsh advfirewall firewall delete rule name="CyrenePanel-Block-ICMPv4"`;
    const r = execCmd(cmd, 5000);
    return r.ok ? { ok: true } : { ok: false, message: r.stderr || "删除阻止规则失败" };
  }

  // Linux：sysctl 即时生效 + sysctl.d 持久化
  const value = block ? 1 : 0;
  const r = execCmd(`sysctl -w net.ipv4.icmp_echo_ignore_all=${value}`, 5000);
  if (!r.ok) return { ok: false, message: r.stderr || "sysctl 设置失败（需要 root 权限）" };

  const persistPath = "/etc/sysctl.d/99-cyrene-ping.conf";
  try {
    if (block) {
      mkdirSync(dirname(persistPath), { recursive: true });
      writeFileSync(persistPath, "net.ipv4.icmp_echo_ignore_all = 1\n");
    } else if (existsSync(persistPath)) {
      unlinkSync(persistPath);
    }
  } catch (e: any) {
    return { ok: true, message: `生效成功，但持久化失败: ${e.message}` };
  }
  return { ok: true };
}

// ── 防火墙规则 ────────────────────────────────────────────────────

export interface FirewallRule {
  id: string;
  action: "allow" | "deny" | "reject";
  protocol: "tcp" | "udp" | "any";
  port: string;        // 单端口 or 范围，如 "80" 或 "8000:8100"
  source?: string;     // 可选源 IP / CIDR
  raw?: string;        // 原始规则描述
}

function listUfwRules(): FirewallRule[] {
  const r = execCmd("ufw status numbered", 5000);
  if (!r.ok) return [];
  const rules: FirewallRule[] = [];
  for (const line of r.stdout.split("\n")) {
    // 形如: [ 1] 22/tcp                     ALLOW IN    Anywhere
    const m = line.match(/^\s*\[\s*(\d+)\s*\]\s+(.+?)\s{2,}([A-Z\s]+?)\s{2,}(.+)$/);
    if (!m) continue;
    const idx = m[1];
    const target = m[2].trim();
    const actionRaw = m[3].trim();
    const source = m[4].trim();
    const portMatch = target.match(/^(\d+(?::\d+)?)(?:\/(tcp|udp))?$/);
    if (!portMatch) continue;
    const action: FirewallRule["action"] = /DENY/i.test(actionRaw)
      ? "deny"
      : /REJECT/i.test(actionRaw)
        ? "reject"
        : "allow";
    rules.push({
      id: `ufw:${idx}`,
      action,
      protocol: (portMatch[2] as any) || "any",
      port: portMatch[1],
      source: source && source.toLowerCase() !== "anywhere" ? source : undefined,
      raw: line.trim(),
    });
  }
  return rules;
}

function listFirewalldRules(): FirewallRule[] {
  const r = execCmd("firewall-cmd --list-ports", 5000);
  if (!r.ok) return [];
  const rules: FirewallRule[] = [];
  let i = 0;
  for (const tok of r.stdout.split(/\s+/).filter(Boolean)) {
    // 形如 80/tcp
    const m = tok.match(/^(\d+(?:-\d+)?)\/(tcp|udp)$/);
    if (!m) continue;
    rules.push({
      id: `firewalld:${i++}`,
      action: "allow",
      protocol: m[2] as any,
      port: m[1].replace("-", ":"),
      raw: tok,
    });
  }
  return rules;
}

function listIptablesRules(): FirewallRule[] {
  const r = execCmd("iptables -L INPUT -n --line-numbers", 5000);
  if (!r.ok) return [];
  const rules: FirewallRule[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!/^\s*\d+\s/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const idx = parts[0];
    const target = parts[1];
    const protocol = parts[2];
    const source = parts[4];
    const portMatch = line.match(/dpt:(\d+(?::\d+)?)/);
    if (!portMatch) continue;
    rules.push({
      id: `iptables:${idx}`,
      action: target === "ACCEPT" ? "allow" : target === "REJECT" ? "reject" : "deny",
      protocol: protocol === "tcp" || protocol === "udp" ? (protocol as any) : "any",
      port: portMatch[1],
      source: source && source !== "0.0.0.0/0" ? source : undefined,
      raw: line.trim(),
    });
  }
  return rules;
}

function listNetshRules(): FirewallRule[] {
  // 仅列出由本面板创建的规则，避免噪音
  const r = execCmd(
    `netsh advfirewall firewall show rule name="CyrenePanel-*"`,
    5000,
  );
  if (!r.ok) return [];
  const blocks = r.stdout.split(/\r?\n\r?\n/);
  const rules: FirewallRule[] = [];
  for (const blk of blocks) {
    const name = blk.match(/Rule Name:\s+(CyrenePanel-[^\r\n]+)/i)?.[1];
    if (!name) continue;
    const proto = blk.match(/Protocol:\s+(TCP|UDP|Any)/i)?.[1]?.toLowerCase() || "any";
    const port = blk.match(/LocalPort:\s+([^\r\n]+)/i)?.[1]?.trim() || "";
    const action = /Action:\s+Allow/i.test(blk) ? "allow" : "deny";
    rules.push({
      id: `netsh:${name}`,
      action: action as any,
      protocol: proto as any,
      port,
      raw: name,
    });
  }
  return rules;
}

function listFirewallRules(backend: FirewallBackend): FirewallRule[] {
  switch (backend) {
    case "ufw": return listUfwRules();
    case "firewalld": return listFirewalldRules();
    case "iptables": return listIptablesRules();
    case "netsh": return listNetshRules();
    default: return [];
  }
}

interface AddRuleInput {
  action: "allow" | "deny" | "reject";
  protocol: "tcp" | "udp" | "any";
  port: string;
  source?: string;
}

function validatePort(p: string): boolean {
  return /^\d+(:\d+)?$/.test(p) && p.split(/:/).every((n) => {
    const v = Number(n);
    return v >= 1 && v <= 65535;
  });
}

function addFirewallRule(backend: FirewallBackend, input: AddRuleInput): { ok: boolean; message?: string } {
  if (!validatePort(input.port)) return { ok: false, message: "端口格式不合法（示例：80 或 8000:8100）" };
  switch (backend) {
    case "ufw": {
      const parts = ["ufw", input.action];
      if (input.source) parts.push("from", input.source, "to", "any");
      parts.push("port", input.port);
      if (input.protocol !== "any") parts.push("proto", input.protocol);
      const r = execCmd(parts.join(" "), 8000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || r.stdout || "添加失败" };
    }
    case "firewalld": {
      if (input.action !== "allow") return { ok: false, message: "firewalld 不支持非 allow 规则（请在富规则中实现）" };
      if (input.protocol === "any") return { ok: false, message: "请选择具体协议（tcp/udp）" };
      const port = input.port.replace(":", "-");
      const r = execCmd(`firewall-cmd --permanent --add-port=${port}/${input.protocol}`, 8000);
      if (!r.ok) return { ok: false, message: r.stderr || "添加失败" };
      execCmd("firewall-cmd --reload", 5000);
      return { ok: true };
    }
    case "iptables": {
      const target = input.action === "allow" ? "ACCEPT" : input.action === "reject" ? "REJECT" : "DROP";
      const proto = input.protocol === "any" ? "tcp" : input.protocol;
      const src = input.source ? ` -s ${input.source}` : "";
      const port = input.port.replace(":", ":");
      const r = execCmd(`iptables -A INPUT${src} -p ${proto} --dport ${port} -j ${target}`, 5000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "添加失败" };
    }
    case "netsh": {
      const ruleName = `CyrenePanel-${input.action}-${input.protocol}-${input.port}-${Date.now()}`;
      const action = input.action === "allow" ? "allow" : "block";
      const proto = input.protocol === "any" ? "any" : input.protocol;
      const port = input.port;
      const r = execCmd(
        `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=${action} protocol=${proto} localport=${port}`,
        5000,
      );
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "添加失败" };
    }
    default:
      return { ok: false, message: "未检测到可用防火墙" };
  }
}

function deleteFirewallRule(backend: FirewallBackend, id: string): { ok: boolean; message?: string } {
  const [be, ref] = id.split(":");
  if (be !== backend) return { ok: false, message: "规则不属于当前防火墙后端" };
  switch (backend) {
    case "ufw": {
      // ufw 删除会询问 y/n
      const r = execCmd(`echo y | ufw delete ${ref}`, 8000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "删除失败" };
    }
    case "firewalld": {
      // ref 是数组下标，需要重新查
      const rules = listFirewalldRules();
      const target = rules.find((x) => x.id === id);
      if (!target) return { ok: false, message: "规则不存在" };
      const port = target.port.replace(":", "-");
      const r = execCmd(
        `firewall-cmd --permanent --remove-port=${port}/${target.protocol}`,
        8000,
      );
      if (!r.ok) return { ok: false, message: r.stderr || "删除失败" };
      execCmd("firewall-cmd --reload", 5000);
      return { ok: true };
    }
    case "iptables": {
      const r = execCmd(`iptables -D INPUT ${ref}`, 5000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "删除失败" };
    }
    case "netsh": {
      const r = execCmd(`netsh advfirewall firewall delete rule name="${ref}"`, 5000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "删除失败" };
    }
    default:
      return { ok: false, message: "未检测到可用防火墙" };
  }
}

function enableFirewall(backend: FirewallBackend, enable: boolean): { ok: boolean; message?: string } {
  switch (backend) {
    case "ufw": {
      const r = execCmd(enable ? "echo y | ufw enable" : "ufw disable", 8000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "操作失败" };
    }
    case "firewalld": {
      const cmd = enable
        ? "systemctl enable --now firewalld"
        : "systemctl disable --now firewalld";
      const r = execCmd(cmd, 10000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "操作失败" };
    }
    case "iptables": {
      if (enable) return { ok: false, message: "iptables 始终处于内核中，无法整体启停（请通过规则控制）" };
      const r = execCmd("iptables -F", 5000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "清空规则失败" };
    }
    case "netsh": {
      const cmd = `netsh advfirewall set allprofiles state ${enable ? "on" : "off"}`;
      const r = execCmd(cmd, 5000);
      return r.ok ? { ok: true } : { ok: false, message: r.stderr || "操作失败" };
    }
    default:
      return { ok: false, message: "未检测到可用防火墙" };
  }
}

// ── SSH 管理 ──────────────────────────────────────────────────────

interface SshStatus {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  serviceName: string;
  port: number;
  permitRootLogin: string;
  passwordAuthentication: string;
  configPath: string;
  message?: string;
}

function detectSshServiceName(): string | null {
  if (platform() === "win32") return null;
  for (const name of ["ssh", "sshd"]) {
    const r = execCmd(`systemctl list-unit-files ${name}.service`, 4000);
    if (r.ok && new RegExp(`${name}\\.service`).test(r.stdout)) return name;
  }
  // 兜底
  if (existsSync("/etc/ssh/sshd_config")) return "ssh";
  return null;
}

const SSHD_CONFIG = "/etc/ssh/sshd_config";

function parseSshdConfig(): { port: number; permitRootLogin: string; passwordAuthentication: string } {
  let port = 22;
  let permitRootLogin = "yes";
  let passwordAuthentication = "yes";
  if (!existsSync(SSHD_CONFIG)) return { port, permitRootLogin, passwordAuthentication };
  try {
    const content = readFileSync(SSHD_CONFIG, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^(\S+)\s+(.+)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === "port") port = Number(value) || port;
      else if (key === "permitrootlogin") permitRootLogin = value;
      else if (key === "passwordauthentication") passwordAuthentication = value;
    }
  } catch {
    // ignore
  }
  return { port, permitRootLogin, passwordAuthentication };
}

function getSshStatus(): SshStatus {
  if (platform() === "win32") {
    return {
      installed: false,
      active: false,
      enabled: false,
      serviceName: "",
      port: 22,
      permitRootLogin: "n/a",
      passwordAuthentication: "n/a",
      configPath: "",
      message: "Windows 暂不支持 SSH 管理",
    };
  }
  const name = detectSshServiceName();
  if (!name) {
    return {
      installed: false,
      active: false,
      enabled: false,
      serviceName: "",
      port: 22,
      permitRootLogin: "unknown",
      passwordAuthentication: "unknown",
      configPath: SSHD_CONFIG,
      message: "未检测到 SSH 服务（请确认已安装 openssh-server）",
    };
  }
  const active = execCmd(`systemctl is-active ${name}`, 3000).stdout.trim() === "active";
  const enabled = execCmd(`systemctl is-enabled ${name}`, 3000).stdout.trim() === "enabled";
  const cfg = parseSshdConfig();
  return {
    installed: true,
    active,
    enabled,
    serviceName: name,
    port: cfg.port,
    permitRootLogin: cfg.permitRootLogin,
    passwordAuthentication: cfg.passwordAuthentication,
    configPath: SSHD_CONFIG,
  };
}

function controlSsh(action: "start" | "stop" | "restart" | "enable" | "disable"): { ok: boolean; message?: string } {
  if (platform() === "win32") return { ok: false, message: "Windows 暂不支持 SSH 管理" };
  const name = detectSshServiceName();
  if (!name) return { ok: false, message: "未检测到 SSH 服务" };
  const r = execCmd(`systemctl ${action} ${name}`, 10000);
  if (!r.ok) return { ok: false, message: r.stderr || `${action} 失败` };
  return { ok: true };
}

interface SshConfigPatch {
  port?: number;
  permitRootLogin?: string;
  passwordAuthentication?: string;
}

function updateSshConfig(patch: SshConfigPatch): { ok: boolean; message?: string } {
  if (platform() === "win32") return { ok: false, message: "Windows 暂不支持 SSH 管理" };
  if (!existsSync(SSHD_CONFIG)) return { ok: false, message: "未找到 sshd_config" };
  try {
    const original = readFileSync(SSHD_CONFIG, "utf-8");
    // 备份
    const backupPath = `${SSHD_CONFIG}.cyrene.bak`;
    if (!existsSync(backupPath)) writeFileSync(backupPath, original);

    const lines = original.split("\n");
    const updates: Record<string, string> = {};
    if (patch.port !== undefined) {
      if (!Number.isFinite(patch.port) || patch.port < 1 || patch.port > 65535) {
        return { ok: false, message: "端口范围 1-65535" };
      }
      updates["Port"] = String(patch.port);
    }
    if (patch.permitRootLogin !== undefined) {
      if (!["yes", "no", "prohibit-password", "forced-commands-only"].includes(patch.permitRootLogin)) {
        return { ok: false, message: "PermitRootLogin 取值不合法" };
      }
      updates["PermitRootLogin"] = patch.permitRootLogin;
    }
    if (patch.passwordAuthentication !== undefined) {
      if (!["yes", "no"].includes(patch.passwordAuthentication)) {
        return { ok: false, message: "PasswordAuthentication 取值不合法" };
      }
      updates["PasswordAuthentication"] = patch.passwordAuthentication;
    }

    const handled = new Set<string>();
    const newLines = lines.map((line) => {
      const m = line.match(/^(\s*#?\s*)(Port|PermitRootLogin|PasswordAuthentication)\s+(.+)$/i);
      if (!m) return line;
      const key = m[2].charAt(0).toUpperCase() + m[2].slice(1).replace(/(?:^|\s)\S/g, (s) => s.toUpperCase());
      const normalized =
        key.toLowerCase() === "port"
          ? "Port"
          : key.toLowerCase() === "permitrootlogin"
            ? "PermitRootLogin"
            : "PasswordAuthentication";
      if (!(normalized in updates)) return line;
      handled.add(normalized);
      return `${normalized} ${updates[normalized]}`;
    });
    for (const k of Object.keys(updates)) {
      if (!handled.has(k)) newLines.push(`${k} ${updates[k]}`);
    }

    writeFileSync(SSHD_CONFIG, newLines.join("\n"));

    // 校验配置
    const test = execCmd("sshd -t", 5000);
    if (!test.ok) {
      writeFileSync(SSHD_CONFIG, original);
      return { ok: false, message: `sshd 配置校验失败，已回滚：${test.stderr}` };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
}

// ── 路由 ──────────────────────────────────────────────────────────

export const securityRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // 总览
  .get("/api/security/info", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const backend = detectFirewall();
    const fw: FirewallStatus = {
      backend,
      installed: backend !== "none",
      enabled: backend !== "none" ? getFirewallEnabled(backend) : false,
      pingBlocked: isPingBlocked(),
    };
    return {
      success: true,
      platform: platform(),
      firewall: fw,
      ssh: getSshStatus(),
    };
  })

  // 防火墙规则列表
  .get("/api/security/firewall/rules", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const backend = detectFirewall();
    return {
      success: true,
      backend,
      rules: backend === "none" ? [] : listFirewallRules(backend),
    };
  })

  // 添加规则
  .post(
    "/api/security/firewall/rules",
    ({ body, profile, request, server }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };
      const backend = detectFirewall();
      if (backend === "none") return { success: false, message: "未检测到可用防火墙" };
      const input = body as AddRuleInput;
      const result = addFirewallRule(backend, input);
      auditLog({
        username: profile.username,
        category: "system",
        action: result.ok ? "添加防火墙规则" : "添加防火墙规则失败",
        target: `${input.action} ${input.protocol} ${input.port}${input.source ? " from " + input.source : ""}`,
        detail: result.message,
        ip: getRequestIp(request, server),
        success: result.ok,
      });
      return { success: result.ok, message: result.message };
    },
    {
      body: t.Object({
        action: t.Union([t.Literal("allow"), t.Literal("deny"), t.Literal("reject")]),
        protocol: t.Union([t.Literal("tcp"), t.Literal("udp"), t.Literal("any")]),
        port: t.String(),
        source: t.Optional(t.String()),
      }),
    },
  )

  // 删除规则
  .delete(
    "/api/security/firewall/rules/:id",
    ({ params, profile, request, server }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };
      const backend = detectFirewall();
      if (backend === "none") return { success: false, message: "未检测到可用防火墙" };
      const result = deleteFirewallRule(backend, decodeURIComponent(params.id));
      auditLog({
        username: profile.username,
        category: "system",
        action: result.ok ? "删除防火墙规则" : "删除防火墙规则失败",
        target: params.id,
        detail: result.message,
        ip: getRequestIp(request, server),
        success: result.ok,
      });
      return { success: result.ok, message: result.message };
    },
  )

  // 启停防火墙
  .post(
    "/api/security/firewall/toggle",
    ({ body, profile, request, server }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };
      const backend = detectFirewall();
      if (backend === "none") return { success: false, message: "未检测到可用防火墙" };
      const result = enableFirewall(backend, !!body.enable);
      auditLog({
        username: profile.username,
        category: "system",
        action: body.enable ? "启用防火墙" : "禁用防火墙",
        target: backend,
        detail: result.message,
        ip: getRequestIp(request, server),
        success: result.ok,
      });
      return { success: result.ok, message: result.message };
    },
    {
      body: t.Object({ enable: t.Boolean() }),
    },
  )

  // 禁/允 ping
  .post(
    "/api/security/firewall/ping",
    ({ body, profile, request, server }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };
      const result = setPingBlocked(!!body.block);
      auditLog({
        username: profile.username,
        category: "system",
        action: body.block ? "禁止 ping" : "允许 ping",
        target: "icmp_echo",
        detail: result.message,
        ip: getRequestIp(request, server),
        success: result.ok,
      });
      return { success: result.ok, message: result.message };
    },
    {
      body: t.Object({ block: t.Boolean() }),
    },
  )

  // SSH 状态
  .get("/api/security/ssh/status", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return { success: true, ssh: getSshStatus() };
  })

  // SSH 启停
  .post(
    "/api/security/ssh/:action",
    ({ params, profile, request, server }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };
      const action = params.action as "start" | "stop" | "restart" | "enable" | "disable";
      if (!["start", "stop", "restart", "enable", "disable"].includes(action)) {
        return { success: false, message: "未知操作" };
      }
      const result = controlSsh(action);
      auditLog({
        username: profile.username,
        category: "system",
        action: `SSH ${action}`,
        target: "ssh",
        detail: result.message,
        ip: getRequestIp(request, server),
        success: result.ok,
      });
      return { success: result.ok, message: result.message };
    },
  )

  // SSH 配置更新
  .put(
    "/api/security/ssh/config",
    ({ body, profile, request, server }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };
      const patch: SshConfigPatch = {
        port: body.port,
        permitRootLogin: body.permitRootLogin,
        passwordAuthentication: body.passwordAuthentication,
      };
      const result = updateSshConfig(patch);
      auditLog({
        username: profile.username,
        category: "system",
        action: result.ok ? "更新 SSH 配置" : "更新 SSH 配置失败",
        target: "sshd_config",
        detail: result.message || JSON.stringify(patch),
        ip: getRequestIp(request, server),
        success: result.ok,
      });
      if (result.ok) {
        logger.info(`管理员 ${profile.username} 更新了 SSH 配置`);
      }
      return { success: result.ok, message: result.message };
    },
    {
      body: t.Object({
        port: t.Optional(t.Number()),
        permitRootLogin: t.Optional(t.String()),
        passwordAuthentication: t.Optional(t.String()),
      }),
    },
  );
