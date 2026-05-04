"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import XtermTerminal from "@/components/xterm-terminal";
import {
  ArrowLeft,
  Play,
  Square,
  RotateCcw,
  Trash2,
  Terminal,
  Info,
  Clock,
  FolderOpen,
  AlertCircle,
} from "lucide-react";

// ── 类型 ─────────────────────────────────────────────────────────────────

interface InstanceDetail {
  id: string;
  name: string;
  command: string;
  cwd: string;
  autoRestart: boolean;
  env: Record<string, string>;
  status: "running" | "stopped" | "error";
  pid?: number;
  startedAt?: number;
  exitCode: number | null;
  createdAt: number;
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

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}时 ${m}分`;
  if (h > 0) return `${h}时 ${m}分`;
  return `${m}分`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

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

// ── 终端控制按钮 + XtermTerminal ──────────────────────────────────────────

function ConsoleTab({
  instance,
  onAction,
}: {
  instance: InstanceDetail;
  onAction: (action: "start" | "stop" | "restart") => void;
}) {
  const isRunning = instance.status === "running";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {!isRunning ? (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => onAction("start")}
          >
            <Play className="h-4 w-4" />
            启动
          </Button>
        ) : (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onAction("stop")}
          >
            <Square className="h-4 w-4" />
            停止
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAction("restart")}
          disabled={!isRunning}
        >
          <RotateCcw className="h-4 w-4" />
          重启
        </Button>
      </div>
      <XtermTerminal instanceId={instance.id} status={instance.status} />
    </div>
  );
}

// ── 实例详细信息 Tab ─────────────────────────────────────────────────────

function InfoTab({ instance }: { instance: InstanceDetail }) {
  const isRunning = instance.status === "running";
  const uptime =
    isRunning && instance.startedAt ? Date.now() - instance.startedAt : 0;

  return (
    <div className="space-y-6">
      {/* 基本信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" />
            基本信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">实例 ID</Label>
              <p className="text-sm font-mono">{instance.id}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">实例名称</Label>
              <p className="text-sm">{instance.name}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">状态</Label>
              <div className="flex items-center gap-2">
                <StatusBadge status={instance.status} />
                {isRunning && instance.pid && (
                  <span className="text-xs text-muted-foreground">
                    PID: {instance.pid}
                  </span>
                )}
                {!isRunning && instance.exitCode !== null && (
                  <span className="text-xs text-muted-foreground">
                    退出码: {instance.exitCode}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {isRunning ? "已运行时间" : "运行时长"}
              </Label>
              <p className="text-sm flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {isRunning ? formatDuration(uptime) : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 执行配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            执行配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">启动命令</Label>
              <p className="text-sm font-mono bg-muted px-3 py-2 rounded-md break-all">
                {instance.command}
              </p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">工作目录</Label>
              <p className="text-sm font-mono flex items-center gap-2">
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {instance.cwd}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                崩溃自动重启
              </Label>
              <p className="text-sm">
                {instance.autoRestart ? (
                  <span className="text-blue-500">已启用</span>
                ) : (
                  <span className="text-muted-foreground">未启用</span>
                )}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">创建时间</Label>
              <p className="text-sm">{formatTime(instance.createdAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 环境变量 */}
      {Object.keys(instance.env).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">环境变量</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border divide-y">
              {Object.entries(instance.env).map(([key, value]) => (
                <div key={key} className="flex items-center px-3 py-2 text-sm">
                  <code className="font-mono text-muted-foreground w-1/3 shrink-0">
                    {key}
                  </code>
                  <code className="font-mono truncate">{value}</code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────

export default function InstanceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [instance, setInstance] = useState<InstanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const data = await apiGet<{
        success: boolean;
        instance: InstanceDetail;
        message?: string;
      }>(`/api/instances/${id}`);
      if (data.success) {
        setInstance(data.instance);
      } else {
        setError(data.message || "获取实例详情失败");
      }
    } catch {
      setError("请求失败");
    }
  }, [id]);

  useEffect(() => {
    const init = async () => {
      await fetchDetail();
      setLoading(false);
    };
    init();
  }, [fetchDetail]);

  // 运行中时定期刷新
  useEffect(() => {
    if (!instance || instance.status !== "running") return;
    const timer = setInterval(fetchDetail, 5000);
    return () => clearInterval(timer);
  }, [instance, fetchDetail]);

  const handleAction = async (action: "start" | "stop" | "restart") => {
    await apiPost(`/api/instances/${id}/${action}`);
    setTimeout(fetchDetail, 500);
  };

  const handleDelete = async () => {
    await apiDelete(`/api/instances/${id}`);
    router.push("/dashboard/instances");
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error || !instance) {
    return (
      <div className="max-w-5xl mx-auto w-full">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/dashboard/instances")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          返回实例列表
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="h-12 w-12 text-red-500/50 mb-4" />
            <h3 className="text-lg font-semibold">加载失败</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {error || "实例不存在"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto w-full">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/dashboard/instances")}
            title="返回实例列表"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              {instance.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              ID: {instance.id}
            </p>
          </div>
          <StatusBadge status={instance.status} />
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteConfirm(true)}
        >
          <Trash2 className="h-4 w-4" />
          删除实例
        </Button>
      </div>

      {/* Tab 内容 */}
      <Tabs defaultValue="console" className="w-full">
        <TabsList>
          <TabsTrigger value="console">
            <Terminal className="h-4 w-4" />
            终端
          </TabsTrigger>
          <TabsTrigger value="info">
            <Info className="h-4 w-4" />
            实例详细信息
          </TabsTrigger>
        </TabsList>
        <TabsContent value="console">
          <ConsoleTab instance={instance} onAction={handleAction} />
        </TabsContent>
        <TabsContent value="info">
          <InfoTab instance={instance} />
        </TabsContent>
      </Tabs>

      {/* 删除确认对话框 */}
      <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要删除实例「{instance.name}」吗？此操作不可撤销。
            {instance.status === "running" && (
              <span className="block mt-1 text-red-500">
                该实例正在运行，删除前将自动停止。
              </span>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}