import { Elysia, t } from "elysia";
import { config } from "../index";

export const accountRoutes = new Elysia()
  .post(
    "/api/login",
    async ({ body, jwt, cookie }: any) => {
      if (body.username === config.username && body.password === config.password) {
        const token = await jwt.sign({ username: body.username });
        cookie.auth.set({
          value: token,
          httpOnly: true,
          maxAge: 7 * 86400,
          path: '/',
        });
        return { success: true, message: "登录成功" };
      }
      return { success: false, message: "用户名或密码错误" };
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String()
      })
    }
  )
  .get("/api/me", async ({ jwt, cookie }: any) => {
    const profile = await jwt.verify(cookie.auth.value as string | undefined);
    if (!profile) {
      return { success: false, message: "未授权，请先登录" };
    }
    return { success: true, profile };
  });
