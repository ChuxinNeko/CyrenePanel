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

      const { providerId, model, messages, systemInfo, nodeInfo, terminalContext } = body;
      const providers = getProviders();
      const provider = providers.find((p) => p.id === providerId);

      if (!provider) {
        setHeader.status = 404;
        return { success: false, message: "提供商不存在" };
      }

      try {
        const headers = buildRequestHeaders(provider);
        const systemPrompt = buildSystemPrompt(
          systemInfo?.platform || "unknown", 
          systemInfo?.arch || "unknown", 
          systemInfo?.detail || "", 
          nodeInfo?.name,
          terminalContext
        );
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
        terminalContext: t.Optional(t.String()),
      }),
    }
  )
  
  // 测试 AI 模型可用性与测速
  .post(
    "/api/ai/test",
    async ({ body, profile }: any) => {
      if (!profile) return { success: false, message: "未授权" };
      if (profile.role !== "admin") return { success: false, message: "仅管理员可访问" };

      const { apiUrl, apiKey, format, model } = body;
      const provider: AIProvider = {
        id: "test",
        name: "test",
        apiUrl,
        apiKey,
        format,
        models: [model],
      };

      try {
        const headers = buildRequestHeaders(provider);
        const requestBody = buildRequestBody(provider, model, [{ role: "user", content: "请从 1 数到 100" }]);
        
        const start = Date.now();
        const response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return { success: false, message: `API 返回错误: ${response.status}`, detail: errorText };
        }

        const reader = response.body?.getReader();
        if (!reader) return { success: false, message: "无法读取响应流" };

        const decoder = new TextDecoder();
        let firstTokenTime = 0;
        let totalChars = 0;
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          
          if (firstTokenTime === 0 && value && value.length > 0) {
            firstTokenTime = Date.now();
          }

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              
              if (format === "anthropic") {
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  totalChars += parsed.delta.text.length;
                }
              } else {
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  totalChars += delta.content.length;
                }
              }
            } catch {
              // ignore
            }
          }
        }
        const end = Date.now();
        
        const ttft = firstTokenTime > 0 ? firstTokenTime - start : end - start;
        const durationMs = end - (firstTokenTime > 0 ? firstTokenTime : start);
        
        // 估算 TPS (用中文字符数粗略代替 Token 数)
        let tps = 0;
        if (durationMs > 0) {
          tps = (totalChars / durationMs) * 1000;
        }

        return { 
          success: true, 
          ttft,
          tps: Math.round(tps * 10) / 10 
        };

      } catch (err: any) {
        return { success: false, message: `请求失败: ${err.message}` };
      }
    },
    {
      body: t.Object({
        apiUrl: t.String(),
        apiKey: t.String(),
        format: t.Union([t.Literal("openai"), t.Literal("anthropic")]),
        model: t.String(),
      }),
    }
  );

// ── 辅助函数 ─────────────────────────────────────────────────────

function buildSystemPrompt(platform: string, arch: string, detail: string, nodeName?: string, terminalContext?: string): string {
  const nodeBlock = nodeName
    ? `\n当前操作的节点: ${nodeName}`
    : "";
  const systemBlock = detail
    ? `\n当前服务器系统信息：${nodeBlock}\n- 平台: ${platform}\n- 架构: ${arch}\n- 详情:\n${detail}`
    : `\n当前服务器平台: ${platform}, 架构: ${arch}${nodeBlock}`;

  const terminalBlock = terminalContext 
    ? `\n## 当前终端实时内容\n\`\`\`text\n${terminalContext}\n\`\`\`\n*(这是用户终端屏幕当前显示的文本，供你参考)*`
    : "";

  return `你是一个专业的服务器运维安全与诊断 AI Agent (DevOps AI Assistant)，运行在用户的远程服务器终端环境中。
你的目标是像一位资深的高级运维工程师一样，帮助用户诊断问题、管理服务器、排查故障，并提供精准的解决方案。

${systemBlock}${terminalBlock}

## 核心准则

1. **精准适配系统**：你的所有命令必须严格匹配当前的操作系统和架构。执行前需思考依赖是否可用（例如：Debian系用apt，RHEL系用yum/dnf，macOS用brew，Windows用PowerShell cmdlet）。如果跨平台，必须指出。
2. **专业与安全至上**：
   - 绝不建议或执行高危破坏性操作（如 \`rm -rf /\`）。
   - 在修改核心配置前，优先提供备份方案（如 \`cp config config.bak\`）。
   - 在处理复杂问题时，优先“收集信息”（如查看日志、状态、配置），然后再“执行修改”。
3. **一步一步的 Agent 模式（核心特性）**：
   - 当你需要执行命令收集信息或执行操作时，请将命令包裹在 \`\`\`command\`\`\` 代码块中。
   - **绝对规则**：每次回复最多只输出一个 \`\`\`command\`\`\` 块！并且块内只能有一条核心指令（避免用 && 或 ; 串接大量逻辑导致难以排错）。
   - 用户界面会自动解析并执行你的命令，**执行结果会自动作为新消息传回给你**。
   - **切勿要求用户“手动执行并把结果告诉我”**，更**绝对不要对用户说“请执行xxx验证结果”**。你是完全自动化的执行者！
   - 如果你需要验证某个配置是否生效，请在收到上一条命令的成功结果后，**由你自己**在下一次回复中输出验证的 \`\`\`command\`\`\` 命令，让系统去执行。
   - 收到结果后，再决定下一步操作或给出最终结论。如果任务已彻底完成且你已亲自验证，直接告诉用户“任务已完成”即可。
   - 当终端提示命令不存在时，主动提供安装该工具的命令，或寻找系统自带的替代工具。
4. **简洁专业的表达**：
   - 始终用专业的中文回复。
   - 如果用户的问题模糊，可以自行探测系统状态（给出探测命令）或者向用户追问。
   - 在解释原因时，做到条理清晰。`;
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