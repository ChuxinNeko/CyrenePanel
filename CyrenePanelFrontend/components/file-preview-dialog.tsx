"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  FileImage,
  Film,
  Maximize2,
  Music,
  RefreshCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  checkPreviewSize,
  type FileKind,
} from "@/lib/file-kind";
import {
  buildFileRawUrl,
  kindSupportsNativeRange,
  loadPreviewBlobUrl,
  probeFileRaw,
  revokeObjectUrl,
} from "@/lib/file-media-url";

export interface FilePreviewTarget {
  path: string;
  name: string;
  kind: "image" | "video" | "audio";
  size: number;
  mimeType?: string | false | null;
  nodeId?: string | null;
}

interface FilePreviewDialogProps {
  target: FilePreviewTarget | null;
  onClose: () => void;
  onDownload?: (path: string) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}

function KindIcon({ kind }: { kind: FileKind }) {
  if (kind === "video") return <Film className="h-4 w-4 shrink-0 text-pink-500" />;
  if (kind === "audio") return <Music className="h-4 w-4 shrink-0 text-cyan-500" />;
  return <FileImage className="h-4 w-4 shrink-0 text-purple-500" />;
}

/**
 * 图片缩放层：职责仅限 transform 交互
 * - 滚轮缩放 / 拖拽平移 / 双击切换
 * - 工具栏 zoomIn / zoomOut / reset / 适配窗口
 * - src 变化时重置变换，避免切图残留缩放
 */
function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const apiRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const [scalePercent, setScalePercent] = useState(100);

  useEffect(() => {
    apiRef.current?.resetTransform(0);
    setScalePercent(100);
  }, [src]);

  return (
    <div className="relative h-full w-full">
      <TransformWrapper
        key={src}
        ref={apiRef}
        initialScale={1}
        minScale={0.2}
        maxScale={8}
        centerOnInit
        limitToBounds={false}
        // smooth 模式下实际步长 = step × |deltaY|；鼠标一格 deltaY≈100，
        // step 过大（如 0.12）会一次跳到上下限，这里用库默认量级保证丝滑
        wheel={{ step: 0.002 }}
        doubleClick={{ mode: "toggle", step: 1.6 }}
        panning={{ velocityDisabled: true }}
        onTransform={(_, state) => {
          setScalePercent(Math.round(state.scale * 100));
        }}
      >
        {({ zoomIn, zoomOut, resetTransform, centerView }) => (
          <>
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/70 p-1 shadow-lg backdrop-blur-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/15 hover:text-white"
                title="缩小"
                onClick={() => zoomOut()}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="min-w-12 select-none text-center text-xs tabular-nums text-white/90">
                {scalePercent}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/15 hover:text-white"
                title="放大"
                onClick={() => zoomIn()}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <div className="mx-0.5 h-4 w-px bg-white/20" />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/15 hover:text-white"
                title="重置 100%"
                onClick={() => resetTransform()}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/15 hover:text-white"
                title="适配窗口"
                onClick={() => centerView(1)}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>

            <TransformComponent
              wrapperClass="!h-full !w-full"
              contentClass="!flex !h-full !w-full !items-center !justify-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt}
                className="max-h-[calc(85vh-3.5rem)] max-w-[95vw] select-none object-contain"
                draggable={false}
              />
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}

/**
 * 媒体预览对话框
 *
 * 加载策略：
 * 1. 体积校验
 * 2. 探测 /files/raw → 成功则用 token 直链（视频可 Range seek）
 * 3. 失败则回退 base64 download → blob URL（旧节点 / 小文件）
 * 4. 关闭时 revoke blob，abort 进行中的请求
 */
export function FilePreviewDialog({ target, onClose, onDownload }: FilePreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"raw" | "blob" | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 切换目标 / 关闭时清理资源
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    revokeObjectUrl(blobUrlRef.current);
    blobUrlRef.current = null;
    setSrc(null);
    setError(null);
    setSourceMode(null);
    setLoading(false);

    if (!target) return;

    const sizeError = checkPreviewSize(target.kind, target.size);
    if (sizeError) {
      setError(sizeError);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    (async () => {
      try {
        // 1) 优先 raw 直链（性能最好，支持 Range）
        const probe = await probeFileRaw({
          path: target.path,
          nodeId: target.nodeId,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (probe.ok) {
          const rawUrl = buildFileRawUrl({
            path: target.path,
            nodeId: target.nodeId,
          });
          if (rawUrl) {
            setSrc(rawUrl);
            setSourceMode("raw");
            setLoading(false);
            return;
          }
        }

        // 2) 回退：全量 base64 → blob（仅小文件可接受）
        // 视频若无 raw 且体积较大，避免拖垮浏览器
        if (kindSupportsNativeRange(target.kind) && target.size > 30 * 1024 * 1024) {
          setError(
            probe.message
              ? `${probe.message}。大视频需要后端 raw 接口支持，请升级节点或下载查看`
              : "当前节点不支持流式预览，大视频请下载查看",
          );
          setLoading(false);
          return;
        }

        const blob = await loadPreviewBlobUrl({
          path: target.path,
          nodeId: target.nodeId,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          revokeObjectUrl(blob.url);
          return;
        }
        blobUrlRef.current = blob.url;
        setSrc(blob.url);
        setSourceMode("blob");
        setLoading(false);
      } catch (e: any) {
        if (controller.signal.aborted || e?.name === "AbortError") return;
        setError(e?.message || "预览加载失败");
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
      revokeObjectUrl(blobUrlRef.current);
      blobUrlRef.current = null;
    };
  }, [target]);

  const open = !!target;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[85vh] w-[95vw] max-w-[95vw] flex-col gap-0 p-0 sm:max-w-[95vw]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>预览 - {target?.name || ""}</DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {target && <KindIcon kind={target.kind} />}
            <span className="truncate text-sm font-medium">{target?.name}</span>
            {target && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(target.size)}
              </span>
            )}
            {sourceMode === "raw" && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                流式
              </Badge>
            )}
            {sourceMode === "blob" && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                兼容
              </Badge>
            )}
            {target?.kind === "image" && !loading && !error && src && (
              <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
                滚轮缩放 · 拖拽平移 · 双击切换
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {target && onDownload && (
              <Button
                variant="ghost"
                size="icon"
                title="下载"
                onClick={() => onDownload(target.path)}
              >
                <Download className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" title="关闭" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/90">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              加载预览...
            </div>
          )}

          {!loading && error && (
            <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
              <AlertCircle className="h-10 w-10 text-destructive/80" />
              <p className="text-sm text-muted-foreground">{error}</p>
              {target && onDownload && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onDownload(target.path)}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  下载文件
                </Button>
              )}
            </div>
          )}

          {!loading && !error && src && target?.kind === "image" && (
            <ZoomableImage src={src} alt={target.name} />
          )}

          {!loading && !error && src && target?.kind === "video" && (
            <video
              key={src}
              src={src}
              controls
              playsInline
              preload="metadata"
              className="max-h-full max-w-full"
            />
          )}

          {!loading && !error && src && target?.kind === "audio" && (
            <div className="flex w-full max-w-xl flex-col items-center gap-6 px-8">
              <Music className="h-16 w-16 text-cyan-400/80" />
              <p className="truncate text-sm text-muted-foreground">{target.name}</p>
              <audio key={src} src={src} controls preload="metadata" className="w-full" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}