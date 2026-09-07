/**
 * 容器高级操作
 *
 * 基础的 start/stop/restart/删除/日志在 docker/index.ts 中，
 * 这里补齐对标宝塔所需的：暂停恢复 / 强制终止 / 重命名 / 实时资源统计 /
 * 进程列表 / 提交为镜像 / 批量操作 / 清理已停止容器。
 */

import { Elysia } from "elysia";

import { logger } from "../logger/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { docker, dockerJsonLines, guard } from "./cli";

/** 把 "12.34%" 解析为 12.34 */
function parsePercent(text: string | undefined): number {
  if (!text) return 0;
  const value = parseFloat(String(text).replace("%", "").trim());
  return Number.isFinite(value) ? value : 0;
}

/** 把 "1.5GiB / 7.77GiB" 拆成 [已用, 总量] 的原始文本 */
function splitPair(text: string | undefined): [string, string] {
  if (!text) return ["", ""];
  const parts = String(text).split("/").map((s) => s.trim());
  return [parts[0] || "", parts[1] || ""];
}

const SIMPLE_ACTION_LABELS: Record<string, string> = {
  pause: "暂停",
  unpause: "恢复",
  kill: "强制终止",
};

async function containerSimpleAction(profile: unknown, id: string, action: string) {
  if (!profile) return { success: false, message: "未授权" };
  return guard(`容器 ${action}`, async () => {
    await docker([action, id]);
    logger.info(`[docker] 容器 ${id} 已${SIMPLE_ACTION_LABELS[action]}`);
    return { success: true as const, message: `容器已${SIMPLE_ACTION_LABELS[action]}` };
  });
}

