/**
 * 桌面会话生命周期。
 *
 * 每个会话是一组进程：Xvfb(虚拟屏) + openbox(窗口管理) +（桌面模式追加）tint2 任务栏
 * 与 pcmanfm 文件管理器 + 目标应用 + x11vnc(抓帧)。照 instances/manager.ts 用 Map
 * 注册表 + SIGTERM/SIGKILL 管理，外加空闲回收：常驻进程不管前端连没连都占内存，
 * 断开超时就整组拆掉。
 *
 * 安全与资源约束：
 * - x11vnc 只绑 127.0.0.1（-localhost），唯一入口是票据鉴权的 WS 桥，不开任何公网端口。
 * - 启动目标走白名单，绝不接受前端传来的任意命令；分辨率也从预设里选，不接受任意值。
 * - 并发封顶 + 空闲回收，小内存机器上别被开爆。
 * - 可选降权：设了 CYRENE_DESKTOP_USER 且该用户存在时，X 会话以该非 root 用户运行。
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { logger } from "../logger/index";
import { detectDeps, has } from "./deps";

/** 可启动的 GUI 应用白名单。command 是无参二进制名，highMemory 用于前端二次确认 */
export interface DesktopApp {
  id: string;
  label: string;
  command: string;
  highMemory: boolean;
}

const APP_DEFS: DesktopApp[] = [
  { id: "xterm", label: "终端 (xterm)", command: "xterm", highMemory: false },
  { id: "pcmanfm", label: "文件管理器", command: "pcmanfm", highMemory: false },
  { id: "xcalc", label: "计算器", command: "xcalc", highMemory: false },
  { id: "xeyes", label: "xeyes（演示）", command: "xeyes", highMemory: false },
  { id: "mousepad", label: "文本编辑器", command: "mousepad", highMemory: false },
  { id: "firefox", label: "Firefox 浏览器", command: "firefox-esr", highMemory: true },
];

/** 返回应用清单，附带该二进制在本机是否可用（前端据此禁用未安装项） */
export function listApps(): (DesktopApp & { available: boolean })[] {
  return APP_DEFS.map((a) => ({ ...a, available: has(a.command) }));
}

function findApp(id: string): DesktopApp | undefined {
  return APP_DEFS.find((a) => a.id === id);
}

/** 分辨率预设。不接受前端任意值，避免被塞进 Xvfb 命令 */
export const GEOMETRIES = [
  { id: "1280x720", width: 1280, height: 720 },
  { id: "1366x768", width: 1366, height: 768 },
  { id: "1600x900", width: 1600, height: 900 },
  { id: "1920x1080", width: 1920, height: 1080 },
] as const;
const DEFAULT_GEOMETRY = GEOMETRIES[0];

/** 同时最多几个会话。这台 7.8G/无 swap，先给 2 */
const MAX_SESSIONS = 2;
/** 断开超过这个时长自动回收 */
const IDLE_MS = 15 * 60 * 1000;
const DEPTH = 24;

/** 可选：把 X 会话降权到这个用户跑（需存在）。默认不降权 */
const DESKTOP_USER = process.env.CYRENE_DESKTOP_USER || "";

type SessionMode = "app" | "desktop";

interface Session {
  id: string;
  mode: SessionMode;
  appId: string | null;
  label: string;
  display: number;
  port: number;
  width: number;
  height: number;
  home: string;
  procs: Bun.Subprocess[];
  startedAt: number;
  lastActiveAt: number;
  clients: number;
}

const sessions = new Map<string, Session>();

export interface SessionInfo {
  id: string;
  mode: SessionMode;
  appId: string | null;
  label: string;
  geometry: { id: string; width: number; height: number };
  startedAt: number;
}

function toInfo(s: Session): SessionInfo {
  return {
    id: s.id,
    mode: s.mode,
    appId: s.appId,
    label: s.label,
    geometry: { id: `${s.width}x${s.height}`, width: s.width, height: s.height },
    startedAt: s.startedAt,
  };
}

function allocateDisplay(): number | null {
  const used = new Set([...sessions.values()].map((s) => s.display));
  for (let n = 10; n < 100; n++) {
    if (used.has(n)) continue;
    if (existsSync(`/tmp/.X11-unix/X${n}`)) continue;
    return n;
  }
  return null;
}

/** 降权前缀：设了用户且存在就用 runuser 包一层，否则原样跑 */
function privilegeWrap(cmd: string[]): string[] {
  if (DESKTOP_USER && has("runuser")) {
    return ["runuser", "-u", DESKTOP_USER, "--", ...cmd];
  }
  return cmd;
}

function spawnProc(cmd: string[], display: number, home: string): Bun.Subprocess {
  const env = { ...process.env, DISPLAY: `:${display}`, HOME: home };
  // -ac 关掉了 X 访问控制，这里清掉 XAUTHORITY 避免鉴权文件不匹配
  delete (env as Record<string, string | undefined>).XAUTHORITY;
  return Bun.spawn(privilegeWrap(cmd), { env, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
}

async function waitForDisplay(display: number, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(`/tmp/.X11-unix/X${display}`)) return true;
    await Bun.sleep(80);
  }
  return false;
}

