"use client";

import { useEffect, useRef, useState } from "react";
import { buildBackendWsUrl } from "@/hooks/use-backend-port";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardPaste, Keyboard, Loader2, WifiOff } from "lucide-react";

type ViewerState = "connecting" | "connected" | "disconnected" | "error";

interface RFBLike {
  disconnect(): void;
  sendCtrlAltDel(): void;
  clipboardPasteFrom(text: string): void;
  scaleViewport: boolean;
  background: string;
  qualityLevel: number;
  compressionLevel: number;
}

/** 画质档：越靠「流畅」JPEG 压得越狠、带宽越省，广域网下更跟手 */
const QUALITY_PRESETS: Record<string, { quality: number; compression: number }> = {
  fast: { quality: 2, compression: 4 },
  balanced: { quality: 6, compression: 2 },
  sharp: { quality: 9, compression: 1 },
};

/**
 * noVNC 画布。把 /api/desktop/vnc 的 RFB-over-WS 渲染成 canvas。
 *
 * RFB 只能在浏览器里跑，动态 import 避开 SSR。连接前先换一次性票据，
 * URL 里只出现 ticket，不出现 JWT。
 *
 * 画面用 scaleViewport 客户端缩放贴合容器——这条任何环境都稳；服务端真分辨率
 * 由启动会话时选定，不做实时 resize（Xvfb 的 RANDR 模式有限，易碎）。
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
  const rfbRef = useRef<RFBLike | null>(null);
  const [state, setState] = useState<ViewerState>("connecting");
  const [message, setMessage] = useState("");
  const [clip, setClip] = useState("");
  const [quality, setQuality] = useState("balanced");
  // 画质切换要即时生效、又不能触发重连，所以用 ref 传给连接闭包
  const qualityRef = useRef(quality);

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

      // 包 exports 只暴露根入口（映射到 core/rfb.js），不能走子路径
      const { default: RFB } = await import("@novnc/novnc");
      if (disposed || !hostRef.current) return;

      const rfb = new RFB(hostRef.current, url, { shared: true }) as unknown as RFBLike;
      rfb.scaleViewport = true;
      rfb.background = "#0b0f19";
      const preset = QUALITY_PRESETS[qualityRef.current] ?? QUALITY_PRESETS.balanced;
      rfb.qualityLevel = preset.quality;
      rfb.compressionLevel = preset.compression;
      rfbRef.current = rfb;

      const target = rfb as unknown as EventTarget;
      target.addEventListener("connect", () => {
        if (!disposed) setState("connected");
      });
      target.addEventListener("disconnect", (e: Event) => {
        if (disposed) return;
        const clean = (e as CustomEvent<{ clean: boolean }>).detail?.clean;
        setState("disconnected");
        if (!clean) setMessage("连接已断开");
        onClosed?.();
      });
      // 桌面剪贴板变化 → 回填输入框，方便复制到本地
      target.addEventListener("clipboard", (e: Event) => {
        const text = (e as CustomEvent<{ text: string }>).detail?.text;
        if (typeof text === "string" && !disposed) setClip(text);
      });
    })();

    return () => {
      disposed = true;
      try { rfbRef.current?.disconnect(); } catch {}
      rfbRef.current = null;
    };
  }, [sessionId, backendPort, onClosed]);

  // 画质切换即时生效，不重连
  useEffect(() => {
    qualityRef.current = quality;
    const rfb = rfbRef.current;
    if (!rfb) return;
    const preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.balanced;
    try {
      rfb.qualityLevel = preset.quality;
      rfb.compressionLevel = preset.compression;
    } catch {}
  }, [quality]);

  const sendClipboard = () => {
    try { rfbRef.current?.clipboardPasteFrom(clip); } catch {}
  };
  const sendCtrlAltDel = () => {
    try { rfbRef.current?.sendCtrlAltDel(); } catch {}
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-56 flex-1 items-center gap-1.5">
          <Input
            value={clip}
            onChange={(e) => setClip(e.target.value)}
            placeholder="剪贴板文本：输入后发送到桌面，桌面复制的内容也会回填到这里"
            className="h-8"
          />
          <Button variant="outline" size="sm" onClick={sendClipboard} disabled={state !== "connected"}>
            <ClipboardPaste className="size-3.5" />
            发送到桌面
          </Button>
        </div>
        <Select value={quality} onValueChange={setQuality}>
          <SelectTrigger size="sm" className="w-24" title="画质越低越省带宽、越跟手">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">流畅</SelectItem>
            <SelectItem value="balanced">均衡</SelectItem>
            <SelectItem value="sharp">高清</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={sendCtrlAltDel} disabled={state !== "connected"}>
          <Keyboard className="size-3.5" />
          Ctrl+Alt+Del
        </Button>
      </div>

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
    </div>
  );
}
