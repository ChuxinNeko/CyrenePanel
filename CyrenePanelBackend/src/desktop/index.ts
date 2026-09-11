/**
 * 桌面模拟路由。
 *
 * 功能默认关闭：/status 报告依赖是否装好，前端据此显示「启用」入口；
 * 只有用户手动点启用，才走 /install/stream 装依赖。会话启动、VNC 桥接都要求管理员
 * ——桌面等于以 root 跑任意 GUI，与系统终端同级。
 */

import { Elysia } from "elysia";
import { logger } from "../logger/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import { consumeTicket } from "../terminal/ticket";
import { buildAppInstallCommand, buildInstallCommand, buildUninstallCommand, detectDeps, detectPackageManager } from "./deps";
import {
  attachClient,
  desktopLimits,
  detachClient,
  getAppInstallPackages,
  listApps,
  listSessions,
  startSession,
  stopAllSessions,
  stopSession,
} from "./session";

/** 跑一条命令并把输出按行 SSE 推给前端，装/卸/装应用共用。done 给出最终判定 */
function streamShell(
  command: string,
  startMsg: string,
  done: (code: number) => { success: boolean; message: string },
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send({ type: "stage", message: startMsg });

      const proc = Bun.spawn(["bash", "-lc", command], { stdout: "pipe", stderr: "pipe" });
      const pump = async (rs: ReadableStream<Uint8Array>) => {
        const reader = rs.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done: d, value } = await reader.read();
          if (d) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() || "";
          for (const line of lines) if (line.trim()) send({ type: "log", line });
        }
        if (buf.trim()) send({ type: "log", line: buf });
      };
      await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
      const code = await proc.exited;

      const result = done(code);
      send({ type: "done", ...result });
      if (!closed) {
        closed = true;
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

const noPmResponse = () =>
  new Response(JSON.stringify({ success: false, message: "当前系统无受支持的包管理器" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });

/** 启用 / 停用桌面依赖集 */
function depsStream(action: "install" | "uninstall"): Response {
  const pm = detectPackageManager();
  if (!pm) return noPmResponse();
  const command = action === "install" ? buildInstallCommand(pm) : buildUninstallCommand(pm);
  const startMsg =
    action === "install"
      ? "开始安装桌面依赖（Xvfb / x11vnc / openbox / tint2 / pcmanfm / 字体）..."
      : "开始卸载桌面依赖，恢复到未启用状态...";
  return streamShell(command, startMsg, (code) => {
    const after = detectDeps();
    const ok = action === "install" ? code === 0 && after.installed : code === 0 && !after.installed;
    return {
      success: ok,
      message: ok
        ? action === "install" ? "桌面依赖安装完成" : "桌面依赖已卸载"
        : `${action === "install" ? "安装" : "卸载"}未完成（退出码 ${code}）`,
    };
  });
}

/** 按需安装单个应用 */
function appInstallStream(appId: string): Response {
  const pm = detectPackageManager();
  if (!pm) return noPmResponse();
  const pkgs = getAppInstallPackages(appId);
  if (!pkgs) {
    return new Response(JSON.stringify({ success: false, message: "该应用不支持面板内安装" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return streamShell(
    buildAppInstallCommand(pm, pkgs),
    `开始安装 ${pkgs.join(" ")}...`,
    (code) => {
      const nowAvailable = listApps().find((a) => a.id === appId)?.available ?? false;
      const ok = code === 0 && nowAvailable;
      return { success: ok, message: ok ? "应用安装完成" : `安装未完成（退出码 ${code}）` };
    },
  );
}

export const desktopRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => ({
    profile: await resolveRequestProfile(jwt, request),
  }))

  // 依赖与会话状态。前端用它决定显示「启用」还是「桌面」
  .get("/api/desktop/status", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const deps = detectDeps();
    return {
      success: true,
      enabled: deps.installed,
      deps,
      apps: listApps(),
      sessions: listSessions(),
      limits: {
        maxSessions: desktopLimits.maxSessions,
        idleMinutes: desktopLimits.idleMs / 60000,
        geometries: desktopLimits.geometries,
        privileged: desktopLimits.privileged,
      },
      isAdmin: profile.role === "admin",
    };
  })

  // 手动启用：安装依赖。管理员专属
  .post("/api/desktop/install/stream", ({ profile }: any) => {
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    if (profile.role !== "admin") {
      return new Response(JSON.stringify({ success: false, message: "需要管理员权限" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    return depsStream("install");
  })

  // 按需安装单个应用（浏览器等未预装的）。管理员专属
  .post("/api/desktop/apps/:id/install/stream", ({ profile, params }: any) => {
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    if (profile.role !== "admin") {
      return new Response(JSON.stringify({ success: false, message: "需要管理员权限" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    return appInstallStream(String(params.id));
  })

  // 停用：拆掉所有会话并卸载依赖，回到零占用状态。管理员专属
  .post("/api/desktop/uninstall/stream", ({ profile }: any) => {
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    if (profile.role !== "admin") {
      return new Response(JSON.stringify({ success: false, message: "需要管理员权限" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    const killed = stopAllSessions();
    if (killed > 0) logger.info(`[desktop] 停用前先关闭 ${killed} 个会话`);
    return depsStream("uninstall");
  })

  .post("/api/desktop/sessions", async ({ profile, body }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (profile.role !== "admin") return { success: false, message: "需要管理员权限" };
    const mode = body?.mode === "desktop" ? "desktop" : "app";
    const result = await startSession({
      mode,
      appId: body?.appId ? String(body.appId) : undefined,
      geometryId: body?.geometryId ? String(body.geometryId) : undefined,
    });
    return result.ok
      ? { success: true, session: result.session }
      : { success: false, message: result.message };
  })

  .delete("/api/desktop/sessions/:id", ({ profile, params }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (profile.role !== "admin") return { success: false, message: "需要管理员权限" };
    return stopSession(params.id);
  })

  /**
   * VNC 桥：把浏览器的 RFB-over-WS 二进制流双向管到本机 x11vnc。
   * 鉴权走一次性票据（purpose=desktop，签发端已限管理员）。
   */
  .ws("/api/desktop/vnc", {
    async beforeHandle({ request }: any) {
      const url = new URL(request.url);
      const ticket = consumeTicket(url.searchParams.get("ticket"), "desktop");
      if (!ticket || ticket.role !== "admin") {
        return new Response("Unauthorized", { status: 401 });
      }
    },

    open(ws) {
      const url = new URL((ws.data as any).request?.url || "");
      const sessionId = url.searchParams.get("session") || "";
      const attached = attachClient(sessionId);
      if (!attached) {
        ws.send(JSON.stringify({ type: "error", message: "会话不存在或已关闭" }));
        ws.close();
        return;
      }
      (ws.data as any).sessionId = sessionId;
      (ws.data as any).connected = true;

      // 连本机 x11vnc，把两端字节直连
      Bun.connect({
        hostname: "127.0.0.1",
        port: attached.port,
        socket: {
          data(_sock, chunk) {
            if ((ws.data as any).connected) {
              try { ws.send(chunk); } catch {}
            }
          },
          close() {
            (ws.data as any).connected = false;
            try { ws.close(); } catch {}
          },
          error() {
            (ws.data as any).connected = false;
            try { ws.close(); } catch {}
          },
        },
      })
        .then((sock) => {
          (ws.data as any).vncSock = sock;
          // 竞态：socket 建好前浏览器已断开，补一次关闭
          if (!(ws.data as any).connected) {
            try { sock.end(); } catch {}
          }
        })
        .catch((e) => {
          logger.err(`[desktop] 连接 x11vnc 失败: ${e?.message}`);
          try { ws.send(JSON.stringify({ type: "error", message: "无法连接 VNC 服务" })); } catch {}
          try { ws.close(); } catch {}
        });
    },

    message(ws, message: any) {
      const sock = (ws.data as any).vncSock;
      if (!sock) return;
      try {
        if (typeof message === "string") sock.write(message);
        else if (message instanceof ArrayBuffer) sock.write(new Uint8Array(message));
        else sock.write(message); // Buffer / Uint8Array
      } catch {
        // 写失败通常意味着对端已关，close 会兜底
      }
    },

    close(ws) {
      (ws.data as any).connected = false;
      const sock = (ws.data as any).vncSock;
      if (sock) { try { sock.end(); } catch {} }
      const sessionId = (ws.data as any).sessionId;
      if (sessionId) detachClient(sessionId);
    },
  });
