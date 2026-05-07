import { Elysia } from "elysia";
import { execFileSync } from "child_process";
import { platform } from "os";
import { logger } from "../logger/index";

type CheckStatus = "ok" | "missing" | "unsupported";

interface EnvironmentCheckItem {
  id: string;
  name: string;
  description: string;
  command: string;
  required: boolean;
  status: CheckStatus;
  installPackage?: string;
  installable: boolean;
}

interface PackageManager {
  id: string;
  name: string;
  installCommand: (packages: string[]) => { command: string; args: string[] };
}

function commandExists(command: string): boolean {
  try {
    const isWindows = platform() === "win32";
    execFileSync(
      isWindows ? "where.exe" : "sh",
      isWindows ? [command] : ["-lc", `command -v ${command}`],
      { stdio: "ignore", timeout: 5000, windowsHide: true },
    );
    return true;
  } catch {
    return false;
  }
}

function shellCommand(command: string): { command: string; args: string[] } {
  return { command: "sh", args: ["-lc", command] };
}

function isRootUser(): boolean {
  if (platform() === "win32") return true;
  try {
    const output = execFileSync("id", ["-u"], { encoding: "utf-8", timeout: 3000, windowsHide: true });
    return output.trim() === "0";
  } catch {
    return false;
  }
}

function privilegePrefix(): string {
  if (isRootUser()) return "";
  return commandExists("sudo") ? "sudo -n " : "";
}

function withPrivilege(command: string, args: string[]): { command: string; args: string[] } {
  if (isRootUser() || platform() === "win32") return { command, args };
  if (commandExists("sudo")) return { command: "sudo", args: ["-n", command, ...args] };
  return { command, args };
}

function detectPackageManager(): PackageManager | null {
  if (platform() === "win32") return null;
  const privilege = privilegePrefix();
  if (commandExists("apt-get")) {
    return {
      id: "apt-get",
      name: "APT",
      installCommand: (packages) => shellCommand(`${privilege}env DEBIAN_FRONTEND=noninteractive apt-get update && ${privilege}env DEBIAN_FRONTEND=noninteractive apt-get install -y ${packages.join(" ")}`),
    };
  }
  if (commandExists("dnf")) {
    return {
      id: "dnf",
      name: "DNF",
      installCommand: (packages) => withPrivilege("dnf", ["install", "-y", ...packages]),
    };
  }
  if (commandExists("yum")) {
    return {
      id: "yum",
      name: "YUM",
      installCommand: (packages) => withPrivilege("yum", ["install", "-y", ...packages]),
    };
  }
  if (commandExists("pacman")) {
    return {
      id: "pacman",
      name: "Pacman",
      installCommand: (packages) => withPrivilege("pacman", ["-Sy", "--noconfirm", ...packages]),
    };
  }
  if (commandExists("zypper")) {
    return {
      id: "zypper",
      name: "Zypper",
      installCommand: (packages) => withPrivilege("zypper", ["--non-interactive", "install", ...packages]),
    };
  }
  if (commandExists("apk")) {
    return {
      id: "apk",
      name: "APK",
      installCommand: (packages) => withPrivilege("apk", ["add", ...packages]),
    };
  }
  return null;
}

function buildChecks(): EnvironmentCheckItem[] {
  const isWindows = platform() === "win32";
  if (isWindows) {
    return [
      {
        id: "powershell",
        name: "PowerShell",
        description: "用于 Windows ZIP 压缩和解压。",
        command: "powershell.exe",
        required: true,
        status: commandExists("powershell.exe") ? "ok" : "missing",
        installable: false,
      },
      {
        id: "tar",
        name: "tar",
        description: "用于 Windows tar/tar.gz 压缩和解压。",
        command: "tar.exe",
        required: true,
        status: commandExists("tar.exe") ? "ok" : "missing",
        installable: false,
      },
    ];
  }

  const packageManager = detectPackageManager();
  return [
    {
      id: "tar",
      name: "tar",
      description: "用于 tar、tar.gz、tar.bz2、tar.xz 的压缩和解压。",
      command: "tar",
      required: true,
      status: commandExists("tar") ? "ok" : "missing",
      installPackage: "tar",
      installable: !!packageManager,
    },
    {
      id: "zip",
      name: "zip",
      description: "用于在 Linux 节点创建 .zip 压缩包。",
      command: "zip",
      required: true,
      status: commandExists("zip") ? "ok" : "missing",
      installPackage: "zip",
      installable: !!packageManager,
    },
    {
      id: "unzip",
      name: "unzip",
      description: "用于在 Linux 节点解压 .zip 压缩包。",
      command: "unzip",
      required: true,
      status: commandExists("unzip") ? "ok" : "missing",
      installPackage: "unzip",
      installable: !!packageManager,
    },
  ];
}

function currentCheckResult() {
  const packageManager = detectPackageManager();
  const checks = buildChecks();
  const missing = checks.filter((item) => item.required && item.status === "missing");
  const installableMissing = missing.filter((item) => item.installable);
  return {
    success: true,
    platform: platform(),
    packageManager: packageManager ? { id: packageManager.id, name: packageManager.name } : null,
    checks,
    missing,
    allReady: missing.length === 0,
    canInstall: installableMissing.length === missing.length && installableMissing.length > 0,
    message: missing.length === 0 ? "环境正常" : `发现 ${missing.length} 个缺失项`,
  };
}

function authToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

export const selfCheckRoutes = new Elysia()
  .get("/api/self-check/environment", async ({ jwt, request }: any) => {
    const token = authToken(request);
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };
    return currentCheckResult();
  })

  .post("/api/self-check/environment/install", async ({ jwt, request, body }: any) => {
    const token = authToken(request);
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };
    if (profile.role !== "admin") return { success: false, message: "仅管理员可安装面板依赖" };
    if (platform() === "win32") return { success: false, message: "Windows 依赖无法由面板自动安装，请手动安装缺失组件" };

    const packageManager = detectPackageManager();
    if (!packageManager) return { success: false, message: "未检测到支持的系统包管理器" };

    const checks = buildChecks();
    const requestedIds = Array.isArray(body?.ids) ? new Set(body.ids.map(String)) : null;
    const packages = checks
      .filter((item) => item.status === "missing" && item.installable && (!requestedIds || requestedIds.has(item.id)))
      .map((item) => item.installPackage)
      .filter((pkg): pkg is string => !!pkg);
    const uniquePackages = [...new Set(packages)];

    if (uniquePackages.length === 0) {
      return { ...currentCheckResult(), message: "没有需要安装的缺失项" };
    }

    try {
      const { command, args } = packageManager.installCommand(uniquePackages);
      logger.info(`环境自检安装依赖: ${packageManager.name} ${uniquePackages.join(", ")}`);
      const output = execFileSync(command, args, {
        encoding: "utf-8",
        timeout: 10 * 60 * 1000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 5,
      });
      return {
        ...currentCheckResult(),
        installOutput: output.slice(-4000),
        message: "依赖安装完成",
      };
    } catch (e: any) {
      logger.err(`环境依赖安装失败: ${e.message}`);
      return {
        success: false,
        message: `安装失败: ${e.message}`,
        installOutput: String(e.stdout || e.stderr || "").slice(-4000),
        result: currentCheckResult(),
      };
    }
  });
