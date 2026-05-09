import { Elysia } from "elysia";
import { platform } from "os";
import { execSync } from "child_process";

// ── 类型定义 ──────────────────────────────────────────────────────────

interface EnvInfo {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  latestVersion: string | null;
  packageManager: string | null;
  installCommand: string | null;
  updateCommand: string | null;
  removeCommand: string | null;
  description: string;
  homepage: string | null;
  defaultVersion?: string | null;
  versionOptions?: { value: string; label: string; recommended?: boolean }[];
  installMethods?: InstallMethodOption[];
}

type EnvironmentInstallMethod = "quick" | "compile";

interface InstallMethodOption {
  value: EnvironmentInstallMethod;
  label: string;
  description: string;
  recommended?: boolean;
  supportsVersion?: boolean;
}

// ── 工具函数 ──────────────────────────────────────────────────────────

function execCmd(cmd: string, timeoutMs = 15000): string {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    if (e.stdout) return (e.stdout as Buffer).toString("utf-8").trim();
    throw e;
  }
}

function execCmdSafe(cmd: string, timeoutMs = 15000): string | null {
  try {
    return execCmd(cmd, timeoutMs);
  } catch {
    return null;
  }
}

function isLinuxPlatform(): boolean {
  return platform() !== "win32";
}

function getOfficialServerUrl(): string {
  return (
    process.env.CYRENE_OFFICIAL_SERVER_URL ||
    process.env.OFFICIAL_SERVER_URL ||
    "https://dockerhub.nekofun.top"
  ).replace(/\/+$/, "");
}

function getOfficialScriptCommand(
  envId: string,
  action: "install" | "update" | "remove",
  version?: string | null,
  installMethod?: EnvironmentInstallMethod | null,
): string {
  const scriptUrl = `${getOfficialServerUrl()}/environments/${envId}/script`;
  const args: string[] = [action];
  if ((envId === "nginx" || envId === "docker") && installMethod) {
    args.push(installMethod);
    if (installMethod === "compile" && version && action !== "remove") {
      args.push(version);
    }
  } else if (version && action !== "remove") {
    args.push(version);
  }
  return `curl -fsSL ${scriptUrl} | sudo bash -s -- ${args.join(" ")}`;
}

const NGINX_VERSION_OPTIONS = [
  { value: "1.18", label: "1.18.0" },
  { value: "1.20", label: "1.20.2" },
  { value: "1.22", label: "1.22.1" },
  { value: "1.24", label: "1.24.0", recommended: true },
  { value: "1.25", label: "1.25.5" },
  { value: "1.26", label: "1.26.3" },
  { value: "1.27", label: "1.27.5" },
  { value: "1.28", label: "1.28.0" },
  { value: "1.29", label: "1.29.3" },
  { value: "1.30", label: "1.30.0" },
];

const NGINX_INSTALL_METHOD_OPTIONS: InstallMethodOption[] = [
  {
    value: "quick",
    label: "快速安装",
    description: "使用 nginx 官方 apt/yum/dnf 仓库安装稳定版",
    recommended: true,
    supportsVersion: false,
  },
  {
    value: "compile",
    label: "编译安装",
    description: "下载 nginx、PCRE、zlib、OpenSSL 源码并编译到 /www/server/nginx",
    supportsVersion: true,
  },
];

const DOCKER_VERSION_OPTIONS = [
  { value: "27.5.1", label: "27.5.1" },
  { value: "28.0.4", label: "28.0.4" },
  { value: "28.1.1", label: "28.1.1" },
  { value: "28.2.2", label: "28.2.2" },
  { value: "28.3.3", label: "28.3.3" },
  { value: "28.5.1", label: "28.5.1", recommended: true },
];

const DOCKER_INSTALL_METHOD_OPTIONS: InstallMethodOption[] = [
  {
    value: "quick",
    label: "快速安装",
    description: "使用 Docker 官方 apt/yum/dnf 仓库安装 Docker Engine",
    recommended: true,
    supportsVersion: false,
  },
  {
    value: "compile",
    label: "编译安装",
    description: "从 Moby 源码编译 dockerd 并安装为系统服务",
    supportsVersion: true,
  },
];

function normalizeNginxVersion(version?: string): string {
  const selected = version || "1.24";
  const found = NGINX_VERSION_OPTIONS.find((item) => item.value === selected);
  if (!found) throw new Error(`不支持的 Nginx 版本: ${selected}`);
  return found.value;
}

