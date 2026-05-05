import { Elysia } from "elysia";
import { platform } from "os";
import { execSync } from "child_process";

// ── 类型定义 ──────────────────────────────────────────────────────────

interface ServiceInfo {
  name: string;
  displayName: string;
  description: string;
  status: string;
  enabled: boolean;
  type: string;
  subtype: string;
  mainPid: number | null;
  memory: number | null;
  cpuUsage: string | null;
  activeState: string;
  subState: string;
  since: string;
  journalFile: string | null;
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

function isSystemdAvailable(): boolean {
  try {
    execCmd("systemctl --version", 5000);
    return true;
  } catch {
    return false;
  }
}

// ── Linux 服务管理 ────────────────────────────────────────────────────

function parseSystemctlList(output: string): string[] {
  const lines = output.split("\n").filter((l) => l.trim());
  const services: string[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 1 && parts[0].endsWith(".service")) {
      services.push(parts[0]);
    }
  }
  return services;
}

function getServiceDetail(name: string): ServiceInfo | null {
  try {
    const statusOutput = execCmd(`systemctl show "${name}" --no-pager`);

    const props: Record<string, string> = {};
    for (const line of statusOutput.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) {
        props[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }

    const activeState = props["ActiveState"] || "unknown";
    const subState = props["SubState"] || "unknown";
    const description = props["Description"] || "";
    const mainPid = props["MainPID"] ? parseInt(props["MainPID"]) : null;
    const memoryCurrent = props["MemoryCurrent"] ? parseInt(props["MemoryCurrent"]) : null;
    const execMainStartTimestamp = props["ExecMainStartTimestamp"] || "";
    const journalFile = props["JournalFile"] || null;

    let enabled = false;
    try {
      const enabledOutput = execCmd(`systemctl is-enabled "${name}" 2>/dev/null`, 5000);
      enabled = enabledOutput.trim() === "enabled";
    } catch {
      // ignore
    }

    return {
      name,
      displayName: name.replace(/\.service$/, ""),
      description: description.replace(/"/g, ""),
      status: activeState,
      enabled,
      type: "linux-service",
      subtype: subState,
      mainPid: mainPid && mainPid > 0 ? mainPid : null,
      memory: memoryCurrent && memoryCurrent > 0 ? memoryCurrent : null,
      cpuUsage: null,
      activeState,
      subState,
      since: execMainStartTimestamp || "",
      journalFile,
    };
  } catch {
    return null;
  }
}

function getLinuxServices(): ServiceInfo[] {
  try {
    const output = execCmd(
      "systemctl list-units --type=service --all --no-pager --no-legend",
      20000
    );
    const serviceNames = parseSystemctlList(output);
    return serviceNames
      .map((name) => getServiceDetail(name))
      .filter((s): s is ServiceInfo => s !== null);
  } catch {
    return [];
  }
}

function linuxServiceAction(
  name: string,
  action: "start" | "stop" | "restart" | "enable" | "disable"
): { success: boolean; message: string } {
  try {
    execCmd(`systemctl ${action} "${name}"`, 30000);
    const labels: Record<string, string> = { start: "启动", stop: "停止", restart: "重启", enable: "启用", disable: "禁用" };
    return { success: true, message: `服务 ${name} 已${labels[action]}` };
  } catch (e: any) {
    return { success: false, message: e.stderr || e.message || "未知错误" };
  }
}

function linuxServiceLogs(name: string, lines: number = 200): string {
  try {
    return execCmd(
      `journalctl -u "${name}" --no-pager -n ${lines} --no-hostname`,
      15000
    );
  } catch (e: any) {
    return e.stdout || e.message || "无法获取日志";
  }
}

function linuxServiceStatus(): { total: number; active: number; failed: number; enabled: number } {
  let total = 0, active = 0, failed = 0, enabled = 0;
  try {
    const output = execCmd(
      "systemctl list-units --type=service --all --no-pager --no-legend",
      20000
    );
    for (const line of output.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 1 && parts[0].endsWith(".service")) {
        total++;
          if (parts.length >= 3) {
          if (parts[2] === "active") active++;
          if (parts[2] === "failed") failed++;
        }
        try {
          const en = execCmd(`systemctl is-enabled "${parts[0]}" 2>/dev/null`, 3000);
          if (en.trim() === "enabled") enabled++;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return { total, active, failed, enabled };
}

// ── Windows 服务管理 ──────────────────────────────────────────────────

function getWindowsServices(): ServiceInfo[] {
  try {
    // 使用 Get-CimInstance 获取完整的服务信息（包含 StartMode）
    const output = execCmd(
      'powershell -NoProfile -Command "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode | ConvertTo-Json -Depth 2 -Compress"',
      60000
    );
    if (!output) return [];

    const parsed = JSON.parse(output);
    const services: any[] = Array.isArray(parsed) ? parsed : [parsed];

    return services.map((s: any) => {
      const state = String(s.State || "Unknown").toLowerCase();
      const startMode = String(s.StartMode || "Unknown").toLowerCase();

      // 判断是否"已启用"（开机自启）
      const enabled = startMode === "autostart" || startMode === "auto";

      return {
        name: s.Name || "",
        displayName: s.DisplayName || s.Name || "",
        description: "",
        status: state,
        enabled,
        type: "windows-service",
        subtype: state,
        mainPid: null,
        memory: null,
        cpuUsage: null,
        activeState: state,
        subState: "",
        since: "",
        journalFile: null,
      };
    });
  } catch (e: any) {
    // 尝试备用方案：使用 sc query
    try {
      return getWindowsServicesFallback();
    } catch {
      return [];
    }
  }
}

function getWindowsServicesFallback(): ServiceInfo[] {
  // 备用方案：使用 sc query 获取服务列表
  try {
    const output = execCmd('sc query type= service state= all 2>nul', 60000);
    const services: ServiceInfo[] = [];

    const blocks = output.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      const nameMatch = block.match(/SERVICE_NAME:\s*(.+)/i);
      const stateMatch = block.match(/STATE\s*:\s*\d+\s+(.+)/i);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        const state = stateMatch ? stateMatch[1].trim().toLowerCase() : "unknown";

        // 获取显示名称和启动类型
        let displayName = name;
        let startType = "unknown";
        try {
          const qca = execCmd(`sc qc "${name}" 2>nul`, 10000);
          const dnMatch = qca.match(/DISPLAY_NAME\s*:\s*(.+)/i);
          const stMatch = qca.match(/START_TYPE\s*:\s*\d+\s+(.+)/i);
          if (dnMatch) displayName = dnMatch[1].trim();
          if (stMatch) startType = stMatch[1].trim().toLowerCase();
        } catch {
          // ignore
        }

        const enabled = startType.includes("auto");

        services.push({
          name,
          displayName,
          description: "",
          status: state,
          enabled,
          type: "windows-service",
          subtype: state,
          mainPid: null,
          memory: null,
          cpuUsage: null,
          activeState: state,
          subState: "",
          since: "",
          journalFile: null,
        });
      }
    }

    return services;
  } catch {
    return [];
  }
}

function winServiceAction(
  name: string,
  action: "start" | "stop" | "restart" | "enable" | "disable"
): { success: boolean; message: string } {
  try {
    if (action === "start") {
      execCmd(`net start "${name}"`, 30000);
    } else if (action === "stop") {
      execCmd(`net stop "${name}"`, 30000);
    } else if (action === "restart") {
      execCmd(`net stop "${name}"`, 30000);
      execCmd(`net start "${name}"`, 30000);
    } else if (action === "enable") {
      execCmd(`sc config "${name}" start= auto`, 15000);
    } else if (action === "disable") {
      execCmd(`sc config "${name}" start= disabled`, 15000);
    }
    return { success: true, message: "操作成功" };
  } catch (e: any) {
    return { success: false, message: e.message || "操作失败" };
  }
}

function winServiceLogs(name: string): string {
  try {
    return execCmd(
      `powershell -NoProfile -Command "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-WinEvent -LogName System -MaxEvents 100 | Where-Object { $_.ProviderName -eq 'Service Control Manager' -and $_.Message -like '*${name}*' } | Select-Object -Property TimeCreated,Message | Format-Table -AutoSize -Wrap | Out-String"`,
      15000
    );
  } catch (e: any) {
    return e.stdout || "无法获取日志";
  }
}

// ── 平台检测 ──────────────────────────────────────────────────────────

function isLinuxPlatform(): boolean {
  return platform() !== "win32";
}

// ── 路由 ──────────────────────────────────────────────────────────────

export const serviceRoutes = new Elysia()
  .get("/api/services", async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const isLinux = isLinuxPlatform();

    if (isLinux && !isSystemdAvailable()) {
      return {
        success: false,
        message: "系统未安装 systemd，无法管理服务",
        services: [],
        summary: { total: 0, active: 0, failed: 0, enabled: 0 },
      };
    }

    const services = isLinux ? getLinuxServices() : getWindowsServices();
    const summary = isLinux
      ? linuxServiceStatus()
      : {
          total: services.length,
          active: services.filter((s: any) => s.status === "running").length,
          failed: services.filter((s: any) => s.status === "stopfailed" || s.status === "paused").length,
          enabled: services.filter((s: any) => s.enabled).length,
        };

    return { success: true, services, summary, platform: isLinux ? "linux" : "windows" };
  })

  .get("/api/services/logs/:name", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { name } = params;
    const url = new URL(request.url);
    const lines = parseInt(url.searchParams.get("lines") || "200");
    const isLinux = isLinuxPlatform();

    const logs = isLinux ? linuxServiceLogs(name, lines) : winServiceLogs(name);
    return { success: true, logs };
  })

  .post("/api/services/:name/:action", async ({ jwt, request, params }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { success: false, message: "未授权" };
    const profile = await jwt.verify(token);
    if (!profile) return { success: false, message: "未授权" };

    const { name, action } = params;
    const validActions = ["start", "stop", "restart", "enable", "disable"];
    if (!validActions.includes(action)) {
      return { success: false, message: "无效的操作" };
    }

    const isLinux = isLinuxPlatform();
    const result = isLinux
      ? linuxServiceAction(name, action as any)
      : winServiceAction(name, action as any);

    return result;
  });