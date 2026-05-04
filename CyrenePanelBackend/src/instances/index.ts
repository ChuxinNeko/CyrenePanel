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

export const instanceRoutes = new Elysia()
  // JWT 验证 resolve
  .resolve(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // 获取所有实例
  .get("/api/instances", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const instances = getAllInstances();
    return { success: true, instances };
  })

  // 创建实例
  .post("/api/instances", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { name, command, cwd, env, autoRestart } = body || {};

    if (!name || !command || !cwd) {
      return { success: false, message: "缺少必要参数: name, command, cwd" };
    }

    const cfg = createInstance({ name, command, cwd, env, autoRestart });
    return { success: true, instance: cfg };
  })

  // 获取单个实例详情（含日志）
  .get("/api/instances/:id", ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const inst = getInstance(params.id);
    if (!inst) return { success: false, message: "实例不存在" };
    return { success: true, instance: inst };
  })

  // 更新实例配置
  .put("/api/instances/:id", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { name, command, cwd, env, autoRestart } = body || {};

    const updated = updateInstance(params.id, {
      name,
      command,
      cwd,
      env,
      autoRestart,
    });
    if (!updated) return { success: false, message: "实例不存在" };

    return { success: true, instance: updated };
  })

  // 删除实例
  .delete("/api/instances/:id", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
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
      if (!removed) {
        logger.warn(`实例不存在于配置中: ${id}`);
        return { success: false, message: "实例不存在" };
      }

      logger.info(`实例已从系统中移除: ${id}`);
      return { success: true, message: "实例已删除" };
    } catch (e: any) {
      logger.err(`删除实例时发生严重错误: ${e.message}`);
      // 最后的兜底：尝试强制移除内存中的配置，防止后端死锁
      removeInstance(id);
      return { success: false, message: `删除失败: ${e.message}` };
    }
  })

  // 启动实例
  .post("/api/instances/:id/start", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const result = await startInstance(params.id);
    return result;
  })

  // 停止实例
  .post("/api/instances/:id/stop", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const result = await stopInstance(params.id);
    return result;
  })

  // 重启实例
  .post("/api/instances/:id/restart", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const result = await restartInstance(params.id);
    return result;
  });