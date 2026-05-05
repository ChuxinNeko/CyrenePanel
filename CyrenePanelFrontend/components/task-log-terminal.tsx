"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import type { TaskLogEntry } from "@/lib/task-store";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const COLORS = {
  stage: "\x1b[34m",    // blue
  done: "\x1b[32m",     // green
  error: "\x1b[31m",    // red
  progress: "\x1b[90m", // gray
  reset: "\x1b[0m",
  dim: "\x1b[2m",
};

function renderLogLine(entry: TaskLogEntry): string {
  const time = formatTime(entry.timestamp);
  const color = COLORS[entry.type] || COLORS.progress;
  const label =
    entry.type === "stage"
      ? "[STAGE]"
      : entry.type === "done"
        ? "[DONE]"
        : entry.type === "error"
          ? "[ERROR]"
          : "";
  const prefix = label ? `${COLORS.dim}${time}${COLORS.reset} ${color}${label.padEnd(7)}${COLORS.reset}` : `${COLORS.dim}${time}${COLORS.reset} `;
  const text = entry.message || `${entry.layer ? `${entry.layer}: ` : ""}${entry.detail || ""}`;
  return `${prefix}${text}`;
}

interface TaskLogTerminalProps {
  logs: TaskLogEntry[];
  className?: string;
}

export default function TaskLogTerminal({ logs, className }: TaskLogTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const writtenCountRef = useRef(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Initialize terminal once
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (disposed || !containerRef.current) return;

      // Dispose previous instance if any
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }

      const terminal = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
        convertEol: true,
        theme: {
          background: "#0b0f14",
          foreground: "#e4e4e7",
          cursor: "#a1a1aa",
          selectionBackground: "#3f3f46",
        },
        allowProposedApi: true,
        padding: 4,
        scrollback: 5000,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);

      // Sync any logs that arrived before mount
      writtenCountRef.current = 0;
      for (const entry of logs) {
        terminal.writeln(renderLogLine(entry));
        writtenCountRef.current++;
      }

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}
      });

      const observer = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch {}
      });
      observer.observe(containerRef.current);
      observerRef.current = observer;
    })();

    return () => {
      disposed = true;
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      writtenCountRef.current = 0;
    };
  // Only run on mount/unmount — logs are handled in the effect below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Append new log entries incrementally
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const newLogs = logs.slice(writtenCountRef.current);
    for (const entry of newLogs) {
      terminal.writeln(renderLogLine(entry));
      writtenCountRef.current++;
    }

    // Auto-scroll to bottom
    if (newLogs.length > 0) {
      terminal.scrollToBottom();
    }
  }, [logs]);

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden ${className || ""}`}
      style={{ height: "100%" }}
    />
  );
}