"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";

interface DesktopApp {
  id: string;
  label: string;
  command: string;
  highMemory: boolean;
  available: boolean;
  installable: boolean;
}

interface Geometry {
  id: string;
  width: number;
  height: number;
}

interface SessionInfo {
  id: string;
  mode: "app" | "desktop";
  appId: string | null;
  label: string;
  geometry: Geometry;
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
  limits?: {
    maxSessions: number;
    idleMinutes: number;
    geometries: Geometry[];
    privileged: boolean;
  };
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
  // null | "install" | "uninstall" | `app:<id>`
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState<SessionInfo | null>(null);
  const [geometryId, setGeometryId] = useState("1280x720");
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/desktop/status`, { headers: authHeaders() });
    const data: DesktopStatus = await res.json();
    setStatus(data);
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
  }, [log]);

  // 装 / 卸依赖 / 装单个应用，都是 SSE 流式输出，共用一套
  const runStream = async (url: string, busyKey: string) => {
    setBusy(busyKey);
    setLog([]);
    try {
      const res = await fetch(`${API_BASE}${url}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message || "操作启动失败");
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
              setLog((prev) => [...prev, evt.line || evt.message]);
            } else if (evt.type === "done") {
              if (evt.success) toast.success(evt.message);
              else toast.error(evt.message || "操作未完成");
            }
          } catch {
            // 非 JSON 行忽略
          }
        }
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const startSession = async (payload: { mode: "app" | "desktop"; appId?: string }) => {
    setStarting(true);
    try {
      const res = await fetch(`${API_BASE}/api/desktop/sessions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ...payload, geometryId }),
      });
      const data = await res.json();
      if (data.success && data.session) {
        setActive(data.session);
        await load();
      } else {
        toast.error(data.message || "启动失败");
      }
    } finally {
      setStarting(false);
    }
  };

  const handleStartApp = (app: DesktopApp) => {
    if (app.highMemory && !confirm(`${app.label} 属于高内存应用，可能占用数百 MB 到 1GB+，确定启动？`)) {
      return;
    }
    startSession({ mode: "app", appId: app.id });
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

  const handleUninstall = () => {
    if (!confirm("停用将关闭所有桌面会话并卸载相关依赖（Xvfb / x11vnc / openbox 等），确定继续？")) {
      return;
    }
    runStream("/api/desktop/uninstall/stream", "uninstall");
  };

  const handleInstallApp = (app: DesktopApp) => {
    runStream(`/api/desktop/apps/${app.id}/install/stream`, `app:${app.id}`);
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
  const geometries = status?.limits?.geometries ?? [];

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
        // ── 未启用：可选功能入口，点了才装依赖 ──
        <Card>
          <CardContent className="space-y-4 py-8">
            <div className="flex items-start gap-3">
              <MonitorPlay className="mt-0.5 size-6 shrink-0 text-mute" />
              <div className="space-y-1">
                <h2 className="font-medium">桌面模拟尚未启用</h2>
                <p className="text-sm text-muted-foreground">
                  启用会安装 Xvfb、x11vnc、openbox、任务栏与文件管理器等依赖（约 200–300 MB 磁盘）。
                  桌面框架本身内存占用很小，只有真正启动会话时才产生占用。
                </p>
                <p className="text-xs text-mute">
                  包管理器：{deps.packageManager} · 缺失组件：{deps.missing.join("、")}
                </p>
              </div>
            </div>

            <Button onClick={() => runStream("/api/desktop/install/stream", "install")} disabled={busy !== null}>
              {busy === "install" ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {busy === "install" ? "正在安装依赖..." : "启用桌面模拟（安装依赖）"}
            </Button>

            {log.length > 0 && <StreamLog logRef={logRef} lines={log} />}
          </CardContent>
        </Card>
      ) : (
        // ── 已启用：启动器 + 画布 ──
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={geometryId} onValueChange={setGeometryId}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {geometries.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.width}×{g.height}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => startSession({ mode: "desktop" })} disabled={starting}>
              {starting ? <RefreshCw className="size-3.5 animate-spin" /> : <Monitor className="size-3.5" />}
              启动完整桌面
            </Button>
            {!status?.limits?.privileged && (
              <Badge variant="outline" className="gap-1">
                <ShieldAlert className="size-3" />
                降权运行
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={handleUninstall}
              disabled={busy !== null}
            >
              {busy === "uninstall" ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              停用（卸载依赖）
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">单应用</span>
            {(status?.apps ?? []).map((app) => {
              const installing = busy === `app:${app.id}`;
              // 已装 → 启动；未装但可装 → 安装；未装且不可装 → 置灰
              if (!app.available && (app.installable || installing)) {
                return (
                  <Button
                    key={app.id}
                    variant="outline"
                    size="sm"
                    onClick={() => handleInstallApp(app)}
                    disabled={busy !== null}
                    title={`安装 ${app.label}`}
                  >
                    {installing ? (
                      <RefreshCw className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    安装 {app.label}
                    {app.highMemory && (
                      <Badge variant="outline" className="ml-1 gap-1">
                        <Cpu className="size-3" />
                        高内存
                      </Badge>
                    )}
                  </Button>
                );
              }
              return (
                <Button
                  key={app.id}
                  variant="outline"
                  size="sm"
                  onClick={() => handleStartApp(app)}
                  disabled={starting || busy !== null || !app.available}
                  title={app.available ? undefined : `${app.command} 未安装`}
                >
                  <Monitor className="size-3.5" />
                  {app.label}
                  {app.highMemory && (
                    <Badge variant="outline" className="ml-1 gap-1">
                      <Cpu className="size-3" />
                      高内存
                    </Badge>
                  )}
                  {!app.available && <span className="ml-1 text-mute">未安装</span>}
                </Button>
              );
            })}
            <span className="ml-auto font-mono text-[11px] text-mute">
              并发上限 {status?.limits?.maxSessions} · 空闲 {status?.limits?.idleMinutes} 分钟自动回收
            </span>
          </div>

          {(busy === "uninstall" || busy?.startsWith("app:")) && log.length > 0 && (
            <StreamLog logRef={logRef} lines={log} />
          )}

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
                    {s.label}
                    <span className="ml-1 text-mute">{s.geometry.id}</span>
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
                <span className="text-sm font-medium">
                  {active.label}
                  <span className="ml-1.5 font-mono text-xs text-mute">{active.geometry.id}</span>
                </span>
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
                <p className="text-sm text-muted-foreground">
                  选择上方一个应用，或启动完整桌面
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StreamLog({
  logRef,
  lines,
}: {
  logRef: React.RefObject<HTMLDivElement | null>;
  lines: string[];
}) {
  return (
    <div
      ref={logRef}
      className="max-h-64 overflow-y-auto rounded-md bg-surface-inset p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
    >
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all">
          {line}
        </div>
      ))}
    </div>
  );
}
