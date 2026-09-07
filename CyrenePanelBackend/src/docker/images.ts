/**
 * Docker 本地镜像管理
 *
 * 覆盖：列表 / 详情 / 历史 / 拉取(流式) / 打标签 / 删除 / 批量删除 /
 *      清理悬空镜像 / 导出为 tar / 从 tar 导入
 */

import { Elysia } from "elysia";

import { logger } from "../logger/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { docker, dockerJsonLines, dockerJson, dockerStream, guard, parseSize } from "./cli";
import { getMirrorImage } from "./mirror";

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  /** repository:tag，未命名镜像为 <none>:<none> */
  reference: string;
  size: number;
  sizeText: string;
  created: string;
  dangling: boolean;
  /** 有多少个容器正在使用该镜像 */
  usedBy: number;
}

async function listImages(): Promise<DockerImage[]> {
  const rows = await dockerJsonLines<any>([
    "images",
    "--all",
    "--format={{json .}}",
  ]);

  // docker images 原生带 Containers 字段（被多少容器引用）。
  // 部分环境会返回 "N/A"，此时退化为从容器列表反推。
  const nativeUsageUnavailable = rows.some((row) => row.Containers === "N/A");
  const usage = new Map<string, number>();
  if (nativeUsageUnavailable) {
    try {
      const containers = await dockerJsonLines<any>(["ps", "--all", "--format={{json .}}"]);
      for (const c of containers) {
        const image = String(c.Image || "");
        usage.set(image, (usage.get(image) || 0) + 1);
      }
    } catch {
      // 拿不到容器列表不影响镜像列表本身
    }
  }

  return rows.map((row) => {
    const repository = row.Repository || "<none>";
    const tag = row.Tag || "<none>";
    const reference = `${repository}:${tag}`;
    const dangling = repository === "<none>" || tag === "<none>";

    const nativeCount = parseInt(row.Containers);
    const usedBy = Number.isFinite(nativeCount) && nativeCount >= 0
      ? nativeCount
      : usage.get(reference) || usage.get(repository) || 0;

    return {
      id: row.ID,
      repository,
      tag,
      reference,
      size: parseSize(row.Size),
      sizeText: row.Size || "",
      created: row.CreatedAt || "",
      dangling,
      usedBy,
    };
  });
}

