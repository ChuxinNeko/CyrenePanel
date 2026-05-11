import { Elysia, t } from "elysia";
import { hashSync, compare } from "bcryptjs";
import { dbGetAllUsers, dbGetUser, dbInsertUser, dbUpdateUserPassword, dbDeleteUser, dbGetUserById } from "../db";
import { logger } from "../logger/index";
import { auditLog, getRequestIp } from "../audit/index";

export const userRoutes = new Elysia()
  // ── JWT 鉴权辅助 ──────────────────────────────────────────────────
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // ── 列出所有用户（仅 admin）──────────────────────────────────────
  .get("/api/users", async ({ profile }: any) => {
    if (!profile || profile.role !== "admin") {
      return { success: false, message: "无权限" };
    }
    const users = dbGetAllUsers();
    return { success: true, users };
  })

  // ── 创建用户（仅 admin）──────────────────────────────────────────
  .post(
    "/api/users",
    async ({ body, profile, request, server }: any) => {
      if (!profile || profile.role !== "admin") {
        return { success: false, message: "无权限" };
      }

      const existing = dbGetUser(body.username);
      if (existing) {
        return { success: false, message: "用户名已存在" };
      }

      const hashedPassword = hashSync(body.password, 10);
      const role = body.role || "user";
      dbInsertUser(body.username, hashedPassword, role);
      logger.info(`管理员 ${profile.username} 创建了用户 ${body.username} (${role})`);
      auditLog({
        username: profile.username,
        category: "user",
        action: "创建用户",
        target: body.username,
        detail: `角色: ${role}`,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "用户创建成功" };
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String(),
        role: t.Optional(t.String()),
      }),
    }
  )

  // ── 用户修改自己的密码（必须在 :id/password 之前）──────────────
  .patch(
    "/api/users/me/password",
    async ({ body, profile, request, server }: any) => {
      if (!profile) {
        return { success: false, message: "未授权" };
      }

      const user = dbGetUser(profile.username);
      if (!user) {
        return { success: false, message: "用户不存在" };
      }

      const valid = await compare(body.oldPassword, user.password);
      if (!valid) {
        return { success: false, message: "原密码错误" };
      }

      const hashedPassword = hashSync(body.newPassword, 10);
      dbUpdateUserPassword(user.id, hashedPassword);
      logger.info(`用户 ${profile.username} 修改了自己的密码`);
      auditLog({
        username: profile.username,
        category: "user",
        action: "修改密码",
        target: profile.username,
        detail: "本人修改",
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "密码修改成功" };
    },
    {
      body: t.Object({
        oldPassword: t.String(),
        newPassword: t.String(),
      }),
    }
  )

  // ── admin 修改任意用户密码 ───────────────────────────────────────
  .patch(
    "/api/users/:id/password",
    async ({ params, body, profile, request, server }: any) => {
      if (!profile || profile.role !== "admin") {
        return { success: false, message: "无权限" };
      }

      const userId = Number(params.id);
      const target = dbGetUserById(userId);
      if (!target) {
        return { success: false, message: "用户不存在" };
      }

      const hashedPassword = hashSync(body.password, 10);
      dbUpdateUserPassword(userId, hashedPassword);
      logger.info(`管理员 ${profile.username} 修改了用户 ${target.username} 的密码`);
      auditLog({
        username: profile.username,
        category: "user",
        action: "修改密码",
        target: target.username,
        detail: "管理员代为修改",
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "密码修改成功" };
    },
    {
      body: t.Object({
        password: t.String(),
      }),
    }
  )

  // ── 删除用户（仅 admin，不能删除自己）────────────────────────────
  .delete("/api/users/:id", async ({ params, profile, request, server }: any) => {
    if (!profile || profile.role !== "admin") {
      return { success: false, message: "无权限" };
    }

    const userId = Number(params.id);
    const target = dbGetUserById(userId);
    if (!target) {
      return { success: false, message: "用户不存在" };
    }

    if (target.username === profile.username) {
      return { success: false, message: "不能删除自己的账号" };
    }

    dbDeleteUser(userId);
    logger.info(`管理员 ${profile.username} 删除了用户 ${target.username}`);
    auditLog({
      username: profile.username,
      category: "user",
      action: "删除用户",
      target: target.username,
      ip: getRequestIp(request, server),
    });
    return { success: true, message: "用户已删除" };
  });