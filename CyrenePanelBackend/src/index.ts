import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const configPath = join(process.cwd(), "config.json");

let config = {
  username: "admin",
  password: ""
};

if (!existsSync(configPath)) {
  config.password = randomBytes(4).toString("hex"); // 8位随机密码
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n======================================`);
  console.log(`[INIT] 初始密码已生成并保存到 config.json`);
  console.log(`[INIT] 默认账号: ${config.username}`);
  console.log(`[INIT] 初始密码: ${config.password}`);
  console.log(`======================================\n`);
} else {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
}

export const app = new Elysia()
  .use(cors({
    origin: [
      'http://localhost:3000', 
      'http://127.0.0.1:3000', 
      process.env.FRONTEND_URL || ''
    ].filter(Boolean),
    credentials: true,
  }))
  .use(
    jwt({
      name: 'jwt',
      secret: 'super_secret_key_for_cyrene_panel_dev' // In production, use process.env.JWT_SECRET
    })
  )
  .post(
    "/api/login",
    async ({ body, jwt, cookie: { auth } }) => {
      if (body.username === config.username && body.password === config.password) {
        const token = await jwt.sign({ username: body.username });
        auth.set({
          value: token,
          httpOnly: true,
          maxAge: 7 * 86400,
          path: '/',
        });
        return { success: true, message: "Login successful" };
      }
      return { success: false, message: "Invalid credentials" };
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String()
      })
    }
  )
  .get("/api/me", async ({ jwt, cookie: { auth } }) => {
    const profile = await jwt.verify(auth.value);
    if (!profile) {
      return { success: false, message: "Unauthorized" };
    }
    return { success: true, profile };
  })
  .listen(5676);

export type App = typeof app;

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
