"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status-dot";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertCircle,
  Trash2,
  Play,
  Square,
  RefreshCw,
  FolderSearch,
  Search,
  RotateCcw,
  SquareTerminal,
  Pencil,
} from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import {
  DirectoryBrowserDialog,
  MAIN_NODE,
} from "@/components/directory-browser-dialog";
import { InstanceEditDialog } from "@/components/instance-edit-dialog";
import { runtimeSummary, statusMeta, type Instance } from "@/lib/instances";
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

// ── 新建实例对话框 ────────────────────────────────────────────────────────

interface EnvPair {
  key: string;
  value: string;
}

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  isMain: number;
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

  // 节点选择。Select 不接受空字符串作为值，用哨兵值代表主节点
  const [nodeId, setNodeId] = useState(MAIN_NODE);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);

  // 目录选择器（与编辑对话框共用同一个组件）
  const [browseOpen, setBrowseOpen] = useState(false);

  // 获取子节点列表
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const data = await apiGet<{ success: boolean; nodes?: NodeInfo[] }>(
          "/api/nodes"
        );
        if (data.success && data.nodes) {
          setNodes(data.nodes);
        }
      } catch {
        // ignore
      }
    })();
  }, [open]);

  const reset = () => {
    setName("");
    setCommand("");
    setCwd("");
    setAutoRestart(false);
    setEnvPairs([]);
    setError("");
    setNodeId(MAIN_NODE);
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
      const body: Record<string, unknown> = {
        name: name.trim(),
        command: command.trim(),
        cwd: cwd.trim(),
        env,
        autoRestart,
      };
      if (nodeId !== MAIN_NODE) body.nodeId = nodeId;

      const res = await apiPost<{ success: boolean; message?: string }>(
        "/api/instances",
        body
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
    <>
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
            {nodes.length > 0 && (
              <div className="space-y-2">
                <Label>运行节点</Label>
                <Select value={nodeId} onValueChange={setNodeId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MAIN_NODE}>主节点（本地）</SelectItem>
                    {nodes.map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        {node.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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
              <div className="flex gap-2">
                <Input
                  placeholder="例如：/home/user/myapp"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  className="flex-1 font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => setBrowseOpen(true)}
                  title="浏览目录"
                >
                  <FolderSearch className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={autoRestart} onCheckedChange={setAutoRestart} />
              <Label className="cursor-pointer">崩溃后自动重启</Label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>环境变量</Label>
                <Button variant="outline" size="sm" onClick={addEnv} type="button">
                  <Plus className="size-3" />
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
                        className="flex-1 font-mono"
                      />
                      <Input
                        placeholder="VALUE"
                        value={pair.value}
                        onChange={(e) => updateEnv(i, "value", e.target.value)}
                        className="flex-1 font-mono"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeEnv(i)}
                        type="button"
                        aria-label={`删除第 ${i + 1} 个环境变量`}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "创建中…" : "创建实例"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DirectoryBrowserDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        nodeId={nodeId}
        onSelect={setCwd}
      />
    </>
  );
}

// ── 实例卡片 ─────────────────────────────────────────────────────────────

/** 卡片里的键值信息行 */
function SpecRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-xs ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * MCSManager 风格的实例卡：顶部实例名 + 状态标签，中间键值信息块，
 * 底部一行常驻的操作按钮（控制台 / 启动停止 / 重启）。
 */
function InstanceCard({
  instance,
  now,
  busy,
  onAction,
  onEdit,
}: {
  instance: Instance;
  now: number;
  busy: boolean;
  onAction: (id: string, action: "start" | "stop" | "restart") => void;
  onEdit: (instance: Instance) => void;
}) {
  const meta = statusMeta(instance.status);
  const isRunning = instance.status === "running";

  return (
    <Card className="flex flex-col transition-shadow hover:shadow-elev-4">
      <CardHeader className="border-b pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="truncate">
              <Link
                href={`/dashboard/instances/${instance.id}`}
                className="rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {instance.name}
              </Link>
            </CardTitle>
            <p className="truncate font-mono text-[11px] text-mute" title={instance.id}>
              {instance.id.slice(0, 12)}
            </p>
          </div>
          {/* 状态标签里带圆点，色觉障碍下也能靠文字读出来 */}
          <Badge variant={meta.badge} className="shrink-0 gap-1.5">
            <span aria-hidden className={`size-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        <dl className="divide-y divide-border">
          <SpecRow label="启动命令" value={instance.command} mono />
          <SpecRow label="工作目录" value={instance.cwd} mono />
          <SpecRow label="节点" value={instance.nodeName ?? "主节点"} />
          <SpecRow label={isRunning ? "运行时长" : "状态"} value={runtimeSummary(instance, now)} mono />
        </dl>
      </CardContent>

      <CardFooter className="gap-1.5">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/instances/${instance.id}`}>
            <SquareTerminal className="size-3.5" />
            控制台
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(instance)}
          aria-label={`编辑 ${instance.name}`}
        >
          <Pencil className="size-3.5" />
          编辑
        </Button>
        <div className="flex-1" />
        {isRunning ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onAction(instance.id, "stop")}
          >
            {busy ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Square className="size-3.5 text-destructive" />
            )}
            停止
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onAction(instance.id, "start")}
          >
            {busy ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5 text-success-fg" />
            )}
            启动
          </Button>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!isRunning || busy}
          onClick={() => onAction(instance.id, "restart")}
          aria-label={`重启 ${instance.name}`}
          title="重启"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────

