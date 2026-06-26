"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { API_BASE } from "@/lib/api-base";
import {
  Settings2,
  Send,
  TerminalSquare,
  CheckCircle2,
  Loader2,
  Bot,
  User,
  Play,
  Copy,
  Check,
} from "lucide-react";
import AISettingsDialog from "./ai-settings-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── 类型 ─────────────────────────────────────────────────────────

interface AIProvider {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  format: "openai" | "anthropic";
  models: string[];
}

interface CommandBlock {
  id: string;
  command: string;
  status: "pending" | "running" | "success" | "error";
  output?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  commands?: CommandBlock[];
  timestamp: number;
  isHidden?: boolean;
}

interface TerminalAIAssistantProps {
  /** 向终端 WebSocket 发送命令的回调，返回该命令的输出（等待输出完成后 resolve） */
  onExecuteCommand: (command: string) => Promise<string>;
  systemInfo?: { platform: string; arch: string; detail: string };
  className?: string;
  /** 当前连接的节点信息（null 表示主节点） */
  nodeId?: string | null;
  nodeName?: string | null;
}


// ── 解析消息中的命令块 ────────────────────────────────────────────

function parseCommandBlocks(text: string): { text: string; commands: CommandBlock[] } {
  const commands: CommandBlock[] = [];
  const commandRegex = /```command\s*\n([\s\S]*?)```/g;
  let cleanText = text;
  let match;

  while ((match = commandRegex.exec(text)) !== null) {
    const cmd = match[1].trim();
    if (cmd) {
      commands.push({
        id: crypto.randomUUID(),
        command: cmd,
        status: "pending",
      });
      cleanText = cleanText.replace(match[0], `[COMMAND:${commands.length - 1}]`);
    }
  }

  return { text: cleanText, commands };
}

// ── 渲染 Markdown 简易解析 ───────────────────────────────────────

function renderContent(content: string, commands?: CommandBlock[], isAnswerStarted = false): React.ReactNode {
  // 将内容按 [COMMAND:n] 标记分割
  const parts = content.split(/(\[COMMAND:\d+\])/g);

  return parts.map((part, idx) => {
    const cmdMatch = part.match(/\[COMMAND:(\d+)\]/);
    if (cmdMatch && commands) {
      const cmdIdx = parseInt(cmdMatch[1]);
      const cmd = commands[cmdIdx];
      if (!cmd) return null;
      return <CommandBlockUI key={`cmd-${idx}`} command={cmd} />;
    }

    if (!part) return null;
    return (
      <div key={idx} className="overflow-hidden w-full max-w-full">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre({ node, children, ...props }: any) {
              const child = node?.children?.[0];
              const isThink = child?.tagName === "code" && child?.properties?.className?.includes("language-think");
              
              if (isThink) {
                return <>{children}</>;
              }
              
              return (
                <pre className="bg-muted p-2 rounded-md overflow-x-auto text-xs font-mono mb-2" {...props}>
                  {children}
                </pre>
              );
            },
            code({ node, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || "");
              if (match && match[1] === "think") {
                const text = typeof children === "string" ? children : String(children);
                return <ThinkingBlock reasoning={text} isAnswerStarted={isAnswerStarted} />;
              }
              return (
                <code
                  className={match ? className : "bg-muted px-1.5 py-0.5 rounded text-xs font-mono break-words whitespace-pre-wrap"}
                  {...props}
                >
                  {children}
                </code>
              );
            },
            p({ children }) {
              return <p className="mb-2 last:mb-0 leading-relaxed break-words whitespace-pre-wrap">{children}</p>;
            },
            ul({ children }) {
              return <ul className="list-disc pl-4 mb-2">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="list-decimal pl-4 mb-2">{children}</ol>;
            },
            li({ children }) {
              return <li className="mb-1">{children}</li>;
            },
            h1({ children }) { return <h1 className="text-lg font-bold mb-2">{children}</h1>; },
            h2({ children }) { return <h2 className="text-md font-bold mb-2">{children}</h2>; },
            h3({ children }) { return <h3 className="text-base font-bold mb-2">{children}</h3>; },
          }}
        >
          {part}
        </ReactMarkdown>
      </div>
    );
  });
}

