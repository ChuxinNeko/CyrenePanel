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
} from "lucide-react";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
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

  // 获取子节点列表
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

  // 获取子节点在线状态
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

  // 初始化 xterm 终端
  const initTerminal = useCallback(() => {
    if (!termRef.current) return;

    // 如果已有终端，先销毁
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

    // 自动聚焦
    terminal.focus();

    return terminal;
  }, []);

  // 建立 WebSocket 连接（主节点）
  const connectMainTerminal = useCallback(() => {
    const token = getToken();
    if (!token || backendPort === null) {
      router.push("/login");
      return;
    }

    // 断开旧连接
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

      // 发送初始尺寸
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }

      // 连接成功后聚焦终端，确保键盘输入能被捕获
      requestAnimationFrame(() => {
        terminal.focus();
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          terminal.write(msg.data);
        } else if (msg.type === "ready") {
          terminal.clear();
        } else if (msg.type === "exit") {
          terminal.writeln(`\r\n\x1b[31m[终端进程已退出，退出码: ${msg.code}]\x1b[0m`);
          setConnected(false);
        } else if (msg.type === "error") {
          terminal.writeln(`\r\n\x1b[31m[错误: ${msg.message}]\x1b[0m`);
        }
      } catch {
        // 如果不是 JSON，直接写入
        terminal.write(event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (terminalRef.current) {
        terminalRef.current.writeln("\r\n\x1b[31m[连接已断开]\x1b[0m");
      }
      // 3 秒后尝试重连
      reconnectTimerRef.current = setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectMainTerminal();
        }
      }, 3000);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    // 终端输入 → WebSocket
    terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // 终端窗口大小变化 → 发送 resize
    terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
  }, [router, backendPort]);

  // 连接主节点终端
  useEffect(() => {
    if (!authChecked) return;
    if (backendPort === null) return;
    if (selectedNodeId) return; // 子节点模式下不连接主节点

    // 等待 DOM 渲染
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

  // 切换节点时重新连接
  useEffect(() => {
    if (!authChecked) return;
    if (backendPort === null) return;

    // 清理旧的终端
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
      // 子节点模式：通过主节点 WebSocket 代理连接
      const timer = setTimeout(() => {
        initTerminal();
        connectSubTerminal(selectedNodeId);
      }, 100);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, authChecked, initTerminal]);

  // 连接子节点终端（通过主节点代理）
  const connectSubTerminal = useCallback(
    (nodeId: string) => {
      const token = getToken();
      if (!token || backendPort === null) {
        router.push("/login");
        return;
      }

      const terminal = terminalRef.current;
      if (!terminal) return;

      // 找到子节点信息（仅用于显示名称）
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) {
        terminal.writeln(`\x1b[31m[节点信息未找到]\x1b[0m`);
        return;
      }

      // 通过主节点 WebSocket 代理连接子节点终端
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

  // 窗口 resize 时自适应终端
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // 忽略
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 切换节点
  const handleNodeChange = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  // 手动重连
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

  // 初始化
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

  // 刷新节点状态
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleReconnect}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            重连
          </Button>
        </div>
      </div>

      {/* 终端区域 */}
      <div className="flex-1 min-h-0 relative rounded-lg overflow-hidden">
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
