"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { API_BASE } from "@/lib/api-base";
import { toast } from "sonner";
import {
  CirclePause,
  CirclePlay,
  Loader2,
  RefreshCw,
  RotateCw,
  ScrollText,
} from "lucide-react";

interface AppInfo {
  exists: boolean;
  name: string;
  status: "running" | "stopped" | "failed" | "unknown";
  activeState: string;
  subState: string;
  pid: number | null;
  memory: number | null;
  enabled: boolean;
  since: string | null;
  runtime: string | null;
  startCommand: string;
  appPort: number | null;
  user: string;
  env: [string, string][];
  autoStart: boolean;
  workingDir: string;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return res.json();
}

async function apiPost<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: authHeaders() });
  return res.json();
}

async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function formatMemory(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "-";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function statusBadgeClass(status: AppInfo["status"]) {
  switch (status) {
    case "running":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "failed":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "stopped":
      return "bg-muted text-muted-foreground border-muted";
    default:
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
  }
}

function statusLabel(status: AppInfo["status"]) {
  switch (status) {
    case "running":
      return "运行中";
    case "failed":
      return "启动失败";
    case "stopped":
      return "已停止";
    default:
      return "未知";
  }
}

interface SiteRuntimePanelProps {
  siteName: string;
  basePath: string;
  onChanged?: () => void | Promise<void>;
}

export function SiteRuntimePanel({ siteName, basePath, onChanged }: SiteRuntimePanelProps) {
  const [app, setApp] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const [startCommand, setStartCommand] = useState("");
  const [appPort, setAppPort] = useState("");
  const [user, setUser] = useState("");
  const [envText, setEnvText] = useState("");
  const [autoStart, setAutoStart] = useState(true);

  const fetchApp = useCallback(async () => {
    try {
      const res = await apiGet<{ success: boolean; app?: AppInfo; message?: string }>(
        `${basePath}/${encodeURIComponent(siteName)}/app`,
      );
      if (res.success && res.app) {
        setApp(res.app);
        setStartCommand(res.app.startCommand || "");
        setAppPort(res.app.appPort ? String(res.app.appPort) : "");
        setUser(res.app.user || "");
        setEnvText((res.app.env || []).map(([k, v]) => `${k}=${v}`).join("\n"));
        setAutoStart(res.app.autoStart !== false);
      } else if (!res.success) {
        toast.error(res.message || "应用状态读取失败");
      }
    } catch (e: any) {
      toast.error(e.message || "应用状态读取失败");
    } finally {
      setLoading(false);
    }
  }, [basePath, siteName]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await apiGet<{ success: boolean; logs?: string; message?: string }>(
        `${basePath}/${encodeURIComponent(siteName)}/app/logs?lines=300`,
      );
      if (res.success) {
        setLogs(res.logs || "");
      } else {
        toast.error(res.message || "应用日志读取失败");
      }
    } catch (e: any) {
      toast.error(e.message || "应用日志读取失败");
    } finally {
      setLogsLoading(false);
    }
  }, [basePath, siteName]);

  useEffect(() => {
    fetchApp();
  }, [fetchApp]);

  const runAction = async (action: "start" | "stop" | "restart") => {
    setActing(action);
    try {
      const res = await apiPost<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(siteName)}/app/${action}`,
      );
      if (res.success) {
        toast.success(res.message || "操作成功");
        await fetchApp();
        await onChanged?.();
      } else {
        toast.error(res.message || "操作失败");
      }
    } catch (e: any) {
      toast.error(e.message || "操作失败");
    } finally {
      setActing(null);
    }
  };

  const toggleLogs = async () => {
    const next = !showLogs;
    setShowLogs(next);
    if (next && !logs) await fetchLogs();
  };

  const saveConfig = async () => {
    if (!startCommand.trim()) {
      toast.error("请填写应用启动命令");
      return;
    }
    const port = Number(appPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error("应用端口必须是 1-65535 之间的数字");
      return;
    }
    const env = envText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf("=");
        if (idx <= 0) return null;
        return [line.slice(0, idx).trim(), line.slice(idx + 1)] as [string, string];
      })
      .filter((pair): pair is [string, string] => !!pair);

    setSaving(true);
    try {
      const res = await apiPut<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(siteName)}/app`,
        { startCommand: startCommand.trim(), appPort: port, user: user.trim(), env, autoStart },
      );
      if (res.success) {
        toast.success(res.message || "应用配置已更新");
        await fetchApp();
        await onChanged?.();
      } else {
        toast.error(res.message || "应用配置保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "应用配置保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载应用状态中...
      </div>
    );
  }

  if (!app) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">未找到应用信息</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={statusBadgeClass(app.status)}>
              {statusLabel(app.status)}
            </Badge>
            {app.runtime && <Badge variant="secondary">{app.runtime.toUpperCase()}</Badge>}
            {app.enabled && <Badge variant="secondary">开机自启</Badge>}
            <span className="text-xs text-muted-foreground">服务名 {app.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {app.status === "running" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!!acting}
                onClick={() => runAction("stop")}
              >
                {acting === "stop" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CirclePause className="h-4 w-4" />
                )}
                停止
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!!acting}
                onClick={() => runAction("start")}
              >
                {acting === "start" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CirclePlay className="h-4 w-4" />
                )}
                启动
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!!acting}
              onClick={() => runAction("restart")}
            >
              {acting === "restart" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              重启
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchApp}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-4">
          <div>PID：{app.pid ?? "-"}</div>
          <div>内存：{formatMemory(app.memory)}</div>
          <div className="truncate">启动时间：{app.since || "-"}</div>
          <div className="truncate font-mono">127.0.0.1:{app.appPort ?? "-"}</div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="text-sm font-medium">应用配置</div>
        <div className="grid gap-4 md:grid-cols-[1fr_160px]">
          <div className="space-y-1.5">
            <Label>启动命令</Label>
            <Input
              className="font-mono text-sm"
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>应用端口</Label>
            <Input
              inputMode="numeric"
              value={appPort}
              onChange={(e) => setAppPort(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>运行用户</Label>
            <Input
              className="font-mono text-sm"
              placeholder="root"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>项目目录</Label>
            <Input className="font-mono text-sm" value={app.workingDir || "-"} disabled />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>环境变量</Label>
          <Textarea
            className="font-mono text-xs"
            placeholder={"NODE_ENV=production\nPORT=3000"}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="text-sm font-medium">开机自启</div>
          <Switch checked={autoStart} onCheckedChange={setAutoStart} />
        </div>
        <div className="flex justify-end">
          <Button onClick={saveConfig} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存并重启
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <button
          type="button"
          onClick={toggleLogs}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            应用日志（journalctl）
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {logsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {showLogs ? "收起" : "展开"}
          </span>
        </button>
        {showLogs && (
          <div className="space-y-2 border-t p-3">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={fetchLogs} disabled={logsLoading}>
                {logsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                刷新日志
              </Button>
            </div>
            <pre className="h-72 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-all">
              {logs || "暂无日志"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
