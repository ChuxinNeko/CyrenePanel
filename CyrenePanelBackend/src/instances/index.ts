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

function canReadInstances(profile: any): boolean {
  return Boolean(profile) && (profile.role !== "node" || hasNodeCapability(profile, "instances:read"));
}

function canWriteInstances(profile: any): boolean {
  return Boolean(profile) && (profile.role !== "node" || hasNodeCapability(profile, "instances:write"));
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
  .post("/api/instances", async ({ body, profile }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const { name, command, cwd, env, autoRestart, nodeId } = body || {};

    if (!name || !command || !cwd) {
      return { success: false, message: "缺少必要参数: name, command, cwd" };
    }

    // 如果指定了子节点，代理创建请求到子节点
    if (nodeId && nodeId !== "__main__") {
      const node = dbGetNode(nodeId);
      if (!node) return { success: false, message: "节点不存在" };

      try {
        const res = await fetchNode(node, "/api/instances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, command, cwd, env, autoRestart, nodeId, nodeName: node.name }),
        }, 10_000);
        const data = await res.json();
        return data;
      } catch (e: any) {
        logger.err(`子节点实例创建代理失败: ${e.message}`);
        return { success: false, message: `子节点请求失败: ${e.message}` };
      }
    }

    const cfg = createInstance({ name, command, cwd, env, autoRestart, nodeId: "__main__", nodeName: "主节点" });
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
  .put("/api/instances/:id", async ({ params, body, profile, isNodeRequest }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const { name, command, cwd, env, autoRestart } = body || {};

    const updated = updateInstance(params.id, {
      name,
      command,
      cwd,
      env,
      autoRestart,
    });
    if (updated) return { success: true, instance: updated };
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
          if (data.success || data.message !== "实例不存在") return data;
        }
      } catch {}
    }

    return { success: false, message: "实例不存在" };
  })

  // 删除实例
  .delete("/api/instances/:id", async ({ params, profile, isNodeRequest }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const id = params.id;

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
            if (data.success || data.message !== "实例不存在") return data;
          }
        } catch {}
      }

      logger.warn(`实例不存在于配置中: ${id}`);
      return { success: false, message: "实例不存在" };
    } catch (e: any) {
      logger.err(`删除实例时发生严重错误: ${e.message}`);
      removeInstance(params.id);
      return { success: false, message: `删除失败: ${e.message}` };
    }
  })

  // 启动实例
  .post("/api/instances/:id/start", async ({ params, profile, isNodeRequest }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const result = await startInstance(params.id);
    if (result.ok || result.message !== "实例不存在") return result;
    if (isNodeRequest) return result;

    const nodes = dbGetAllNodes();
    for (const node of nodes) {
      try {
        const res = await fetchNode(node, `/api/instances/${params.id}/start`, { method: "POST" }, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.ok || data.message !== "实例不存在") return data;
        }
      } catch {}
    }
    return result;
  })

  // 停止实例
  .post("/api/instances/:id/stop", async ({ params, profile, isNodeRequest }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const result = await stopInstance(params.id);
    if (result.ok || result.message !== "实例不存在") return result;
    if (isNodeRequest) return result;

    const nodes = dbGetAllNodes();
    for (const node of nodes) {
      try {
        const res = await fetchNode(node, `/api/instances/${params.id}/stop`, { method: "POST" }, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.ok || data.message !== "实例不存在") return data;
        }
      } catch {}
    }
    return result;
  })

  // 重启实例
  .post("/api/instances/:id/restart", async ({ params, profile, isNodeRequest }: any) => {
    if (!canWriteInstances(profile)) return { success: false, message: "未授权" };
    const result = await restartInstance(params.id);
    if (result.ok || result.message !== "实例不存在") return result;
    if (isNodeRequest) return result;

    const nodes = dbGetAllNodes();
    for (const node of nodes) {
      try {
        const res = await fetchNode(node, `/api/instances/${params.id}/restart`, { method: "POST" }, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.ok || data.message !== "实例不存在") return data;
        }
      } catch {}
    }
    return result;
  });