/**
 * Docker Compose 容器编排管理
 *
 * 与 index.ts 中一次性的 compose/deploy-stream 不同（那个把 YAML 写到临时目录、
 * 部署完就删，之后无法再从面板管理），这里把每个项目持久化到
 * <DATA_DIR>/compose/<project>/docker-compose.yml，因此可以列表、编辑、
 * 重新部署、停止、查看日志。
 *
 * 同时也会识别不是面板创建、但已在这台机器上运行的 compose 项目
 * （docker compose ls 能看到），只是这类项目没有面板托管的文件，
 * 仅提供状态查看与启停。
 */

import { Elysia } from "elysia";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { logger } from "../logger/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { DATA_DIR } from "../runtime-paths";
import { docker, dockerJson, dockerStream, guard } from "./cli";

const COMPOSE_ROOT = join(DATA_DIR, "compose");

/** 项目名限制：docker compose 本身也只接受小写字母数字和 _ - */
const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

function validateProjectName(name: string): string | null {
  if (!name) return "项目名称不能为空";
  if (!PROJECT_NAME_RE.test(name)) {
    return "项目名称只能包含小写字母、数字、下划线和短横线，且必须以字母或数字开头";
  }
  if (name.length > 64) return "项目名称过长";
  return null;
}

/**
 * 解析项目目录并确认它没有跳出 COMPOSE_ROOT。
 * 名称已经过白名单校验，这里是第二道防线。
 */
function projectDir(name: string): string {
  const dir = resolve(join(COMPOSE_ROOT, name));
  if (!dir.startsWith(resolve(COMPOSE_ROOT))) {
    throw new Error("非法的项目路径");
  }
  return dir;
}

function composeFilePath(name: string): string {
  return join(projectDir(name), "docker-compose.yml");
}

interface ComposeProject {
  name: string;
  /** 面板托管（有本地 YAML 文件）还是仅从 docker 发现 */
  managed: boolean;
  status: string;
  configFiles: string;
  serviceCount: number;
  runningCount: number;
  updatedAt: string;
}

/** docker compose ls 看到的项目（含未被面板托管的） */
async function listRunningProjects(): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  try {
    const rows = await dockerJson<any[]>(["compose", "ls", "--all", "--format=json"]);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.Name) map.set(row.Name, row);
    }
  } catch {
    // compose 插件未安装时忽略
  }
  return map;
}

/** 统计项目内服务数与运行中数量 */
async function projectServiceCounts(name: string): Promise<{ total: number; running: number }> {
  try {
    const out = await docker(["compose", "-p", name, "ps", "--all", "--format=json"]);
    // 不同版本可能返回 JSON 数组或每行一个对象，两种都兼容
    const trimmed = out.trim();
    if (!trimmed) return { total: 0, running: 0 };

    let rows: any[] = [];
    if (trimmed.startsWith("[")) {
      rows = JSON.parse(trimmed);
    } else {
      for (const line of trimmed.split("\n")) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line));
        } catch {
          // 跳过
        }
      }
    }

    return {
      total: rows.length,
      running: rows.filter((r) => String(r.State || "").toLowerCase() === "running").length,
    };
  } catch {
    return { total: 0, running: 0 };
  }
}

async function listProjects(): Promise<ComposeProject[]> {
  await mkdir(COMPOSE_ROOT, { recursive: true });

  const running = await listRunningProjects();
  const projects = new Map<string, ComposeProject>();

  // 面板托管的项目
  const entries = await readdir(COMPOSE_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!existsSync(composeFilePath(name))) continue;

    const info = running.get(name);
    const counts = await projectServiceCounts(name);
    projects.set(name, {
      name,
      managed: true,
      status: info?.Status || (counts.running > 0 ? "running" : "stopped"),
      configFiles: composeFilePath(name),
      serviceCount: counts.total,
      runningCount: counts.running,
      updatedAt: "",
    });
  }

  // docker 里存在但面板没有托管文件的项目
  for (const [name, info] of running) {
    if (projects.has(name)) continue;
    const counts = await projectServiceCounts(name);
    projects.set(name, {
      name,
      managed: false,
      status: info?.Status || "",
      configFiles: info?.ConfigFiles || "",
      serviceCount: counts.total,
      runningCount: counts.running,
      updatedAt: "",
    });
  }

  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 构造 compose 命令参数：托管项目指定 -f，未托管的只按项目名操作 */
async function composeArgs(name: string, rest: string[]): Promise<string[]> {
  const file = composeFilePath(name);
  if (existsSync(file)) {
    return ["compose", "-f", file, "-p", name, ...rest];
  }
  return ["compose", "-p", name, ...rest];
}