// ── 思考过程块组件 ───────────────────────────────────────────────

function ThinkingBlock({
  reasoning,
  isAnswerStarted,
}: {
  reasoning: string;
  isAnswerStarted: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const prevAnswerRef = useRef(false);

  // 当回答开始输出时，自动折叠一次
  if (isAnswerStarted && !prevAnswerRef.current) {
    prevAnswerRef.current = true;
    if (!collapsed) {
      // 使用 setTimeout 避免在渲染期间调用 setState
      queueMicrotask(() => setCollapsed(true));
    }
  }

  if (!reasoning) return null;

  // 3 行高度约为 48px（text-xs 12px * line-height 1.5 * 3行）
  const maxHeight = "48px";

  return (
    <div className="mb-1">
      <div className="text-xs leading-relaxed text-zinc-400 font-sans w-fit max-w-full">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            <Bot className="h-3 w-3" />
            查看思考过程
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 font-medium text-zinc-500">
                <Bot className="h-3 w-3" />
                思考过程
              </div>
              {isAnswerStarted && (
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer text-[10px]"
                >
                  收起
                </button>
              )}
            </div>
            <div
              className="whitespace-pre-wrap break-words opacity-80 overflow-y-auto"
              style={{ maxHeight }}
            >
              {reasoning}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 命令块组件 ───────────────────────────────────────────────────

function CommandBlockUI({ command }: { command: CommandBlock }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusConfig = {
    pending: { color: "text-muted-foreground", icon: TerminalSquare, label: "等待执行" },
    running: { color: "text-yellow-500", icon: Loader2, label: "执行中..." },
    success: { color: "text-emerald-500", icon: CheckCircle2, label: "成功" },
    error: { color: "text-red-500", icon: TerminalSquare, label: "失败" },
  };

  const status = statusConfig[command.status];
  const StatusIcon = status.icon;

  return (
    <div className="my-2 rounded-lg border border-border/50 bg-zinc-900/80 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/50 border-b border-border/30">
        <div className={`flex items-center gap-1.5 text-xs ${status.color}`}>
          <StatusIcon
            className={`h-3 w-3 ${command.status === "running" ? "animate-spin" : ""}`}
          />
          {status.label}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={handleCopy}
          className="h-5 w-5"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>
      <pre className="px-3 py-2 text-xs font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap break-all">
        {command.command}
      </pre>
      {command.output && (
        <div className="px-3 py-2 border-t border-border/30 bg-zinc-950/50">
          <pre className="text-xs font-mono text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {command.output}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── 主组件 ───────────────────────────────────────────────────────

export default function TerminalAIAssistant({
  onExecuteCommand,
  className,
  nodeId,
  nodeName,
}: TerminalAIAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemInfo, setSystemInfo] = useState<{ platform: string; arch: string; detail: string }>({ platform: "unknown", arch: "unknown", detail: "" });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 获取当前选中的 provider
  const selectedProvider = providers.find((p) => p.id === selectedProviderId);

  // 加载提供商列表
  const loadProviders = useCallback(async () => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch("/api/ai/providers", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success && data.providers) {
        setProviders(data.providers);
        // 自动选择第一个
        if (data.providers.length > 0 && !selectedProviderId) {
          setSelectedProviderId(data.providers[0].id);
          if (data.providers[0].models.length > 0) {
            setSelectedModel(data.providers[0].models[0]);
          }
        }
      }
    } catch {
      // ignore
    }
  }, [selectedProviderId]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // 获取服务器系统信息
  useEffect(() => {
    const loadSystemInfo = async () => {
      const token = localStorage.getItem("token");
      try {
        const url = nodeId
          ? `/api/ai/system-info?nodeId=${encodeURIComponent(nodeId)}`
          : "/api/ai/system-info";
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) {
          setSystemInfo({
            platform: data.platform || "unknown",
            arch: data.arch || "unknown",
            detail: data.detail || "",
          });
        }
      } catch {
        // ignore
      }
    };
    loadSystemInfo();
  }, [nodeId]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 发送消息
  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    if (!selectedProvider || !selectedModel) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // 构建消息历史，恢复 AI 消息中的命令块
    const apiMessages = [...messages, userMessage]
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        let content = m.content;
        if (m.role === "assistant" && m.commands) {
          m.commands.forEach((cmd, idx) => {
            content = content.replace(`[COMMAND:${idx}]`, `\`\`\`command\n${cmd.command}\n\`\`\``);
          });
        }
        return {
          role: m.role as "user" | "assistant",
          content,
        };
      });

    const assistantId = crypto.randomUUID();
    const placeholderMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, placeholderMsg]);

    try {
      abortControllerRef.current = new AbortController();
      const token = localStorage.getItem("token");

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          providerId: selectedProviderId,
          model: selectedModel,
          messages: apiMessages,
          systemInfo,
          ...(nodeId ? { nodeInfo: { id: nodeId, name: nodeName || "子节点" } } : {}),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: "请求失败" }));
        throw new Error(errData.message || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let rawContent = "";
      let rawReasoning = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
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

            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
              if (delta.reasoning_content) {
                rawReasoning += delta.reasoning_content;
              }
              if (delta.content) {
                rawContent += delta.content;
              }
            }
            // Anthropic 格式
            else if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              rawContent += parsed.delta.text;
            }
            // Anthropic message_stop
            else if (parsed.type === "message_stop") {
              break;
            }

            let parsedReasoning = rawReasoning;
            let parsedContent = "";
            let temp = rawContent;
            
            while (true) {
              const startIdx = temp.indexOf('<think>');
              if (startIdx === -1) {
                parsedContent += temp;
                break;
              }
              parsedContent += temp.slice(0, startIdx);
              const endIdx = temp.indexOf('</think>', startIdx);
              if (endIdx === -1) {
                parsedReasoning += temp.slice(startIdx + 7);
                break;
              } else {
                parsedReasoning += temp.slice(startIdx + 7, endIdx) + "\n";
                temp = temp.slice(endIdx + 8);
              }
            }

            // 实时更新消息
            const { text, commands } = parseCommandBlocks(parsedContent);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: text, reasoning_content: parsedReasoning.trim(), commands }
                  : m
              )
            );
          } catch {
            // 忽略解析错误
          }
        }
      }

      let parsedReasoning = rawReasoning;
      let parsedContent = "";
      let temp = rawContent;
      while (true) {
        const startIdx = temp.indexOf('<think>');
        if (startIdx === -1) {
          parsedContent += temp;
          break;
        }
        parsedContent += temp.slice(0, startIdx);
        const endIdx = temp.indexOf('</think>', startIdx);
        if (endIdx === -1) {
          parsedReasoning += temp.slice(startIdx + 7);
          break;
        } else {
          parsedReasoning += temp.slice(startIdx + 7, endIdx) + "\n";
          temp = temp.slice(endIdx + 8);
        }
      }

      // 最终解析
      const { text, commands } = parseCommandBlocks(parsedContent);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: text, reasoning_content: parsedReasoning.trim(), commands, timestamp: Date.now() }
            : m
        )
      );
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `请求失败: ${err.message}`,
                timestamp: Date.now(),
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [
    input,
    isLoading,
    messages,
    selectedProvider,
    selectedModel,
    selectedProviderId,
    nodeId,
    nodeName,
  ]);

  // 执行命令
  const handleExecuteCommand = useCallback(
    async (messageId: string, commandId: string) => {
      // 更新命令状态为 running
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.commands) return m;
          return {
            ...m,
            commands: m.commands.map((c) =>
              c.id === commandId ? { ...c, status: "running" as const } : c
            ),
          };
        })
      );

      // 找到对应命令
      const msg = messages.find((m) => m.id === messageId);
      const cmd = msg?.commands?.find((c) => c.id === commandId);
      const targetCommand = cmd?.command || "";

      if (!targetCommand) return;

      try {
        const output = await onExecuteCommand(targetCommand);

        // 更新命令状态为成功
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId || !m.commands) return m;
            return {
              ...m,
              commands: m.commands.map((c) =>
                c.id === commandId
                  ? { ...c, status: "success" as const, output }
                  : c
              ),
            };
          })
        );

        // 将执行结果反馈给 AI
        const feedbackContent = `命令 \`${targetCommand}\` 已执行完毕，输出如下：\n\n\`\`\`\n${output}\n\`\`\`\n\n请分析执行结果。`;

        const feedbackMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: feedbackContent,
          timestamp: Date.now(),
          isHidden: true,
        };

        setMessages((prev) => [...prev, feedbackMsg]);

        // 自动发送反馈给 AI
        setIsLoading(true);
        const assistantId = crypto.randomUUID();
        const placeholderMsg: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, placeholderMsg]);

        const apiMessages = [...messages, feedbackMsg].map((m) => {
          let content = m.content;
          if (m.role === "assistant" && m.commands) {
            m.commands.forEach((cmd, idx) => {
              content = content.replace(`[COMMAND:${idx}]`, `\`\`\`command\n${cmd.command}\n\`\`\``);
            });
          }
          return {
            role: m.role as "user" | "assistant",
            content,
          };
        });

        const token = localStorage.getItem("token");
        abortControllerRef.current = new AbortController();

        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            providerId: selectedProviderId,
            model: selectedModel,
            messages: apiMessages,
            systemInfo,
            ...(nodeId ? { nodeInfo: { id: nodeId, name: nodeName || "子节点" } } : {}),
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("无法读取响应流");

        const decoder = new TextDecoder();
        let rawContent = "";
        let rawReasoning = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
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
              
              const delta = parsed.choices?.[0]?.delta;
              if (delta) {
                if (delta.reasoning_content) {
                  rawReasoning += delta.reasoning_content;
                }
                if (delta.content) {
                  rawContent += delta.content;
                }
              } else if (
                parsed.type === "content_block_delta" &&
                parsed.delta?.text
              ) {
                rawContent += parsed.delta.text;
              } else if (parsed.type === "message_stop") {
                break;
              }

              let parsedReasoning = rawReasoning;
              let parsedContent = "";
              let temp = rawContent;
              
              while (true) {
                const startIdx = temp.indexOf('<think>');
                if (startIdx === -1) {
                  parsedContent += temp;
                  break;
                }
                parsedContent += temp.slice(0, startIdx);
                const endIdx = temp.indexOf('</think>', startIdx);
                if (endIdx === -1) {
                  parsedReasoning += temp.slice(startIdx + 7);
                  break;
                } else {
                  parsedReasoning += temp.slice(startIdx + 7, endIdx) + "\n";
                  temp = temp.slice(endIdx + 8);
                }
              }

              const { text, commands } = parseCommandBlocks(parsedContent);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: text, reasoning_content: parsedReasoning.trim(), commands }
                    : m
                )
              );
            } catch {
              // ignore
            }
          }
        }

        let parsedReasoning = rawReasoning;
        let parsedContent = "";
        let temp = rawContent;
        while (true) {
          const startIdx = temp.indexOf('<think>');
          if (startIdx === -1) {
            parsedContent += temp;
            break;
          }
          parsedContent += temp.slice(0, startIdx);
          const endIdx = temp.indexOf('</think>', startIdx);
          if (endIdx === -1) {
            parsedReasoning += temp.slice(startIdx + 7);
            break;
          } else {
            parsedReasoning += temp.slice(startIdx + 7, endIdx) + "\n";
            temp = temp.slice(endIdx + 8);
          }
        }

        const { text, commands } = parseCommandBlocks(parsedContent);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: text, reasoning_content: parsedReasoning.trim(), commands, timestamp: Date.now() }
              : m
          )
        );
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId || !m.commands) return m;
            return {
              ...m,
              commands: m.commands.map((c) =>
                c.id === commandId
                  ? { ...c, status: "error" as const, output: err.message }
                  : c
              ),
            };
          })
        );
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, onExecuteCommand, selectedProviderId, selectedModel, nodeId, nodeName]
  );

  // 快捷键
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 停止生成
  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  };

  return (
    <div className={`flex flex-col h-full min-w-0 ${className || ""}`}>
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI 助手</span>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      {/* 消息列表 */}
      <ScrollArea className="flex-1 min-h-0 w-full overflow-hidden" style={{ overflow: 'hidden' }}>
        <div className="p-3 space-y-4 min-w-0 overflow-hidden">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
              <Bot className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">描述你的需求，AI 将为你提供解决方案</p>
              <p className="text-xs mt-1 opacity-60">
                支持自动生成并执行终端命令
              </p>
            </div>
          )}

          {messages.filter(m => !m.isHidden).map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 min-w-0 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="flex-shrink-0 mt-1">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1 w-full max-w-[85%] min-w-0">
                <ThinkingBlock
                  reasoning={msg.reasoning_content}
                  isAnswerStarted={!!msg.content}
                />
                
                {msg.content && (
                  <div
                    className={`min-w-0 overflow-hidden rounded-xl px-3 py-2 text-sm leading-relaxed w-fit max-w-full shadow-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground self-end"
                        : "bg-muted/50"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <>
                        {renderContent(msg.content, msg.commands, !!msg.content)}
                        {/* 有待执行的命令时显示执行按钮 */}
                        {msg.commands?.some((c) => c.status === "pending") && (
                          <div className="flex gap-2 mt-2">
                            {msg.commands
                              .filter((c) => c.status === "pending")
                              .map((cmd) => (
                                <Button
                                  key={cmd.id}
                                  size="xs"
                                  variant="outline"
                                  onClick={() => handleExecuteCommand(msg.id, cmd.id)}
                                  disabled={isLoading}
                                >
                                  <Play className="h-3 w-3 mr-1" />
                                  执行: {cmd.command.length > 30 ? cmd.command.slice(0, 30) + "..." : cmd.command}
                                </Button>
                              ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                )}

                {/* 思考或生成中的加载状态 */}
                {msg.role === "assistant" && isLoading && !msg.content && (
                  <div className="bg-muted/50 rounded-xl px-3 py-2 flex items-center gap-2 w-fit shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {msg.reasoning_content ? "正在生成回复..." : "AI 正在思考..."}
                    </span>
                  </div>
                )}
              </div>

              {msg.role === "user" && (
                <div className="flex-shrink-0 mt-1">
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
                    <User className="h-3.5 w-3.5" />
                  </div>
                </div>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* 输入区域 */}
      <div className="border-t p-3 shrink-0 space-y-2">
        {/* 模型选择 */}
        {providers.length > 0 && (
          <div className="flex gap-2">
            <Select
              value={selectedProviderId}
              onValueChange={(v) => {
                setSelectedProviderId(v);
                const p = providers.find((p) => p.id === v);
                if (p?.models.length) {
                  setSelectedModel(p.models[0]);
                }
              }}
            >
              <SelectTrigger size="sm" className="flex-1">
                <SelectValue placeholder="选择提供商" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedProvider && selectedProvider.models.length > 0 && (
              <Select
                value={selectedModel}
                onValueChange={setSelectedModel}
              >
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {selectedProvider.models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {providers.length === 0 && (
          <div className="text-center py-1">
            <Button
              variant="link"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setSettingsOpen(true)}
            >
              请先配置 AI 提供商
            </Button>
          </div>
        )}

        {/* 输入框 */}
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            placeholder="描述你的需求..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
            disabled={isLoading || providers.length === 0}
          />
          {isLoading ? (
            <Button
              size="icon"
              variant="outline"
              onClick={handleStop}
              className="shrink-0 self-end"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || providers.length === 0}
              className="shrink-0 self-end"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 设置对话框 */}
      <AISettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onProvidersUpdated={loadProviders}
      />
    </div>
  );
}