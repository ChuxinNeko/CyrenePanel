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