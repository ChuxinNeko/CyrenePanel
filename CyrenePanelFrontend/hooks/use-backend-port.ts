import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "@/lib/api-base";

let cachedPort: number | null = null;

export function useBackendPort() {
  const [port, setPort] = useState<number | null>(cachedPort);
  const fetched = useRef(false);

  const fetchPort = useCallback(async () => {
    if (cachedPort !== null) {
      setPort(cachedPort);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      const data = await res.json();
      if (data.backendPort) {
        cachedPort = data.backendPort;
        setPort(data.backendPort);
      }
    } catch {
      // 静默失败，回退到默认端口
      cachedPort = 5677;
      setPort(5677);
    }
  }, []);

  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true;
      fetchPort();
    }
  }, [fetchPort]);

  return port;
}

/**
 * 构建直连后端的 WebSocket URL
 * 通过当前页面的 host + 后端端口直连，不经过 Next.js 代理
 */
export function getBackendWebSocketUrl(path: string, backendPort: number): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  // 开发模式：NEXT_PUBLIC_API_URL 已设置时，直接用它
  if (API_BASE) {
    return `${API_BASE.replace(/^http/, "ws")}${normalizedPath}`;
  }

  // 生产模式：用当前页面 host + 后端端口直连
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    return `${protocol}//${host}:${backendPort}${normalizedPath}`;
  }

  return normalizedPath;
}

export type TerminalTicketPurpose = "system" | "docker-exec" | "instance" | "desktop";

/**
 * 构建带一次性票据的终端 WS URL。
 *
 * 先用带 Bearer 头的普通 HTTP（经前端代理）换一张短时效票据，再把票据拼进 WS URL。
 * JWT 因此不再出现在 URL 里，也就不会进浏览器历史或前置反代的 access 日志。
 */
export async function buildBackendWsUrl(
  path: string,
  purpose: TerminalTicketPurpose,
  backendPort: number,
): Promise<string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(`${API_BASE}/api/terminal/ticket`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ purpose }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.success || !data.ticket) {
    throw new Error(data?.message || "获取终端票据失败");
  }
  const sep = path.includes("?") ? "&" : "?";
  return getBackendWebSocketUrl(
    `${path}${sep}ticket=${encodeURIComponent(data.ticket)}`,
    backendPort,
  );
}