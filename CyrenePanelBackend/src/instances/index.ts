import { Elysia } from "elysia";
import { logger } from "../logger/index";
import {
  createInstance,
  getInstance,
  getAllInstances,
  updateInstance,
  removeInstance,
} from "./store";
import {
  startInstance,
  stopInstance,
  restartInstance,
  deleteInstanceManager,
} from "./manager";
import { dbGetNode, dbGetAllNodes } from "../db";
import { fetchNode } from "../nodes/index";
import { hasNodeCapability } from "../node-auth/principal";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { auditLog, getRequestIp } from "../audit/index";

function canReadInstances(profile: any): boolean {
  return Boolean(profile) && (profile.role !== "node" || hasNodeCapability(profile, "instances:read"));
}

function canWriteInstances(profile: any): boolean {
  return Boolean(profile) && (profile.role !== "node" || hasNodeCapability(profile, "instances:write"));
}

/**
 * 记录一次实例操作。
 *
 * 只在「请求直接来自人」的那一端记录：主节点把请求转发给子节点时，
 * 子节点收到的是 isNodeRequest=true，那边跳过，否则同一次操作会在
 * 主从各留一条。这样记下来的用户名也是真实操作者，而不是 node:xxx。
 *
 * 代价是子节点上的操作，日志落在主节点而非子节点，所以 detail 里
 * 补上目标节点名，按节点筛选时还能追溯。
 */
function auditInstance(ctx: {
  request: Request;
  server: any;
  profile: any;
  isNodeRequest: boolean;
  action: string;
  target: string;
  detail?: string;
  success?: boolean;
}): void {
  if (ctx.isNodeRequest) return;
  auditLog({
    username: ctx.profile?.username || "",
    category: "instance",
    action: ctx.action,
    target: ctx.target,
    detail: ctx.detail,
    ip: getRequestIp(ctx.request, ctx.server),
    success: ctx.success,
  });
}

/**
 * 启动 / 停止 / 重启三个路由的逻辑完全一样：先在本地执行，
 * 本地没有这个实例就依次问各子节点。抽出来避免三份拷贝各写一遍审计。
 */
function lifecycleHandler(
  action: "start" | "stop" | "restart",
  run: (id: string) => Promise<{ ok: boolean; message: string }>,
  label: string,
) {
  return async ({ params, profile, isNodeRequest, request, server }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };

    const target = getInstance(params.id)?.name || params.id;
    const audit = (detail: string | undefined, success: boolean) =>
      auditInstance({
        request,
        server,
        profile,
        isNodeRequest,
        action: label,
        target,
        detail,
        success,
      });

    const result = await run(params.id);
    if (result.ok || result.message !== "实例不存在") {
      audit(result.ok ? undefined : result.message, result.ok);
      return result;
    }
    if (isNodeRequest) return result;

    const nodes = dbGetAllNodes();
    for (const node of nodes) {
      try {
        const res = await fetchNode(node, `/api/instances/${params.id}/${action}`, { method: "POST" }, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.ok || data.message !== "实例不存在") {
            audit(`节点: ${node.name}`, Boolean(data.ok));
            return data;
          }
        }
      } catch {}
    }

    audit("实例不存在", false);
    return result;
  };
}

