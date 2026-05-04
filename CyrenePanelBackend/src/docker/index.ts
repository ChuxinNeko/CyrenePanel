import { Elysia } from "elysia";
import { logger } from "../logger/index";
import { storeApps } from "./store";
import { getConfig, setConfig } from "../db";

// ── Docker 镜像仓库镜像辅助 ───────────────────────────────────────

function getMirrorImage(image: string): string {
  const mirrorUrl = getConfig("docker_mirror_url");
  const mirrorEnabled = getConfig("docker_mirror_enabled") === "true";
  if (!mirrorEnabled || !mirrorUrl) return image;
  const host = mirrorUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const cleanImage = image.replace(/^docker\.io\//, "");
  return `${host}/${cleanImage}`;
}

// ── Docker CLI 辅助 ────────────────────────────────────────────────

async function docker(args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(["docker", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(stderr.trim() || `docker 命令失败，退出码: ${exitCode}`);
    }
    return stdout;
  } catch (e: any) {
    if (e.message?.includes("docker")) throw e;
    throw new Error("Docker 不可用: " + (e.message || "未知错误"));
  }
}

async function dockerJson(args: string[]): Promise<any> {
  const out = await docker(args);
  return JSON.parse(out);
}

// 流式读取 docker 命令输出，每行回调
async function dockerStream(
  args: string[],
  onLine: (line: string) => void,
): Promise<number> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  }
  if (buffer.trim()) onLine(buffer);

  return await proc.exited;
}

// ── 容器列表 ────────────────────────────────────────────────────────

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: { publicPort?: number; privatePort: number; type: string }[];
  created: string;
  startedAt?: string;
}

async function listContainers(all: boolean): Promise<DockerContainer[]> {
  const raw = await docker([
    "ps",
    all ? "--all" : "",
    '--format={"ID":"{{.ID}}","Name":"{{.Names}}","Image":"{{.Image}}","State":"{{.State}}","Status":"{{.Status}}","Ports":"{{.Ports}}","CreatedAt":"{{.CreatedAt}}"}',
  ].filter(Boolean));

  // docker ps --format 输出每行一个 JSON 对象，不是合法 JSON 数组
  const lines = raw.trim().split("\n").filter((l: string) => l.trim());
  const containers: DockerContainer[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      // 解析端口映射: "0.0.0.0:8080->80/tcp, :::8080->80/tcp"
      const ports: DockerContainer["ports"] = [];
      if (obj.Ports && obj.Ports !== "") {
        const portMappings = obj.Ports.split(",").map((s: string) => s.trim());
        // 去重：用 privatePort 和 type 去重
        const seen = new Set<string>();
        for (const mapping of portMappings) {
          const match = mapping.match(/(?::(\d+)->)?(\d+)\/(\w+)/);
          if (match) {
            const publicPort = match[1] ? parseInt(match[1]) : undefined;
            const privatePort = parseInt(match[2]);
            const type = match[3];
            const key = `${privatePort}/${type}`;
            if (!seen.has(key)) {
              seen.add(key);
              ports.push({ publicPort, privatePort, type });
            }
          }
        }
      }

      containers.push({
        id: obj.ID,
        name: obj.Name,
        image: obj.Image,
        state: obj.State,
        status: obj.Status,
        ports,
        created: obj.CreatedAt,
      });
    } catch {
      // 跳过无法解析的行
    }
  }

  return containers;
}

// ── 容器详情 ────────────────────────────────────────────────────────

