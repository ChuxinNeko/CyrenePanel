import { Elysia, t } from "elysia";
import { compare } from "bcryptjs";
import { dbGetUser } from "../db";
import { logger } from "../logger/index";

export const accountRoutes = new Elysia()
  .post(
    "/api/login",
    async ({ body, jwt }: any) => {
      const user = dbGetUser(body.username);
      if (!user) {
        logger.warn(`用户 ${body.username} 登录失败：用户不存在`);
        return { success: false, message: "用户名或密码错误" };
      }

      const valid = await compare(body.password, user.password);
      if (!valid) {
        logger.warn(`用户 ${body.username} 登录失败：密码错误`);
        return { success: false, message: "用户名或密码错误" };
      }

      const token = await jwt.sign({ username: user.username, role: user.role });
      logger.debug(`用户 ${body.username} 登录成功，已返回 Token`);
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
    return { success: true, profile };
  });