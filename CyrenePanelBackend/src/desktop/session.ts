/**
 * 桌面会话生命周期。
 *
 * 每个会话是一组进程：Xvfb(虚拟屏) + openbox(窗口管理) + 目标应用 + x11vnc(抓帧)。
 * 照 instances/manager.ts 的做法用 Map 注册表 + SIGTERM/SIGKILL 管理，
 * 外加空闲回收：常驻进程不管前端连没连都占着内存，断开超时就整组拆掉。
 *
 * 安全与资源上的几条硬约束：
 * - x11vnc 只绑 127.0.0.1（-localhost），唯一入口是票据鉴权的 WS 桥，不开任何公网端口。
 * - 启动目标走白名单，绝不接受前端传来的任意命令。
 * - 并发会话数封顶，小内存机器上别被开爆。
 */

import { existsSync } from "fs";
import { logger } from "../logger/index";
import { detectDeps } from "./deps";

/** 可启动的 GUI 应用白名单。command 是无参二进制名，highMemory 用来在前端二次确认 */
export interface DesktopApp {
  id: string;
  label: string;
  command: string;
  highMemory: boolean;
}

export const DESKTOP_APPS: DesktopApp[] = [
  { id: "xterm", label: "终端 (xterm)", command: "xterm", highMemory: false },
  { id: "xcalc", label: "计算器 (xcalc)", command: "xcalc", highMemory: false },
  { id: "xeyes", label: "xeyes（演示）", command: "xeyes", highMemory: false },
];

/** 同时最多几个会话。这台是 7.8G/无 swap，先给 2，可后续做成配置 */
const MAX_SESSIONS = 2;
/** 断开超过这个时长自动回收 */
const IDLE_MS = 15 * 60 * 1000;
const GEOMETRY = { width: 1280, height: 720, depth: 24 };

interface Session {
  id: string;
  appId: string;
  appLabel: string;
  display: number;
  port: number;
  procs: Bun.Subprocess[];
  startedAt: number;
  lastActiveAt: number;
  /** 当前挂着的 WS 桥数量，>0 表示有人在看 */
  clients: number;
}

const sessions = new Map<string, Session>();

export interface SessionInfo {
  id: string;
  appId: string;
  appLabel: string;
  geometry: { width: number; height: number };
  startedAt: number;
}

function toInfo(s: Session): SessionInfo {
  return {
    id: s.id,
    appId: s.appId,
    appLabel: s.appLabel,
    geometry: { width: GEOMETRY.width, height: GEOMETRY.height },
    startedAt: s.startedAt,
  };
}

function usedDisplays(): Set<number> {
  return new Set([...sessions.values()].map((s) => s.display));
}

/** 找一个没被占用的显示号（:N 与 /tmp/.X11-unix/XN 都空闲） */
function allocateDisplay(): number | null {
  const used = usedDisplays();
  for (let n = 10; n < 100; n++) {
    if (used.has(n)) continue;
    if (existsSync(`/tmp/.X11-unix/X${n}`)) continue;
    return n;
  }
  return null;
}

function spawnProc(cmd: string[], display: number): Bun.Subprocess {
  const env = { ...process.env, DISPLAY: `:${display}` };
  // -ac 关掉了 X 的访问控制，本来就靠的是 XAUTHORITY，这里清掉避免鉴权文件不匹配
  delete (env as Record<string, string | undefined>).XAUTHORITY;
  return Bun.spawn(cmd, { env, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
}

/** 等 Xvfb 把 unix socket 建出来，最多等 ~3 秒 */
async function waitForDisplay(display: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(`/tmp/.X11-unix/X${display}`)) return true;
    await Bun.sleep(80);
  }
  return false;
}

