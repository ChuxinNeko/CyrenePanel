"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { API_BASE } from "@/lib/api-base";
import { useBackendPort, getBackendWebSocketUrl } from "@/hooks/use-backend-port";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
  Terminal as TerminalIcon,
  PanelRightOpen,
  PanelRightClose,
} from "lucide-react";
import TerminalAIAssistant from "@/components/terminal-ai-assistant";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

function getActiveTerminalContent(terminal: Terminal | null): string {
  if (!terminal) return "";
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  // Get at most the last 150 lines to avoid massive payloads
  const start = Math.max(0, buffer.length - 150);
  for (let i = start; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  return lines.join("\n").replace(/\s+$/g, "");
}

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  apiKey: string;
  isMain: number;
  createdAt: number;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${url}`, { ...init, headers });
  return res.json();
}

function TerminalPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    searchParams.get("node")
  );
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const backendPort = useBackendPort();
  const [nodeStatus, setNodeStatus] = useState<Record<string, boolean>>({});
  const [aiPanelOpen, setAiPanelOpen] = useState(true);

  // ── 命令执行与输出捕获 ─────────────────────────────────────────

  // 用于捕获终端输出的回调列表
  const outputCaptureRef = useRef<((data: string) => void)[]>([]);

  /**
   * 向终端发送命令并捕获输出。
   * 原理：发送命令后，注册一个输出监听器，收集所有终端输出数据。
   * 当输出静默超过 2 秒 或总时长超过 15 秒时，认为命令执行完成。
   */
  const executeCommand = useCallback((command: string): Promise<string> => {
    return new Promise((resolve) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        resolve("[错误: 终端未连接]");
        return;
      }

      let output = "";
      let checkPromptTimer: ReturnType<typeof setTimeout> | null = null;
      let silenceFallbackTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (checkPromptTimer) clearTimeout(checkPromptTimer);
        if (silenceFallbackTimer) clearTimeout(silenceFallbackTimer);
        if (hardTimeout) clearTimeout(hardTimeout);
        const idx = outputCaptureRef.current.indexOf(onOutput);
        if (idx >= 0) outputCaptureRef.current.splice(idx, 1);
      };

      const checkIsDone = () => {
        cleanup();
        resolve(stripAnsi(output));
      };

      const onOutput = (data: string) => {
        output += data;
        
        if (checkPromptTimer) clearTimeout(checkPromptTimer);
        if (silenceFallbackTimer) clearTimeout(silenceFallbackTimer);

        // 500ms 短暂静默后，检查终端光标所在行是否像是一个 Shell Prompt
        checkPromptTimer = setTimeout(() => {
          if (!terminalRef.current) return;
          const buffer = terminalRef.current.buffer.active;
          let lastLine = "";
          for (let i = buffer.cursorY + buffer.baseY; i >= 0; i--) {
            const line = buffer.getLine(i);
            if (line) {
              const text = line.translateToString(true).trim();
              if (text) {
                lastLine = text;
                break;
              }
            }
          }
          // 匹配常见系统提示符的结尾字符: $, #, %, >
          if (/[$#%>]$/.test(lastLine)) {
            checkIsDone();
          }
        }, 500);

        // 10秒长静默后，作为兜底强制判定结束（防止某些耗时下载任务卡住，或非标准提示符）
        silenceFallbackTimer = setTimeout(() => {
          checkIsDone();
        }, 10000);
      };

      // 注册输出监听
      outputCaptureRef.current.push(onOutput);

      // 发送命令 + 回车
      ws.send(JSON.stringify({ type: "input", data: command + "\r" }));

      // 硬超时 120 秒
      hardTimeout = setTimeout(() => {
        cleanup();
        resolve(stripAnsi(output) || "[命令执行超时]");
      }, 120000);
    });
  }, []);

  // ── ANSI 清理 ──────────────────────────────────────────────────

  function stripAnsi(str: string): string {
    // 去除 ANSI 转义序列
    return str
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b[()][AB012]/g, "")
      .replace(/\r/g, "")
      .trim();
  }

  // ── 节点相关 ───────────────────────────────────────────────────

  const fetchNodes = useCallback(async () => {
    try {
      const data = await apiFetch<{
        success: boolean;
        nodes?: NodeInfo[];
      }>("/api/nodes");
      if (data.success && data.nodes) {
        setNodes(data.nodes);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchNodeStatuses = useCallback(async () => {
    for (const node of nodes) {
      try {
        const data = await apiFetch<{
          success: boolean;
          online?: boolean;
        }>(`/api/nodes/${node.id}/status`);
        setNodeStatus((prev) => ({
          ...prev,
          [node.id]: data.success && !!data.online,
        }));
      } catch {
        setNodeStatus((prev) => ({ ...prev, [node.id]: false }));
      }
    }
  }, [nodes]);

  // ── 终端初始化 ─────────────────────────────────────────────────

  const initTerminal = useCallback(() => {
    if (!termRef.current) return;

    if (terminalRef.current) {
      terminalRef.current.dispose();
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, "Courier New", monospace',
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        cursorAccent: "#1e1e2e",
        selectionBackground: "#585b70",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(termRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.focus();

    return terminal;
  }, []);

  // ── WebSocket 连接 ─────────────────────────────────────────────

  const connectMainTerminal = useCallback(() => {
    const token = getToken();
    if (!token || backendPort === null) {
      router.push("/login");
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const terminal = terminalRef.current;
    if (!terminal) return;

    const wsUrl = getBackendWebSocketUrl(`/api/terminal?token=${token}`, backendPort!);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      terminal.writeln("\x1b[33m正在连接主节点终端...\x1b[0m\r\n");

      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }

      requestAnimationFrame(() => {
        terminal.focus();
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          terminal.write(msg.data);
          // 通知输出捕获器
          for (const cb of outputCaptureRef.current) {
            cb(msg.data);
          }
        } else if (msg.type === "ready") {
          terminal.clear();
        } else if (msg.type === "exit") {
          terminal.writeln(`\r\n\x1b[31m[终端进程已退出，退出码: ${msg.code}]\x1b[0m`);
          setConnected(false);
        } else if (msg.type === "error") {
          terminal.writeln(`\r\n\x1b[31m[错误: ${msg.message}]\x1b[0m`);
        }
      } catch {
        terminal.write(event.data);
        for (const cb of outputCaptureRef.current) {
          cb(event.data);
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (terminalRef.current) {
        terminalRef.current.writeln("\r\n\x1b[31m[连接已断开]\x1b[0m");
      }
      reconnectTimerRef.current = setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectMainTerminal();
        }
      }, 3000);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
  }, [router, backendPort]);

  // ── 主节点连接 effect ─────────────────────────────────────────

  useEffect(() => {
    if (!authChecked) return;
    if (backendPort === null) return;
    if (selectedNodeId) return;

    const timer = setTimeout(() => {
      initTerminal();
      connectMainTerminal();
    }, 100);

    return () => {
      clearTimeout(timer);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
    };
  }, [authChecked, selectedNodeId, initTerminal, connectMainTerminal]);

  // ── 子节点切换 effect ──────────────────────────────────────────

  useEffect(() => {
    if (!authChecked) return;
    if (backendPort === null) return;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }

    if (selectedNodeId) {
      const timer = setTimeout(() => {
        initTerminal();
        connectSubTerminal(selectedNodeId);
      }, 100);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, authChecked, initTerminal]);

  // ── 子节点终端连接 ─────────────────────────────────────────────

  const connectSubTerminal = useCallback(
    (nodeId: string) => {
      const token = getToken();
      if (!token || backendPort === null) {
        router.push("/login");
        return;
      }

      const terminal = terminalRef.current;
      if (!terminal) return;

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) {
        terminal.writeln(`\x1b[31m[节点信息未找到]\x1b[0m`);
        return;
      }

      const wsUrl = getBackendWebSocketUrl(`/api/nodes/${nodeId}/terminal?token=${token}`, backendPort!);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        terminal.writeln(`\x1b[33m正在连接子节点: ${node.name}...\x1b[0m\r\n`);

        const dims = fitAddonRef.current?.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output") {
            terminal.write(msg.data);
            for (const cb of outputCaptureRef.current) {
              cb(msg.data);
            }
          } else if (msg.type === "ready") {
            terminal.clear();
          } else if (msg.type === "exit") {
            terminal.writeln(`\r\n\x1b[31m[终端进程已退出，退出码: ${msg.code}]\x1b[0m`);
            setConnected(false);
          } else if (msg.type === "error") {
            terminal.writeln(`\r\n\x1b[31m[错误: ${msg.message}]\x1b[0m`);
          }
        } catch {
          terminal.write(event.data);
          for (const cb of outputCaptureRef.current) {
            cb(event.data);
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (terminalRef.current) {
          terminalRef.current.writeln("\r\n\x1b[31m[连接已断开]\x1b[0m");
        }
        reconnectTimerRef.current = setTimeout(() => {
          if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
            connectSubTerminal(nodeId);
          }
        }, 3000);
      };

      ws.onerror = () => {
        setConnected(false);
      };

      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      terminal.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });
    },
    [router, nodes, backendPort]
  );

  // ── 窗口 resize ────────────────────────────────────────────────

  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ── 工具函数 ───────────────────────────────────────────────────

  const handleNodeChange = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleReconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    setTimeout(() => {
      initTerminal();
      if (selectedNodeId) {
        connectSubTerminal(selectedNodeId);
      } else {
        connectMainTerminal();
      }
    }, 100);
  }, [selectedNodeId, initTerminal, connectMainTerminal, connectSubTerminal]);

  // ── 认证与初始化 ───────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      try {
        const res = await apiFetch<{ success: boolean; profile?: unknown }>(
          "/api/me"
        );
        if (!res.success) {
          router.push("/login");
          return;
        }
        await fetchNodes();
      } catch {
        router.push("/login");
      } finally {
        setAuthChecked(true);
      }
    };
    init();
  }, [router, fetchNodes]);

  useEffect(() => {
    if (nodes.length === 0) return;
    fetchNodeStatuses();
    const timer = setInterval(fetchNodeStatuses, 30000);
    return () => clearInterval(timer);
  }, [nodes, fetchNodeStatuses]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-7rem)]">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] p-4 gap-4">
      {/* 顶栏 */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">终端</h1>
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
              connected
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-red-500/10 text-red-500"
            }`}
          >
            {connected ? (
              <>
                <Wifi className="h-3 w-3" />
                已连接
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" />
                未连接
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 节点选择器 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Server className="h-4 w-4" />
              <span>节点:</span>
            </div>
            <select
              value={selectedNodeId || ""}
              onChange={(e) => handleNodeChange(e.target.value || null)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">主节点</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={handleReconnect}>
            <RefreshCw className="h-4 w-4 mr-2" />
            重连
          </Button>
          <Button
            variant={aiPanelOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setAiPanelOpen(!aiPanelOpen)}
          >
            {aiPanelOpen ? (
              <PanelRightClose className="h-4 w-4 mr-1" />
            ) : (
              <PanelRightOpen className="h-4 w-4 mr-1" />
            )}
            AI 助手
          </Button>
        </div>
      </div>

      {/* 主体区域：终端 + AI 面板 */}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* 终端区域 */}
        <div
          className={`relative rounded-lg overflow-hidden min-w-0 transition-all duration-200 ${
            aiPanelOpen ? "flex-1" : "flex-1"
          }`}
        >
          <div
            ref={termRef}
            className="absolute inset-0"
            style={{
              backgroundColor: "#1e1e2e",
            }}
            onClick={() => terminalRef.current?.focus()}
          />
          {!connected && authChecked && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <TerminalIcon className="h-8 w-8" />
                <p className="text-sm">
                  {selectedNodeId ? "正在连接子节点终端..." : "正在连接终端..."}
                </p>
                <Button variant="outline" size="sm" onClick={handleReconnect}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  重新连接
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* AI 助手面板 */}
        {aiPanelOpen && (
          <div
            className="rounded-lg border bg-card overflow-hidden flex flex-col"
            style={{ width: 400, maxWidth: 400, minWidth: 0, flex: '0 0 400px' }}
          >
            <TerminalAIAssistant
              onExecuteCommand={executeCommand}
              onGetTerminalContext={() => getActiveTerminalContent(terminalRef.current)}
              className="h-full"
              nodeId={selectedNodeId}
              nodeName={selectedNodeId ? nodes.find(n => n.id === selectedNodeId)?.name : null}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function TerminalPage() {
  return (
    <Suspense fallback={<TerminalPageFallback />}>
      <TerminalPageContent />
    </Suspense>
  );
}

function TerminalPageFallback() {
  return (
    <div className="flex h-[calc(100vh-7rem)] items-center justify-center">
      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}