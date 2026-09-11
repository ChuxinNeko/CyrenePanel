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
import { detectDeps, detectPackageManager, has, type PackageManager } from "./deps";

/**
 * 可启动的 GUI 应用白名单。
 * commands 是候选二进制名，取第一个在本机存在的——同一个应用在不同发行版上
 * 名字不一样（浏览器在 Debian 是 firefox-esr、Ubuntu 是 firefox，或 chromium），
 * 写死单名会导致「明明装了却点不亮」。highMemory 用于前端二次确认。
 */
interface DesktopAppDef {
  id: string;
  label: string;
  commands: string[];
  highMemory: boolean;
  /** 未预装时可按需安装的包名（各发行版）。缺省表示不支持面板内安装 */
  install?: Partial<Record<PackageManager, string[]>>;
  /** 浏览器走专门的安装命令（Mozilla 源等），而非简单包名 */
  browserInstall?: boolean;
}

export interface DesktopApp {
  id: string;
  label: string;
  command: string;
  highMemory: boolean;
}

const APP_DEFS: DesktopAppDef[] = [
  { id: "xterm", label: "终端 (xterm)", commands: ["xterm"], highMemory: false, install: { apt: ["xterm"], dnf: ["xterm"], yum: ["xterm"] } },
  { id: "pcmanfm", label: "文件管理器", commands: ["pcmanfm"], highMemory: false, install: { apt: ["pcmanfm"], dnf: ["pcmanfm"], yum: ["pcmanfm"] } },
  { id: "xcalc", label: "计算器", commands: ["xcalc"], highMemory: false, install: { apt: ["x11-apps"], dnf: ["xorg-x11-apps"], yum: ["xorg-x11-apps"] } },
  { id: "xeyes", label: "xeyes（演示）", commands: ["xeyes"], highMemory: false, install: { apt: ["x11-apps"], dnf: ["xorg-x11-apps"], yum: ["xorg-x11-apps"] } },
  { id: "mousepad", label: "文本编辑器", commands: ["mousepad", "leafpad", "gedit"], highMemory: false, install: { apt: ["mousepad"], dnf: ["mousepad"], yum: ["mousepad"] } },
  // 浏览器装 Firefox：apt 走 Mozilla 官方源的真 deb（绕开 Ubuntu 的 snap），
  // dnf/yum 用发行版自带真 rpm。系统本就有 firefox/chromium 也识别并可直接启动。
  { id: "browser", label: "浏览器 (Firefox)", commands: ["firefox", "firefox-esr", "chromium", "chromium-browser"], highMemory: true, browserInstall: true },
];

/** 取第一个存在的候选命令，全不在则 null */
function resolveCommand(def: DesktopAppDef): string | null {
  return def.commands.find((c) => has(c)) ?? null;
}

/** 返回应用清单，附带是否可用、以及未装时能否面板内安装 */
export function listApps(): (DesktopApp & { available: boolean; installable: boolean })[] {
  const pm = detectPackageManager();
  return APP_DEFS.map((def) => {
    const command = resolveCommand(def);
    const available = command !== null;
    const installable = !available && !!pm && (def.browserInstall === true || !!def.install?.[pm]);
    return {
      id: def.id,
      label: def.label,
      command: command ?? def.commands[0],
      highMemory: def.highMemory,
      available,
      installable,
    };
  });
}

function findApp(id: string): DesktopAppDef | undefined {
  return APP_DEFS.find((a) => a.id === id);
}

export type AppInstallSpec =
  | { kind: "browser" }
  | { kind: "packages"; packages: string[] };

/** 某应用在当前发行版上的安装方式，用于按需安装路由 */
export function getAppInstall(id: string): AppInstallSpec | null {
  const pm = detectPackageManager();
  const def = findApp(id);
  if (!pm || !def) return null;
  if (def.browserInstall) return { kind: "browser" };
  const packages = def.install?.[pm];
  return packages ? { kind: "packages", packages } : null;
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

function spawnProc(
  cmd: string[],
  display: number,
  home: string,
  extraEnv?: Record<string, string>,
): Bun.Subprocess {
  const env = { ...process.env, DISPLAY: `:${display}`, HOME: home, ...extraEnv };
  // -ac 关掉了 X 访问控制，这里清掉 XAUTHORITY 避免鉴权文件不匹配
  delete (env as Record<string, string | undefined>).XAUTHORITY;
  return Bun.spawn(privilegeWrap(cmd), { env, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
}

/**
 * 浏览器以 root 跑时的处理：Chromium 系默认沙箱在 root 下拒绝启动，需 --no-sandbox。
 * Firefox 以 root 跑只是告警、能正常运行，无需特殊处理。降权到普通用户后都不必。
 */
function browserLaunch(command: string): { cmd: string[]; env: Record<string, string> } {
  if (DESKTOP_USER) return { cmd: [command], env: {} };
  if (/chromium/.test(command)) return { cmd: [command, "--no-sandbox"], env: {} };
  return { cmd: [command], env: {} };
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
  let appId: string | null = null;
  let appCommand: string | null = null;
  let label: string;
  if (opts.mode === "app") {
    const def = findApp(opts.appId || "");
    if (!def) return { ok: false, message: "未知的应用" };
    appCommand = resolveCommand(def);
    if (!appCommand) return { ok: false, message: `${def.label} 未安装` };
    appId = def.id;
    label = def.label;
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

    if (opts.mode === "app" && appCommand) {
      // 3-app) 单应用：退出即拆会话。浏览器 root 下需关沙箱
      const launch = appId === "browser" ? browserLaunch(appCommand) : { cmd: [appCommand], env: {} };
      const appProc = spawnProc(launch.cmd, display, home, launch.env);
      procs.push(appProc);
      appProc.exited.then(() => teardown());
    }

    // 4) VNC 服务端，只绑本机。性能相关：
    //    -threads    输入/输出多线程，交互延迟明显下降
    //    (不加 -noxdamage) 让 x11vnc 走 XDAMAGE 事件驱动，只重读变化区域，
    //                比全屏轮询省大量 CPU、也更跟手；现代 Xvfb 的 XDAMAGE 已可靠
    //    -defer 8 / -wait 8  更小的合帧间隔，画面更跟手（默认 30ms）
    //    -nolookup   跳过连接时的反向 DNS
    procs.push(
      spawnProc(
        ["x11vnc", "-display", `:${display}`, "-rfbport", String(port), "-localhost", "-forever", "-shared", "-nopw", "-threads", "-defer", "8", "-wait", "8", "-nolookup", "-xrandr", "resize", "-quiet"],
        display,
        home,
      ),
    );

    const now = Date.now();
    sessions.set(id, {
      id, mode: opts.mode, appId, label,
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
