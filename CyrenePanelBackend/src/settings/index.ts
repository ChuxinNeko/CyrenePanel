import { Elysia, t } from "elysia";
import { setConfig, getAllConfig } from "../db";
import { logger } from "../logger/index";
import { randomBytes } from "crypto";

export const settingsRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // ── 获取所有设置 ──────────────────────────────────────────────────
  .get("/api/settings", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

    try {
      const allConfig = getAllConfig();
      return {
        success: true,
        settings: {
          // 通用设置
          panelName: allConfig["panelName"] || "CyrenePanel",
          logLevel: allConfig["logLevel"] || "INFO",
          // Docker 设置
          dockerMirrorEnabled: allConfig["docker_mirror_enabled"] === "true",
          dockerMirrorUrl: allConfig["docker_mirror_url"] || "",
          // API Key
          apiKey: allConfig["api_key"] || "",
          // 页脚设置
          footerCode: allConfig["footer_code"] || "",
        },
      };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 更新通用设置 ──────────────────────────────────────────────────
  .put(
    "/api/settings/general",
    async ({ body, profile }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

      try {
        const { panelName, logLevel } = body || {};
        if (typeof panelName === "string" && panelName.trim()) {
          setConfig("panelName", panelName.trim());
        }
        if (typeof logLevel === "string") {
          const validLevels = ["DEBUG", "INFO", "WARN", "ERROR"];
          if (validLevels.includes(logLevel.toUpperCase())) {
            setConfig("logLevel", logLevel.toUpperCase());
            logger.info(`日志级别已更新为: ${logLevel.toUpperCase()}`);
          }
        }
        return { success: true, message: "通用设置已保存" };
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    },
    {
      body: t.Object({
        panelName: t.Optional(t.String()),
        logLevel: t.Optional(t.String()),
      }),
    }
  )

  // ── 更新 Docker 设置 ──────────────────────────────────────────────
  .put(
    "/api/settings/docker",
    async ({ body, profile }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

      try {
        const { mirrorEnabled, mirrorUrl } = body || {};
        if (typeof mirrorEnabled === "boolean") {
          setConfig("docker_mirror_enabled", mirrorEnabled ? "true" : "false");
        }
        if (typeof mirrorUrl === "string") {
          setConfig("docker_mirror_url", mirrorUrl);
        }
        return { success: true, message: "Docker 设置已保存" };
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    },
    {
      body: t.Object({
        mirrorEnabled: t.Optional(t.Boolean()),
        mirrorUrl: t.Optional(t.String()),
      }),
    }
  )

  // ── 获取页脚代码（所有已登录用户可访问） ────────────────────────
  .get("/api/settings/footer", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    try {
      const footerCode = getAllConfig()["footer_code"] || "";
      return { success: true, code: footerCode };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 公开获取页脚代码（无需登录，用于登录页） ────────────────────
  .get("/api/public/footer", async () => {
    try {
      const footerCode = getAllConfig()["footer_code"] || "";
      const panelName = getAllConfig()["panelName"] || "CyrenePanel";
      return { success: true, code: footerCode, panelName };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 更新页脚代码设置 ──────────────────────────────────────────────
  .put(
    "/api/settings/footer",
    async ({ body, profile }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

      try {
        const { code } = body || {};
        if (typeof code === "string") {
          setConfig("footer_code", code);
        }
        return { success: true, message: "页脚设置已保存" };
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    },
    {
      body: t.Object({
        code: t.String(),
      }),
    }
  )

  // ── 重新生成 API Key ──────────────────────────────────────────────
  .post("/api/settings/regenerate-api-key", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

    try {
      const newKey = randomBytes(16).toString("hex");
      setConfig("api_key", newKey);
      logger.info(`管理员 ${profile.username} 重新生成了 API Key`);
      return { success: true, apiKey: newKey, message: "API Key 已重新生成" };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });