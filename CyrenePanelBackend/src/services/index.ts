import { Elysia } from "elysia";
import { platform } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { resolveRequestProfile } from "../node-auth/request-profile";

const execAsync = promisify(exec);

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

interface ServiceSummary {
  total: number;
  active: number;
  failed: number;
  enabled: number;
}

// ── 工具函数 ──────────────────────────────────────────────────────────

/**
 * 统一的命令执行入口。必须是异步的：本模块会批量调用 systemctl，
 * 用 execSync 会把 Bun 的事件循环整个阻塞住，导致同一时刻的其它请求一起被拖慢。
 */
async function execCmd(cmd: string, timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (e: any) {
    if (e.stdout) return String(e.stdout).trim();
    throw e;
  }
}

/** 把参数安全地包成单引号形式，避免服务名里的特殊字符被 shell 解释 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

let systemdAvailable: boolean | null = null;

async function isSystemdAvailable(): Promise<boolean> {
  // systemd 是否存在在进程生命周期内不会变，探测一次即可
  if (systemdAvailable !== null) return systemdAvailable;
  try {
    await execCmd("systemctl --version", 5000);
    systemdAvailable = true;
  } catch {
    systemdAvailable = false;
  }
  return systemdAvailable;
}

// ── Linux 服务管理 ────────────────────────────────────────────────────

interface UnitListEntry {
  name: string;
  activeState: string;
  subState: string;
  description: string;
}

/**
 * 解析 `systemctl list-units --plain --no-legend` 的输出。
 * 列格式为 UNIT LOAD ACTIVE SUB DESCRIPTION；必须加 --plain，
 * 否则失败的单元行首会多出 "●" 导致整行错位、被漏掉。
 */
function parseSystemctlList(output: string): UnitListEntry[] {
  const entries: UnitListEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (!parts[0]?.endsWith(".service")) continue;
    entries.push({
      name: parts[0],
      activeState: parts[2] || "unknown",
      subState: parts[3] || "unknown",
      description: parts.slice(4).join(" "),
    });
  }
  return entries;
}

const SHOW_PROPERTIES = [
  "Id",
  "Description",
  "ActiveState",
  "SubState",
  "MainPID",
  "MemoryCurrent",
  "ExecMainStartTimestamp",
  "JournalFile",
  "UnitFileState",
].join(",");

/** 单次 systemctl show 传入的单元数量上限，避免命令行过长 */
const SHOW_BATCH_SIZE = 100;

/**
 * 批量取单元属性。`systemctl show` 支持一次传入多个单元，各单元的属性块之间以空行分隔，
 * 因此 N 个服务只需要 ceil(N/100) 次调用，而不是原来的 N 次。
 * UnitFileState 同时替代了逐个执行的 `systemctl is-enabled`。
 */
async function showUnits(names: string[]): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();

  for (let i = 0; i < names.length; i += SHOW_BATCH_SIZE) {
    const batch = names.slice(i, i + SHOW_BATCH_SIZE);
    let output: string;
    try {
      output = await execCmd(
        `systemctl show ${batch.map(shellQuote).join(" ")} --no-pager --property=${SHOW_PROPERTIES}`,
        20000
      );
    } catch {
      continue;
    }

    for (const block of output.split(/\n\s*\n/)) {
      const props: Record<string, string> = {};
      for (const line of block.split("\n")) {
        const idx = line.indexOf("=");
        if (idx > 0) props[line.slice(0, idx)] = line.slice(idx + 1);
      }
      // 用 Id 回填而不是依赖顺序，systemd 省略空属性时不会错位
      if (props["Id"]) result.set(props["Id"], props);
    }
  }

  return result;
}

function isUnitEnabled(unitFileState: string | undefined): boolean {
  return unitFileState === "enabled" || unitFileState === "enabled-runtime";
}

