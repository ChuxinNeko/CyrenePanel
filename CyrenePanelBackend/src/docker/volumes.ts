/**
 * Docker 存储卷管理
 *
 * 覆盖：列表 / 详情 / 创建 / 删除 / 批量删除 / 清理未使用
 */

import { Elysia } from "elysia";

import { logger } from "../logger/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { docker, dockerJson, dockerJsonLines, guard } from "./cli";

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  created: string;
  scope: string;
  /** 正在使用该卷的容器名 */
  usedBy: string[];
  labels: Record<string, string>;
}

async function listVolumes(): Promise<DockerVolume[]> {
  const rows = await dockerJsonLines<any>(["volume", "ls", "--format={{json .}}"]);
  if (rows.length === 0) return [];

  // 统计每个卷被哪些容器挂载，删除前能给出明确提示
  const usage = new Map<string, string[]>();
  try {
    const ids = (await dockerJsonLines<any>(["ps", "--all", "--format={{json .}}"])).map(
      (c: any) => c.ID,
    );
    const containers = ids.length > 0 ? await dockerJson<any[]>(["container", "inspect", ...ids]) : [];
    for (const c of containers) {
      const name = String(c.Name || "").replace(/^\//, "");
      for (const mount of c.Mounts || []) {
        if (mount.Type === "volume" && mount.Name) {
          const list = usage.get(mount.Name) || [];
          list.push(name);
          usage.set(mount.Name, list);
        }
      }
    }
  } catch {
    // 没有容器或 inspect 失败时忽略，不影响卷列表
  }

  const details = new Map<string, any>();
  try {
    const inspected = await dockerJson<any[]>([
      "volume",
      "inspect",
      ...rows.map((r) => r.Name),
    ]);
    for (const item of inspected) details.set(item.Name, item);
  } catch {
    // 忽略
  }

  return rows.map((row) => {
    const detail = details.get(row.Name);
    return {
      name: row.Name,
      driver: row.Driver || detail?.Driver || "local",
      mountpoint: detail?.Mountpoint || row.Mountpoint || "",
      created: detail?.CreatedAt || "",
      scope: detail?.Scope || row.Scope || "local",
      usedBy: usage.get(row.Name) || [],
      labels: detail?.Labels || {},
    };
  });
}

export const dockerVolumeRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  .get("/api/docker/volumes", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("列出存储卷", async () => ({
      success: true as const,
      volumes: await listVolumes(),
    }));
  })

  .get("/api/docker/volumes/:name", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("查看存储卷详情", async () => {
      const [data] = await dockerJson<any[]>(["volume", "inspect", params.name]);
      return {
        success: true as const,
        volume: {
          name: data.Name,
          driver: data.Driver,
          mountpoint: data.Mountpoint,
          created: data.CreatedAt,
          scope: data.Scope,
          labels: data.Labels || {},
          options: data.Options || {},
        },
      };
    });
  })

  .post("/api/docker/volumes", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const name = String(body?.name || "").trim();
    if (!name) return { success: false, message: "存储卷名称不能为空" };
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return { success: false, message: "名称只能包含字母、数字、下划线、点和短横线，且不能以符号开头" };
    }

    const args = ["volume", "create", "--driver", String(body?.driver || "local").trim()];
    for (const [key, value] of Object.entries(body?.labels || {})) {
      args.push("--label", `${key}=${value}`);
    }
    for (const [key, value] of Object.entries(body?.options || {})) {
      args.push("--opt", `${key}=${value}`);
    }
    args.push(name);

    return guard("创建存储卷", async () => {
      await docker(args);
      logger.info(`[docker] 创建存储卷 ${name}`);
      return { success: true as const, message: `存储卷 ${name} 已创建` };
    });
  })

  .delete("/api/docker/volumes/:name", async ({ params, query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const force = query?.force === "true";

    return guard("删除存储卷", async () => {
      await docker(["volume", "rm", ...(force ? ["--force"] : []), params.name]);
      logger.info(`[docker] 删除存储卷 ${params.name}`);
      return { success: true as const, message: "存储卷已删除" };
    });
  })

  .post("/api/docker/volumes/batch-delete", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const names: string[] = Array.isArray(body?.names) ? body.names : [];
    if (names.length === 0) return { success: false, message: "未选择存储卷" };

    const succeeded: string[] = [];
    const failed: { name: string; message: string }[] = [];
    for (const name of names) {
      try {
        await docker(["volume", "rm", ...(body?.force === true ? ["--force"] : []), name]);
        succeeded.push(name);
      } catch (e: any) {
        failed.push({ name, message: (e?.message || "删除失败").trim() });
      }
    }

    logger.info(`[docker] 批量删除存储卷：成功 ${succeeded.length}，失败 ${failed.length}`);
    return {
      success: failed.length === 0,
      message:
        failed.length === 0
          ? `已删除 ${succeeded.length} 个存储卷`
          : `成功 ${succeeded.length} 个，失败 ${failed.length} 个`,
      succeeded,
      failed,
    };
  })

  .post("/api/docker/volumes/prune", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("清理存储卷", async () => {
      const out = await docker(["volume", "prune", "--force"]);
      const reclaimed = out.match(/Total reclaimed space:\s*(.+)/i)?.[1]?.trim() || "0B";
      logger.info(`[docker] 清理未使用存储卷，释放 ${reclaimed}`);
      return {
        success: true as const,
        message: `清理完成，释放 ${reclaimed}`,
        reclaimed,
        output: out.trim(),
      };
    });
  });
