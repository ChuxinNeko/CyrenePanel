"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  Wifi,
  WifiOff,
  Loader2,
  FolderOpen,
  Terminal,
  Settings,
  Cpu,
  MemoryStick,
  Box,
  Hash,
  Globe,
} from "lucide-react";

// ── API 辅助 ─────────────────────────────────────────────────────────

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

async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
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

// ── 类型 ─────────────────────────────────────────────────────────────

interface MetricPoint {
  timestamp: number;
  cpu: number;
  memoryPercentage: number;
}

interface NodeOverview {
  id: string;
  name: string;
  address: string;
  isMain: boolean;
  online: boolean;
  cpu?: number;
  memory?: {
    used: number;
    total: number;
    usedFormatted: string;
    totalFormatted: string;
    percentage: number;
  };
  runningInstances?: number;
  totalInstances?: number;
  version?: string;
  metrics?: MetricPoint[];
}

// ── 迷你趋势图 ──────────────────────────────────────────────────────

function MiniChart({
  data,
  color,
  label,
  unit = "%",
}: {
  data: number[];
  color: string;
  label: string;
  unit?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
        暂无数据
      </div>
    );
  }

  const max = Math.max(Math.max(...data), 20);
  const points = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * 100;
    const y = 100 - (v / max) * 100;
    return `${x},${y}`;
  });
  const polyline = points.join(" ");

  // 填充区域
  const areaPoints = `0,100 ${polyline} 100,100`;

  const current = data[data.length - 1];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium" style={{ color }}>
          {current}{unit}
        </span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-12 rounded"
        style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}
      >
        <polygon
          points={areaPoints}
          fill={color}
          fillOpacity="0.1"
        />
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ── 进度条颜色 ───────────────────────────────────────────────────────

function getProgressColor(pct: number) {
  if (pct >= 90) return "bg-destructive";
  if (pct >= 70) return "bg-primary/60";
  return "bg-primary";
}

// ── 添加节点对话框 ───────────────────────────────────────────────────

function AddNodeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setAddress("");
    setApiKey("");
  };

  const handleSubmit = async () => {
    if (!name.trim() || !address.trim() || !apiKey.trim()) {
      toast.error("请填写所有字段");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ success: boolean; message?: string }>(
        "/api/nodes",
        { name: name.trim(), address: address.trim(), apiKey: apiKey.trim() }
      );
      if (res.success) {
        toast.success("节点添加成功");
        reset();
        onOpenChange(false);
        onCreated();
      } else {
        toast.error(res.message || "添加失败");
      }
    } catch {
      toast.error("请求失败");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加节点</DialogTitle>
          <DialogDescription>
            输入子节点的 API 地址和密钥进行绑定。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-node-name">节点名称</Label>
            <Input
              id="add-node-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：远程服务器"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-node-address">API 地址</Label>
            <Input
              id="add-node-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="例如：http://192.168.1.100:5677"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-node-apikey">API Key</Label>
            <Input
              id="add-node-apikey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="子节点的 API Key"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                验证中...
              </>
            ) : (
              "添加"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 编辑节点对话框 ───────────────────────────────────────────────────

function EditNodeDialog({
  node,
  open,
  onOpenChange,
  onSaved,
}: {
  node: NodeOverview | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (node && open) {
      setName(node.name);
      setAddress(node.address);
      setApiKey("");
    }
  }, [node, open]);

  const handleSubmit = async () => {
    if (!node) return;
    setSubmitting(true);
    try {
      const body: Record<string, string> = {};
      if (name.trim() && name.trim() !== node.name) body.name = name.trim();
      if (address.trim() && address.trim() !== node.address) body.address = address.trim();
      if (apiKey.trim()) body.apiKey = apiKey.trim();

      if (Object.keys(body).length === 0) {
        toast.info("没有修改");
        onOpenChange(false);
        return;
      }

      const res = await apiPatch<{ success: boolean; message?: string }>(
        `/api/nodes/${node.id}`,
        body
      );
      if (res.success) {
        toast.success("节点已更新");
        onOpenChange(false);
        onSaved();
      } else {
        toast.error(res.message || "更新失败");
      }
    } catch {
      toast.error("请求失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑节点</DialogTitle>
          <DialogDescription>修改节点的名称、地址或 API Key。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-node-name">节点名称</Label>
            <Input
              id="edit-node-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-node-address">API 地址</Label>
            <Input
              id="edit-node-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-node-apikey">API Key（留空则不修改）</Label>
            <Input
              id="edit-node-apikey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入新的 API Key"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                保存中...
              </>
            ) : (
              "保存"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 节点卡片 ─────────────────────────────────────────────────────────

function NodeCard({
  node,
  isAdmin,
  onEdit,
  onDelete,
}: {
  node: NodeOverview;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();

  const cpuData = node.metrics?.map((m) => m.cpu) ?? [];
  const memData = node.metrics?.map((m) => m.memoryPercentage) ?? [];

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0 flex-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 shrink-0" />
              <span className="truncate">{node.name}</span>
              {node.isMain && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                  主
                </Badge>
              )}
              {node.online ? (
                <Badge
                  variant="default"
                  className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 shrink-0"
                >
                  <Wifi className="h-3 w-3 mr-0.5" />
                  在线
                </Badge>
              ) : (
                <Badge variant="destructive" className="shrink-0">
                  <WifiOff className="h-3 w-3 mr-0.5" />
                  离线
                </Badge>
              )}
            </CardTitle>
          </div>

          {/* 右上角操作按钮 */}
          <TooltipProvider delayDuration={200}>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      if (node.isMain) {
                        router.push("/dashboard/files");
                      } else {
                        router.push(`/dashboard/files?node=${node.id}`);
                      }
                    }}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>文件管理</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      if (node.isMain) {
                        router.push("/dashboard/terminal");
                      } else {
                        router.push(`/dashboard/terminal?node=${node.id}`);
                      }
                    }}
                  >
                    <Terminal className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>终端</TooltipContent>
              </Tooltip>

              {isAdmin && !node.isMain && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={onEdit}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>设置</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={onDelete}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>删除</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </TooltipProvider>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        {/* 信息网格 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">地址</span>
          </div>
          <span className="font-mono text-xs truncate text-right">{node.address}</span>

          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Hash className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">ID</span>
          </div>
          <span className="font-mono text-xs truncate text-right">
            {node.id === "__main__" ? "main" : node.id.slice(0, 12)}
          </span>

          {node.online && node.version && (
            <>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Server className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">版本</span>
              </div>
              <span className="text-xs truncate text-right">{node.version}</span>
            </>
          )}

          {node.online && node.totalInstances !== undefined && (
            <>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Box className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">实例</span>
              </div>
              <span className="text-xs text-right">
                <span className="font-medium text-primary">{node.runningInstances}</span>
                <span className="text-muted-foreground"> / {node.totalInstances} 运行中</span>
              </span>
            </>
          )}
        </div>

        {/* CPU & 内存概览 */}
        {node.online && (
          <div className="space-y-2">
            {node.cpu !== undefined && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Cpu className="h-3 w-3" /> CPU
                  </span>
                  <span className="font-medium">{node.cpu}%</span>
                </div>
                <Progress
                  value={node.cpu}
                  indicatorClassName={getProgressColor(node.cpu)}
                  className="h-1.5"
                />
              </div>
            )}
            {node.memory && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <MemoryStick className="h-3 w-3" /> 内存
                  </span>
                  <span className="font-medium">
                    {node.memory.usedFormatted} / {node.memory.totalFormatted}
                  </span>
                </div>
                <Progress
                  value={node.memory.percentage}
                  indicatorClassName={getProgressColor(node.memory.percentage)}
                  className="h-1.5"
                />
              </div>
            )}
          </div>
        )}

        {/* 趋势图 */}
        {node.online && node.metrics && node.metrics.length > 1 && (
          <div className="grid grid-cols-2 gap-3 pt-1 border-t">
            <MiniChart
              data={cpuData}
              color="hsl(221, 83%, 53%)"
              label="CPU 趋势"
            />
            <MiniChart
              data={memData}
              color="hsl(262, 83%, 58%)"
              label="内存趋势"
            />
          </div>
        )}

        {/* 离线提示 */}
        {!node.online && (
          <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
            <WifiOff className="h-4 w-4 mr-2" />
            节点不可达
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────

export default function NodesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ username: string; role: string } | null>(null);
  const [nodes, setNodes] = useState<NodeOverview[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [editNode, setEditNode] = useState<NodeOverview | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NodeOverview | null>(null);

  const isAdmin = profile?.role === "admin";

  const fetchOverview = useCallback(async () => {
    try {
      const data = await apiGet<{ success: boolean; nodes?: NodeOverview[] }>(
        "/api/nodes/overview"
      );
      if (data.success && data.nodes) {
        setNodes(data.nodes);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await (
          await import("@/lib/api")
        ).api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
        const p = data.profile as { username: string; role: string };
        setProfile(p);
        await fetchOverview();
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchOverview]);

  // 每 30 秒自动刷新
  useEffect(() => {
    const timer = setInterval(fetchOverview, 30000);
    return () => clearInterval(timer);
  }, [fetchOverview]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchOverview();
    setRefreshing(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const data = await apiDelete<{ success: boolean; message?: string }>(
        `/api/nodes/${deleteTarget.id}`
      );
      if (data.success) {
        toast.success("节点已删除");
        setDeleteTarget(null);
        await fetchOverview();
      } else {
        toast.error(data.message || "删除失败");
      }
    } catch {
      toast.error("请求失败");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between">
          <div className="h-9 w-32 bg-muted rounded animate-pulse" />
          <div className="h-9 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="h-5 w-40 bg-muted rounded animate-pulse" />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-4 w-full bg-muted rounded animate-pulse" />
                <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                <div className="h-12 w-full bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">节点管理</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`}
            />
            刷新
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              添加节点
            </Button>
          )}
        </div>
      </div>

      {/* 节点卡片网格 */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            isAdmin={isAdmin}
            onEdit={() => {
              setEditNode(node);
              setEditOpen(true);
            }}
            onDelete={() => setDeleteTarget(node)}
          />
        ))}
      </div>

      {nodes.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <Server className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium">暂无节点</p>
          <p className="text-sm mt-1">点击右上角"添加节点"来添加子节点</p>
        </div>
      )}

      {/* 对话框 */}
      <AddNodeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={fetchOverview}
      />

      <EditNodeDialog
        node={editNode}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchOverview}
      />

      {/* 删除确认 */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除节点 <strong>{deleteTarget?.name}</strong> 吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}