/**
 * Docker 守护进程与系统级管理
 *
 * 覆盖：版本详情 / 磁盘占用统计 / 全局清理 / 守护进程服务状态与启停
 */

import { Elysia } from "elysia";

import { logger } from "../logger/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { docker, dockerJson, dockerJsonLines, guard, parseSize } from "./cli";

async function systemctl(args: string[]): Promise<string> {
  const proc = Bun.spawn(["systemctl", ...args], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  // systemctl is-active 对非 active 状态返回非 0，但 stdout 才是我们要的
  if (exitCode !== 0 && !stdout.trim()) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(stderr.trim() || `systemctl 失败，退出码 ${exitCode}`);
  }
  return stdout.trim();
}

export const dockerSystemRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // ── 版本详情 ──────────────────────────────────────────────────────
  .get("/api/docker/version", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("获取 Docker 版本", async () => {
      const data = await dockerJson<any>(["version", "--format={{json .}}"]);

      // compose 是独立插件，可能没装
      let composeVersion = "";
      try {
        composeVersion = (await docker(["compose", "version", "--short"])).trim();
      } catch {
        composeVersion = "";
      }

      return {
        success: true as const,
        version: {
          clientVersion: data.Client?.Version || "",
          clientApiVersion: data.Client?.ApiVersion || "",
          clientGoVersion: data.Client?.GoVersion || "",
          clientPlatform: data.Client?.Platform?.Name || "",
          serverVersion: data.Server?.Version || "",
          serverApiVersion: data.Server?.ApiVersion || "",
          serverMinApiVersion: data.Server?.MinAPIVersion || "",
          serverGoVersion: data.Server?.GoVersion || "",
          serverOs: data.Server?.Os || "",
          serverArch: data.Server?.Arch || "",
          serverKernel: data.Server?.KernelVersion || "",
          buildTime: data.Server?.BuildTime || "",
          composeVersion,
          components: (data.Server?.Components || []).map((c: any) => ({
            name: c.Name,
            version: c.Version,
          })),
        },
      };
    });
  })

  // ── 完整 info ─────────────────────────────────────────────────────
  .get("/api/docker/system/info", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("获取 Docker 详细信息", async () => {
      const info = await dockerJson<any>(["info", "--format={{json .}}"]);
      return {
        success: true as const,
        info: {
          id: info.ID,
          name: info.Name,
          serverVersion: info.ServerVersion,
          operatingSystem: info.OperatingSystem,
          osType: info.OSType,
          architecture: info.Architecture,
          kernelVersion: info.KernelVersion,
          cpus: info.NCPU,
          memTotal: info.MemTotal,
          dockerRootDir: info.DockerRootDir,
          storageDriver: info.Driver,
          loggingDriver: info.LoggingDriver,
          cgroupDriver: info.CgroupDriver,
          cgroupVersion: info.CgroupVersion,
          containers: info.Containers ?? 0,
          containersRunning: info.ContainersRunning ?? 0,
          containersPaused: info.ContainersPaused ?? 0,
          containersStopped: info.ContainersStopped ?? 0,
          images: info.Images ?? 0,
          registryMirrors: info.RegistryConfig?.Mirrors || [],
          insecureRegistries:
            info.RegistryConfig?.IndexConfigs
              ? Object.values(info.RegistryConfig.IndexConfigs)
                  .filter((c: any) => c?.Secure === false)
                  .map((c: any) => c.Name)
              : [],
          warnings: info.Warnings || [],
          live: true,
        },
      };
    });
  })

  // ── 磁盘占用 ──────────────────────────────────────────────────────
  .get("/api/docker/system/df", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("统计磁盘占用", async () => {
      const rows = await dockerJsonLines<any>(["system", "df", "--format={{json .}}"]);

      // 输出形如 {"Type":"Images","TotalCount":"12","Active":"5","Size":"3.1GB","Reclaimable":"1.2GB (38%)"}
      const items = rows.map((row) => ({
        type: row.Type || "",
        totalCount: parseInt(row.TotalCount || "0") || 0,
        active: parseInt(row.Active || "0") || 0,
        size: parseSize(row.Size),
        sizeText: row.Size || "0B",
        reclaimableText: row.Reclaimable || "0B",
        reclaimable: parseSize((row.Reclaimable || "").split(" ")[0]),
      }));

      return {
        success: true as const,
        items,
        totalSize: items.reduce((sum, i) => sum + i.size, 0),
        totalReclaimable: items.reduce((sum, i) => sum + i.reclaimable, 0),
      };
    });
  })

  // ── 全局清理 ──────────────────────────────────────────────────────
  .post("/api/docker/system/prune", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    // all：连未被使用的镜像一起删；volumes：连数据卷一起删（危险，默认关闭）
    const all = body?.all === true;
    const withVolumes = body?.volumes === true;

    return guard("全局清理", async () => {
      const args = ["system", "prune", "--force"];
      if (all) args.push("--all");
      if (withVolumes) args.push("--volumes");

      const out = await docker(args);
      const reclaimed = out.match(/Total reclaimed space:\s*(.+)/i)?.[1]?.trim() || "0B";
      logger.info(
        `[docker] 全局清理完成（all=${all} volumes=${withVolumes}），释放 ${reclaimed}`,
      );
      return {
        success: true as const,
        message: `清理完成，释放 ${reclaimed}`,
        reclaimed,
        output: out.trim(),
      };
    });
  })

  // ── 守护进程服务状态 ──────────────────────────────────────────────
  .get("/api/docker/daemon/status", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (process.platform === "win32") {
      return { success: false, message: "Windows 下不支持通过面板管理 Docker 守护进程" };
    }

    return guard("获取 Docker 服务状态", async () => {
      const [activeState, enabledState] = await Promise.all([
        systemctl(["is-active", "docker"]).catch(() => "unknown"),
        systemctl(["is-enabled", "docker"]).catch(() => "unknown"),
      ]);

      let since = "";
      try {
        since = await systemctl([
          "show",
          "docker",
          "--property=ExecMainStartTimestamp",
          "--value",
        ]);
      } catch {
        // 忽略
      }

      return {
        success: true as const,
        daemon: {
          active: activeState === "active",
          activeState,
          enabled: enabledState === "enabled" || enabledState === "enabled-runtime",
          enabledState,
          since,
        },
      };
    });
  })

  // ── 守护进程启停 ──────────────────────────────────────────────────
  .post("/api/docker/daemon/:action", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (process.platform === "win32") {
      return { success: false, message: "Windows 下不支持通过面板管理 Docker 守护进程" };
    }

    const valid = ["start", "stop", "restart", "enable", "disable"];
    if (!valid.includes(params.action)) return { success: false, message: "无效的操作" };

    return guard(`Docker 服务 ${params.action}`, async () => {
      await systemctl([params.action, "docker"]);
      const labels: Record<string, string> = {
        start: "启动",
        stop: "停止",
        restart: "重启",
        enable: "设为开机自启",
        disable: "取消开机自启",
      };
      logger.info(`[docker] Docker 守护进程已${labels[params.action]}`);
      return { success: true as const, message: `Docker 服务已${labels[params.action]}` };
    });
  });
