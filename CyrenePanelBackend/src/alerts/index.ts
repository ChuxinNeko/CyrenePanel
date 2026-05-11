import { Elysia, t } from "elysia";
import { getConfig, setConfig } from "../db";
import { getLocalMetrics } from "../nodes/index";
import { getMemoryInfo } from "../memory";
import { logger } from "../logger/index";
import { sendMail, type SmtpConfig } from "./smtp";
import { hostname } from "os";

// ── 配置类型 ──────────────────────────────────────────────────────

export type AlertRuleType =
  | "auth_login_success"
  | "auth_login_failed"
  | "sensitive_action"
  | "cpu_high"
  | "memory_high";

export interface AlertRule {
  type: AlertRuleType;
  enabled: boolean;
  threshold?: number; // CPU/Memory 百分比 0-100
  cooldownMin?: number; // 同一规则最小重复发送间隔（分钟）
}

interface StoredSmtp {
  host: string;
  port: number;
  encryption: "ssl" | "starttls" | "none";
  user: string;
  pass: string;
  from: string;
  to: string; // 逗号分隔的收件人邮箱
}

const DEFAULT_SMTP: StoredSmtp = {
  host: "",
  port: 465,
  encryption: "ssl",
  user: "",
  pass: "",
  from: "",
  to: "",
};

const DEFAULT_RULES: AlertRule[] = [
  { type: "auth_login_success", enabled: false, cooldownMin: 0 },
  { type: "auth_login_failed", enabled: true, cooldownMin: 1 },
  { type: "sensitive_action", enabled: true, cooldownMin: 0 },
  { type: "cpu_high", enabled: true, threshold: 90, cooldownMin: 10 },
  { type: "memory_high", enabled: true, threshold: 90, cooldownMin: 10 },
];

const RULE_LABELS: Record<AlertRuleType, string> = {
  auth_login_success: "用户登录成功",
  auth_login_failed: "用户登录失败",
  sensitive_action: "敏感操作",
  cpu_high: "CPU 占用过高",
  memory_high: "内存占用过高",
};

// 视为"敏感"的审计类别 / 关键字
const SENSITIVE_CATEGORIES = new Set(["user", "certificate", "node", "system"]);
const SENSITIVE_KEYWORDS = ["删除", "重置", "重新生成", "密码", "禁用", "卸载", "移除"];

function isSensitive(category: string, action: string): boolean {
  if (SENSITIVE_CATEGORIES.has(category)) return true;
  return SENSITIVE_KEYWORDS.some((k) => action.includes(k));
}

// ── 存储读写 ──────────────────────────────────────────────────────

function loadSmtp(): StoredSmtp {
  const raw = getConfig("alerts_smtp");
  if (!raw) return { ...DEFAULT_SMTP };
  try {
    return { ...DEFAULT_SMTP, ...(JSON.parse(raw) as Partial<StoredSmtp>) };
  } catch {
    return { ...DEFAULT_SMTP };
  }
}

function saveSmtp(cfg: StoredSmtp): void {
  setConfig("alerts_smtp", JSON.stringify(cfg));
}

function loadRules(): AlertRule[] {
  const raw = getConfig("alerts_rules");
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_RULES));
  try {
    const parsed = JSON.parse(raw) as AlertRule[];
    // 合并默认值，确保新增的规则类型自动出现
    const map = new Map<AlertRuleType, AlertRule>();
    for (const r of DEFAULT_RULES) map.set(r.type, { ...r });
    for (const r of parsed) {
      if (map.has(r.type)) map.set(r.type, { ...map.get(r.type)!, ...r });
    }
    return Array.from(map.values());
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_RULES));
  }
}

function saveRules(rules: AlertRule[]): void {
  setConfig("alerts_rules", JSON.stringify(rules));
}

function maskSmtp(cfg: StoredSmtp): StoredSmtp & { passConfigured: boolean } {
  return {
    ...cfg,
    pass: "",
    passConfigured: !!cfg.pass,
  };
}

// ── 冷却记录（内存，重启后重置） ──────────────────────────────────

const lastSent: Map<AlertRuleType, number> = new Map();

function inCooldown(type: AlertRuleType, cooldownMin?: number): boolean {
  if (!cooldownMin || cooldownMin <= 0) return false;
  const last = lastSent.get(type);
  if (!last) return false;
  return Date.now() - last < cooldownMin * 60_000;
}

function markSent(type: AlertRuleType): void {
  lastSent.set(type, Date.now());
}

// ── 发送邮件入口 ──────────────────────────────────────────────────

