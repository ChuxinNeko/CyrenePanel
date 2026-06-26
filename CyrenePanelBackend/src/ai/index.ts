import { Elysia, t } from "elysia";
import { getConfig, setConfig, dbGetNode } from "../db";
import { logger } from "../logger/index";
import { exchangeApiKeyForToken } from "../nodes/index";

// ── AI Provider 配置类型 ─────────────────────────────────────────

interface AIProvider {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  format: "openai" | "anthropic";
  models: string[];
}

const AI_PROVIDERS_KEY = "ai_providers";

function getProviders(): AIProvider[] {
  const raw = getConfig(AI_PROVIDERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveProviders(providers: AIProvider[]) {
  setConfig(AI_PROVIDERS_KEY, JSON.stringify(providers));
}

// ── AI 路由 ─────────────────────────────────────────────────────

export const aiRoutes = new Elysia()
  .derive(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // 检测当前服务器系统信息（支持子节点代理）
  .get("/api/ai/system-info", async ({ profile, query }: any) => {
    if (!profile) return { success: false, message: "未授权" };

    const nodeId = query?.nodeId as string | undefined;

    // 子节点：代理到远端获取系统信息
    if (nodeId) {
      const node = dbGetNode(nodeId);
      if (!node) return { success: false, message: "节点不存在" };
      try {
        const token = await exchangeApiKeyForToken(node.address, node.apiKey);
        if (!token) return { success: false, message: "子节点不可达" };
        const res = await fetch(`${node.address}/api/ai/system-info`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        return await res.json();
      } catch (err: any) {
        return { success: false, message: `子节点系统信息获取失败: ${err.message}` };
      }
    }

    // 主节点：本地获取
    try {
      const isWindows = process.platform === "win32";
      let command: string;

      if (isWindows) {
        command =
          'powershell -NoProfile -Command "$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; Write-Output ($os.Caption + \'|\' + $os.Version + \'|\' + $cpu.Name + \'|\' + $cpu.NumberOfLogicalProcessors + \' cores\')"';
      } else {
        command = 'uname -s -r -m && nproc && cat /etc/os-release 2>/dev/null | head -5 || sw_vers 2>/dev/null';
      }

      const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();

      return {
        success: true,
        platform: process.platform,
        arch: process.arch,
        detail: output.trim(),
      };
    } catch (err: any) {
      return {
        success: true,
        platform: process.platform,
        arch: process.arch,
        detail: `检测失败: ${err.message}`,
      };
    }
  })

  // 获取所有 AI 提供商配置（脱敏）
  .get("/api/ai/providers", ({ profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const providers = getProviders();
    return {
      success: true,
      providers: providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? "***已设置***" : "",
      })),
    };
  })

  // 添加 AI 提供商
  .post(
    "/api/ai/providers",
    ({ body, profile }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

      const providers = getProviders();
      const newProvider: AIProvider = {
        id: crypto.randomUUID(),
        name: body.name,
        apiUrl: body.apiUrl,
        apiKey: body.apiKey,
        format: body.format,
        models: body.models || [],
      };
      providers.push(newProvider);
      saveProviders(providers);
      logger.info(`管理员 ${profile.username} 添加了 AI 提供商: ${newProvider.name}`);
      return { success: true, provider: { ...newProvider, apiKey: "***已设置***" } };
    },
    {
      body: t.Object({
        name: t.String(),
        apiUrl: t.String(),
        apiKey: t.String(),
        format: t.Union([t.Literal("openai"), t.Literal("anthropic")]),
        models: t.Optional(t.Array(t.String())),
      }),
    }
  )

  // 更新 AI 提供商
  .put(
    "/api/ai/providers/:id",
    ({ params, body, profile }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

      const providers = getProviders();
      const idx = providers.findIndex((p) => p.id === params.id);
      if (idx === -1) return { success: false, message: "提供商不存在" };

      if (body.name !== undefined) providers[idx].name = body.name;
      if (body.apiUrl !== undefined) providers[idx].apiUrl = body.apiUrl;
      if (body.apiKey !== undefined && body.apiKey !== "***已设置***") providers[idx].apiKey = body.apiKey;
      if (body.format !== undefined) providers[idx].format = body.format;
      if (body.models !== undefined) providers[idx].models = body.models;

      saveProviders(providers);
      logger.info(`管理员 ${profile.username} 更新了 AI 提供商: ${providers[idx].name}`);
      return { success: true, provider: { ...providers[idx], apiKey: "***已设置***" } };
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        apiUrl: t.Optional(t.String()),
        apiKey: t.Optional(t.String()),
        format: t.Optional(t.Union([t.Literal("openai"), t.Literal("anthropic")])),
        models: t.Optional(t.Array(t.String())),
      }),
    }
  )

  // 删除 AI 提供商
  .delete("/api/ai/providers/:id", ({ params, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

    const providers = getProviders();
    const idx = providers.findIndex((p) => p.id === params.id);
    if (idx === -1) return { success: false, message: "提供商不存在" };

    const removed = providers.splice(idx, 1)[0];
    saveProviders(providers);
    logger.info(`管理员 ${profile.username} 删除了 AI 提供商: ${removed.name}`);
    return { success: true };
  })

  // 流式 AI 对话（代理请求到实际 AI API）
  .post(
    "/api/ai/chat",
    async ({ body, profile, set: setHeader }: any) => {
      if (!profile) {
        setHeader.status = 401;
        return { success: false, message: "未授权" };
      }

      const { providerId, model, messages, systemInfo, nodeInfo } = body;
      const providers = getProviders();
      const provider = providers.find((p) => p.id === providerId);

      if (!provider) {
        setHeader.status = 404;
        return { success: false, message: "提供商不存在" };
      }

      try {
        const headers = buildRequestHeaders(provider);
        const systemPrompt = systemInfo
          ? buildSystemPrompt(systemInfo.platform, systemInfo.arch, systemInfo.detail, nodeInfo?.name)
          : undefined;
        const requestBody = buildRequestBody(provider, model, messages, systemPrompt);

        const response = await fetch(provider.apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.err(`AI API 错误 [${provider.name}]: ${response.status} - ${errorText}`);
          setHeader.status = response.status;
          return { success: false, message: `AI API 错误: ${response.status}`, detail: errorText };
        }

        // 返回流式响应
        setHeader.headers["Content-Type"] = "text/event-stream";
        setHeader.headers["Cache-Control"] = "no-cache";
        setHeader.headers["Connection"] = "keep-alive";

        return response.body;
      } catch (err: any) {
        logger.err(`AI 请求失败: ${err.message}`);
        setHeader.status = 500;
        return { success: false, message: `请求失败: ${err.message}` };
      }
    },
    {
      body: t.Object({
        providerId: t.String(),
        model: t.String(),
        messages: t.Array(
          t.Object({
            role: t.Union([t.Literal("user"), t.Literal("assistant")]),
            content: t.String(),
          })
        ),
        systemInfo: t.Optional(
          t.Object({
            platform: t.String(),
            arch: t.String(),
            detail: t.String(),
          })
        ),
        nodeInfo: t.Optional(
          t.Object({
            id: t.String(),
            name: t.String(),
          })
        ),
      }),
    }
  );

// ── 辅助函数 ─────────────────────────────────────────────────────

function buildSystemPrompt(platform: string, arch: string, detail: string, nodeName?: string): string {
  const nodeBlock = nodeName
    ? `\n当前操作的节点: ${nodeName}`
    : "";
  const systemBlock = detail
    ? `\n当前服务器系统信息：${nodeBlock}\n- 平台: ${platform}\n- 架构: ${arch}\n- 详情:\n${detail}`
    : `\n当前服务器平台: ${platform}, 架构: ${arch}${nodeBlock}`;

  return `你是一个服务器终端 AI 助手，运行在用户的远程服务器终端环境中。你可以帮助用户诊断问题、管理服务器、排查故障。

${systemBlock}

## 核心规则

1. **必须适配当前系统**：你生成的所有命令必须严格适配上述操作系统和架构。在给出任何命令前，先确认该命令在当前系统上可用。例如：
   - Linux (Debian/Ubuntu): 用 apt / apt-get
   - Linux (CentOS/RHEL/Fedora): 用 yum / dnf
   - macOS: 用 brew，注意 GNU/BSD 工具差异
   - Windows (PowerShell): 用 PowerShell cmdlet 或 winget/scoop
   - 不要在 Linux 上给出 brew 命令，不要在 macOS 上给出 apt 命令，不要在 Windows 上给出 bash 独有命令

2. **命令格式**：当用户需要你执行命令时，请将命令用 \`\`\`command\`\`\` 代码块包裹。例如：
\`\`\`command
ls -la /var/log
\`\`\`
   你可以包含多个命令块。每个命令块在用户确认后会被自动执行。

3. **执行机制与多功能 Agent 特性**（重要）：
   - 用户界面会自动解析你输出的 \`\`\`command\`\`\` 块，并在旁边生成“执行”按钮。
   - 当用户点击“执行”时，命令会自动在左侧的终端中运行，**且系统会自动把完整输出结果回复给你**。
   - **绝对不要**要求用户“手动执行命令”或“手动复制粘贴输出结果”给你。你的身份是一个支持自动化执行的 Agent，只需给出命令，等待系统自动传回结果即可。
   - 每次只给出必要的分析和少数相关命令，等待结果返回后再决定下一步操作。
   - 如果命令执行失败，系统也会自动传回失败信息，请分析原因并提供修复命令。

4. **安全意识**：
   - 不要建议使用 rm -rf / 等极端危险命令
   - 修改系统配置前先建议备份
   - 涉及网络操作时说明影响范围

5. **回复语言**：始终用中文回复`;
}

function buildRequestHeaders(provider: AIProvider): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider.format === "anthropic") {
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }

  return headers;
}

function buildRequestBody(
  provider: AIProvider,
  model: string,
  messages: { role: string; content: string }[],
  systemPrompt?: string
): any {
  if (provider.format === "anthropic") {
    const body: any = {
      model,
      max_tokens: 4096,
      stream: true,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }
    return body;
  }

  // OpenAI 格式
  const openaiMessages: any[] = [];
  if (systemPrompt) {
    openaiMessages.push({ role: "system", content: systemPrompt });
  }
  openaiMessages.push(
    ...messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
  );

  return {
    model,
    messages: openaiMessages,
    stream: true,
    max_tokens: 4096,
  };
}