function normalizeEnvironmentInstallMethod(method?: string, envName = "环境"): EnvironmentInstallMethod {
  if (!method) return "quick";
  if (method === "quick" || method === "compile") return method;
  throw new Error(`不支持的 ${envName} 安装方式: ${method}`);
}

function normalizeNginxInstallMethod(method?: string): EnvironmentInstallMethod {
  return normalizeEnvironmentInstallMethod(method, "Nginx");
}

function normalizeDockerVersion(version?: string): string {
  const selected = version || "28.5.1";
  if (!/^\d+\.\d+\.\d+$/.test(selected)) {
    throw new Error(`不支持的 Docker 版本: ${selected}`);
  }
  return selected;
}

function normalizeDockerInstallMethod(method?: string): EnvironmentInstallMethod {
  return normalizeEnvironmentInstallMethod(method, "Docker");
}

function detectNginxInstallMethod(): EnvironmentInstallMethod | null {
  if (execCmdSafe("test -x /www/server/nginx/sbin/nginx && echo compile")) {
    return "compile";
  }
  if (
    execCmdSafe("test -x /usr/sbin/nginx && echo quick") ||
    execCmdSafe("test -x /usr/local/sbin/nginx && echo quick") ||
    execCmdSafe(isLinuxPlatform() ? "command -v nginx" : "where nginx")
  ) {
    return "quick";
  }
  return null;
}

function detectDockerInstallMethod(): EnvironmentInstallMethod | null {
  if (execCmdSafe("test -f /etc/systemd/system/cyrene-docker.service && echo compile")) {
    return "compile";
  }
  if (execCmdSafe(isLinuxPlatform() ? "command -v docker" : "where docker")) {
    return "quick";
  }
  return null;
}

function detectNginxBinaryPath(): string | null {
  return (
    execCmdSafe("test -x /www/server/nginx/sbin/nginx && echo /www/server/nginx/sbin/nginx") ||
    execCmdSafe("test -x /usr/sbin/nginx && echo /usr/sbin/nginx") ||
    execCmdSafe("test -x /usr/local/sbin/nginx && echo /usr/local/sbin/nginx") ||
    execCmdSafe(isLinuxPlatform() ? "command -v nginx" : "where nginx")
  );
}

// ── 环境检测器 ────────────────────────────────────────────────────────

interface EnvDetector {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  description: string;
  homepage: string | null;
  detectVersion: () => string | null;
  detectPath: () => string | null;
  getLatestVersion: () => string | null;
  getInstallInfo: () => { packageManager: string; installCommand: string } | null;
  getUpdateInfo: () => string | null;
  getRemoveInfo: () => string | null;
  getDefaultVersion?: () => string | null;
  getVersionOptions?: () => { value: string; label: string; recommended?: boolean }[];
  getInstallMethods?: () => InstallMethodOption[];
}