export const dockerComposeRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 项目列表 ──────────────────────────────────────────────────────
  .get("/api/docker/compose/projects", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("列出编排项目", async () => ({
      success: true as const,
      projects: await listProjects(),
    }));
  })

  // ── 项目详情（含 YAML 与服务列表）────────────────────────────────
  .get("/api/docker/compose/projects/:name", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const error = validateProjectName(params.name);
    if (error) return { success: false, message: error };

    return guard("获取编排项目详情", async () => {
      const file = composeFilePath(params.name);
      const managed = existsSync(file);
      const content = managed ? await readFile(file, "utf-8") : "";

      let services: any[] = [];
      try {
        const out = await docker(await composeArgs(params.name, ["ps", "--all", "--format=json"]));
        const trimmed = out.trim();
        if (trimmed) {
          const rows = trimmed.startsWith("[")
            ? JSON.parse(trimmed)
            : trimmed
                .split("\n")
                .filter((l) => l.trim())
                .map((l) => {
                  try {
                    return JSON.parse(l);
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean);
          services = rows.map((r: any) => ({
            name: r.Name || r.Service || "",
            service: r.Service || "",
            image: r.Image || "",
            state: r.State || "",
            status: r.Status || "",
            health: r.Health || "",
            ports: r.Publishers
              ? (r.Publishers as any[])
                  .filter((p) => p.PublishedPort)
                  .map((p) => `${p.PublishedPort}:${p.TargetPort}/${p.Protocol}`)
              : [],
          }));
        }
      } catch {
        // 项目未启动时 ps 可能失败，返回空列表即可
      }

      return {
        success: true as const,
        project: { name: params.name, managed, content, services },
      };
    });
  })

  // ── 保存项目（新建或覆盖 YAML）──────────────────────────────────
  .post("/api/docker/compose/projects", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const name = String(body?.name || "").trim().toLowerCase();
    const content = String(body?.content || "");
    const error = validateProjectName(name);
    if (error) return { success: false, message: error };
    if (!content.trim()) return { success: false, message: "Compose 内容不能为空" };

    return guard("保存编排项目", async () => {
      const dir = projectDir(name);
      await mkdir(dir, { recursive: true });
      await writeFile(composeFilePath(name), content, "utf-8");

      // 保存即校验配置，语法错误当场反馈，不用等到部署
      try {
        await docker(["compose", "-f", composeFilePath(name), "-p", name, "config", "--quiet"]);
      } catch (e: any) {
        return {
          success: false as const,
          message: `已保存，但配置校验未通过：${(e?.message || "").trim()}`,
        };
      }

      logger.info(`[compose] 保存项目 ${name}`);
      return { success: true as const, message: `项目 ${name} 已保存` };
    });
  })

  // ── 校验 YAML ─────────────────────────────────────────────────────
  .post("/api/docker/compose/validate", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const content = String(body?.content || "");
    if (!content.trim()) return { success: false, message: "Compose 内容不能为空" };

    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const dir = await mkdtemp(join(tmpdir(), "cyrene-compose-check-"));
    const file = join(dir, "docker-compose.yml");
    try {
      await writeFile(file, content, "utf-8");
      await docker(["compose", "-f", file, "config", "--quiet"]);
      return { success: true, message: "配置校验通过" };
    } catch (e: any) {
      return { success: false, message: (e?.message || "配置校验失败").trim() };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  })

  // ── 生命周期操作（SSE 流式输出）──────────────────────────────────
  .post("/api/docker/compose/projects/:name/:action", async ({ params, body, profile }: any) => {
    if (!profile) return new Response("未授权", { status: 401 });

    const nameError = validateProjectName(params.name);
    if (nameError) return new Response(nameError, { status: 400 });

    const actions: Record<string, string[]> = {
      up: ["up", "-d", "--remove-orphans"],
      down: ["down"],
      start: ["start"],
      stop: ["stop"],
      restart: ["restart"],
      pull: ["pull"],
    };
    const composeAction = actions[params.action];
    if (!composeAction) return new Response("无效的操作", { status: 400 });

    // down 时可选连同数据卷一起删除
    const args = [...composeAction];
    if (params.action === "down" && body?.volumes === true) args.push("--volumes");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        const labels: Record<string, string> = {
          up: "部署",
          down: "移除",
          start: "启动",
          stop: "停止",
          restart: "重启",
          pull: "拉取镜像",
        };

        send({ type: "start", message: `正在${labels[params.action]} ${params.name} ...` });

        try {
          const full = await composeArgs(params.name, args);
          const code = await dockerStream(full, (line) => send({ type: "log", line }));

          if (code === 0) {
            logger.info(`[compose] 项目 ${params.name} ${labels[params.action]}完成`);
            send({ type: "done", success: true, message: `${labels[params.action]}完成` });
          } else {
            send({ type: "done", success: false, message: `${labels[params.action]}失败，退出码 ${code}` });
          }
        } catch (e: any) {
          send({ type: "done", success: false, message: e?.message || "操作失败" });
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

  // ── 项目日志 ──────────────────────────────────────────────────────
  .get("/api/docker/compose/projects/:name/logs", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const error = validateProjectName(params.name);
    if (error) return { success: false, message: error };

    const parsed = parseInt(query?.tail || "200");
    const tail = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 5000) : 200;

    return guard("获取编排日志", async () => {
      const args = await composeArgs(params.name, ["logs", "--no-color", "--tail", String(tail)]);
      let logs = "";
      try {
        logs = await docker(args);
      } catch (e: any) {
        // compose logs 在项目未运行时会返回非 0，但 stderr 里就是提示信息
        logs = (e?.message || "").trim();
      }
      return { success: true as const, logs };
    });
  })

  // ── 删除项目 ──────────────────────────────────────────────────────
  .delete("/api/docker/compose/projects/:name", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const error = validateProjectName(params.name);
    if (error) return { success: false, message: error };

    return guard("删除编排项目", async () => {
      // 先把容器停掉再删文件，否则会留下没人管的容器
      const downArgs = ["down", "--remove-orphans"];
      if (query?.volumes === "true") downArgs.push("--volumes");

      try {
        await docker(await composeArgs(params.name, downArgs));
      } catch (e: any) {
        logger.warn(`[compose] 删除项目 ${params.name} 前停止失败: ${(e?.message || "").trim()}`);
      }

      if (query?.keepFiles !== "true") {
        await rm(projectDir(params.name), { recursive: true, force: true });
      }

      logger.info(`[compose] 删除项目 ${params.name}`);
      return { success: true as const, message: `项目 ${params.name} 已删除` };
    });
  });