/** 桌面模式：写 openbox 菜单（列出已装应用）+ autostart（拉起任务栏和文件管理器） */
function writeDesktopConfig(home: string): void {
  const obDir = `${home}/.config/openbox`;
  mkdirSync(obDir, { recursive: true });

  const apps = listApps().filter((a) => a.available && a.id !== "pcmanfm");
  const items = apps
    .map(
      (a) =>
        `    <item label="${a.label}"><action name="Execute"><command>${a.command}</command></action></item>`,
    )
    .join("\n");
  writeFileSync(
    `${obDir}/menu.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>
<openbox_menu xmlns="http://openbox.org/3.4/menu">
  <menu id="root-menu" label="应用">
${items}
    <separator/>
    <item label="重启窗口管理器"><action name="Restart"/></item>
  </menu>
</openbox_menu>
`,
  );

  const autostart: string[] = [];
  if (has("tint2")) autostart.push("tint2 &");
  if (has("pcmanfm")) autostart.push("pcmanfm --desktop &");
  writeFileSync(`${obDir}/autostart`, autostart.join("\n") + "\n");
}

export interface StartOptions {
  mode: SessionMode;
  appId?: string;
  geometryId?: string;
}

export async function startSession(
  opts: StartOptions,
): Promise<{ ok: boolean; message?: string; session?: SessionInfo }> {
  if (!detectDeps().installed) {
    return { ok: false, message: "桌面依赖未安装，请先在页面启用" };
  }
  if (sessions.size >= MAX_SESSIONS) {
    return { ok: false, message: `已达并发上限（${MAX_SESSIONS} 个会话），请先关闭一个` };
  }

  const geometry = GEOMETRIES.find((g) => g.id === opts.geometryId) ?? DEFAULT_GEOMETRY;
  let app: DesktopApp | undefined;
  let label: string;
  if (opts.mode === "app") {
    app = findApp(opts.appId || "");
    if (!app) return { ok: false, message: "未知的应用" };
    if (!has(app.command)) return { ok: false, message: `${app.label} 未安装` };
    label = app.label;
  } else {
    label = "桌面";
  }

  const display = allocateDisplay();
  if (display === null) return { ok: false, message: "没有空闲的显示号" };
  const port = 5900 + display;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const home = `/tmp/cyrene-desktop-${id}`;

  const procs: Bun.Subprocess[] = [];
  const teardown = () => stopSessionById(id);

  try {
    mkdirSync(home, { recursive: true });
    if (opts.mode === "desktop") writeDesktopConfig(home);

    // 1) 虚拟显示。-nolisten tcp 只留 unix socket，-ac 因此可安全关闭访问控制
    const xvfb = spawnProc(
      ["Xvfb", `:${display}`, "-screen", "0", `${geometry.width}x${geometry.height}x${DEPTH}`, "-nolisten", "tcp", "-ac"],
      display,
      home,
    );
    procs.push(xvfb);
    xvfb.exited.then(() => teardown());

    if (!(await waitForDisplay(display))) {
      xvfb.kill();
      return { ok: false, message: "虚拟显示启动超时" };
    }

    // 2) 窗口管理器。桌面模式下它的 autostart 会拉起 tint2 + pcmanfm
    procs.push(spawnProc(["openbox"], display, home));

    if (opts.mode === "app" && app) {
      // 3-app) 单应用：退出即拆会话
      const appProc = spawnProc([app.command], display, home);
      procs.push(appProc);
      appProc.exited.then(() => teardown());
    }

    // 4) VNC 服务端，只绑本机；-xrandr resize 让分辨率可跟随
    procs.push(
      spawnProc(
        ["x11vnc", "-display", `:${display}`, "-rfbport", String(port), "-localhost", "-forever", "-shared", "-nopw", "-noxdamage", "-xrandr", "resize", "-quiet"],
        display,
        home,
      ),
    );

    const now = Date.now();
    sessions.set(id, {
      id, mode: opts.mode, appId: app?.id ?? null, label,
      display, port, width: geometry.width, height: geometry.height, home,
      procs, startedAt: now, lastActiveAt: now, clients: 0,
    });
    logger.info(`[desktop] 会话已启动 id=${id} mode=${opts.mode} display=:${display} ${geometry.id}${DESKTOP_USER ? ` user=${DESKTOP_USER}` : ""}`);
    return { ok: true, session: toInfo(sessions.get(id)!) };
  } catch (e: any) {
    for (const p of procs) { try { p.kill(); } catch {} }
    try { rmSync(home, { recursive: true, force: true }); } catch {}
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
  setTimeout(() => {
    for (const p of s.procs) {
      try { if (p.exitCode === null) p.kill(9); } catch {}
    }
    try { rmSync(s.home, { recursive: true, force: true }); } catch {}
  }, 3000);
  logger.info(`[desktop] 会话已停止 id=${id}`);
}

export function stopSession(id: string): { ok: boolean; message?: string } {
  if (!sessions.has(id)) return { ok: false, message: "会话不存在" };
  stopSessionById(id);
  return { ok: true };
}

/** 停用整个功能时，先把所有会话拆掉 */
export function stopAllSessions(): number {
  const ids = [...sessions.keys()];
  for (const id of ids) stopSessionById(id);
  return ids.length;
}

export function listSessions(): SessionInfo[] {
  return [...sessions.values()].map(toInfo);
}

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

export const desktopLimits = {
  maxSessions: MAX_SESSIONS,
  idleMs: IDLE_MS,
  geometries: GEOMETRIES,
  privileged: !DESKTOP_USER,
};

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