export default function InstancesPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [editing, setEditing] = useState<Instance | null>(null);
  const now = useNow();

  const fetchInstances = useCallback(async () => {
    try {
      const data = await apiGet<{
        success: boolean;
        instances: Instance[];
        message?: string;
      }>("/api/instances");
      if (data.success) {
        setInstances(data.instances);
        setError("");
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

  const handleAction = async (
    id: string,
    action: "start" | "stop" | "restart"
  ) => {
    setPendingId(id);
    try {
      await apiPost(`/api/instances/${id}/${action}`);
      // 进程状态不是立刻落库的，稍等一拍再拉
      await new Promise((resolve) => setTimeout(resolve, 300));
      await fetchInstances();
    } finally {
      setPendingId(null);
    }
  };

  const counts = useMemo(
    () => ({
      running: instances.filter((i) => i.status === "running").length,
      stopped: instances.filter((i) => i.status === "stopped").length,
      error: instances.filter((i) => i.status === "error").length,
    }),
    [instances]
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return instances.filter((inst) => {
      if (statusFilter !== "__all__" && inst.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        inst.name.toLowerCase().includes(keyword) ||
        inst.command.toLowerCase().includes(keyword) ||
        inst.cwd.toLowerCase().includes(keyword) ||
        (inst.nodeName ?? "").toLowerCase().includes(keyword)
      );
    });
  }, [instances, query, statusFilter]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-display">实例管理</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>共 {instances.length} 个实例</span>
            <StatusDot dot="bg-success">运行中 {counts.running}</StatusDot>
            <StatusDot dot="bg-mute">已停止 {counts.stopped}</StatusDot>
            {counts.error > 0 && (
              <StatusDot dot="bg-destructive">异常 {counts.error}</StatusDot>
            )}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          新建实例
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <AlertCircle className="size-8 text-destructive/60" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchInstances}>
              <RefreshCw className="size-3.5" />
              重试
            </Button>
          </CardContent>
        </Card>
      ) : instances.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-1 py-16 text-center">
            <Box className="mb-3 size-10 text-mute/50" />
            <h3 className="text-base font-semibold tracking-display">暂无实例</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              点击「新建实例」创建你的第一个进程实例
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              新建实例
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 筛选条：统一放在它所作用的表格上方一行 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-mute" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索名称、命令、目录或节点"
                className="h-8 pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                <SelectItem value="running">运行中</SelectItem>
                <SelectItem value="stopped">已停止</SelectItem>
                <SelectItem value="error">错误</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={fetchInstances}
              aria-label="刷新实例列表"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-mute">
                没有匹配的实例
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((inst) => (
                <InstanceCard
                  key={inst.id}
                  instance={inst}
                  now={now}
                  busy={pendingId === inst.id}
                  onAction={handleAction}
                  onEdit={setEditing}
                />
              ))}
            </div>
          )}
        </>
      )}

      <CreateInstanceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={fetchInstances}
      />

      <InstanceEditDialog
        instance={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={fetchInstances}
      />
    </div>
  );
}