function buildAlertEmail(subject: string, lines: string[]): { subject: string; text: string; html: string } {
  const host = hostname();
  const now = new Date().toLocaleString();
  const fullSubject = `[CyrenePanel 告警] ${subject}`;
  const text = [
    `节点: ${host}`,
    `时间: ${now}`,
    "",
    ...lines,
    "",
    "—— CyrenePanel",
  ].join("\n");
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111;">
      <h2 style="margin: 0 0 12px;">⚠️ ${subject}</h2>
      <table style="border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">节点</td><td>${host}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">时间</td><td>${now}</td></tr>
      </table>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 14px 0;" />
      <div style="font-size: 14px; line-height: 1.6;">
        ${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}
      </div>
      <p style="margin-top: 18px; color: #888; font-size: 12px;">—— CyrenePanel 告警系统</p>
    </div>`;
  return { subject: fullSubject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendAlertEmail(subject: string, lines: string[]): Promise<void> {
  const smtp = loadSmtp();
  if (!smtp.host || !smtp.from || !smtp.to) {
    logger.debug("告警邮件未发送：SMTP 未完整配置");
    return;
  }
  const { subject: fullSubject, text, html } = buildAlertEmail(subject, lines);
  const cfg: SmtpConfig = {
    host: smtp.host,
    port: smtp.port,
    encryption: smtp.encryption,
    user: smtp.user,
    pass: smtp.pass,
    from: smtp.from,
  };
  try {
    await sendMail(cfg, { to: smtp.to, subject: fullSubject, text, html });
    logger.info(`告警邮件已发送: ${subject}`);
  } catch (e: any) {
    logger.warn(`告警邮件发送失败: ${e.message}`);
  }
}

// ── 来自审计模块的钩子 ────────────────────────────────────────────

export interface AuditAlertPayload {
  username: string;
  category: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
  success?: boolean;
}

export function notifyAlertOnAudit(entry: AuditAlertPayload): void {
  const rules = loadRules();
  const isLogin = entry.category === "auth" && entry.action.includes("登录");
  const success = entry.success !== false;

  if (isLogin && success) {
    const r = rules.find((x) => x.type === "auth_login_success");
    if (r?.enabled && !inCooldown(r.type, r.cooldownMin)) {
      markSent(r.type);
      void sendAlertEmail("用户登录成功", [
        `用户: ${entry.username}`,
        `来源 IP: ${entry.ip || "未知"}`,
        entry.detail ? `详情: ${entry.detail}` : "",
      ].filter(Boolean));
    }
    return;
  }

  if (isLogin && !success) {
    const r = rules.find((x) => x.type === "auth_login_failed");
    if (r?.enabled && !inCooldown(r.type, r.cooldownMin)) {
      markSent(r.type);
      void sendAlertEmail("用户登录失败", [
        `用户: ${entry.username}`,
        `来源 IP: ${entry.ip || "未知"}`,
        entry.detail ? `原因: ${entry.detail}` : "",
      ].filter(Boolean));
    }
    return;
  }

  if (isSensitive(entry.category, entry.action)) {
    const r = rules.find((x) => x.type === "sensitive_action");
    if (r?.enabled && !inCooldown(r.type, r.cooldownMin)) {
      markSent(r.type);
      void sendAlertEmail("敏感操作触发", [
        `用户: ${entry.username}`,
        `类别: ${entry.category}`,
        `操作: ${entry.action}`,
        entry.target ? `目标: ${entry.target}` : "",
        entry.detail ? `详情: ${entry.detail}` : "",
        `来源 IP: ${entry.ip || "未知"}`,
      ].filter(Boolean));
    }
  }
}

// ── 周期性指标检查 ────────────────────────────────────────────────

function checkMetrics(): void {
  const rules = loadRules();
  const metrics = getLocalMetrics();
  const latest = metrics[metrics.length - 1];
  const cpu = latest?.cpu ?? 0;
  const mem = getMemoryInfo();
  const memPct = mem.total > 0 ? Math.round((mem.used / mem.total) * 100) : 0;

  const cpuRule = rules.find((r) => r.type === "cpu_high");
  if (cpuRule?.enabled && typeof cpuRule.threshold === "number" && cpu >= cpuRule.threshold) {
    if (!inCooldown(cpuRule.type, cpuRule.cooldownMin)) {
      markSent(cpuRule.type);
      void sendAlertEmail("CPU 占用过高", [
        `当前 CPU 使用率: ${cpu}%`,
        `阈值: ${cpuRule.threshold}%`,
      ]);
    }
  }

  const memRule = rules.find((r) => r.type === "memory_high");
  if (memRule?.enabled && typeof memRule.threshold === "number" && memPct >= memRule.threshold) {
    if (!inCooldown(memRule.type, memRule.cooldownMin)) {
      markSent(memRule.type);
      const fmt = (b: number) => {
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.max(0, Math.min(Math.floor(Math.log(b || 1) / Math.log(k)), sizes.length - 1));
        return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
      };
      void sendAlertEmail("内存占用过高", [
        `当前内存使用率: ${memPct}%`,
        `已使用 / 总量: ${fmt(mem.used)} / ${fmt(mem.total)}`,
        `阈值: ${memRule.threshold}%`,
      ]);
    }
  }
}

let checkerTimer: ReturnType<typeof setInterval> | null = null;

export function startAlertChecker(intervalMs = 30_000): void {
  if (checkerTimer) return;
  checkerTimer = setInterval(() => {
    try {
      checkMetrics();
    } catch (e: any) {
      logger.debug(`告警检查异常: ${e.message}`);
    }
  }, intervalMs);
  logger.info(`告警检查器已启动 (间隔 ${Math.round(intervalMs / 1000)}s)`);
}

// ── 路由 ──────────────────────────────────────────────────────────

export const alertRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  .get("/api/alerts/settings", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };
    const smtp = loadSmtp();
    const rules = loadRules();
    return {
      success: true,
      smtp: maskSmtp(smtp),
      rules: rules.map((r) => ({ ...r, label: RULE_LABELS[r.type] })),
    };
  })

  .put(
    "/api/alerts/settings",
    ({ body, profile }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

      try {
        const incoming = body?.smtp || {};
        const current = loadSmtp();
        const updated: StoredSmtp = {
          host: typeof incoming.host === "string" ? incoming.host.trim() : current.host,
          port: Number.isFinite(incoming.port) ? Number(incoming.port) : current.port,
          encryption: ["ssl", "starttls", "none"].includes(incoming.encryption)
            ? incoming.encryption
            : current.encryption,
          user: typeof incoming.user === "string" ? incoming.user : current.user,
          // pass 为空字符串视为不修改；显式传 null 表示清空
          pass:
            incoming.pass === null
              ? ""
              : typeof incoming.pass === "string" && incoming.pass.length > 0
                ? incoming.pass
                : current.pass,
          from: typeof incoming.from === "string" ? incoming.from.trim() : current.from,
          to: typeof incoming.to === "string" ? incoming.to.trim() : current.to,
        };
        saveSmtp(updated);

        if (Array.isArray(body?.rules)) {
          const validTypes: AlertRuleType[] = [
            "auth_login_success",
            "auth_login_failed",
            "sensitive_action",
            "cpu_high",
            "memory_high",
          ];
          const sanitized: AlertRule[] = body.rules
            .filter((r: any) => r && validTypes.includes(r.type))
            .map((r: any) => ({
              type: r.type,
              enabled: !!r.enabled,
              threshold:
                typeof r.threshold === "number" && Number.isFinite(r.threshold)
                  ? Math.max(0, Math.min(100, Math.round(r.threshold)))
                  : undefined,
              cooldownMin:
                typeof r.cooldownMin === "number" && Number.isFinite(r.cooldownMin)
                  ? Math.max(0, Math.round(r.cooldownMin))
                  : 0,
            }));
          // 合并：缺失的规则保留默认
          const map = new Map<AlertRuleType, AlertRule>();
          for (const r of DEFAULT_RULES) map.set(r.type, { ...r });
          for (const r of sanitized) map.set(r.type, { ...map.get(r.type)!, ...r });
          saveRules(Array.from(map.values()));
        }

        return { success: true, message: "告警设置已保存" };
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    },
    {
      body: t.Object({
        smtp: t.Optional(t.Any()),
        rules: t.Optional(t.Any()),
      }),
    },
  )

  .post(
    "/api/alerts/test",
    async ({ body, profile }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

      try {
        const smtp = loadSmtp();
        // 允许前端临时覆盖（如未保存就测试）
        const override = body?.smtp || {};
        const merged: StoredSmtp = {
          host: typeof override.host === "string" && override.host ? override.host : smtp.host,
          port: Number.isFinite(override.port) ? Number(override.port) : smtp.port,
          encryption: ["ssl", "starttls", "none"].includes(override.encryption)
            ? override.encryption
            : smtp.encryption,
          user: typeof override.user === "string" ? override.user : smtp.user,
          pass:
            typeof override.pass === "string" && override.pass.length > 0
              ? override.pass
              : smtp.pass,
          from: typeof override.from === "string" && override.from ? override.from : smtp.from,
          to: typeof override.to === "string" && override.to ? override.to : smtp.to,
        };
        if (!merged.host || !merged.from || !merged.to) {
          return { success: false, message: "SMTP 主机 / 发件人 / 收件人 必填" };
        }

        const { subject, text, html } = buildAlertEmail("测试告警邮件", [
          "这是来自 CyrenePanel 的测试邮件。",
          "如果你收到此邮件，说明 SMTP 配置正确。",
        ]);
        await sendMail(
          {
            host: merged.host,
            port: merged.port,
            encryption: merged.encryption,
            user: merged.user,
            pass: merged.pass,
            from: merged.from,
          },
          { to: merged.to, subject, text, html },
        );
        return { success: true, message: "测试邮件发送成功" };
      } catch (e: any) {
        return { success: false, message: e?.message || "测试邮件发送失败" };
      }
    },
    {
      body: t.Object({
        smtp: t.Optional(t.Any()),
      }),
    },
  );