export const dockerImageRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 列表 ──────────────────────────────────────────────────────────
  .get("/api/docker/images", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("列出镜像", async () => ({
      success: true as const,
      images: await listImages(),
    }));
  })

  // ── 详情 ──────────────────────────────────────────────────────────
  .get("/api/docker/images/:id/inspect", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("查看镜像详情", async () => {
      const [data] = await dockerJson<any[]>(["image", "inspect", params.id]);
      return {
        success: true as const,
        image: {
          id: data.Id,
          repoTags: data.RepoTags || [],
          repoDigests: data.RepoDigests || [],
          created: data.Created,
          size: data.Size,
          architecture: data.Architecture,
          os: data.Os,
          author: data.Author,
          dockerVersion: data.DockerVersion,
          env: data.Config?.Env || [],
          cmd: data.Config?.Cmd || [],
          entrypoint: data.Config?.Entrypoint || [],
          workingDir: data.Config?.WorkingDir || "",
          exposedPorts: Object.keys(data.Config?.ExposedPorts || {}),
          volumes: Object.keys(data.Config?.Volumes || {}),
          labels: data.Config?.Labels || {},
          layers: data.RootFS?.Layers || [],
        },
      };
    });
  })

  // ── 构建历史 ──────────────────────────────────────────────────────
  .get("/api/docker/images/:id/history", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("查看镜像历史", async () => {
      const rows = await dockerJsonLines<any>([
        "history",
        "--no-trunc",
        "--format={{json .}}",
        params.id,
      ]);
      return {
        success: true as const,
        history: rows.map((row) => ({
          id: row.ID,
          createdBy: row.CreatedBy || "",
          createdSince: row.CreatedSince || "",
          size: row.Size || "",
          comment: row.Comment || "",
        })),
      };
    });
  })

  // ── 拉取镜像（SSE 流式进度）────────────────────────────────────────
  .post("/api/docker/images/pull-stream", async ({ body, profile }: any) => {
    if (!profile) return new Response("未授权", { status: 401 });

    const rawImage = String(body?.image || "").trim();
    if (!rawImage) return new Response("镜像名不能为空", { status: 400 });

    // 是否使用加速地址由前端决定，默认跟随全局设置
    const useMirror = body?.useMirror;
    const image = getMirrorImage(rawImage, useMirror);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        send({ type: "start", image, original: rawImage });
        logger.info(`[docker] 开始拉取镜像 ${image}`);

        try {
          const code = await dockerStream(["pull", image], (line) => {
            send({ type: "log", line });
          });

          if (code === 0) {
            // 用加速地址拉下来的镜像要打回原始名字，否则后续引用对不上
            if (image !== rawImage) {
              try {
                await docker(["tag", image, rawImage]);
                send({ type: "log", line: `已重新标记为 ${rawImage}` });
              } catch (e: any) {
                send({ type: "log", line: `重新标记失败: ${e.message}` });
              }
            }
            send({ type: "done", success: true, message: `镜像 ${rawImage} 拉取完成` });
            logger.info(`[docker] 镜像 ${image} 拉取完成`);
          } else {
            send({ type: "done", success: false, message: `拉取失败，退出码 ${code}` });
          }
        } catch (e: any) {
          send({ type: "done", success: false, message: e?.message || "拉取失败" });
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

  // ── 打标签 ────────────────────────────────────────────────────────
  .post("/api/docker/images/tag", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const source = String(body?.source || "").trim();
    const target = String(body?.target || "").trim();
    if (!source || !target) return { success: false, message: "源镜像和目标标签都不能为空" };

    return guard("镜像打标签", async () => {
      await docker(["tag", source, target]);
      logger.info(`[docker] 镜像 ${source} 打标签为 ${target}`);
      return { success: true as const, message: `已标记为 ${target}` };
    });
  })

  // ── 删除单个 ──────────────────────────────────────────────────────
  .delete("/api/docker/images/:id", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const force = query?.force === "true";

    return guard("删除镜像", async () => {
      await docker(["rmi", ...(force ? ["--force"] : []), params.id]);
      logger.info(`[docker] 删除镜像 ${params.id}${force ? "（强制）" : ""}`);
      return { success: true as const, message: "镜像已删除" };
    });
  })

  // ── 批量删除 ──────────────────────────────────────────────────────
  .post("/api/docker/images/batch-delete", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (ids.length === 0) return { success: false, message: "未选择镜像" };
    const force = body?.force === true;

    const succeeded: string[] = [];
    const failed: { id: string; message: string }[] = [];

    for (const id of ids) {
      try {
        await docker(["rmi", ...(force ? ["--force"] : []), id]);
        succeeded.push(id);
      } catch (e: any) {
        failed.push({ id, message: (e?.message || "删除失败").trim() });
      }
    }

    logger.info(`[docker] 批量删除镜像：成功 ${succeeded.length}，失败 ${failed.length}`);
    return {
      success: failed.length === 0,
      message:
        failed.length === 0
          ? `已删除 ${succeeded.length} 个镜像`
          : `成功 ${succeeded.length} 个，失败 ${failed.length} 个`,
      succeeded,
      failed,
    };
  })

  // ── 清理悬空镜像 ──────────────────────────────────────────────────
  .post("/api/docker/images/prune", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    // all=true 会连同未被容器使用的有标签镜像一起删，风险更高
    const all = body?.all === true;

    return guard("清理镜像", async () => {
      const out = await docker(["image", "prune", "--force", ...(all ? ["--all"] : [])]);
      const reclaimed = out.match(/Total reclaimed space:\s*(.+)/i)?.[1]?.trim() || "0B";
      logger.info(`[docker] 清理镜像完成，释放 ${reclaimed}`);
      return {
        success: true as const,
        message: `清理完成，释放 ${reclaimed}`,
        reclaimed,
        output: out.trim(),
      };
    });
  });