export const instanceRoutes = new Elysia()
  // JWT 验证 resolve
  .resolve(async ({ jwt, request }: any) => {
    const profile = await resolveRequestProfile(jwt, request);
    return { profile, isNodeRequest: profile?.role === "node" };
  })

  // 获取所有实例
  .get("/api/instances", async ({ profile, isNodeRequest }: any) => {
    if (!canReadInstances(profile)) return { success: false, message: "未授权" };
    const instances = getAllInstances();
    if (isNodeRequest) {
      return { success: true, instances };
    }

    // 从所有子节点聚合实例
    const nodes = dbGetAllNodes();
    await Promise.all(nodes.map(async (node) => {
      try {
        const res = await fetchNode(node, "/api/instances", {}, 3000);

        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.instances)) {
            // 将子节点的实例合并进来，并覆盖 nodeId
            const childInstances = data.instances.map((inst: any) => ({
              ...inst,
              nodeId: node.id,
              nodeName: node.name
            }));
            instances.push(...childInstances);
          }
        }
      } catch (e: any) {
        logger.warn(`获取子节点 ${node.name} 实例列表失败: ${e.message}`);
      }
    }));

    // 按创建时间倒序排序
    instances.sort((a, b) => b.createdAt - a.createdAt);

    return { success: true, instances };
  })

  // 创建实例
  .post("/api/instances", async ({ body, profile, isNodeRequest, request, server }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const { name, command, cwd, env, autoRestart, nodeId } = body || {};

    if (!name || !command || !cwd) {
      return { success: false, message: "缺少必要参数: name, command, cwd" };
    }

    const audit = (detail: string | undefined, success: boolean) =>
      auditInstance({
        request,
        server,
        profile,
        isNodeRequest,
        action: "创建实例",
        target: name,
        detail,
        success,
      });

    // 如果指定了子节点，代理创建请求到子节点
    if (nodeId && nodeId !== "__main__") {
      const node = dbGetNode(nodeId);
      if (!node) {
        audit(`节点不存在: ${nodeId}`, false);
        return { success: false, message: "节点不存在" };
      }

      try {
        const res = await fetchNode(node, "/api/instances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, command, cwd, env, autoRestart, nodeId, nodeName: node.name }),
        }, 10_000);
        const data = await res.json();
        audit(`节点: ${node.name} · ${command}`, Boolean(data?.success));
        return data;
      } catch (e: any) {
        logger.err(`子节点实例创建代理失败: ${e.message}`);
        audit(`节点: ${node.name} · 请求失败: ${e.message}`, false);
        return { success: false, message: `子节点请求失败: ${e.message}` };
      }
    }

    const cfg = createInstance({ name, command, cwd, env, autoRestart, nodeId: "__main__", nodeName: "主节点" });
    audit(command, true);
    return { success: true, instance: cfg };
  })

  // 获取单个实例详情（含日志）
  .get("/api/instances/:id", async ({ params, profile, isNodeRequest }: any) => {
    if (!canReadInstances(profile)) return { success: false, message: "未授权" };
    const inst = getInstance(params.id);
    if (inst) return { success: true, instance: inst };
    if (isNodeRequest) return { success: false, message: "实例不存在" };

    // 尝试在子节点中查找
    const nodes = dbGetAllNodes();
    for (const node of nodes) {
      try {
        const res = await fetchNode(node, `/api/instances/${params.id}`, {}, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.success) return data;
        }
      } catch {}
    }

    return { success: false, message: "实例不存在" };
  })

  // 更新实例配置
  .put("/api/instances/:id", async ({ params, body, profile, isNodeRequest, request, server }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const { name, command, cwd, env, autoRestart } = body || {};

    // 记下这次动了哪几项，只写「更新实例」事后查不出改了什么
    const before = getInstance(params.id);
    const changed: string[] = [];
    if (before) {
      if (name !== undefined && name !== before.name) changed.push("名称");
      if (command !== undefined && command !== before.command) changed.push("启动命令");
      if (cwd !== undefined && cwd !== before.cwd) changed.push("工作目录");
      if (autoRestart !== undefined && autoRestart !== before.autoRestart) changed.push("自动重启");
      if (env !== undefined && JSON.stringify(env) !== JSON.stringify(before.env)) {
        changed.push("环境变量");
      }
    }

    const audit = (target: string, detail: string | undefined, success: boolean) =>
      auditInstance({
        request,
        server,
        profile,
        isNodeRequest,
        action: "更新实例",
        target,
        detail,
        success,
      });

    const updated = updateInstance(params.id, {
      name,
      command,
      cwd,
      env,
      autoRestart,
    });
    if (updated) {
      audit(updated.name, changed.length > 0 ? `变更: ${changed.join("、")}` : "无实际变更", true);
      return { success: true, instance: updated };
    }
    if (isNodeRequest) return { success: false, message: "实例不存在" };

    // 尝试在子节点中查找并更新
    const nodes = dbGetAllNodes();
    for (const node of nodes) {
      try {
        const res = await fetchNode(node, `/api/instances/${params.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.success || data.message !== "实例不存在") {
            audit(data?.instance?.name || name || params.id, `节点: ${node.name}`, Boolean(data.success));
            return data;
          }
        }
      } catch {}
    }

    audit(name || params.id, "实例不存在", false);
    return { success: false, message: "实例不存在" };
  })

  // 删除实例
  .delete("/api/instances/:id", async ({ params, profile, isNodeRequest, request, server }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const id = params.id;

    // 名字得在删之前拿，删完就查不到了
    const target = getInstance(id)?.name || id;
    const audit = (detail: string | undefined, success: boolean) =>
      auditInstance({
        request,
        server,
        profile,
        isNodeRequest,
        action: "删除实例",
        target,
        detail,
        success,
      });

    try {
      logger.info(`收到删除实例请求: ${id}`);

      // 1. 尝试停止运行中的实例 (设置较短的超时预期)
      // deleteInstanceManager 内部已有 stopInstance 的超时逻辑
      await deleteInstanceManager(id).catch(e => {
        logger.warn(`停止实例进程时出现异常 (可能已处于僵死状态): ${e.message}`);
      });

      // 2. 无论进程是否完美停止，都从配置存储中移除
      const removed = removeInstance(id);
      if (removed) {
        logger.info(`实例已从系统中移除: ${id}`);
        audit(undefined, true);
        return { success: true, message: "实例已删除" };
      }
      if (isNodeRequest) return { success: false, message: "实例不存在" };

      // 如果本地没有，尝试在子节点中删除
      const nodes = dbGetAllNodes();
      for (const node of nodes) {
        try {
          const res = await fetchNode(node, `/api/instances/${id}`, { method: "DELETE" }, 3000);
          if (res.ok) {
            const data = await res.json();
            if (data.success || data.message !== "实例不存在") {
              audit(`节点: ${node.name}`, Boolean(data.success));
              return data;
            }
          }
        } catch {}
      }

      logger.warn(`实例不存在于配置中: ${id}`);
      audit("实例不存在", false);
      return { success: false, message: "实例不存在" };
    } catch (e: any) {
      logger.err(`删除实例时发生严重错误: ${e.message}`);
      removeInstance(params.id);
      audit(`删除异常: ${e.message}`, false);
      return { success: false, message: `删除失败: ${e.message}` };
    }
  })

  // 启停重启：三个动作结构完全一致，见 lifecycleHandler
  .post("/api/instances/:id/start", lifecycleHandler("start", startInstance, "启动实例"))
  .post("/api/instances/:id/stop", lifecycleHandler("stop", stopInstance, "停止实例"))
  .post("/api/instances/:id/restart", lifecycleHandler("restart", restartInstance, "重启实例"));