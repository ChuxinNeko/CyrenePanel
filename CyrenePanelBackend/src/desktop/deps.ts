/**
 * 桌面模拟功能的依赖检测与安装命令。
 *
 * 这个功能默认关闭：不安装任何东西，面板在小内存机器上零额外占用。
 * 用户在页面手动点「启用」时，才按当前发行版把下面这几个包装上。
 *
 * P1（单应用串流）只需要：虚拟显示 + VNC 服务端 + 轻量窗口管理器 +
 * 几个演示用小程序 + 中文字体。浏览器这类内存大户不预装，按需再说。
 */

import { execSync } from "child_process";

export type PackageManager = "apt" | "dnf" | "yum";

/** 检测这些二进制在不在，用来判断功能是否「已启用」 */
export const REQUIRED_BINARIES = ["Xvfb", "x11vnc", "openbox"] as const;

/** 各发行版的包名。演示程序 xterm/xeyes 分属不同包，一并装上 */
const PACKAGES: Record<PackageManager, string[]> = {
  apt: ["xvfb", "x11vnc", "openbox", "xterm", "x11-apps", "fonts-wqy-zenhei"],
  dnf: ["xorg-x11-server-Xvfb", "x11vnc", "openbox", "xterm", "xorg-x11-apps", "wqy-zenhei-fonts"],
  yum: ["xorg-x11-server-Xvfb", "x11vnc", "openbox", "xterm", "xorg-x11-apps", "wqy-zenhei-fonts"],
};

function has(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function detectPackageManager(): PackageManager | null {
  if (has("apt-get")) return "apt";
  if (has("dnf")) return "dnf";
  if (has("yum")) return "yum";
  return null;
}

export interface DepsStatus {
  /** 三个核心二进制都在，才算启用 */
  installed: boolean;
  missing: string[];
  packageManager: PackageManager | null;
  /** 没有包管理器（如 Windows / 极简系统）时为 false，页面据此提示不可用 */
  installable: boolean;
}

export function detectDeps(): DepsStatus {
  if (process.platform !== "linux") {
    return { installed: false, missing: [...REQUIRED_BINARIES], packageManager: null, installable: false };
  }
  const missing = REQUIRED_BINARIES.filter((bin) => !has(bin));
  const packageManager = detectPackageManager();
  return {
    installed: missing.length === 0,
    missing,
    packageManager,
    installable: packageManager !== null,
  };
}

/**
 * 生成安装命令。root 直接跑，否则尝试 sudo -n；都不行就报错让用户在宿主机装。
 * 与 environments 模块的降权判断保持一致。
 */
export function buildInstallCommand(pm: PackageManager): string {
  const pkgs = PACKAGES[pm].join(" ");
  const install =
    pm === "apt"
      ? `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgs}`
      : `${pm} install -y ${pkgs}`;
  return `if [ "$(id -u)" -eq 0 ]; then ${install}; elif sudo -n true >/dev/null 2>&1; then sudo bash -c '${install}'; else echo "面板进程非 root 且 sudo 不可用，请在宿主机 shell 中手动安装" >&2; exit 1; fi`;
}
