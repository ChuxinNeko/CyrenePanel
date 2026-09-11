"use client";

import { useEffect, useRef, useState } from "react";
import { buildBackendWsUrl } from "@/hooks/use-backend-port";
import { Loader2, WifiOff } from "lucide-react";

type ViewerState = "connecting" | "connected" | "disconnected" | "error";

/**
 * noVNC 画布。把 /api/desktop/vnc 的 RFB-over-WS 渲染成 canvas。
 *
 * RFB 只能在浏览器里跑，动态 import 避开 SSR。连接前先换一次性票据，
 * URL 里只出现 ticket，不出现 JWT。
 */
export function VncViewer({
  sessionId,
  backendPort,
  onClosed,
}: {
  sessionId: string;
  backendPort: number;
  onClosed?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<{ disconnect(): void } | null>(null);
  const [state, setState] = useState<ViewerState>("connecting");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;

    (async () => {
      if (!hostRef.current) return;
      let url: string;
      try {
        url = await buildBackendWsUrl(
          `/api/desktop/vnc?session=${encodeURIComponent(sessionId)}`,
          "desktop",
          backendPort,
        );
      } catch (e) {
        if (!disposed) {
          setState("error");
          setMessage(e instanceof Error ? e.message : "获取票据失败");
        }
        return;
      }
      if (disposed) return;

      const { default: RFB } = await import("@novnc/novnc/core/rfb.js");
      if (disposed || !hostRef.current) return;

      const rfb = new RFB(hostRef.current, url, { shared: true });
      rfb.scaleViewport = true; // 画面缩放贴合容器，不撑破布局
      rfb.background = "#0b0f19";
      rfbRef.current = rfb;

      rfb.addEventListener("connect", () => {
        if (!disposed) setState("connected");
      });
      rfb.addEventListener("disconnect", (e: Event) => {
        if (disposed) return;
        const clean = (e as CustomEvent<{ clean: boolean }>).detail?.clean;
        setState("disconnected");
        if (!clean) setMessage("连接已断开");
        onClosed?.();
      });
    })();

    return () => {
      disposed = true;
      try { rfbRef.current?.disconnect(); } catch {}
      rfbRef.current = null;
    };
  }, [sessionId, backendPort, onClosed]);

  return (
    <div className="relative overflow-hidden rounded-lg border bg-[#0b0f19]">
      <div ref={hostRef} className="h-[600px] w-full" />
      {state !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0b0f19]/80 text-sm text-muted-foreground">
          {state === "connecting" ? (
            <>
              <Loader2 className="size-6 animate-spin" />
              <span>正在连接桌面...</span>
            </>
          ) : (
            <>
              <WifiOff className="size-6" />
              <span>{message || "连接已断开"}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
