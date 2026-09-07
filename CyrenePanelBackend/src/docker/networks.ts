/**
 * Docker 网络管理
 *
 * 覆盖：列表 / 详情 / 创建 / 删除 / 批量删除 / 清理未使用 / 连接与断开容器
 */

import { Elysia } from "elysia";

import { logger } from "../logger/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { docker, dockerJson, dockerJsonLines, guard } from "./cli";

/** Docker 预置网络，不允许删除 */
const BUILTIN_NETWORKS = new Set(["bridge", "host", "none"]);

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
  ipv6: boolean;
  created: string;
  subnets: { subnet: string; gateway: string }[];
  containerCount: number;
  builtin: boolean;
}

async function listNetworks(): Promise<DockerNetwork[]> {
  const rows = await dockerJsonLines<any>(["network", "ls", "--format={{json .}}"]);
  if (rows.length === 0) return [];

  // ls 不含子网和容器数，需要 inspect 补齐；一次传入全部网络，避免 N 次调用
  const details = new Map<string, any>();
  try {
    const inspected = await dockerJson<any[]>([
      "network",
      "inspect",
      ...rows.map((r) => r.ID),
    ]);
    for (const item of inspected) details.set(item.Id, item);
  } catch {
    // inspect 失败时退化为仅展示 ls 的信息
  }

  return rows.map((row) => {
    const detail = details.get(row.ID);
    const subnets = (detail?.IPAM?.Config || []).map((c: any) => ({
      subnet: c.Subnet || "",
      gateway: c.Gateway || "",
    }));
    return {
      id: row.ID,
      name: row.Name,
      driver: row.Driver,
      scope: row.Scope,
      internal: detail?.Internal ?? false,
      attachable: detail?.Attachable ?? false,
      ipv6: detail?.EnableIPv6 ?? false,
      created: detail?.Created || row.CreatedAt || "",
      subnets,
      containerCount: Object.keys(detail?.Containers || {}).length,
      builtin: BUILTIN_NETWORKS.has(row.Name),
    };
  });
}

export const dockerNetworkRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  .get("/api/docker/networks", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("列出网络", async () => ({
      success: true as const,
      networks: await listNetworks(),
    }));
  })

  .get("/api/docker/networks/:id", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("查看网络详情", async () => {
      const [data] = await dockerJson<any[]>(["network", "inspect", params.id]);
      return {
        success: true as const,
        network: {
          id: data.Id,
          name: data.Name,
          driver: data.Driver,
          scope: data.Scope,
          created: data.Created,
          internal: data.Internal,
          attachable: data.Attachable,
          ipv6: data.EnableIPv6,
          ipam: data.IPAM,
          options: data.Options || {},
          labels: data.Labels || {},
          containers: Object.entries(data.Containers || {}).map(([id, c]: [string, any]) => ({
            id,
            name: c.Name,
            ipv4: c.IPv4Address,
            ipv6: c.IPv6Address,
            mac: c.MacAddress,
          })),
        },
      };
    });
  })

  // ── 创建 ──────────────────────────────────────────────────────────
  .post("/api/docker/networks", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const name = String(body?.name || "").trim();
    if (!name) return { success: false, message: "网络名称不能为空" };
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return { success: false, message: "网络名称只能包含字母、数字、下划线、点和短横线，且不能以符号开头" };
    }

    const driver = String(body?.driver || "bridge").trim();
    const subnet = String(body?.subnet || "").trim();
    const gateway = String(body?.gateway || "").trim();
    const ipRange = String(body?.ipRange || "").trim();

    if (gateway && !subnet) return { success: false, message: "指定网关时必须同时指定子网" };
    if (ipRange && !subnet) return { success: false, message: "指定 IP 范围时必须同时指定子网" };

    const args = ["network", "create", "--driver", driver];
    if (subnet) args.push("--subnet", subnet);
    if (gateway) args.push("--gateway", gateway);
    if (ipRange) args.push("--ip-range", ipRange);
    if (body?.internal === true) args.push("--internal");
    if (body?.attachable === true) args.push("--attachable");
    if (body?.ipv6 === true) args.push("--ipv6");

    for (const [key, value] of Object.entries(body?.labels || {})) {
      args.push("--label", `${key}=${value}`);
    }
    for (const [key, value] of Object.entries(body?.options || {})) {
      args.push("--opt", `${key}=${value}`);
    }

    args.push(name);

    return guard("创建网络", async () => {
      const id = (await docker(args)).trim();
      logger.info(`[docker] 创建网络 ${name} (${driver})`);
      return { success: true as const, message: `网络 ${name} 已创建`, id };
    });
  })

  // ── 删除 ──────────────────────────────────────────────────────────
  .delete("/api/docker/networks/:id", async ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    return guard("删除网络", async () => {
      // 预置网络删不掉，提前给出明确提示而不是让 docker 报错
      const [detail] = await dockerJson<any[]>(["network", "inspect", params.id]);
      if (BUILTIN_NETWORKS.has(detail?.Name)) {
        return { success: false as const, message: `${detail.Name} 是 Docker 内置网络，不能删除` };
      }
      const inUse = Object.keys(detail?.Containers || {}).length;
      if (inUse > 0) {
        return {
          success: false as const,
          message: `该网络仍有 ${inUse} 个容器在使用，请先断开连接`,
        };
      }

      await docker(["network", "rm", params.id]);
      logger.info(`[docker] 删除网络 ${detail?.Name || params.id}`);
      return { success: true as const, message: "网络已删除" };
    });
  })

  // ── 清理未使用 ────────────────────────────────────────────────────
  .post("/api/docker/networks/prune", async ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    return guard("清理网络", async () => {
      const out = await docker(["network", "prune", "--force"]);
      const removed = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^deleted networks:/i.test(l));
      logger.info(`[docker] 清理未使用网络 ${removed.length} 个`);
      return {
        success: true as const,
        message: removed.length > 0 ? `已清理 ${removed.length} 个未使用网络` : "没有需要清理的网络",
        removed,
      };
    });
  })

  // ── 连接容器 ──────────────────────────────────────────────────────
  .post("/api/docker/networks/:id/connect", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const container = String(body?.container || "").trim();
    if (!container) return { success: false, message: "容器不能为空" };

    const args = ["network", "connect"];
    const ip = String(body?.ip || "").trim();
    const alias = String(body?.alias || "").trim();
    if (ip) args.push("--ip", ip);
    if (alias) args.push("--alias", alias);
    args.push(params.id, container);

    return guard("连接容器到网络", async () => {
      await docker(args);
      logger.info(`[docker] 容器 ${container} 已连接到网络 ${params.id}`);
      return { success: true as const, message: "已连接到网络" };
    });
  })

  // ── 断开容器 ──────────────────────────────────────────────────────
  .post("/api/docker/networks/:id/disconnect", async ({ params, body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const container = String(body?.container || "").trim();
    if (!container) return { success: false, message: "容器不能为空" };

    return guard("断开容器网络", async () => {
      await docker([
        "network",
        "disconnect",
        ...(body?.force === true ? ["--force"] : []),
        params.id,
        container,
      ]);
      logger.info(`[docker] 容器 ${container} 已从网络 ${params.id} 断开`);
      return { success: true as const, message: "已断开连接" };
    });
  });