export const dockerContainerRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 实时资源统计（一次性快照，前端轮询）──────────────────────────
  // 放在 /api/docker/stats 而不是 /containers/stats，
  // 否则会和已有的 GET /api/docker/containers/:id 争夺匹配
  .get("/api/docker/stats", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("获取容器资源统计", async () => {
      // --no-stream 取单次快照；不加会持续输出导致请求挂住
      const rows = await dockerJsonLines<any>([
        "stats",
        "--no-stream",
        "--format={{json .}}",
      ]);

      const stats = rows.map((row) => {
        const [memUsed, memLimit] = splitPair(row.MemUsage);
        const [netIn, netOut] = splitPair(row.NetIO);
        const [blockIn, blockOut] = splitPair(row.BlockIO);
        return {
          id: row.ID,
          name: row.Name,
          cpuPercent: parsePercent(row.CPUPerc),
          memPercent: parsePercent(row.MemPerc),
          memUsage: memUsed,
          memLimit,
          netInput: netIn,
          netOutput: netOut,
          blockRead: blockIn,
          blockWrite: blockOut,
          pids: parseInt(row.PIDs || "0") || 0,
        };
      });

      return { success: true as const, stats };
    });
  })

  // ── 容器内进程列表 ────────────────────────────────────────────────
  .get("/api/docker/containers/:id/top", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("获取容器进程", async () => {
      const out = await docker(["top", params.id]);
      const lines = out.trim().split("\n").filter((l) => l.trim());
      if (lines.length === 0) return { success: true as const, headers: [], processes: [] };

      const headers = lines[0].trim().split(/\s+/);
      const processes = lines.slice(1).map((line) => {
        // 最后一列是完整命令，可能含空格，因此限制切分次数
        const parts = line.trim().split(/\s+/);
        const fixed = parts.slice(0, headers.length - 1);
        const rest = parts.slice(headers.length - 1).join(" ");
        return [...fixed, rest];
      });

      return { success: true as const, headers, processes };
    });
  })

  // ── 暂停 / 恢复 / 强制终止 ────────────────────────────────────────
  // 逐个显式注册而不是用 :action 通配，避免遮蔽 index.ts 里已有的
  // /containers/:id/start、/stop、/restart
  .post("/api/docker/containers/:id/pause", ({ params, profile }: any) =>
    containerSimpleAction(profile, params.id, "pause"),
  )
  .post("/api/docker/containers/:id/unpause", ({ params, profile }: any) =>
    containerSimpleAction(profile, params.id, "unpause"),
  )
  .post("/api/docker/containers/:id/kill", ({ params, profile }: any) =>
    containerSimpleAction(profile, params.id, "kill"),
  )

  // ── 重命名 ────────────────────────────────────────────────────────
  .post("/api/docker/containers/:id/rename", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const name = String(body?.name || "").trim();
    if (!name) return { success: false, message: "新名称不能为空" };
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return { success: false, message: "名称只能包含字母、数字、下划线、点和短横线，且不能以符号开头" };
    }

    return guard("重命名容器", async () => {
      await docker(["rename", params.id, name]);
      logger.info(`[docker] 容器 ${params.id} 重命名为 ${name}`);
      return { success: true as const, message: `已重命名为 ${name}` };
    });
  })

  // ── 提交为镜像 ────────────────────────────────────────────────────
  .post("/api/docker/containers/:id/commit", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const repository = String(body?.repository || "").trim();
    if (!repository) return { success: false, message: "镜像名称不能为空" };
    const tag = String(body?.tag || "latest").trim();
    const message = String(body?.message || "").trim();
    const author = String(body?.author || "").trim();

    const args = ["commit"];
    if (message) args.push("--message", message);
    if (author) args.push("--author", author);
    // pause=false 时容器在提交期间继续运行，可能产生不一致的镜像
    if (body?.pause === false) args.push("--pause=false");
    args.push(params.id, `${repository}:${tag}`);

    return guard("提交容器为镜像", async () => {
      const id = (await docker(args)).trim();
      logger.info(`[docker] 容器 ${params.id} 已提交为镜像 ${repository}:${tag}`);
      return { success: true as const, message: `已提交为 ${repository}:${tag}`, id };
    });
  })

  // ── 批量操作 ──────────────────────────────────────────────────────
  .post("/api/docker/containers/batch", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    const action = String(body?.action || "").trim();
    const valid = ["start", "stop", "restart", "pause", "unpause", "kill", "remove"];
    if (ids.length === 0) return { success: false, message: "未选择容器" };
    if (!valid.includes(action)) return { success: false, message: "无效的操作" };

    const succeeded: string[] = [];
    const failed: { id: string; message: string }[] = [];

    for (const id of ids) {
      try {
        if (action === "remove") {
          await docker(["rm", "--force", id]);
        } else {
          await docker([action, id]);
        }
        succeeded.push(id);
      } catch (e: any) {
        failed.push({ id, message: (e?.message || "操作失败").trim() });
      }
    }

    const labels: Record<string, string> = {
      start: "启动",
      stop: "停止",
      restart: "重启",
      pause: "暂停",
      unpause: "恢复",
      kill: "强制终止",
      remove: "删除",
    };
    logger.info(`[docker] 批量${labels[action]}容器：成功 ${succeeded.length}，失败 ${failed.length}`);

    return {
      success: failed.length === 0,
      message:
        failed.length === 0
          ? `已${labels[action]} ${succeeded.length} 个容器`
          : `成功 ${succeeded.length} 个，失败 ${failed.length} 个`,
      succeeded,
      failed,
    };
  })

  // ── 清理已停止容器 ────────────────────────────────────────────────
  .post("/api/docker/containers/prune", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("清理已停止容器", async () => {
      const out = await docker(["container", "prune", "--force"]);
      const reclaimed = out.match(/Total reclaimed space:\s*(.+)/i)?.[1]?.trim() || "0B";
      logger.info(`[docker] 清理已停止容器，释放 ${reclaimed}`);
      return {
        success: true as const,
        message: `清理完成，释放 ${reclaimed}`,
        reclaimed,
        output: out.trim(),
      };
    });
  });
