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
  Hash,
  Calendar,
  Cpu,
  Monitor,
  Server,
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
  nodeId: string;
  nodeName: string;
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

// ── 右侧信息面板 ────────────────────────────────────────────────────

function InfoPanel({ instance }: { instance: InstanceDetail }) {
  const isRunning = instance.status === "running";
  const uptime =
    isRunning && instance.startedAt ? Date.now() - instance.startedAt : 0;

  const statusMap: Record<string, { label: string; color: string; bg: string; ring: string }> = {
    running: { label: "运行中", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950", ring: "ring-emerald-500/20" },
    stopped: { label: "已停止", color: "text-zinc-500", bg: "bg-zinc-50 dark:bg-zinc-900", ring: "ring-zinc-500/20" },
    error: { label: "错误", color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950", ring: "ring-red-500/20" },
  };
  const s = statusMap[instance.status] ?? statusMap.stopped;

  return (
    <div className="space-y-4">
      {/* 状态大卡片 */}
      <Card className={`${s.bg} ring-1 ${s.ring} border-0`}>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">当前状态</span>
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${s.color}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${s.color.replace("text-", "bg-")}`} />
              {s.label}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">节点</span>
            <span className="text-sm flex items-center gap-1">
              <Server className="h-3 w-3 text-muted-foreground" />
              {instance.nodeName ?? "主节点"}
            </span>
          </div>
          {isRunning && instance.pid && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">PID</span>
              <span className="font-mono font-medium tabular-nums">{instance.pid}</span>
            </div>
          )}
          {isRunning && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">运行时长</span>
              <span className="font-medium tabular-nums">{formatDuration(uptime)}</span>
            </div>
          )}
          {!isRunning && instance.exitCode !== null && instance.exitCode !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">退出码</span>
              <span className="font-mono font-medium tabular-nums">{instance.exitCode}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 执行配置 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            执行配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">命令</Label>
            <code className="block mt-1 text-xs font-mono bg-muted px-2.5 py-1.5 rounded-md break-all leading-relaxed">
              {instance.command}
            </code>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">工作目录</Label>
            <p className="mt-1 text-xs font-mono text-muted-foreground flex items-center gap-1.5">
              <FolderOpen className="h-3 w-3 shrink-0" />
              {instance.cwd}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 基本信息 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            基本信息
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Hash className="h-3 w-3" />
              ID
            </span>
            <span className="font-mono text-muted-foreground">{instance.id.slice(0, 12)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <RotateCcw className="h-3 w-3" />
              自动重启
            </span>
            <span className={instance.autoRestart ? "text-emerald-500 font-medium" : "text-muted-foreground"}>
              {instance.autoRestart ? "已启用" : "未启用"}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3 w-3" />
              创建时间
            </span>
            <span className="text-muted-foreground">{formatTime(instance.createdAt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* 环境变量 */}
      {Object.keys(instance.env).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
              环境变量
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border divide-y overflow-hidden">
              {Object.entries(instance.env).map(([key, value]) => (
                <div key={key} className="flex items-center px-2.5 py-2 text-xs">
                  <code className="font-mono font-medium w-1/3 shrink-0 truncate">{key}</code>
                  <code className="font-mono text-muted-foreground truncate">{value}</code>
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

  const isRunning = instance.status === "running";

  return (
    <div className="max-w-[90rem] mx-auto w-full h-[calc(100vh-5rem)] flex flex-col gap-3 p-3 lg:gap-4 lg:p-4">
      {/* 顶部导航 */}
      <div className="flex items-start justify-between gap-2 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/dashboard/instances")}
            title="返回实例列表"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg lg:text-xl font-bold tracking-tight truncate">
              {instance.name}
            </h1>
            <p className="text-xs text-muted-foreground font-mono">
              {instance.id.slice(0, 12)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isRunning ? (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => handleAction("start")}
            >
              <Play className="h-3.5 w-3.5 lg:mr-1" />
              <span className="hidden lg:inline">启动</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleAction("stop")}
            >
              <Square className="h-3.5 w-3.5 lg:mr-1" />
              <span className="hidden lg:inline">停止</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("restart")}
            disabled={!isRunning}
          >
            <RotateCcw className="h-3.5 w-3.5 lg:mr-1" />
            <span className="hidden lg:inline">重启</span>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteConfirm(true)}
          >
            <Trash2 className="h-3.5 w-3.5 lg:mr-1" />
            <span className="hidden lg:inline">删除</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 lg:gap-4">
        {/* 左侧：终端 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-[50vh] lg:min-h-0">
          <div className="flex-1 min-h-0 rounded-lg border overflow-hidden bg-black">
            <XtermTerminal instanceId={instance.id} status={instance.status} />
          </div>
        </div>

        {/* 右侧：信息面板 */}
        <div className="w-full lg:w-80 lg:shrink-0 overflow-auto">
          <InfoPanel instance={instance} />
        </div>
      </div>

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