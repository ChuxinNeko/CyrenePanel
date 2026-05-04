"use client";

import { useEffect, useRef, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";

// ── 类型 ─────────────────────────────────────────────────────────────────

interface XtermTerminalProps {
  instanceId: string;
  status: "running" | "stopped" | "error";
  className?: string;
}

// ── API 基础配置 ─────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5677";

function getWsUrl(instanceId: string): string {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : "";
  const wsBase = API_BASE.replace(/^http/, "ws");
  return `${wsBase}/api/instances/${instanceId}/terminal?token=${encodeURIComponent(token || "")}`;
}

// ── 组件 ─────────────────────────────────────────────────────────────────

export default function XtermTerminal({ instanceId, status, className }: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isConnectedRef = useRef(false);
  const observerRef = useRef<ResizeObserver | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    isConnectedRef.current = false;
  }, []);

  const connect = useCallback(async () => {
    if (!containerRef.current || isConnectedRef.current) return;

    // 动态导入 xterm（避免 SSR）
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ]);

    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
        cursor: "#a1a1aa",
        selectionBackground: "#3f3f46",
      },
      allowProposedApi: true,
      padding: 8,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // 延迟 fit 等待 DOM 完全渲染
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // ResizeObserver 自适应
    const observer = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    observer.observe(containerRef.current);
    observerRef.current = observer;

    // WebSocket 连接
    const wsUrl = getWsUrl(instanceId);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      isConnectedRef.current = true;
      terminal.write("\r\n\x1b[32m[已连接到终端]\x1b[0m\r\n");
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // 检查是否是 JSON 控制消息
        if (event.data.startsWith("{") && event.data.endsWith("}")) {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "exit") {
              terminal.write(`\r\n\x1b[33m[进程已退出，code: ${msg.code}]\x1b[0m\r\n`);
              isConnectedRef.current = false;
              return;
            }
          } catch {
            // 不是 JSON，当普通输出处理
          }
        }
        terminal.write(event.data);
      } else if (event.data instanceof Blob) {
        event.data.text().then((text: string) => {
          terminal.write(text);
        });
      }
    };

    ws.onclose = () => {
      if (isConnectedRef.current) {
        terminal.write("\r\n\x1b[31m[连接已断开]\x1b[0m\r\n");
      }
      isConnectedRef.current = false;
      wsRef.current = null;
    };

    ws.onerror = () => {
      terminal.write("\r\n\x1b[31m[连接出错]\x1b[0m\r\n");
      isConnectedRef.current = false;
    };

    wsRef.current = ws;

    // 用户输入 -> WS
    terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }, [instanceId]);

  // 根据 status 自动连接/断开
  useEffect(() => {
    if (status === "running") {
      connect();
    } else {
      // 断开 WS
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        isConnectedRef.current = false;
      }
      // 如果终端已初始化，显示状态提示
      if (terminalRef.current) {
        const label = status === "stopped" ? "已停止" : "错误";
        terminalRef.current.write(`\r\n\x1b[33m[实例${label}]\x1b[0m\r\n`);
      }
    }

    return cleanup;
  }, [status, connect, cleanup]);

  return (
    <div
      ref={containerRef}
      className={`rounded-lg overflow-hidden border border-zinc-800 bg-[#09090b] ${className || ""}`}
      style={{ height: "650px", width: "100%" }}
    />
  );
}