export async function startSession(
  appId: string,
): Promise<{ ok: boolean; message?: string; session?: SessionInfo }> {
  if (!detectDeps().installed) {
    return { ok: false, message: "桌面依赖未安装，请先在页面启用" };
  }
  if (sessions.size >= MAX_SESSIONS) {
    return { ok: false, message: `已达并发上限（${MAX_SESSIONS} 个会话），请先关闭一个` };
  }
  const app = DESKTOP_APPS.find((a) => a.id === appId);
  if (!app) return { ok: false, message: "未知的应用" };

  const display = allocateDisplay();
  if (display === null) return { ok: false, message: "没有空闲的显示号" };
  const port = 5900 + display;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const procs: Bun.Subprocess[] = [];
  const teardown = () => stopSessionById(id);

  try {
    // 1) 虚拟显示。-nolisten tcp 只留 unix socket，-ac 因此可安全关闭访问控制
    const xvfb = spawnProc(
      ["Xvfb", `:${display}`, "-screen", "0", `${GEOMETRY.width}x${GEOMETRY.height}x${GEOMETRY.depth}`, "-nolisten", "tcp", "-ac"],
      display,
    );
    procs.push(xvfb);
    xvfb.exited.then(() => teardown());

    if (!(await waitForDisplay(display))) {
      xvfb.kill();
      return { ok: false, message: "虚拟显示启动超时" };
    }

    // 2) 轻量窗口管理器，让应用窗口可移动/最大化
    procs.push(spawnProc(["openbox"], display));

    // 3) 目标应用。退出即拆会话
    const appProc = spawnProc([app.command], display);
    procs.push(appProc);
    appProc.exited.then(() => teardown());

    // 4) VNC 服务端，只绑本机
    procs.push(
      spawnProc(
        ["x11vnc", "-display", `:${display}`, "-rfbport", String(port), "-localhost", "-forever", "-shared", "-nopw", "-noxdamage", "-quiet"],
        display,
      ),
    );

    const now = Date.now();
    sessions.set(id, {
      id, appId, appLabel: app.label, display, port, procs, startedAt: now, lastActiveAt: now, clients: 0,
    });
    logger.info(`[desktop] 会话已启动 id=${id} app=${appId} display=:${display} port=${port}`);
    return { ok: true, session: toInfo(sessions.get(id)!) };
  } catch (e: any) {
    for (const p of procs) { try { p.kill(); } catch {} }
    logger.err(`[desktop] 会话启动失败: ${e.message}`);
    return { ok: false, message: e.message || "会话启动失败" };
  }
}

function stopSessionById(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  for (const p of s.procs) {
    try { p.kill(); } catch {}
  }
  // 兜底：3 秒后仍在的强杀
  setTimeout(() => {
    for (const p of s.procs) {
      try { if (p.exitCode === null) p.kill(9); } catch {}
    }
  }, 3000);
  logger.info(`[desktop] 会话已停止 id=${id}`);
}

export function stopSession(id: string): { ok: boolean; message?: string } {
  if (!sessions.has(id)) return { ok: false, message: "会话不存在" };
  stopSessionById(id);
  return { ok: true };
}

export function listSessions(): SessionInfo[] {
  return [...sessions.values()].map(toInfo);
}

/** WS 桥用：按 id 取端口，同时刷新活跃时间并登记一个观看者 */
export function attachClient(id: string): { port: number } | null {
  const s = sessions.get(id);
  if (!s) return null;
  s.clients += 1;
  s.lastActiveAt = Date.now();
  return { port: s.port };
}

export function detachClient(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.clients = Math.max(0, s.clients - 1);
  s.lastActiveAt = Date.now();
}

export const desktopLimits = { maxSessions: MAX_SESSIONS, idleMs: IDLE_MS, geometry: GEOMETRY };

// 空闲回收：没有观看者且超过 IDLE_MS 未活跃的会话整组拆掉
setInterval(() => {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (s.clients === 0 && now - s.lastActiveAt > IDLE_MS) {
      logger.info(`[desktop] 会话空闲回收 id=${s.id}`);
      stopSessionById(s.id);
    }
  }
}, 60_000);