function toServiceInfo(entry: UnitListEntry, props: Record<string, string> | undefined): ServiceInfo {
  const activeState = props?.["ActiveState"] || entry.activeState;
  const subState = props?.["SubState"] || entry.subState;
  const mainPid = props?.["MainPID"] ? parseInt(props["MainPID"]) : null;
  const memoryCurrent = props?.["MemoryCurrent"] ? parseInt(props["MemoryCurrent"]) : null;

  return {
    name: entry.name,
    displayName: entry.name.replace(/\.service$/, ""),
    description: (props?.["Description"] || entry.description).replace(/"/g, ""),
    status: activeState,
    enabled: isUnitEnabled(props?.["UnitFileState"]),
    type: "linux-service",
    subtype: subState,
    mainPid: mainPid && mainPid > 0 ? mainPid : null,
    memory: memoryCurrent && memoryCurrent > 0 ? memoryCurrent : null,
    cpuUsage: null,
    activeState,
    subState,
    since: props?.["ExecMainStartTimestamp"] || "",
    journalFile: props?.["JournalFile"] || null,
  };
}

/**
 * 一次性拿到服务列表和汇总。汇总直接由列表数据算出，
 * 不再像以前那样重新跑一遍 list-units 加逐个 is-enabled。
 */
async function getLinuxServiceSnapshot(): Promise<{ services: ServiceInfo[]; summary: ServiceSummary }> {
  let entries: UnitListEntry[];
  try {
    const output = await execCmd(
      "systemctl list-units --type=service --all --no-pager --no-legend --plain",
      20000
    );
    entries = parseSystemctlList(output);
  } catch {
    return { services: [], summary: { total: 0, active: 0, failed: 0, enabled: 0 } };
  }

  const details = await showUnits(entries.map((e) => e.name));
  const services = entries.map((entry) => toServiceInfo(entry, details.get(entry.name)));

  return {
    services,
    summary: {
      total: services.length,
      active: services.filter((s) => s.activeState === "active").length,
      failed: services.filter((s) => s.activeState === "failed").length,
      enabled: services.filter((s) => s.enabled).length,
    },
  };
}

async function linuxServiceAction(
  name: string,
  action: "start" | "stop" | "restart" | "enable" | "disable"
): Promise<{ success: boolean; message: string }> {
  try {
    await execCmd(`systemctl ${action} ${shellQuote(name)}`, 30000);
    const labels: Record<string, string> = { start: "启动", stop: "停止", restart: "重启", enable: "启用", disable: "禁用" };
    return { success: true, message: `服务 ${name} 已${labels[action]}` };
  } catch (e: any) {
    return { success: false, message: e.stderr || e.message || "未知错误" };
  }
}

async function linuxServiceLogs(name: string, lines: number = 200): Promise<string> {
  try {
    return await execCmd(
      `journalctl -u ${shellQuote(name)} --no-pager -n ${lines} --no-hostname`,
      15000
    );
  } catch (e: any) {
    return e.stdout || e.message || "无法获取日志";
  }
}

// ── Windows 服务管理 ──────────────────────────────────────────────────

async function getWindowsServices(): Promise<ServiceInfo[]> {
  try {
    // 使用 Get-CimInstance 获取完整的服务信息（包含 StartMode）
    const output = await execCmd(
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
      return await getWindowsServicesFallback();
    } catch {
      return [];
    }
  }
}

async function getWindowsServicesFallback(): Promise<ServiceInfo[]> {
  // 备用方案：使用 sc query 获取服务列表
  try {
    const output = await execCmd('sc query type= service state= all 2>nul', 60000);
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
          const qca = await execCmd(`sc qc "${name}" 2>nul`, 10000);
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

async function winServiceAction(
  name: string,
  action: "start" | "stop" | "restart" | "enable" | "disable"
): Promise<{ success: boolean; message: string }> {
  try {
    if (action === "start") {
      await execCmd(`net start "${name}"`, 30000);
    } else if (action === "stop") {
      await execCmd(`net stop "${name}"`, 30000);
    } else if (action === "restart") {
      await execCmd(`net stop "${name}"`, 30000);
      await execCmd(`net start "${name}"`, 30000);
    } else if (action === "enable") {
      await execCmd(`sc config "${name}" start= auto`, 15000);
    } else if (action === "disable") {
      await execCmd(`sc config "${name}" start= disabled`, 15000);
    }
    return { success: true, message: "操作成功" };
  } catch (e: any) {
    return { success: false, message: e.message || "操作失败" };
  }
}

async function winServiceLogs(name: string): Promise<string> {
  try {
    return await execCmd(
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
    const profile = await resolveRequestProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };

    const isLinux = isLinuxPlatform();

    if (isLinux && !(await isSystemdAvailable())) {
      return {
        success: false,
        message: "系统未安装 systemd，无法管理服务",
        services: [],
        summary: { total: 0, active: 0, failed: 0, enabled: 0 },
      };
    }

    if (isLinux) {
      const { services, summary } = await getLinuxServiceSnapshot();
      return { success: true, services, summary, platform: "linux" };
    }

    const services = await getWindowsServices();
    const summary: ServiceSummary = {
      total: services.length,
      active: services.filter((s) => s.status === "running").length,
      failed: services.filter((s) => s.status === "stopfailed" || s.status === "paused").length,
      enabled: services.filter((s) => s.enabled).length,
    };

    return { success: true, services, summary, platform: "windows" };
  })

  .get("/api/services/logs/:name", async ({ jwt, request, params }: any) => {
    const profile = await resolveRequestProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };

    const { name } = params;
    const url = new URL(request.url);
    const parsedLines = parseInt(url.searchParams.get("lines") || "200");
    const lines = Number.isFinite(parsedLines) ? Math.min(Math.max(parsedLines, 1), 5000) : 200;
    const isLinux = isLinuxPlatform();

    const logs = isLinux ? await linuxServiceLogs(name, lines) : await winServiceLogs(name);
    return { success: true, logs };
  })

  .post("/api/services/create", async ({ jwt, request, body }: any) => {
    const profile = await resolveRequestProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };

    const { name, displayName, execStart, description, workingDir, user, restart, env, startType, args } = body as any;

    if (!name || !name.trim()) return { success: false, message: "服务名称不能为空" };
    if (!execStart || !execStart.trim()) return { success: false, message: "启动命令不能为空" };

    const isLinux = isLinuxPlatform();

    if (isLinux) {
      // 创建 systemd service unit 文件
      try {
        const serviceName = name.endsWith(".service") ? name : `${name}.service`;
        const svcDescription = description || displayName || name;
        const svcWorkingDir = workingDir ? `WorkingDirectory=${workingDir}` : "";
        const svcUser = user ? `User=${user}` : "";
        const svcRestart = restart || "on-failure";
        const svcExecStart = execStart.trim();
        const svcArgs = args || "";
        const envLines = Array.isArray(env) && env.length > 0
          ? env.filter((e: any) => e.name).map((e: any) => `Environment=${e.name}=${e.value}`).join("\n")
          : "";

        const unitContent = [
          "[Unit]",
          `Description=${svcDescription}`,
          "After=network.target",
          "",
          "[Service]",
          svcWorkingDir,
          svcUser,
          `Type=simple`,
          envLines ? envLines : "",
          `ExecStart=${svcExecStart} ${svcArgs}`.trim(),
          `Restart=${svcRestart}`,
          "",
          "[Install]",
          "WantedBy=multi-user.target",
        ].filter((l) => l !== undefined).join("\n");

        // 写入 unit 文件
        const unitPath = `/etc/systemd/system/${serviceName}`;
        // 使用 tee 写入需要 sudo
        const escapedContent = unitContent.replace(/'/g, "'\\''");
        await execCmd(`echo '${escapedContent}' | sudo tee ${unitPath} > /dev/null`, 10000);
        await execCmd("systemctl daemon-reload", 10000);
        await execCmd(`systemctl enable ${shellQuote(serviceName)}`, 10000);
        await execCmd(`systemctl start ${shellQuote(serviceName)}`, 30000);

        return { success: true, message: `服务 ${serviceName} 已创建并启动` };
      } catch (e: any) {
        return { success: false, message: e.stderr || e.message || "创建服务失败" };
      }
    } else {
      // Windows: 使用 New-Service 或 sc create
      try {
        const svcName = name.trim();
        const svcPath = execStart.trim();
        const svcDisplayNameStr = displayName || svcName;
        const svcDescriptionStr = description || svcDisplayNameStr;
        const svcStart = startType || "Automatic";
        const fullArgs = args ? ` -ArgumentList "${args}"` : "";

        const psCmd = [
          `$ErrorActionPreference = 'Stop'`,
          `$svcPath = '${svcPath}'`,
          `$svcArgs = '${args || ''}'`,
          `$fullPath = if ($svcArgs) { "$svcPath $svcArgs" } else { $svcPath }`,
          `New-Service -Name '${svcName}' -DisplayName '${svcDisplayNameStr}' -Description '${svcDescriptionStr}' -BinaryPathName $fullPath -StartupType ${svcStart}`,
        ].join("; ");

        await execCmd(`powershell -NoProfile -Command "[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${psCmd}"`, 30000);

        return { success: true, message: `服务 ${svcName} 已创建` };
      } catch (e: any) {
        return { success: false, message: e.message || "创建服务失败" };
      }
    }
  })

  .post("/api/services/:name/:action", async ({ jwt, request, params }: any) => {
    const profile = await resolveRequestProfile(jwt, request);
    if (!profile) return { success: false, message: "未授权" };

    const { name, action } = params;
    const validActions = ["start", "stop", "restart", "enable", "disable"];
    if (!validActions.includes(action)) {
      return { success: false, message: "无效的操作" };
    }

    const isLinux = isLinuxPlatform();
    const result = isLinux
      ? await linuxServiceAction(name, action as any)
      : await winServiceAction(name, action as any);

    return result;
  });