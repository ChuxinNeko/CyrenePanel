"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@iconify/react";
import yaml from "js-yaml";
import {
  Globe,
  HardDrive,
  ArrowRightLeft,
  Tag,
  ChevronLeft,
  ChevronRight,
  User,
  Rocket,
} from "lucide-react";
import { ComposeDeployDialog } from "@/components/compose-deploy-dialog";

// ── 类型 ─────────────────────────────────────────────────────────────

export interface AppDetail {
  id: string;
  title: string;
  icon: string;
  thumbnail: string;
  screenshots: string[];
  category: string;
  author: string;
  architectures: string[];
  description: Record<string, string>;
  compose: string;
  tagline: string;
}

interface ComposePort {
  target?: number | string;
  published?: number | string;
  protocol?: string;
}

interface ComposeVolume {
  source?: string;
  target?: string;
}

interface ParsedCompose {
  image: string;
  restart: string;
  ports: ComposePort[];
  volumes: ComposeVolume[];
}

// ── compose YAML 解析 ───────────────────────────────────────────────

function parseCompose(yamlStr: string): ParsedCompose {
  try {
    const doc = yaml.load(yamlStr) as any;
    const services = doc?.services;
    if (!services) return { image: "", restart: "", ports: [], volumes: [] };

    const serviceKey = Object.keys(services)[0];
    const svc = services[serviceKey];
    if (!svc) return { image: "", restart: "", ports: [], volumes: [] };

    return {
      image: svc.image || "",
      restart: svc.restart || "",
      ports: Array.isArray(svc.ports) ? svc.ports : [],
      volumes: Array.isArray(svc.volumes) ? svc.volumes : [],
    };
  } catch {
    return { image: "", restart: "", ports: [], volumes: [] };
  }
}

// ── 图标组件 ───────────────────────────────────────────────────────

function AppIcon({
  icon,
  className = "",
}: {
  icon: string;
  className?: string;
}) {
  if (icon.startsWith("http://") || icon.startsWith("https://")) {
    return <img src={icon} alt="" className={className} />;
  }
  if (icon.includes(":")) {
    return <Icon icon={icon} className={className} />;
  }
  return <span className={className}>{icon}</span>;
}

// ── 组件 ────────────────────────────────────────────────────────────

