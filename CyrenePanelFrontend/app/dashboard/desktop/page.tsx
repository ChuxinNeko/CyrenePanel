"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { VncViewer } from "@/components/desktop/vnc-viewer";
import { useBackendPort } from "@/hooks/use-backend-port";
import { API_BASE } from "@/lib/api-base";
import { toast } from "sonner";
import {
  AlertCircle,
  Cpu,
  Download,
  Monitor,
  MonitorPlay,
  Power,
  RefreshCw,
  X,
} from "lucide-react";

interface DesktopApp {
  id: string;
  label: string;
  command: string;
  highMemory: boolean;
}

interface SessionInfo {
  id: string;
  appId: string;
  appLabel: string;
  geometry: { width: number; height: number };
  startedAt: number;
}

interface DesktopStatus {
  success?: boolean;
  message?: string;
  enabled?: boolean;
  deps?: {
    installed: boolean;
    missing: string[];
    packageManager: string | null;
    installable: boolean;
  };
  apps?: DesktopApp[];
  sessions?: SessionInfo[];
  limits?: { maxSessions: number; idleMinutes: number };
  isAdmin?: boolean;
}

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export default function DesktopPage() {
  const backendPort = useBackendPort();
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const [active, setActive] = useState<SessionInfo | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/desktop/status`, { headers: authHeaders() });
    const data: DesktopStatus = await res.json();
    setStatus(data);
    // 已有会话就直接接上（比如刷新页面后）
    setActive((prev) => {
      if (prev && data.sessions?.some((s) => s.id === prev.id)) return prev;
      return data.sessions?.[0] ?? null;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [installLog]);

  const handleInstall = async () => {
    setInstalling(true);
    setInstallLog([]);
    try {
      const res = await fetch(`${API_BASE}/api/desktop/install/stream`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message || "安装启动失败");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() || "";
        for (const chunk of chunks) {
          const line = chunk.replace(/^data:\s*/, "").trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "log" || evt.type === "stage") {
              setInstallLog((prev) => [...prev, evt.line || evt.message]);
            } else if (evt.type === "done") {
              if (evt.success) toast.success("桌面依赖安装完成");
              else toast.error(evt.message || "安装未完成");
            }
          } catch {
            // 非 JSON 行忽略
          }
        }
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "安装失败");
    } finally {
      setInstalling(false);
    }
  };

  const handleStart = async (app: DesktopApp) => {
    if (app.highMemory && !confirm(`${app.label} 属于高内存应用，可能占用数百 MB 到 1GB+，确定启动？`)) {
      return;
    }
    setStarting(app.id);
    try {
      const res = await fetch(`${API_BASE}/api/desktop/sessions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ appId: app.id }),
      });
      const data = await res.json();
      if (data.success && data.session) {
        setActive(data.session);
        await load();
      } else {
        toast.error(data.message || "启动失败");
      }
    } finally {
      setStarting(null);
    }
  };

  const handleStop = async (id: string) => {
    const res = await fetch(`${API_BASE}/api/desktop/sessions/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const data = await res.json();
    if (data.success || data.ok) {
      if (active?.id === id) setActive(null);
      await load();
    } else {
      toast.error(data.message || "关闭失败");
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const deps = status?.deps;
  const isAdmin = status?.isAdmin ?? false;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-display">桌面模拟</h1>
        <p className="text-sm text-muted-foreground">
          为无图形界面的服务器提供浏览器内的图形桌面，按需启用、按需启动，默认不占用任何资源
        </p>
      </div>

      {!isAdmin ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertCircle className="size-8 text-mute" />
            <p className="text-sm text-muted-foreground">桌面模拟仅限管理员使用</p>
          </CardContent>
        </Card>
      ) : !deps?.installable ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertCircle className="size-8 text-mute" />
            <p className="text-sm text-muted-foreground">
              {status?.message || "当前系统不支持桌面模拟（需要 Linux + apt/dnf/yum）"}
            </p>
          </CardContent>
        </Card>
      ) : !deps.installed ? (
        // ── 未启用：可选功能的入口，点了才装依赖 ──
        <Card>
          <CardContent className="space-y-4 py-8">
            <div className="flex items-start gap-3">
              <MonitorPlay className="mt-0.5 size-6 shrink-0 text-mute" />
              <div className="space-y-1">
                <h2 className="font-medium">桌面模拟尚未启用</h2>
                <p className="text-sm text-muted-foreground">
                  启用会安装 Xvfb、x11vnc、openbox 与字体等依赖（约 150–250 MB 磁盘）。
                  桌面框架本身内存占用很小（几十 MB），只有真正启动应用时才产生占用。
                </p>
                <p className="text-xs text-mute">
                  包管理器：{deps.packageManager} · 缺失组件：{deps.missing.join("、")}
                </p>
              </div>
            </div>

            <Button onClick={handleInstall} disabled={installing}>
              {installing ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {installing ? "正在安装依赖..." : "启用桌面模拟（安装依赖）"}
            </Button>

            {installLog.length > 0 && (
              <div
                ref={logRef}
                className="max-h-64 overflow-y-auto rounded-md bg-surface-inset p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
              >
                {installLog.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        // ── 已启用：应用启动器 + 画布 ──
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">启动应用</span>
            {(status?.apps ?? []).map((app) => (
              <Button
                key={app.id}
                variant="outline"
                size="sm"
                onClick={() => handleStart(app)}
                disabled={starting !== null}
              >
                {starting === app.id ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Monitor className="size-3.5" />
                )}
                {app.label}
                {app.highMemory && (
                  <Badge variant="outline" className="ml-1 gap-1">
                    <Cpu className="size-3" />
                    高内存
                  </Badge>
                )}
              </Button>
            ))}
            <span className="ml-auto font-mono text-[11px] text-mute">
              并发上限 {status?.limits?.maxSessions} · 空闲 {status?.limits?.idleMinutes} 分钟自动回收
            </span>
          </div>

          {(status?.sessions?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">运行中</span>
              {(status?.sessions ?? []).map((s) => (
                <div
                  key={s.id}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                    active?.id === s.id ? "border-primary" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActive(s)}
                    className="font-medium focus-visible:outline-none"
                  >
                    {s.appLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStop(s.id)}
                    className="text-mute transition-colors hover:text-destructive"
                    title="关闭会话"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {active && backendPort !== null ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{active.appLabel}</span>
                <Button variant="outline" size="sm" onClick={() => handleStop(active.id)}>
                  <Power className="size-3.5" />
                  关闭桌面
                </Button>
              </div>
              <VncViewer
                key={active.id}
                sessionId={active.id}
                backendPort={backendPort}
                onClosed={() => load()}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <MonitorPlay className="size-8 text-mute" />
                <p className="text-sm text-muted-foreground">选择上方一个应用启动桌面</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
