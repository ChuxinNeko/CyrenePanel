"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Box,
  Plus,
  Terminal,
  FolderOpen,
  Clock,
  AlertCircle,
  Trash2,
  Play,
  Square,
  Settings,
} from "lucide-react";

// ── 类型 ─────────────────────────────────────────────────────────────────

interface Instance {
  id: string;
  name: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  autoRestart: boolean;
  createdAt: number;
  status: "running" | "stopped" | "error";
  pid?: number;
  startedAt?: number;
  exitCode: number | null;
  logs: string[];
}

// ── API 辅助 ─────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5677";

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

// ── 工具函数 ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    running: { label: "运行中", color: "bg-emerald-500" },
    stopped: { label: "已停止", color: "bg-zinc-400" },
    error: { label: "错误", color: "bg-red-500" },
  };
  const info = map[status] ?? { label: status, color: "bg-zinc-400" };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={`h-2 w-2 rounded-full ${info.color}`} />
      {info.label}
    </span>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}时 ${m}分`;
  if (h > 0) return `${h}时 ${m}分`;
  if (m > 0) return `${m}分`;
  return `< 1分`;
}

// ── 新建实例对话框 ────────────────────────────────────────────────────────

interface EnvPair {
  key: string;
  value: string;
}

function CreateInstanceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [autoRestart, setAutoRestart] = useState(false);
  const [envPairs, setEnvPairs] = useState<EnvPair[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setName("");
    setCommand("");
    setCwd("");
    setAutoRestart(false);
    setEnvPairs([]);
    setError("");
  };

  const addEnv = () => setEnvPairs([...envPairs, { key: "", value: "" }]);
  const removeEnv = (i: number) => setEnvPairs(envPairs.filter((_, idx) => idx !== i));
  const updateEnv = (i: number, field: "key" | "value", val: string) => {
    const next = [...envPairs];
    next[i][field] = val;
    setEnvPairs(next);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !command.trim() || !cwd.trim()) {
      setError("请填写所有必填字段");
      return;
    }

    setSubmitting(true);
    setError("");

    const env: Record<string, string> = {};
    for (const pair of envPairs) {
      if (pair.key.trim()) env[pair.key.trim()] = pair.value;
    }

    try {
      const res = await apiPost<{ success: boolean; message?: string }>(
        "/api/instances",
        { name: name.trim(), command: command.trim(), cwd: cwd.trim(), env, autoRestart }
      );
      if (res.success) {
        reset();
        onOpenChange(false);
        onCreated();
      } else {
        setError(res.message || "创建失败");
      }
    } catch {
      setError("请求失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建实例</DialogTitle>
          <DialogDescription>
            配置一个新的进程实例，填写启动命令和工作目录。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>实例名称 *</Label>
            <Input
              placeholder="例如：我的服务器"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>启动命令 *</Label>
            <Input
              placeholder="例如：node server.js 或 python app.py"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label>工作目录 *</Label>
            <Input
              placeholder="例如：/home/user/myapp 或 D:\projects\myapp"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={autoRestart}
              onCheckedChange={setAutoRestart}
            />
            <Label className="cursor-pointer">崩溃后自动重启</Label>
          </div>

          {/* 环境变量 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>环境变量</Label>
              <Button variant="outline" size="sm" onClick={addEnv} type="button">
                <Plus className="h-3 w-3" />
                添加
              </Button>
            </div>
            {envPairs.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                {envPairs.map((pair, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="KEY"
                      value={pair.key}
                      onChange={(e) => updateEnv(i, "key", e.target.value)}
                      className="font-mono flex-1"
                    />
                    <Input
                      placeholder="VALUE"
                      value={pair.value}
                      onChange={(e) => updateEnv(i, "value", e.target.value)}
                      className="font-mono flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeEnv(i)}
                      type="button"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-500 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "创建中..." : "创建实例"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 实例卡片 ─────────────────────────────────────────────────────────────

function InstanceCard({
  instance,
  onAction,
  onClick,
}: {
  instance: Instance;
  onAction: (id: string, action: "start" | "stop") => void;
  onClick: () => void;
}) {
  const isRunning = instance.status === "running";
  const uptime =
    isRunning && instance.startedAt ? Date.now() - instance.startedAt : 0;

  return (
    <Card
      className="cursor-pointer transition-all hover:ring-2 hover:ring-primary/30 hover:shadow-md group"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0 flex-1">
            <CardTitle className="text-base truncate">{instance.name}</CardTitle>
            <StatusBadge status={instance.status} />
          </div>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isRunning ? (
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(instance.id, "start");
                }}
                title="启动"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(instance.id, "stop");
                }}
                title="停止"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Terminal className="h-3.5 w-3.5 shrink-0" />
          <code className="font-mono truncate text-xs">{instance.command}</code>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-xs font-mono">{instance.cwd}</span>
        </div>
        {isRunning && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs">已运行 {formatDuration(uptime)}</span>
          </div>
        )}
        {!isRunning && instance.exitCode !== null && instance.exitCode !== undefined && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Settings className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs">退出码: {instance.exitCode}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────

export default function InstancesPage() {
  const router = useRouter();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const fetchInstances = useCallback(async () => {
    try {
      const data = await apiGet<{
        success: boolean;
        instances: Instance[];
        message?: string;
      }>("/api/instances");
      if (data.success) {
        setInstances(data.instances);
      } else {
        setError(data.message || "获取实例列表失败");
      }
    } catch {
      setError("请求失败");
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await fetchInstances();
      setLoading(false);
    };
    init();
  }, [fetchInstances]);

  // 有运行中实例时定期刷新
  useEffect(() => {
    const hasRunning = instances.some((i) => i.status === "running");
    if (!hasRunning) return;
    const timer = setInterval(fetchInstances, 5000);
    return () => clearInterval(timer);
  }, [instances, fetchInstances]);

  const handleAction = async (id: string, action: "start" | "stop") => {
    await apiPost(`/api/instances/${id}/${action}`);
    setTimeout(fetchInstances, 300);
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">实例管理</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          新建实例
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-10 w-10 text-red-500/50 mb-3" />
            <p className="text-sm text-red-500">{error}</p>
          </CardContent>
        </Card>
      )}

      {!error && instances.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Box className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold">暂无实例</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              点击「新建实例」创建你的第一个进程实例
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              新建实例
            </Button>
          </CardContent>
        </Card>
      )}

      {instances.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {instances.map((inst) => (
            <InstanceCard
              key={inst.id}
              instance={inst}
              onAction={handleAction}
              onClick={() => router.push(`/dashboard/instances/${inst.id}`)}
            />
          ))}
        </div>
      )}

      <CreateInstanceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={fetchInstances}
      />
    </div>
  );
}