export function AppDetailDialog({
  app,
  open,
  onOpenChange,
  apiBase,
  authHeaders,
  isRemoteNode,
  selectedNodeId,
  onDeploySuccess,
}: {
  app: AppDetail | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  apiBase: string;
  authHeaders: () => Record<string, string>;
  isRemoteNode: boolean;
  selectedNodeId: string | null;
  onDeploySuccess: () => void;
}) {
  const [screenshotIdx, setScreenshotIdx] = useState(0);
  const [deployOpen, setDeployOpen] = useState(false);

  // 切换应用时重置截图索引
  useEffect(() => {
    setScreenshotIdx(0);
  }, [app?.id]);

  if (!app) return null;

  const compose = parseCompose(app.compose);

  // 优先中文描述
  const desc =
    app.description?.zh_cn ||
    app.description?.zh_CN ||
    app.description?.en_us ||
    app.description?.en_US ||
    Object.values(app.description || {})[0] ||
    app.tagline ||
    "";

  const hasScreenshots = app.screenshots.length > 0;

  const prevScreenshot = () =>
    setScreenshotIdx((i) =>
      i > 0 ? i - 1 : app.screenshots.length - 1
    );
  const nextScreenshot = () =>
    setScreenshotIdx((i) =>
      i < app.screenshots.length - 1 ? i + 1 : 0
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[95vw] h-[85vh] max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        style={{ maxWidth: "860px" }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{app.title}</DialogTitle>
        </DialogHeader>
        {/* ─── 可滚动区域 ──────────────────────────────────────── */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col">
            {/* ① 应用头部 */}
            <div className="px-6 pt-6 pb-4 flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-muted/80 to-muted/30 border border-border/50 shadow-sm overflow-hidden flex items-center justify-center shrink-0">
                <AppIcon icon={app.icon} className="w-11 h-11 object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold truncate leading-snug tracking-tight">
                  {app.title}
                </h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <Badge
                    variant="secondary"
                    className="text-[11px] px-2 py-0.5 font-medium"
                  >
                    {app.category}
                  </Badge>
                  {app.author && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3 shrink-0" />
                      {app.author}
                    </span>
                  )}
                  {app.architectures.length > 0 && (
                    <div className="flex items-center gap-1 ml-1">
                      {app.architectures.map((arch) => (
                        <Badge
                          key={arch}
                          variant="outline"
                          className="text-[9px] font-mono px-1.5 py-0"
                        >
                          {arch}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ② 截图轮播 */}
            {hasScreenshots && (
              <div className="px-6 pb-4">
                <div className="relative rounded-xl overflow-hidden bg-black/5 dark:bg-white/5 border border-border/20">
                  <img
                    src={app.screenshots[screenshotIdx]}
                    alt={`Screenshot ${screenshotIdx + 1}`}
                    className="w-full aspect-video object-contain"
                  />
                  {/* 左右切换 */}
                  {app.screenshots.length > 1 && (
                    <>
                      <button
                        onClick={prevScreenshot}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/90 backdrop-blur-sm border border-border/40 flex items-center justify-center text-foreground/60 hover:text-foreground hover:bg-background hover:shadow-md transition-all"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        onClick={nextScreenshot}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/90 backdrop-blur-sm border border-border/40 flex items-center justify-center text-foreground/60 hover:text-foreground hover:bg-background hover:shadow-md transition-all"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
                {/* 缩略图 */}
                {app.screenshots.length > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    {app.screenshots.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => setScreenshotIdx(i)}
                        className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all duration-150 ${
                          i === screenshotIdx
                            ? "border-primary shadow-sm w-14 h-9 opacity-100"
                            : "border-transparent w-12 h-8 opacity-40 hover:opacity-70"
                        }`}
                      >
                        <img
                          src={url}
                          alt={`Thumb ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 无截图时显示 thumbnail 或占位 */}
            {!hasScreenshots && (
              <div className="px-6 pb-4">
                <div className="rounded-xl overflow-hidden bg-muted/30 border border-border/20 flex items-center justify-center h-48">
                  {app.thumbnail ? (
                    <img
                      src={app.thumbnail}
                      alt={app.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <AppIcon icon={app.icon} className="w-16 h-16 opacity-15" />
                  )}
                </div>
              </div>
            )}

            {/* ③ 应用简介 */}
            {desc && (
              <div className="px-6 pb-4">
                <h3 className="text-sm font-semibold mb-2">应用简介</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-line">
                  {desc}
                </p>
              </div>
            )}

            {/* ④ 容器配置 */}
            {(compose.image || compose.restart || compose.ports.length > 0 || compose.volumes.length > 0) && (
              <div className="px-6 pb-6">
                <h3 className="text-sm font-semibold mb-2">容器配置</h3>
                <div className="rounded-xl border border-border/50 overflow-hidden bg-muted/10">
                  {compose.image && (
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 last:border-b-0">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                      <span className="text-xs text-muted-foreground">镜像</span>
                      <code className="text-[11px] font-mono ml-auto bg-muted/50 px-2 py-0.5 rounded-md truncate max-w-[280px]">
                        {compose.image}
                      </code>
                    </div>
                  )}

                  {compose.restart && (
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 last:border-b-0">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                      <span className="text-xs text-muted-foreground">重启策略</span>
                      <span className="text-xs ml-auto">{compose.restart}</span>
                    </div>
                  )}

                  {compose.ports.length > 0 && (
                    <div className="px-4 py-2.5 border-b border-border/30 last:border-b-0">
                      <div className="flex items-center gap-3 mb-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                        <span className="text-xs text-muted-foreground">端口映射</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-6">
                        {compose.ports.map((p, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 text-[11px] font-mono bg-muted/40 rounded-md px-2 py-1"
                          >
                            <span className="text-foreground/80">{p.published || "auto"}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-foreground/80">{p.target || "?"}</span>
                            <span className="text-muted-foreground/60 text-[10px]">/{p.protocol || "tcp"}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {compose.volumes.length > 0 && (
                    <div className="px-4 py-2.5">
                      <div className="flex items-center gap-3 mb-2">
                        <HardDrive className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                        <span className="text-xs text-muted-foreground">卷挂载</span>
                      </div>
                      <div className="flex flex-col gap-1 pl-6">
                        {compose.volumes.map((v, i) => (
                          <span
                            key={i}
                            className="text-[11px] font-mono bg-muted/40 rounded-md px-2 py-1 truncate"
                          >
                            <span className="text-foreground/80">{v.source || "auto"}</span>
                            <span className="text-muted-foreground mx-1">→</span>
                            <span className="text-foreground/80">{v.target || "?"}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 底部操作栏 */}
        <div className="shrink-0 px-6 py-3 border-t border-border/30 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 px-4 text-xs"
          >
            关闭
          </Button>
          <Button
            size="sm"
            onClick={() => setDeployOpen(true)}
            className="h-8 px-4 text-xs gap-1.5"
          >
            <Rocket className="h-3.5 w-3.5" />
            部署
          </Button>
        </div>
      </DialogContent>

      {/* 部署对话框 */}
      {app && (
        <ComposeDeployDialog
          appId={app.id}
          appTitle={app.title}
          appIcon={app.icon}
          open={deployOpen}
          onOpenChange={setDeployOpen}
          apiBase={apiBase}
          authHeaders={authHeaders}
          isRemoteNode={isRemoteNode}
          selectedNodeId={selectedNodeId}
          onDeploySuccess={() => {
            setDeployOpen(false);
            onOpenChange(false);
            onDeploySuccess();
          }}
        />
      )}
    </Dialog>
  );
}