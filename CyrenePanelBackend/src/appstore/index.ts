import { Elysia } from "elysia";
import { logger } from "../logger/index";
import { dbGetNode } from "../db";
import { fetchNode } from "../nodes/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { gameApps } from "./store";
import { createInstance } from "../instances/store";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { open, rename, unlink } from "fs/promises";
import { join } from "path";

interface DeployProgressEvent {
  type: "stage" | "progress" | "done" | "error";
  message?: string;
  stage?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytes?: number;
}

function createSseResponse(run: (send: (event: DeployProgressEvent) => void) => Promise<void>) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: DeployProgressEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await run(send);
      } catch (error: any) {
        logger.err(`部署游戏服务器失败: ${error.message}`);
        send({ type: "error", message: `部署失败: ${error.message}` });
      } finally {
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 1 ? 0 : 1)} ${units[exponent - 1]}`;
}

async function downloadFile(
  url: string,
  targetPath: string,
  send: (event: DeployProgressEvent) => void,
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);
  if (!response.body) throw new Error("下载响应不包含文件内容");

  const total = Number(response.headers.get("content-length"));
  const totalBytes = Number.isFinite(total) && total > 0 ? total : undefined;
  const temporaryPath = `${targetPath}.download`;
  const file = await open(temporaryPath, "w");
  const reader = response.body.getReader();
  const startedAt = performance.now();
  let lastReportAt = startedAt;
  let lastReportedBytes = 0;
  let downloadedBytes = 0;

  const report = (now: number, force = false) => {
    if (!force && now - lastReportAt < 300) return;
    const elapsedSeconds = Math.max((now - lastReportAt) / 1000, 0.001);
    const speedBytes = (downloadedBytes - lastReportedBytes) / elapsedSeconds;
    const progress = totalBytes ? ` ${Math.floor((downloadedBytes / totalBytes) * 100)}%` : "";
    send({
      type: "progress",
      stage: "download",
      downloadedBytes,
      totalBytes,
      speedBytes,
      message: `正在下载服务端文件: ${formatBytes(downloadedBytes)}${totalBytes ? ` / ${formatBytes(totalBytes)}` : ""}，${formatBytes(speedBytes)}/s${progress}`,
    });
    lastReportAt = now;
    lastReportedBytes = downloadedBytes;
  };

  try {
    send({
      type: "stage",
      stage: "download",
      message: `正在下载服务端文件${totalBytes ? `，文件大小 ${formatBytes(totalBytes)}` : ""}...`,
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await file.write(value);
      downloadedBytes += value.byteLength;
      report(performance.now());
    }

    report(performance.now(), true);
    await file.close();
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export const appstoreRoutes = new Elysia()
  .resolve(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // 获取游戏广场模板
  .get("/api/appstore/games", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return { success: true, games: gameApps };
  })

  // 部署游戏服务端，并以 SSE 持续返回准备、下载和实例创建状态。
  .post("/api/appstore/deploy-stream", async ({ body, profile }: any) => {
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { gameId, name, cwd, nodeId } = body || {};
    if (!gameId || !name || !cwd) {
      return new Response(JSON.stringify({ success: false, message: "缺少必要参数: gameId, name, cwd" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const game = gameApps.find((item) => item.id === gameId);
    if (!game) {
      return new Response(JSON.stringify({ success: false, message: "未找到该游戏模板" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (nodeId && nodeId !== "__main__") {
      const node = dbGetNode(nodeId);
      if (!node) {
        return new Response(JSON.stringify({ success: false, message: "节点不存在" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const response = await fetchNode(node, "/api/appstore/deploy-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId, name, cwd, nodeId: "__main__", nodeName: node.name }),
        }, 5 * 60_000);

        if (!response.ok || !response.body) {
          const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
          throw new Error(error.message || `HTTP ${response.status}`);
        }

        return new Response(response.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      } catch (error: any) {
        logger.err(`子节点部署游戏代理失败: ${error.message}`);
        return new Response(JSON.stringify({ success: false, message: `子节点请求失败: ${error.message}` }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return createSseResponse(async (send) => {
      const targetNodeName = body.nodeName || "主节点";
      send({ type: "stage", stage: "prepare", message: "正在准备部署目录..." });
      if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });

      let finalDownloadUrl = game.downloadUrl;
      if (game.type === "minecraft-paper") {
        const version = game.id.match(/mc-paper-([\d.]+)/)?.[1];
        if (!version) throw new Error("无法解析 Paper 版本号");

        send({ type: "stage", stage: "resolve", message: `正在获取 Paper ${version} 的最新构建...` });
        const buildsResponse = await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`, {
          headers: { "User-Agent": "CyrenePanel/1.0.0" },
        });
        if (!buildsResponse.ok) throw new Error(`获取 Paper 构建信息失败: HTTP ${buildsResponse.status}`);

        const builds = await buildsResponse.json();
        const latestBuild = Array.isArray(builds) && builds.length > 0 ? builds[builds.length - 1] : null;
        finalDownloadUrl = latestBuild?.downloads?.["server:default"]?.url;
        if (!finalDownloadUrl) throw new Error("Paper 构建信息中没有可下载的服务端文件");
      }

      if (finalDownloadUrl) {
        const serverJarPath = join(cwd, "server.jar");
        if (existsSync(serverJarPath)) {
          send({ type: "stage", stage: "download", message: "已存在 server.jar，跳过下载。" });
        } else {
          logger.info(`正在下载服务端文件: ${finalDownloadUrl}`);
          await downloadFile(finalDownloadUrl, serverJarPath, send);
        }
      }

      if (game.type.startsWith("minecraft-")) {
        const eulaPath = join(cwd, "eula.txt");
        if (!existsSync(eulaPath)) writeFileSync(eulaPath, "eula=true\n");
      }

      send({ type: "stage", stage: "create", message: "正在创建实例..." });
      const instance = createInstance({
        name,
        command: game.defaultCommand,
        cwd,
        env: game.defaultEnv,
        autoRestart: false,
        nodeId: "__main__",
        nodeName: targetNodeName,
      });

      send({ type: "done", message: "部署成功，实例已创建。" });
      logger.info(`游戏服务端部署完成: ${instance.name}`);
    });
  });