function getNodeDetector(): EnvDetector {
  return {
    id: "nodejs",
    name: "Node.js",
    displayName: "Node.js",
    icon: "nodejs",
    description: "JavaScript 运行时环境",
    homepage: "https://nodejs.org",
    detectVersion: () => {
      const v = execCmdSafe("node --version");
      return v ? v.replace(/^v/, "") : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which node" : "where node"),
    getLatestVersion: () => {
      const v = execCmdSafe("npm view node version");
      return v || null;
    },
    getInstallInfo: () => {
      if (isLinuxPlatform()) {
        return { packageManager: "NodeSource", installCommand: "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs" };
      }
      return { packageManager: "winget", installCommand: "winget install OpenJS.NodeJS.LTS" };
    },
    getUpdateInfo: () => isLinuxPlatform()
      ? "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
      : "winget upgrade OpenJS.NodeJS.LTS",
    getRemoveInfo: () => isLinuxPlatform()
      ? "sudo apt-get remove -y nodejs"
      : "winget uninstall OpenJS.NodeJS.LTS",
  };
}

function getNpmDetector(): EnvDetector {
  return {
    id: "npm",
    name: "npm",
    displayName: "npm",
    icon: "npm",
    description: "Node.js 包管理器",
    homepage: "https://www.npmjs.com",
    detectVersion: () => {
      const v = execCmdSafe("npm --version");
      return v || null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which npm" : "where npm"),
    getLatestVersion: () => execCmdSafe("npm view npm version"),
    getInstallInfo: () => ({ packageManager: "npm", installCommand: "npm install -g npm@latest" }),
    getUpdateInfo: () => "npm install -g npm@latest",
    getRemoveInfo: () => null,
  };
}

function getPnpmDetector(): EnvDetector {
  return {
    id: "pnpm",
    name: "pnpm",
    displayName: "pnpm",
    icon: "pnpm",
    description: "快速、节省磁盘空间的包管理器",
    homepage: "https://pnpm.io",
    detectVersion: () => {
      const v = execCmdSafe("pnpm --version");
      return v || null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which pnpm" : "where pnpm"),
    getLatestVersion: () => execCmdSafe("npm view pnpm version"),
    getInstallInfo: () => ({ packageManager: "npm", installCommand: "npm install -g pnpm" }),
    getUpdateInfo: () => "npm install -g pnpm@latest",
    getRemoveInfo: () => "npm uninstall -g pnpm",
  };
}

function getYarnDetector(): EnvDetector {
  return {
    id: "yarn",
    name: "Yarn",
    displayName: "Yarn",
    icon: "yarn",
    description: "Fast, reliable, and secure dependency management",
    homepage: "https://yarnpkg.com",
    detectVersion: () => {
      const v = execCmdSafe("yarn --version");
      return v || null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which yarn" : "where yarn"),
    getLatestVersion: () => execCmdSafe("npm view yarn version"),
    getInstallInfo: () => ({ packageManager: "npm", installCommand: "npm install -g yarn" }),
    getUpdateInfo: () => "npm install -g yarn@latest",
    getRemoveInfo: () => "npm uninstall -g yarn",
  };
}

function getPythonDetector(): EnvDetector {
  return {
    id: "python",
    name: "Python",
    displayName: "Python",
    icon: "python",
    description: "高级编程语言",
    homepage: "https://www.python.org",
    detectVersion: () => {
      const v = execCmdSafe("python --version") || execCmdSafe("python3 --version");
      return v ? v.replace(/^Python\s*/i, "") : null;
    },
    detectPath: () => {
      return execCmdSafe(isLinuxPlatform() ? "which python3 || which python" : "where python");
    },
    getLatestVersion: () => {
      // Try to get from python.org API
      const v = execCmdSafe('python -c "import sys; print(\\"{}.{}.{}".format(*sys.version_info[:3]))"');
      return v || null;
    },
    getInstallInfo: () => {
      if (isLinuxPlatform()) {
        return { packageManager: "apt", installCommand: "sudo apt-get update && sudo apt-get install -y python3 python3-pip" };
      }
      return { packageManager: "winget", installCommand: "winget install Python.Python.3.12" };
    },
    getUpdateInfo: () => isLinuxPlatform()
      ? "sudo apt-get update && sudo apt-get install -y python3 python3-pip"
      : "winget upgrade Python.Python.3.12",
    getRemoveInfo: () => isLinuxPlatform()
      ? "sudo apt-get remove -y python3 python3-pip"
      : "winget uninstall Python.Python.3.12",
  };
}

function getPipDetector(): EnvDetector {
  return {
    id: "pip",
    name: "pip",
    displayName: "pip",
    icon: "pip",
    description: "Python 包管理器",
    homepage: "https://pip.pypa.io",
    detectVersion: () => {
      const v = execCmdSafe("pip --version") || execCmdSafe("pip3 --version");
      return v ? v.match(/\d+\.\d+(\.\d+)?/)?.[0] || null : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which pip3 || which pip" : "where pip"),
    getLatestVersion: () => execCmdSafe("pip index versions pip 2>/dev/null | head -1"),
    getInstallInfo: () => ({ packageManager: "pip", installCommand: "pip install --upgrade pip" }),
    getUpdateInfo: () => "pip install --upgrade pip",
    getRemoveInfo: () => null,
  };
}

function getJavaDetector(): EnvDetector {
  return {
    id: "java",
    name: "Java",
    displayName: "Java (OpenJDK)",
    icon: "java",
    description: "Java 运行时环境",
    homepage: "https://openjdk.org",
    detectVersion: () => {
      const v = execCmdSafe("java --version") || execCmdSafe("java -version 2>&1");
      if (!v) return null;
      const match = v.match(/(?:openjdk|java)\s+version\s+"?(\d+(?:\.\d+)*(?:_\d+)?)"/i);
      return match ? match[1] : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which java" : "where java"),
    getLatestVersion: () => null,
    getInstallInfo: () => {
      if (isLinuxPlatform()) {
        return { packageManager: "apt", installCommand: "sudo apt-get update && sudo apt-get install -y openjdk-17-jdk" };
      }
      return { packageManager: "winget", installCommand: "winget install Microsoft.OpenJDK.17" };
    },
    getUpdateInfo: () => isLinuxPlatform()
      ? "sudo apt-get update && sudo apt-get install -y openjdk-17-jdk"
      : "winget upgrade Microsoft.OpenJDK.17",
    getRemoveInfo: () => isLinuxPlatform()
      ? "sudo apt-get remove -y openjdk-17-jdk"
      : "winget uninstall Microsoft.OpenJDK.17",
  };
}

function getPhpDetector(): EnvDetector {
  return {
    id: "php",
    name: "PHP",
    displayName: "PHP",
    icon: "php",
    description: "通用脚本语言",
    homepage: "https://www.php.net",
    detectVersion: () => {
      const v = execCmdSafe("php --version");
      if (!v) return null;
      const match = v.match(/PHP\s+(\d+\.\d+\.\d+)/i);
      return match ? match[1] : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which php" : "where php"),
    getLatestVersion: () => null,
    getInstallInfo: () => {
      if (isLinuxPlatform()) {
        return { packageManager: "apt", installCommand: "sudo apt-get update && sudo apt-get install -y php php-cli php-mbstring php-xml php-curl php-zip" };
      }
      return { packageManager: "winget", installCommand: "winget install PHP.PHP" };
    },
    getUpdateInfo: () => isLinuxPlatform()
      ? "sudo apt-get update && sudo apt-get install -y php"
      : "winget upgrade PHP.PHP",
    getRemoveInfo: () => isLinuxPlatform()
      ? "sudo apt-get remove -y php"
      : "winget uninstall PHP.PHP",
  };
}

function getGoDetector(): EnvDetector {
  return {
    id: "go",
    name: "Go",
    displayName: "Go",
    icon: "go",
    description: "Go 编程语言",
    homepage: "https://go.dev",
    detectVersion: () => {
      const v = execCmdSafe("go version");
      if (!v) return null;
      const match = v.match(/go(\d+\.\d+(?:\.\d+)?)/);
      return match ? match[1] : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which go" : "where go"),
    getLatestVersion: () => null,
    getInstallInfo: () => {
      if (isLinuxPlatform()) {
        return { packageManager: "官方安装包", installCommand: "wget -q https://go.dev/dl/go1.22.2.linux-amd64.tar.gz -O /tmp/go.tar.gz && sudo tar -C /usr/local -xzf /tmp/go.tar.gz" };
      }
      return { packageManager: "winget", installCommand: "winget install GoLang.Go" };
    },
    getUpdateInfo: () => isLinuxPlatform()
      ? "wget -q https://go.dev/dl/go1.22.2.linux-amd64.tar.gz -O /tmp/go.tar.gz && sudo tar -C /usr/local -xzf /tmp/go.tar.gz"
      : "winget upgrade GoLang.Go",
    getRemoveInfo: () => isLinuxPlatform()
      ? "sudo rm -rf /usr/local/go"
      : "winget uninstall GoLang.Go",
  };
}

function getRustDetector(): EnvDetector {
  return {
    id: "rust",
    name: "Rust",
    displayName: "Rust",
    icon: "rust",
    description: "系统编程语言",
    homepage: "https://www.rust-lang.org",
    detectVersion: () => {
      const v = execCmdSafe("rustc --version");
      if (!v) return null;
      const match = v.match(/rustc\s+(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which rustc" : "where rustc"),
    getLatestVersion: () => null,
    getInstallInfo: () => ({
      packageManager: "rustup",
      installCommand: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
    }),
    getUpdateInfo: () => "rustup update",
    getRemoveInfo: () => isLinuxPlatform()
      ? "rustup self uninstall"
      : "rustup self uninstall",
  };
}

function getCargoDetector(): EnvDetector {
  return {
    id: "cargo",
    name: "Cargo",
    displayName: "Cargo",
    icon: "cargo",
    description: "Rust 包管理器和构建工具",
    homepage: "https://doc.rust-lang.org/cargo",
    detectVersion: () => {
      const v = execCmdSafe("cargo --version");
      if (!v) return null;
      const match = v.match(/cargo\s+(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which cargo" : "where cargo"),
    getLatestVersion: () => null,
    getInstallInfo: () => null,
    getUpdateInfo: () => "rustup update",
    getRemoveInfo: () => null,
  };
}

function getDotnetDetector(): EnvDetector {
  return {
    id: "dotnet",
    name: ".NET",
    displayName: ".NET SDK",
    icon: "dotnet",
    description: "微软开发平台",
    homepage: "https://dotnet.microsoft.com",
    detectVersion: () => {
      const v = execCmdSafe("dotnet --version");
      return v || null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which dotnet" : "where dotnet"),
    getLatestVersion: () => null,
    getInstallInfo: () => {
      if (isLinuxPlatform()) {
        return { packageManager: "Microsoft", installCommand: "wget https://dot.net/v1/dotnet-install.sh -O /tmp/dotnet-install.sh && chmod +x /tmp/dotnet-install.sh && sudo /tmp/dotnet-install.sh --channel 8.0" };
      }
      return { packageManager: "winget", installCommand: "winget install Microsoft.DotNet.SDK.8" };
    },
    getUpdateInfo: () => isLinuxPlatform()
      ? "wget https://dot.net/v1/dotnet-install.sh -O /tmp/dotnet-install.sh && chmod +x /tmp/dotnet-install.sh && sudo /tmp/dotnet-install.sh --channel 8.0"
      : "winget upgrade Microsoft.DotNet.SDK.8",
    getRemoveInfo: () => isLinuxPlatform()
      ? "sudo rm -rf /usr/share/dotnet /usr/local/share/dotnet"
      : "winget uninstall Microsoft.DotNet.SDK.8",
  };
}

function getBunDetector(): EnvDetector {
  return {
    id: "bun",
    name: "Bun",
    displayName: "Bun",
    icon: "bun",
    description: "极速 JavaScript 运行时、打包器、转译器和包管理器",
    homepage: "https://bun.sh",
    detectVersion: () => {
      const v = execCmdSafe("bun --version");
      return v || null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which bun" : "where bun"),
    getLatestVersion: () => null,
    getInstallInfo: () => ({
      packageManager: "官方安装脚本",
      installCommand: isLinuxPlatform()
        ? "curl -fsSL https://bun.sh/install | bash"
        : "powershell -c \"irm bun.sh/install.ps1 | iex\"",
    }),
    getUpdateInfo: () => "bun upgrade",
    getRemoveInfo: () => isLinuxPlatform()
      ? "rm -rf ~/.bun"
      : 'powershell -c "Remove-Item -Recurse -Force ~/.bun"',
  };
}

function getComposerDetector(): EnvDetector {
  return {
    id: "composer",
    name: "Composer",
    displayName: "Composer",
    icon: "composer",
    description: "PHP 依赖管理器",
    homepage: "https://getcomposer.org",
    detectVersion: () => {
      const v = execCmdSafe("composer --version");
      if (!v) return null;
      const match = v.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which composer" : "where composer"),
    getLatestVersion: () => null,
    getInstallInfo: () => ({
      packageManager: "官方安装脚本",
      installCommand: "curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer",
    }),
    getUpdateInfo: () => "composer self-update",
    getRemoveInfo: () => isLinuxPlatform()
      ? "sudo rm /usr/local/bin/composer"
      : null,
  };
}

function getGitDetector(): EnvDetector {
  return {
    id: "git",
    name: "Git",
    displayName: "Git",
    icon: "git",
    description: "分布式版本控制系统",
    homepage: "https://git-scm.com",
    detectVersion: () => {
      const v = execCmdSafe("git --version");
      if (!v) return null;
      const match = v.match(/git version\s+(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which git" : "where git"),
    getLatestVersion: () => null,
    getInstallInfo: () => {
      if (isLinuxPlatform()) {
        return { packageManager: "apt", installCommand: "sudo apt-get update && sudo apt-get install -y git" };
      }
      return { packageManager: "winget", installCommand: "winget install Git.Git" };
    },
    getUpdateInfo: () => isLinuxPlatform()
      ? "sudo apt-get update && sudo apt-get install -y git"
      : "winget upgrade Git.Git",
    getRemoveInfo: () => isLinuxPlatform()
      ? "sudo apt-get remove -y git"
      : "winget uninstall Git.Git",
  };
}

function getDockerDetector(): EnvDetector {
  return {
    id: "docker",
    name: "Docker",
    displayName: "Docker",
    icon: "docker",
    description: "容器化平台",
    homepage: "https://www.docker.com",
    detectVersion: () => {
      const v = execCmdSafe("docker --version");
      if (!v) return null;
      const match = v.match(/Docker version\s+(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    },
    detectPath: () => execCmdSafe(isLinuxPlatform() ? "which docker" : "where docker"),
    getLatestVersion: () => null,
    getInstallInfo: () => {
      if (isLinuxPlatform()) {
        return {
          packageManager: "Docker official repo / source build",
          installCommand: getOfficialScriptCommand("docker", "install", null, "quick"),
        };
      }
      return { packageManager: "winget", installCommand: "winget install Docker.DockerDesktop" };
    },
    getUpdateInfo: () => {
      if (!isLinuxPlatform()) return "winget upgrade Docker.DockerDesktop";
      const method = detectDockerInstallMethod() || "quick";
      return getOfficialScriptCommand("docker", "update", "28.5.1", method);
    },
    getRemoveInfo: () => {
      if (!isLinuxPlatform()) return "winget uninstall Docker.DockerDesktop";
      const method = detectDockerInstallMethod() || "quick";
      return getOfficialScriptCommand("docker", "remove", null, method);
    },
    getDefaultVersion: () => "28.5.1",
    getVersionOptions: () => DOCKER_VERSION_OPTIONS,
    getInstallMethods: () => DOCKER_INSTALL_METHOD_OPTIONS,
  };
}

function getNginxDetector(): EnvDetector {
  return {
    id: "nginx",
    name: "Nginx",
    displayName: "Nginx",
    icon: "nginx",
    description: "高性能 Web 服务器和反向代理",
    homepage: "https://nginx.org",
    detectVersion: () => {
      const nginxPath = detectNginxBinaryPath();
      const v = nginxPath ? execCmdSafe(`${nginxPath} -v 2>&1`) : null;
      if (!v) return null;
      const match = v.match(/nginx\/(\d+\.\d+\.\d+)/i);
      return match ? match[1] : null;
    },
    detectPath: () => detectNginxBinaryPath(),
    getLatestVersion: () => null,
    getInstallInfo: () => ({
      packageManager: "nginx official repo / source build",
      installCommand: getOfficialScriptCommand("nginx", "install", null, "quick"),
    }),
    getUpdateInfo: () => {
      const method = detectNginxInstallMethod() || "quick";
      return getOfficialScriptCommand("nginx", "update", "1.24", method);
    },
    getRemoveInfo: () => {
      const method = detectNginxInstallMethod() || "quick";
      return getOfficialScriptCommand("nginx", "remove", null, method);
    },
    getDefaultVersion: () => "1.24",
    getVersionOptions: () => NGINX_VERSION_OPTIONS,
    getInstallMethods: () => NGINX_INSTALL_METHOD_OPTIONS,
  };
}

function getAllDetectors(): EnvDetector[] {
  return [
    getNodeDetector(),
    getNpmDetector(),
    getPnpmDetector(),
    getYarnDetector(),
    getPythonDetector(),
    getPipDetector(),
    getJavaDetector(),
    getPhpDetector(),
    getGoDetector(),
    getRustDetector(),
    getCargoDetector(),
    getDotnetDetector(),
    getBunDetector(),
    getComposerDetector(),
    getGitDetector(),
    getDockerDetector(),
    getNginxDetector(),
  ];
}

// ── 扫描环境 ──────────────────────────────────────────────────────────

function scanEnvironments(): EnvInfo[] {
  const detectors = getAllDetectors();
  const results: EnvInfo[] = [];

  for (const detector of detectors) {
    const version = detector.detectVersion();
    const installInfo = detector.getInstallInfo();
    const updateCommand = detector.getUpdateInfo();
    const removeCommand = detector.getRemoveInfo();

    results.push({
      id: detector.id,
      name: detector.name,
      displayName: detector.displayName,
      icon: detector.icon,
      installed: version !== null,
      version,
      path: detector.detectPath(),
      latestVersion: version ? detector.getLatestVersion() : null,
      packageManager: installInfo?.packageManager || null,
      installCommand: installInfo?.installCommand || null,
      updateCommand: updateCommand || null,
      removeCommand: removeCommand || null,
      description: detector.description,
      homepage: detector.homepage,
      defaultVersion: detector.getDefaultVersion?.() || null,
      versionOptions: detector.getVersionOptions?.() || [],
      installMethods: detector.getInstallMethods?.() || [],
    });
  }

  return results;
}

function getActionCommand(
  detector: EnvDetector,
  action: "install" | "update" | "remove",
  version?: string,
  installMethod?: string,
): string | null {
  if (detector.id === "nginx" || detector.id === "docker") {
    const detectedMethod = detector.id === "nginx"
      ? detectNginxInstallMethod()
      : detectDockerInstallMethod();
    const method = detector.id === "nginx"
      ? normalizeNginxInstallMethod(installMethod || detectedMethod || "quick")
      : normalizeDockerInstallMethod(installMethod || detectedMethod || "quick");
    const selectedVersion = method === "compile" && action !== "remove"
      ? detector.id === "nginx"
        ? normalizeNginxVersion(version)
        : normalizeDockerVersion(version)
      : null;
    return getOfficialScriptCommand(detector.id, action, selectedVersion, method);
  }

  if (action === "install") return detector.getInstallInfo()?.installCommand || null;
  if (action === "update") return detector.getUpdateInfo();
  return detector.getRemoveInfo();
}

async function commandStream(command: string, onLine: (line: string) => void): Promise<number> {
  const proc = Bun.spawn(["bash", "-lc", command], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const read = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    }
    if (buffer.trim()) onLine(buffer);
  };

  await Promise.all([read(proc.stdout), read(proc.stderr)]);
  return await proc.exited;
}

function createEnvironmentActionStream(
  envId: string,
  action: "install" | "update" | "remove",
  body?: { version?: string; installMethod?: string },
): Response {
  const detectors = getAllDetectors();
  const detector = detectors.find((d) => d.id === envId);

  if (!detector) {
    return new Response(JSON.stringify({ success: false, message: `未找到环境: ${envId}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if ((detector.id === "nginx" || detector.id === "docker") && !isLinuxPlatform()) {
    return new Response(JSON.stringify({ success: false, message: `${detector.displayName} 安装脚本仅支持 Linux 节点` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let command: string | null;
  try {
    command = getActionCommand(detector, action, body?.version, body?.installMethod);
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, message: e.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!command) {
    return new Response(JSON.stringify({ success: false, message: `${detector.displayName} 不支持该操作` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

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
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // 客户端可能已经断开。
        }
      };

      try {
        const versionText = body?.version && action !== "remove" ? ` ${body.version}` : "";
        send({
          type: "stage",
          stage: action,
          message: `开始${action === "install" ? "安装" : action === "update" ? "更新" : "卸载"} ${detector.displayName}${versionText}...`,
        });

        const exitCode = await commandStream(command, (line) => {
          send({ type: "progress", layer: "", status: "info", detail: line.trim() });
        });

        if (exitCode !== 0) {
          send({ type: "error", message: `${detector.displayName} 操作失败 (退出码 ${exitCode})` });
          return;
        }

        send({ type: "done", message: `${detector.displayName} 操作完成` });
      } catch (e: any) {
        send({ type: "error", message: e.message || "操作失败" });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── 操作执行 ──────────────────────────────────────────────────────────

function executeInstall(envId: string): { success: boolean; message: string; output?: string } {
  const detectors = getAllDetectors();
  const detector = detectors.find((d) => d.id === envId);
  if (!detector) return { success: false, message: `未找到环境: ${envId}` };

  const installInfo = detector.getInstallInfo();
  if (!installInfo) return { success: false, message: `${detector.displayName} 不支持通过面板安装` };

  try {
    const output = execCmd(installInfo.installCommand, 300000); // 5 minute timeout
    return { success: true, message: `${detector.displayName} 安装成功`, output };
  } catch (e: any) {
    return {
      success: false,
      message: `${detector.displayName} 安装失败: ${e.message}`,
      output: e.stdout || e.stderr || "",
    };
  }
}

function executeUpdate(envId: string): { success: boolean; message: string; output?: string } {
  const detectors = getAllDetectors();
  const detector = detectors.find((d) => d.id === envId);
  if (!detector) return { success: false, message: `未找到环境: ${envId}` };

  const updateCommand = detector.getUpdateInfo();
  if (!updateCommand) return { success: false, message: `${detector.displayName} 没有可用的更新命令` };

  try {
    const output = execCmd(updateCommand, 300000);
    return { success: true, message: `${detector.displayName} 更新成功`, output };
  } catch (e: any) {
    return {
      success: false,
      message: `${detector.displayName} 更新失败: ${e.message}`,
      output: e.stdout || e.stderr || "",
    };
  }
}

function executeRemove(envId: string): { success: boolean; message: string; output?: string } {
  const detectors = getAllDetectors();
  const detector = detectors.find((d) => d.id === envId);
  if (!detector) return { success: false, message: `未找到环境: ${envId}` };

  const removeCommand = detector.getRemoveInfo();
  if (!removeCommand) return { success: false, message: `${detector.displayName} 不支持通过面板卸载` };

  try {
    const output = execCmd(removeCommand, 120000);
    return { success: true, message: `${detector.displayName} 已卸载`, output };
  } catch (e: any) {
    return {
      success: false,
      message: `${detector.displayName} 卸载失败: ${e.message}`,
      output: e.stdout || e.stderr || "",
    };
  }
}

// ── 系统包管理器信息 ──────────────────────────────────────────────────

function getPackageManagerInfo(): { name: string; available: boolean; version: string | null }[] {
  const managers: { name: string; cmd: string; versionArg: string }[] = isLinuxPlatform()
    ? [
        { name: "apt", cmd: "apt --version", versionArg: "" },
        { name: "yum", cmd: "yum --version", versionArg: "" },
        { name: "dnf", cmd: "dnf --version", versionArg: "" },
        { name: "snap", cmd: "snap --version", versionArg: "" },
        { name: "pacman", cmd: "pacman --version", versionArg: "" },
      ]
    : [
        { name: "winget", cmd: "winget --version", versionArg: "" },
        { name: "choco", cmd: "choco --version", versionArg: "" },
        { name: "scoop", cmd: "scoop --version", versionArg: "" },
      ];

  return managers.map((m) => {
    const output = execCmdSafe(m.cmd);
    return {
      name: m.name,
      available: output !== null,
      version: output ? output.split("\n")[0] : null,
    };
  });
}

// ── 路由 ──────────────────────────────────────────────────────────────

export const environmentRoutes = new Elysia()
  .get("/api/environments", async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    try {
      const environments = scanEnvironments();
      const installed = environments.filter((e) => e.installed).length;
      const notInstalled = environments.filter((e) => !e.installed).length;

      return {
        success: true,
        environments,
        summary: { total: environments.length, installed, notInstalled },
        platform: isLinuxPlatform() ? "linux" : "windows",
        packageManagers: getPackageManagerInfo(),
      };
    } catch (e: any) {
      return { success: false, message: `扫描环境失败: ${e.message}` };
    }
  })

  .get("/api/environments/:id", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const detectors = getAllDetectors();
    const detector = detectors.find((d) => d.id === params.id);
    if (!detector) return { success: false, message: "未找到环境" };

    const version = detector.detectVersion();
    return {
      success: true,
      environment: {
        id: detector.id,
        name: detector.name,
        displayName: detector.displayName,
        icon: detector.icon,
        description: detector.description,
        homepage: detector.homepage,
        installed: version !== null,
        version,
        path: detector.detectPath(),
        latestVersion: version ? detector.getLatestVersion() : null,
        packageManager: detector.getInstallInfo()?.packageManager || null,
        installCommand: detector.getInstallInfo()?.installCommand || null,
        updateCommand: detector.getUpdateInfo() || null,
        removeCommand: detector.getRemoveInfo() || null,
        defaultVersion: detector.getDefaultVersion?.() || null,
        versionOptions: detector.getVersionOptions?.() || [],
        installMethods: detector.getInstallMethods?.() || [],
      },
    };
  })

  .post("/api/environments/:id/install", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    return executeInstall(params.id);
  })

  .post("/api/environments/:id/:action/stream", async ({ jwt, request, params, body }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const profile = await jwt.verify(token);
    if (!profile) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!["install", "update", "remove"].includes(params.action)) {
      return new Response(JSON.stringify({ success: false, message: "不支持的操作" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return createEnvironmentActionStream(params.id, params.action, body);
  })

  .post("/api/environments/:id/update", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    return executeUpdate(params.id);
  })

  .post("/api/environments/:id/remove", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    return executeRemove(params.id);
  });
