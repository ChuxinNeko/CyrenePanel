import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { randomBytes } from "crypto";
import { hashSync } from "bcryptjs";
import { logger, setLogLevel, getLogLevel, statusBadge } from "./logger/index";
import { accountRoutes } from "./account/index";
import { systemRoutes } from "./system/index";
import { fileRoutes } from "./files/index";
import { instanceRoutes } from "./instances/index";
import { instanceWsRoutes } from "./instances/ws";
import { userRoutes } from "./users/index";
import { loadStore } from "./instances/store";
import { getConfig, setConfig, dbUserCount, dbGetUser, dbInsertUser } from "./db";
import { nodeRoutes } from "./nodes/index";
import { dockerRoutes } from "./docker/index";
import { terminalRoutes } from "./terminal/index";
import { settingsRoutes } from "./settings/index";
import { serviceRoutes } from "./services/index";
import { environmentRoutes } from "./environments/index";
import { siteRoutes } from "./sites/index";
import { certificateRoutes } from "./certificates/index";
import { selfCheckRoutes } from "./self-check/index";
import { auditRoutes, setAuditAlertHook } from "./audit/index";
import { alertRoutes, notifyAlertOnAudit, startAlertChecker } from "./alerts/index";
import { securityRoutes } from "./security/index";
import { databaseRoutes } from "./database/index";
import { mysqlManageRoutes } from "./database/mysql/index";
import { aiRoutes } from "./ai/index";

// ── 初始化 JWT Secret（持久化到数据库） ───────────────────────────

function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const existing = getConfig("jwt_secret");
  if (existing) return existing;
  const generated = randomBytes(32).toString("hex");
  setConfig("jwt_secret", generated);
  logger.info("已自动生成并持久化 JWT Secret");
  return generated;
}

const JWT_SECRET = getJwtSecret();

// ── 初始化 admin 账号（首次启动） ──────────────────────────────────

if (dbUserCount() === 0) {
  const password = randomBytes(4).toString("hex");
  const hashedPassword = hashSync(password, 10);
  dbInsertUser("admin", hashedPassword, "admin");
  logger.info("已自动创建管理员账号");
  logger.info("默认账号: admin");
  logger.warn(`初始密码: ${password}`);
}

// ── 初始化 API key（首次启动） ─────────────────────────────────────

if (!getConfig("api_key")) {
  const apiKey = randomBytes(16).toString("hex");
  setConfig("api_key", apiKey);
  logger.info("已自动生成 API key");
  logger.warn(`API Key: ${apiKey}`);
}

// ── 日志级别 ───────────────────────────────────────────────────────

const logLevel = getConfig("logLevel") || "INFO";
setLogLevel(logLevel);
logger.info(`日志级别: ${logLevel}`);

// ── 加载实例配置 ───────────────────────────────────────────────────

loadStore();

const requestTimings = new WeakMap<Request, number>();

export const app = new Elysia()
  .use(cors({
    origin: (request) => {
      const origin = request.headers.get('origin');
      if (!origin) return true;
      const allowedOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        process.env.FRONTEND_URL
      ].filter(Boolean);
      return allowedOrigins.includes(origin);
    },
    allowedHeaders: ['content-type', 'authorization'],
  }))
  .use(
    jwt({
      name: 'jwt',
      secret: JWT_SECRET
    })
  )
  .onRequest(({ request }) => {
    requestTimings.set(request, performance.now());
  })
  .onAfterHandle((ctx: any) => {
    const { request, set, server, body: reqBody, response } = ctx;
    const method = request.method;
    const url = new URL(request.url);
    const status = (set as any).status ?? 200;
    const start = requestTimings.get(request) ?? performance.now();
    const ms = (performance.now() - start).toFixed(1);
    requestTimings.delete(request);

    if (getLogLevel() === "DEBUG") {
      const ip = server?.requestIP(request)?.address
        || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || request.headers.get("x-real-ip")
        || "unknown";
      
      const req = reqBody !== undefined ? JSON.stringify(reqBody) : "(none)";
      
      let resStr = "(body hidden in logs to prevent issues)";
      if (typeof response === 'object' && response !== null) {
        try {
          const s = JSON.stringify(response);
          resStr = s.length > 200 ? s.slice(0, 200) + "..." : s;
        } catch { resStr = "(unserializable)"; }
      }

      logger.debug(`${method} ${url.pathname} | ${statusBadge(status)} | ${ms}ms | IP: ${ip} | Body: ${req} | Res: ${resStr}`);
    } else {
      logger.info(`${method} ${url.pathname} | ${statusBadge(status)} | ${ms}ms`);
    }
  })
  .use(accountRoutes)
  .use(systemRoutes)
  .use(fileRoutes)
  .use(instanceRoutes)
  .use(instanceWsRoutes)
  .use(userRoutes)
  .use(nodeRoutes)
  .use(dockerRoutes)
  .use(terminalRoutes)
  .use(settingsRoutes)
  .use(serviceRoutes)
  .use(environmentRoutes)
  .use(siteRoutes)
  .use(certificateRoutes)
  .use(selfCheckRoutes)
  .use(auditRoutes)
  .use(alertRoutes)
  .use(securityRoutes)
  .use(databaseRoutes)
  .use(mysqlManageRoutes)
  .use(aiRoutes)
  .listen({ port: Number(process.env.PORT || 5677), hostname: "0.0.0.0" });

setAuditAlertHook(notifyAlertOnAudit);
startAlertChecker();

export type App = typeof app;

logger.info(`Elysia is running at ${String(app.server?.hostname)}:${String(app.server?.port)}`);
