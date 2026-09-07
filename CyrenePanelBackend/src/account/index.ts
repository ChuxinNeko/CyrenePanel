import { Elysia, t } from "elysia";
import { compare } from "bcryptjs";
import { dbGetUser } from "../db";
import { logger } from "../logger/index";
import { CYRENE_VERSION } from "../version";
import { auditLog, getRequestIp } from "../audit/index";

// ── 登录频率限制 / 暴力破解防护 ───────────────────────────────────

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  lockedUntil: number;
}

// IP 级别：滑动窗口内最多 MAX_IP_ATTEMPTS 次尝试
const IP_WINDOW_MS = 15 * 60 * 1000; // 15 分钟窗口
const MAX_IP_ATTEMPTS = 20; // 窗口内最多 20 次
const IP_LOCKOUT_MS = 15 * 60 * 1000; // 超限后锁定 15 分钟

// 账号级别：连续失败 MAX_ACCOUNT_FAILURES 次后锁定
const MAX_ACCOUNT_FAILURES = 5;
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000; // 锁定 15 分钟

const ipRateLimit = new Map<string, RateLimitEntry>();
const accountRateLimit = new Map<string, RateLimitEntry>();

// 定期清理过期条目
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipRateLimit) {
    if (now > entry.lockedUntil && now - entry.firstAttempt > IP_WINDOW_MS) {
      ipRateLimit.delete(key);
    }
  }
  for (const [key, entry] of accountRateLimit) {
    if (now > entry.lockedUntil && now - entry.firstAttempt > ACCOUNT_LOCKOUT_MS) {
      accountRateLimit.delete(key);
    }
  }
}, 60_000);

function checkIpRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = ipRateLimit.get(ip);

  if (entry) {
    // 正在锁定中
    if (now < entry.lockedUntil) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - now };
    }
    // 窗口已过期，重置
    if (now - entry.firstAttempt > IP_WINDOW_MS) {
      ipRateLimit.set(ip, { attempts: 1, firstAttempt: now, lockedUntil: 0 });
      return { allowed: true };
    }
    // 窗口内累加
    entry.attempts++;
    if (entry.attempts > MAX_IP_ATTEMPTS) {
      entry.lockedUntil = now + IP_LOCKOUT_MS;
      logger.warn(`[安全] IP ${ip} 登录尝试过于频繁，已锁定 ${IP_LOCKOUT_MS / 60000} 分钟`);
      return { allowed: false, retryAfterMs: IP_LOCKOUT_MS };
    }
    return { allowed: true };
  }

  ipRateLimit.set(ip, { attempts: 1, firstAttempt: now, lockedUntil: 0 });
  return { allowed: true };
}

function checkAccountRateLimit(username: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = accountRateLimit.get(username);

  if (entry) {
    if (now < entry.lockedUntil) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - now };
    }
    // 锁定已过期，重置
    if (entry.lockedUntil > 0 && now >= entry.lockedUntil) {
      accountRateLimit.delete(username);
      return { allowed: true };
    }
  }
  return { allowed: true };
}

function recordAccountFailure(username: string): void {
  const now = Date.now();
  const entry = accountRateLimit.get(username);

  if (entry) {
    entry.attempts++;
    if (entry.attempts >= MAX_ACCOUNT_FAILURES) {
      entry.lockedUntil = now + ACCOUNT_LOCKOUT_MS;
      logger.warn(`[安全] 账号 ${username} 连续失败 ${entry.attempts} 次，已锁定 ${ACCOUNT_LOCKOUT_MS / 60000} 分钟`);
    }
  } else {
    accountRateLimit.set(username, { attempts: 1, firstAttempt: now, lockedUntil: 0 });
  }
}

function resetAccountFailure(username: string): void {
  accountRateLimit.delete(username);
}

export const accountRoutes = new Elysia()
  .post(
    "/api/login",
    async ({ body, jwt, request, server }: any) => {
      const ip = getRequestIp(request, server);

      // IP 频率限制检查
      const ipCheck = checkIpRateLimit(ip);
      if (!ipCheck.allowed) {
        const retryMin = Math.ceil((ipCheck.retryAfterMs || 0) / 60000);
        logger.warn(`[安全] IP ${ip} 登录被拒绝：频率限制中`);
        auditLog({
          username: body.username || "(unknown)",
          category: "auth",
          action: "登录被拒绝",
          target: body.username || "",
          detail: `IP 频率限制，${retryMin} 分钟后解除`,
          ip,
          success: false,
        });
        return { success: false, message: `登录尝试过于频繁，请 ${retryMin} 分钟后再试`, locked: true, retryAfterMs: ipCheck.retryAfterMs };
      }

      // 账号锁定检查
      const accountCheck = checkAccountRateLimit(body.username);
      if (!accountCheck.allowed) {
        const retryMin = Math.ceil((accountCheck.retryAfterMs || 0) / 60000);
        logger.warn(`[安全] 账号 ${body.username} 登录被拒绝：账号已锁定`);
        auditLog({
          username: body.username,
          category: "auth",
          action: "登录被拒绝",
          target: body.username,
          detail: `账号锁定，${retryMin} 分钟后解除`,
          ip,
          success: false,
        });
        return { success: false, message: `账号已被临时锁定，请 ${retryMin} 分钟后再试`, locked: true, retryAfterMs: accountCheck.retryAfterMs };
      }

      const user = dbGetUser(body.username);
      if (!user) {
        logger.warn(`用户 ${body.username} 登录失败：用户不存在`);
        recordAccountFailure(body.username);
        auditLog({
          username: body.username,
          category: "auth",
          action: "登录失败",
          target: body.username,
          detail: "用户不存在",
          ip,
          success: false,
        });
        return { success: false, message: "用户名或密码错误" };
      }

      const valid = await compare(body.password, user.password);
      if (!valid) {
        logger.warn(`用户 ${body.username} 登录失败：密码错误`);
        recordAccountFailure(body.username);
        auditLog({
          username: body.username,
          category: "auth",
          action: "登录失败",
          target: body.username,
          detail: "密码错误",
          ip,
          success: false,
        });
        return { success: false, message: "用户名或密码错误" };
      }

      // 登录成功，重置账号失败计数
      resetAccountFailure(body.username);

      const token = await jwt.sign({ username: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + 86400 });
      logger.debug(`用户 ${body.username} 登录成功，已返回 Token`);
      auditLog({
        username: user.username,
        category: "auth",
        action: "登录成功",
        target: user.username,
        ip,
      });
      return { success: true, message: "登录成功", token };
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String()
      })
    }
  )
  .get("/api/me", async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    if (!token) {
      logger.debug("GET /api/me | 未找到 Authorization header");
      return { success: false, message: "未授权，请先登录" };
    }

    const profile = await jwt.verify(token);
    if (!profile) {
      logger.warn("GET /api/me | JWT 验证失败");
      return { success: false, message: "未授权，请先登录" };
    }

    logger.debug(`GET /api/me | 鉴权成功: ${profile.username}`);
    return { success: true, profile, version: CYRENE_VERSION };
  });