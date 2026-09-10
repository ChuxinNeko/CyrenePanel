"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status-dot";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import XtermTerminal from "@/components/xterm-terminal";
import { InstanceEditDialog } from "@/components/instance-edit-dialog";
import {
  ArrowLeft,
  Play,
  Square,
  RotateCcw,
  Trash2,
  AlertCircle,
  Pencil,
} from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import {
  formatDuration,
  formatTime,
  statusMeta,
  type Instance,
} from "@/lib/instances";
import { useNow } from "@/hooks/use-now";

// ── API 辅助 ─────────────────────────────────────────────────────────────

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

// ── 侧栏 ─────────────────────────────────────────────────────────────────

/** 定义列表行，和仪表盘系统信息卡同一套排版 */
function SpecRow({
  label,
  children,
  title,
}: {
  label: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs font-medium" title={title}>
        {children}
      </dd>
    </div>
  );
}

function ConfigPanel({ instance }: { instance: Instance }) {
  const envEntries = Object.entries(instance.env);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-sm">配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <p className="eyebrow">启动命令</p>
            <code className="block rounded-md bg-surface-inset px-2.5 py-1.5 font-mono text-xs leading-relaxed break-all">
              {instance.command}
            </code>
          </div>
          <div className="space-y-1.5">
            <p className="eyebrow">工作目录</p>
            <code className="block rounded-md bg-surface-inset px-2.5 py-1.5 font-mono text-xs leading-relaxed break-all">
              {instance.cwd}
            </code>
          </div>
          <dl className="divide-y divide-border">
            <SpecRow label="节点">{instance.nodeName ?? "主节点"}</SpecRow>
            <SpecRow label="自动重启">
              {instance.autoRestart ? (
                <StatusDot dot="bg-success" className="justify-end">
                  已启用
                </StatusDot>
              ) : (
                <span className="text-muted-foreground">未启用</span>
              )}
            </SpecRow>
            <SpecRow label="实例 ID" title={instance.id}>
              <span className="font-mono text-mute">{instance.id.slice(0, 12)}</span>
            </SpecRow>
            <SpecRow label="创建时间">
              <span className="font-mono text-muted-foreground">
                {formatTime(instance.createdAt)}
              </span>
            </SpecRow>
          </dl>
        </CardContent>
      </Card>

      {envEntries.length > 0 && (
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              环境变量
              <span className="font-mono text-xs font-normal text-mute">
                {envEntries.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="divide-y divide-border">
              {envEntries.map(([key, value]) => (
                <div key={key} className="flex gap-2 px-4 py-2 text-xs">
                  <code className="w-2/5 shrink-0 truncate font-mono font-medium" title={key}>
                    {key}
                  </code>
                  <code
                    className="min-w-0 flex-1 truncate font-mono text-muted-foreground"
                    title={value}
                  >
                    {value}
                  </code>
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

  const [instance, setInstance] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const now = useNow();

  const fetchDetail = useCallback(async () => {
    try {
      const data = await apiGet<{
        success: boolean;
        instance: Instance;
        message?: string;
      }>(`/api/instances/${id}`);
      if (data.success) {
        setInstance(data.instance);
        setError("");
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
    setPending(true);
    try {
      await apiPost(`/api/instances/${id}/${action}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await fetchDetail();
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async () => {
    await apiDelete(`/api/instances/${id}`);
    router.push("/dashboard/instances");
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  if (error || !instance) {
    return (
      <div className="mx-auto w-full max-w-[1600px]">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/dashboard/instances")}
          className="mb-4"
        >
          <ArrowLeft className="size-4" />
          返回实例列表
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-1 py-16 text-center">
            <AlertCircle className="mb-3 size-10 text-destructive/60" />
            <h3 className="text-base font-semibold tracking-display">加载失败</h3>
            <p className="text-sm text-muted-foreground">{error || "实例不存在"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isRunning = instance.status === "running";
  const meta = statusMeta(instance.status);
  const uptime = isRunning && instance.startedAt ? now - instance.startedAt : 0;

  return (
    // 外壳已经有 p-6，这里只负责在剩余高度里铺满：顶栏 4rem + 主区上下 padding 3rem
    <div className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-[1600px] flex-col gap-4">
      {/* 页头 */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="mt-0.5 shrink-0"
            onClick={() => router.push("/dashboard/instances")}
            aria-label="返回实例列表"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-xl leading-7 font-semibold tracking-display">
                {instance.name}
              </h1>
              <StatusDot dot={meta.dot} className={meta.text}>
                {meta.label}
              </StatusDot>
            </div>
            {/* 实时指标直接排在标题下，不再单独占一张卡 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-mute">
              <span title={instance.id}>{instance.id.slice(0, 12)}</span>
              <span>·</span>
              <span>{instance.nodeName ?? "主节点"}</span>
              {isRunning && instance.pid && (
                <>
                  <span>·</span>
                  <span>PID {instance.pid}</span>
                </>
              )}
              {isRunning ? (
                <>
                  <span>·</span>
                  <span>已运行 {formatDuration(uptime)}</span>
                </>
              ) : (
                instance.exitCode !== null &&
                instance.exitCode !== undefined && (
                  <>
                    <span>·</span>
                    <span className={instance.exitCode === 0 ? "" : "text-destructive"}>
                      退出码 {instance.exitCode}
                    </span>
                  </>
                )
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isRunning ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => handleAction("stop")}
            >
              <Square className="size-3.5" />
              停止
            </Button>
          ) : (
            <Button size="sm" disabled={pending} onClick={() => handleAction("start")}>
              <Play className="size-3.5" />
              启动
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("restart")}
            disabled={!isRunning || pending}
          >
            <RotateCcw className="size-3.5" />
            重启
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" />
            编辑
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(true)}>
            <Trash2 className="size-3.5 text-destructive" />
            删除
          </Button>
        </div>
      </div>

      {/* 主区：终端铺满剩余空间，配置收在右侧 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex min-h-[45vh] min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0 lg:min-h-0">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <span className="eyebrow">终端输出</span>
            <StatusDot dot={meta.dot} className="text-mute">
              {meta.label}
            </StatusDot>
          </div>
          <div className="min-h-0 flex-1 bg-[#0a0a0a]">
            <XtermTerminal instanceId={instance.id} status={instance.status} />
          </div>
        </Card>

        <div className="w-full shrink-0 overflow-auto lg:w-80">
          <ConfigPanel instance={instance} />
        </div>
      </div>

      <InstanceEditDialog
        instance={instance}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchDetail}
      />

      {/* 删除确认 */}
      <Dialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除实例「{instance.name}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          {isRunning && (
            <p className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              该实例正在运行，删除前将自动停止。
            </p>
          )}
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
