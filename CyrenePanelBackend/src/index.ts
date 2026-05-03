import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { logger, setLogLevel, getLogLevel, statusBadge } from "./logger/index";
import { accountRoutes } from "./account/index";
import { systemRoutes } from "./system/index";
import { fileRoutes } from "./files/index";

const configPath = join(process.cwd(), "config.json");

interface Config {
  username: string;
  password: string;
  logLevel: string;
}

export let config: Config = {
  username: "admin",
  password: "",
  logLevel: "INFO",
};

if (!existsSync(configPath)) {
  config.password = randomBytes(4).toString("hex"); // 8位随机密码
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  logger.info("初始密码已生成并保存到 config.json");
  logger.info(`默认账号: ${config.username}`);
  logger.warn(`初始密码: ${config.password}`);
} else {
  config = { ...config, ...JSON.parse(readFileSync(configPath, "utf-8")) };
}

setLogLevel(config.logLevel);
logger.info(`日志级别: ${config.logLevel}`);

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
      secret: process.env.JWT_SECRET || 'super_secret_key_for_cyrene_panel_dev'
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
      
      // 避免异步读取 response，防止干扰 Cookie
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
  .listen(5676);

export type App = typeof app;

logger.info(`Elysia is running at ${String(app.server?.hostname)}:${String(app.server?.port)}`);