async function inspectContainer(id: string): Promise<any> {
  const [data] = await dockerJson(["inspect", id]);
  return {
    id: data.Id,
    name: (data.Name || "").replace(/^\//, ""),
    image: data.Config?.Image,
    state: data.State?.Status,
    startedAt: data.State?.StartedAt,
    finishedAt: data.State?.FinishedAt,
    exitCode: data.State?.ExitCode,
    ports: Object.entries(data.NetworkSettings?.Ports || {}).map(([k, v]: [string, any]) => {
      const [privatePort, type] = k.split("/");
      const bindings = (v || []).map((b: any) => ({
        hostIp: b.HostIp,
        hostPort: b.HostPort ? parseInt(b.HostPort) : undefined,
      }));
      return { privatePort: parseInt(privatePort), type, bindings };
    }),
    mounts: (data.Mounts || []).map((m: any) => ({
      type: m.Type,
      source: m.Source,
      destination: m.Destination,
      mode: m.Mode,
    })),
    env: (data.Config?.Env || []),
    cmd: data.Config?.Cmd,
    created: data.Created,
    platform: data.Platform,
  };
}

// ── 镜像列表 ────────────────────────────────────────────────────────

async function listImages(): Promise<any[]> {
  const raw = await dockerJson([
    "images",
    '--format={"ID":"{{.ID}}","Repository":"{{.Repository}}","Tag":"{{.Tag}}","Size":"{{.Size}}","CreatedAt":"{{.CreatedAt}}"}',
  ]);
  const lines = raw.trim().split("\n").filter((l: string) => l.trim());
  return lines.map((line: string) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// ── 系统信息 ────────────────────────────────────────────────────────

async function getDockerInfo(): Promise<any> {
  const info = await dockerJson(["info", "--format={{json .}}"]);
  return {
    containers: info.Containers ?? 0,
    containersRunning: info.ContainersRunning ?? 0,
    containersPaused: info.ContainersPaused ?? 0,
    containersStopped: info.ContainersStopped ?? 0,
    images: info.Images ?? 0,
    serverVersion: info.ServerVersion ?? "",
    operatingSystem: info.OperatingSystem ?? "",
    ostype: info.OSType ?? "",
  };
}

// ── 路由 ────────────────────────────────────────────────────────────

export const dockerRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // ── Docker 信息 ───────────────────────────────────────────────────
  .get("/api/docker/info", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const info = await getDockerInfo();
      return { success: true, info };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 容器列表 ──────────────────────────────────────────────────────
  .get("/api/docker/containers", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const all = query?.all === "true";
      const containers = await listContainers(all);
      return { success: true, containers };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 容器详情 ──────────────────────────────────────────────────────
  .get("/api/docker/containers/:id", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const container = await inspectContainer(params.id);
      return { success: true, container };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 启动容器 ──────────────────────────────────────────────────────
  .post("/api/docker/containers/:id/start", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      await docker(["start", params.id]);
      return { success: true, message: "容器已启动" };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 停止容器 ──────────────────────────────────────────────────────
  .post("/api/docker/containers/:id/stop", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      await docker(["stop", params.id]);
      return { success: true, message: "容器已停止" };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 重启容器 ──────────────────────────────────────────────────────
  .post("/api/docker/containers/:id/restart", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      await docker(["restart", params.id]);
      return { success: true, message: "容器已重启" };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 删除容器 ──────────────────────────────────────────────────────
  .delete("/api/docker/containers/:id", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const force = query?.force === "true";
      const args = force ? ["rm", "-f", params.id] : ["rm", params.id];
      await docker(args);
      return { success: true, message: "容器已删除" };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 容器日志 ──────────────────────────────────────────────────────
  .get("/api/docker/containers/:id/logs", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const tail = query?.tail || "200";
      const args = ["logs", "--tail", tail];
      if (query?.timestamps === "true") args.push("--timestamps");
      args.push(params.id);
      const logs = await docker(args);
      return { success: true, logs };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 镜像列表 ──────────────────────────────────────────────────────
  .get("/api/docker/images", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const images = await listImages();
      return { success: true, images };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  // ── 应用商店 ──────────────────────────────────────────────────────
  .get("/api/docker/store", async ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const category = query?.category;
      const apps = category
        ? storeApps.filter((a) => a.category === category)
        : storeApps;
      return { success: true, apps };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  .get("/api/docker/store/:id", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const app = storeApps.find((a) => a.id === params.id);
      if (!app) return { success: false, message: "应用不存在" };
      return { success: true, app };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  .post("/api/docker/store/deploy", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const {
        appId,
        name,
        ports,
        volumes,
        env,
        restart,
        networkMode,
      }: {
        appId: string;
        name: string;
        ports?: { hostPort: number; containerPort: number; protocol: string }[];
        volumes?: { host: string; container: string }[];
        env?: { name: string; value: string }[];
        restart?: string;
        networkMode?: string;
      } = body;

      if (!appId || !name) {
        return { success: false, message: "缺少必填参数: appId, name" };
      }

      const app = storeApps.find((a) => a.id === appId);
      if (!app) {
        return { success: false, message: "应用不存在" };
      }

      // 1. 拉取镜像（支持镜像仓库镜像）
      const pullImage = getMirrorImage(app.image);
      logger.info(`[AppStore] 拉取镜像: ${pullImage}${pullImage !== app.image ? ` (原始: ${app.image})` : ""}`);
      await docker(["pull", pullImage]);

      // 如果使用了镜像，将镜像打回原始标签
      if (pullImage !== app.image) {
        await docker(["tag", pullImage, app.image]);
        logger.info(`[AppStore] 已标记镜像: ${pullImage} -> ${app.image}`);
      }

      // 2. 构建 docker run 参数
      const args: string[] = ["run", "-d", "--name", name];

      // 端口映射
      if (ports && ports.length > 0) {
        for (const p of ports) {
          if (p.hostPort && p.containerPort) {
            args.push("-p", `${p.hostPort}:${p.containerPort}/${p.protocol || "tcp"}`);
          }
        }
      }

      // 卷挂载
      if (volumes && volumes.length > 0) {
        for (const v of volumes) {
          if (v.host && v.container) {
            args.push("-v", `${v.host}:${v.container}`);
          }
        }
      }

      // 环境变量
      if (env && env.length > 0) {
        for (const e of env) {
          if (e.name) {
            args.push("-e", `${e.name}=${e.value || ""}`);
          }
        }
      }

      // 重启策略
      if (restart) {
        args.push("--restart", restart);
      }

      // 网络模式
      if (networkMode) {
        args.push("--network", networkMode);
      }

      args.push(app.image);

      logger.info(`[AppStore] 创建容器: docker ${args.join(" ")}`);
      const result = await docker(args);

      return { success: true, message: "部署成功", containerId: result.trim() };
    } catch (e: any) {
      logger.err(`[AppStore] 部署失败: ${e.message}`);
      return { success: false, message: e.message };
    }
  })

  // ── 流式部署（SSE，实时显示 pull 进度） ────────────────────────
  .post("/api/docker/store/deploy-stream", async ({ body, profile }: any) => {
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const {
      appId,
      name,
      ports,
      volumes,
      env,
      restart,
      networkMode,
    } = body || {};

    if (!appId || !name) {
      return new Response(JSON.stringify({ success: false, message: "缺少必填参数: appId, name" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const app = storeApps.find((a) => a.id === appId);
    if (!app) {
      return new Response(JSON.stringify({ success: false, message: "应用不存在" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const pullImage = getMirrorImage(app.image);
    const needTag = pullImage !== app.image;

    // 构建 docker run 参数
    const runArgs: string[] = ["run", "-d", "--name", name];
    if (ports && ports.length > 0) {
      for (const p of ports) {
        if (p.hostPort && p.containerPort) {
          runArgs.push("-p", `${p.hostPort}:${p.containerPort}/${p.protocol || "tcp"}`);
        }
      }
    }
    if (volumes && volumes.length > 0) {
      for (const v of volumes) {
        if (v.host && v.container) runArgs.push("-v", `${v.host}:${v.container}`);
      }
    }
    if (env && env.length > 0) {
      for (const e of env) {
        if (e.name) runArgs.push("-e", `${e.name}=${e.value || ""}`);
      }
    }
    if (restart) runArgs.push("--restart", restart);
    if (networkMode) runArgs.push("--network", networkMode);
    runArgs.push(app.image);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // 阶段 1: 拉取镜像
          send({ type: "stage", stage: "pull", message: `正在拉取镜像 ${pullImage}...` });

          const pullExitCode = await dockerStream(["pull", pullImage], (line) => {
            // 解析 docker pull 的典型输出行
            const trimmed = line.trim();
            if (!trimmed) return;

            // 匹配: "abcdef123456: Downloading [====>    ] 12.3MB/45.6MB"
            const downloading = trimmed.match(
              /^([\da-f]+):\s*(Downloading|Extracting|Waiting)\s*\[?.*?\]?\s*(.+)$/i,
            );
            if (downloading) {
              send({
                type: "progress",
                layer: downloading[1].slice(0, 12),
                status: downloading[2].toLowerCase(),
                detail: downloading[3].trim(),
              });
              return;
            }

            // 匹配: "abcdef123456: Pull complete" / "Already exists" 等
            const statusMatch = trimmed.match(/^([\da-f]+):\s*(.+)$/i);
            if (statusMatch) {
              send({
                type: "progress",
                layer: statusMatch[1].slice(0, 12),
                status: "info",
                detail: statusMatch[2].trim(),
              });
              return;
            }

            // 匹配: "Status: ..." 或 "Digest: ..."
            if (/^(Status|Digest):/i.test(trimmed)) {
              send({ type: "progress", layer: "", status: "info", detail: trimmed });
              return;
            }

            // 其他输出（如 "latest: Pulling from ..."）
            send({ type: "progress", layer: "", status: "info", detail: trimmed });
          });

          if (pullExitCode !== 0) {
            send({ type: "error", message: `镜像拉取失败 (退出码 ${pullExitCode})` });
            controller.close();
            return;
          }

          // 阶段 2: 标记镜像（如果需要）
          if (needTag) {
            send({ type: "stage", stage: "tag", message: `标记镜像 ${pullImage} → ${app.image}` });
            await docker(["tag", pullImage, app.image]);
          }

          // 阶段 3: 运行容器
          send({ type: "stage", stage: "run", message: "正在创建并启动容器..." });
          logger.info(`[AppStore SSE] 创建容器: docker ${runArgs.join(" ")}`);
          const runResult = await docker(runArgs);

          send({ type: "done", containerId: runResult.trim(), message: "部署成功" });
        } catch (e: any) {
          logger.err(`[AppStore SSE] 部署失败: ${e.message}`);
          send({ type: "error", message: e.message });
        } finally {
          controller.close();
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
  })

  // ── Docker 设置 ──────────────────────────────────────────────────
  .get("/api/docker/settings", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const mirrorEnabled = getConfig("docker_mirror_enabled") === "true";
      const mirrorUrl = getConfig("docker_mirror_url") || "";
      return {
        success: true,
        settings: { mirrorEnabled, mirrorUrl },
      };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  })

  .put("/api/docker/settings", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    try {
      const { mirrorEnabled, mirrorUrl } = body || {};
      if (typeof mirrorEnabled === "boolean") {
        setConfig("docker_mirror_enabled", mirrorEnabled ? "true" : "false");
      }
      if (typeof mirrorUrl === "string") {
        setConfig("docker_mirror_url", mirrorUrl);
      }
      return { success: true, message: "设置已保存" };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });