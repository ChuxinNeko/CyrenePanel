"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Play,
  Square,
  RotateCw,
  RefreshCw,
  Loader2,
  Search,
  Settings2,
  FileText,
  Power,
  PowerOff,
  XCircle,
  Wifi,
  WifiOff,
  Plus,
} from "lucide-react";
import { API_BASE } from "@/lib/api-base";

// ── API 辅助 ─────────────────────────────────────────────────────────

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

async function apiPost<T>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── 类型 ─────────────────────────────────────────────────────────────

interface ServiceInfo {
  name: string;
  displayName: string;
  description: string;
  status: string;
  enabled: boolean;
  type: string;
  subtype: string;
  mainPid: number | null;
  memory: number | null;
  activeState: string;
  subState: string;
  since: string;
}

interface ServiceSummary {
  total: number;
  active: number;
  failed: number;
  enabled: number;
}

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  isMain: boolean;
  online: boolean;
}

// ── 状态颜色（Linux systemd） ────────────────────────────────────────

function getLinuxStatusColor(state: string) {
  switch (state) {
    case "active":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "inactive":
      return "bg-muted text-muted-foreground border-muted";
    case "failed":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "activating":
    case "reloading":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    default:
      return "bg-muted text-muted-foreground border-muted";
  }
}

function getLinuxStatusLabel(state: string) {
  switch (state) {
    case "active":
      return "运行中";
    case "inactive":
      return "已停止";
    case "failed":
      return "失败";
    case "activating":
      return "启动中";
    case "reloading":
      return "重载中";
    default:
      return state;
  }
}

// ── 状态颜色（Windows） ─────────────────────────────────────────────

function getWinStatusColor(state: string) {
  switch (state) {
    case "running":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "stopped":
      return "bg-muted text-muted-foreground border-muted";
    case "paused":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    default:
      return "bg-muted text-muted-foreground border-muted";
  }
}

function getWinStatusLabel(state: string) {
  switch (state) {
    case "running":
      return "运行中";
    case "stopped":
      return "已停止";
    case "paused":
      return "已暂停";
    default:
      return state;
  }
}

// ── 通用状态判断 ─────────────────────────────────────────────────────

function isServiceRunning(service: ServiceInfo, osPlatform: string): boolean {
  if (osPlatform === "windows") return service.status === "running";
  return service.status === "active";
}

function getStatusColor(service: ServiceInfo, osPlatform: string) {
  if (osPlatform === "windows") return getWinStatusColor(service.status);
  return getLinuxStatusColor(service.status);
}

function getStatusLabel(service: ServiceInfo, osPlatform: string) {
  if (osPlatform === "windows") return getWinStatusLabel(service.status);
  return getLinuxStatusLabel(service.status);
}

// ── 主页面 ───────────────────────────────────────────────────────────

export default function ServicesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [summary, setSummary] = useState<ServiceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [osPlatform, setOsPlatform] = useState<string>("linux");

  // 节点选择
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("__main__");

  // 搜索和过滤
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterEnabled, setFilterEnabled] = useState<"all" | "enabled" | "disabled">("all");

  // 操作状态
  const [actingId, setActingId] = useState<string | null>(null);

  // 日志对话框
  const [logService, setLogService] = useState<ServiceInfo | null>(null);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);

  const isRemoteNode = selectedNodeId !== "__main__";

  // 创建服务
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    displayName: "",
    description: "",
    execStart: "",
    args: "",
    workingDir: "",
    user: "",
    restart: "on-failure",
    startType: "Automatic",
    env: [] as { name: string; value: string }[],
  });

  // 初始化
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
        await fetchNodes();
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router]);

  const fetchNodes = async () => {
    try {
      const data = await apiGet<{ success: boolean; nodes?: NodeInfo[] }>(
        "/api/nodes/overview"
      );
      if (data.success && data.nodes) {
        setNodes(data.nodes);
      }
    } catch {
      // ignore
    }
  };

  const fetchServices = useCallback(async () => {
    if (!selectedNodeId) return;
    setServicesLoading(true);
    try {
      const url = isRemoteNode
        ? `/api/nodes/${selectedNodeId}/services`
        : "/api/services";
      const data = await apiGet<{
        success: boolean;
        services?: ServiceInfo[];
        summary?: ServiceSummary;
        message?: string;
        platform?: string;
      }>(url);
      if (data.success) {
        setServices(data.services || []);
        setSummary(data.summary || null);
        setOsPlatform(data.platform || "linux");
        setError(null);
      } else {
        setError(data.message || "获取服务列表失败");
      }
    } catch (e: any) {
      setError(e.message || "请求失败");
    } finally {
      setServicesLoading(false);
    }
  }, [selectedNodeId, isRemoteNode]);

  useEffect(() => {
    if (selectedNodeId) {
      fetchServices();
    }
  }, [selectedNodeId, fetchServices]);

  // 过滤后的服务列表
  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !s.name.toLowerCase().includes(q) &&
          !s.displayName.toLowerCase().includes(q) &&
          !s.description.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (filterStatus !== "all" && s.status !== filterStatus) {
        return false;
      }
      if (filterEnabled === "enabled" && !s.enabled) return false;
      if (filterEnabled === "disabled" && s.enabled) return false;
      return true;
    });
  }, [services, search, filterStatus, filterEnabled]);

  // 服务操作
  const serviceAction = async (name: string, action: string) => {
    setActingId(name);
    try {
      const url = isRemoteNode
        ? `/api/nodes/${selectedNodeId}/services/${encodeURIComponent(name)}/${action}`
        : `/api/services/${encodeURIComponent(name)}/${action}`;
      const res = await apiPost<{ success: boolean; message?: string }>(url);
      if (res.success) {
        toast.success(res.message || "操作成功");
        await fetchServices();
      } else {
        toast.error(res.message || "操作失败");
      }
    } catch (e: any) {
      toast.error(e.message || "请求失败");
    } finally {
      setActingId(null);
    }
  };

  // 查看日志
  const viewLogs = async (service: ServiceInfo) => {
    setLogService(service);
    setLogs("");
    setLogsLoading(true);
    try {
      const url = isRemoteNode
        ? `/api/nodes/${selectedNodeId}/services/logs/${encodeURIComponent(service.name)}?lines=200`
        : `/api/services/logs/${encodeURIComponent(service.name)}?lines=200`;
      const res = await apiGet<{ success: boolean; logs?: string }>(url);
      setLogs(res.logs || "暂无日志");
    } catch (e: any) {
      setLogs(`获取日志失败: ${e.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchServices();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto w-full">
        <div className="h-9 w-32 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-4 w-20 bg-muted rounded animate-pulse" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-12 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="h-64 bg-muted rounded animate-pulse" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">服务管理</h1>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            创建服务
          </Button>
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
        </div>
      </div>

      {/* 节点选择器 */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground shrink-0">目标节点:</span>
        <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="选择节点" />
          </SelectTrigger>
          <SelectContent>
            {nodes.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                <span className="flex items-center gap-2">
                  {node.online ? (
                    <Wifi className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <WifiOff className="h-3 w-3 text-destructive" />
                  )}
                  {node.name}
                  {node.isMain && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                      主
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-xs">
          {osPlatform === "windows" ? "Windows" : "Linux"}
        </Badge>
      </div>

      {/* 错误提示 */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-3 py-6">
            <div className="shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-medium text-destructive">无法加载服务列表</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 概览卡片 */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                总服务数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                运行中
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-emerald-500">
                {summary.active}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                已失败
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">
                {summary.failed}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                已启用
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-500">
                {summary.enabled}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 搜索和过滤 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索服务名称、描述..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="all">全部状态</option>
                {osPlatform === "windows" ? (
                  <>
                    <option value="running">运行中</option>
                    <option value="stopped">已停止</option>
                    <option value="paused">已暂停</option>
                  </>
                ) : (
                  <>
                    <option value="active">运行中</option>
                    <option value="inactive">已停止</option>
                    <option value="failed">失败</option>
                  </>
                )}
              </select>
              <select
                value={filterEnabled}
                onChange={(e) =>
                  setFilterEnabled(e.target.value as "all" | "enabled" | "disabled")
                }
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="all">全部类型</option>
                <option value="enabled">已启用</option>
                <option value="disabled">已禁用</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 服务列表 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            服务列表
            <Badge variant="secondary" className="ml-1 text-[11px]">
              {filteredServices.length} / {services.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {servicesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">加载中...</span>
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Settings2 className="h-8 w-8 mr-2 opacity-50" />
              {services.length === 0 ? "暂无服务" : "没有匹配的服务"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left p-3 font-medium">服务名称</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">
                      描述
                    </th>
                    <th className="text-left p-3 font-medium">状态</th>
                    <th className="text-left p-3 font-medium hidden sm:table-cell">
                      开机自启
                    </th>
                    <th className="text-right p-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map((s) => (
                    <tr
                      key={s.name}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="p-3">
                        <span className="font-mono text-sm font-medium">
                          {s.displayName}
                        </span>
                        {s.mainPid && (
                          <span className="block text-[10px] text-muted-foreground font-mono">
                            PID: {s.mainPid}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground max-w-[300px] truncate hidden md:table-cell">
                        {s.description || "—"}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-[11px] px-1.5 py-0 ${getStatusColor(s, osPlatform)}`}
                        >
                          {getStatusLabel(s, osPlatform)}
                        </Badge>
                      </td>
                      <td className="p-3 hidden sm:table-cell">
                        <Badge
                          variant={s.enabled ? "default" : "secondary"}
                          className={`text-[11px] px-1.5 py-0 ${
                            s.enabled
                              ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30"
                              : ""
                          }`}
                        >
                          {s.enabled ? "已启用" : "已禁用"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          {isServiceRunning(s, osPlatform) ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => serviceAction(s.name, "stop")}
                              disabled={actingId === s.name}
                              title="停止"
                            >
                              {actingId === s.name ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Square className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-emerald-500"
                              onClick={() => serviceAction(s.name, "start")}
                              disabled={actingId === s.name}
                              title="启动"
                            >
                              {actingId === s.name ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => serviceAction(s.name, "restart")}
                            disabled={actingId === s.name}
                            title="重启"
                          >
                            {actingId === s.name ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => serviceAction(s.name, s.enabled ? "disable" : "enable")}
                            disabled={actingId === s.name}
                            title={s.enabled ? "禁用开机自启" : "启用开机自启"}
                          >
                            {s.enabled ? (
                              <PowerOff className="h-3.5 w-3.5" />
                            ) : (
                              <Power className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => viewLogs(s)}
                            title="查看日志"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建服务对话框 */}
      <Dialog open={createOpen} onOpenChange={(v) => {
        if (!v) {
          setCreateForm({
            name: "", displayName: "", description: "", execStart: "",
            args: "", workingDir: "", user: "", restart: "on-failure",
            startType: "Automatic", env: [],
          });
        }
        setCreateOpen(v);
      }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              创建{osPlatform === "windows" ? "Windows" : ""} 系统服务
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">服务名称 *</label>
              <Input
                placeholder={osPlatform === "windows" ? "MyService" : "my-service"}
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="mt-1"
              />
              {osPlatform === "linux" && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  会自动添加 .service 后缀
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">显示名称</label>
              <Input
                placeholder="我的服务"
                value={createForm.displayName}
                onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">描述</label>
              <Input
                placeholder="服务描述"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">启动命令 *</label>
              <Input
                placeholder={osPlatform === "windows" ? "C:\\path\\to\\app.exe" : "/usr/bin/node"}
                value={createForm.execStart}
                onChange={(e) => setCreateForm({ ...createForm, execStart: e.target.value })}
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">启动参数</label>
              <Input
                placeholder="/app/server.js --port=3000"
                value={createForm.args}
                onChange={(e) => setCreateForm({ ...createForm, args: e.target.value })}
                className="mt-1 font-mono text-sm"
              />
            </div>
            {osPlatform === "linux" && (
              <>
                <div>
                  <label className="text-sm font-medium">工作目录</label>
                  <Input
                    placeholder="/app"
                    value={createForm.workingDir}
                    onChange={(e) => setCreateForm({ ...createForm, workingDir: e.target.value })}
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">运行用户</label>
                  <Input
                    placeholder="root"
                    value={createForm.user}
                    onChange={(e) => setCreateForm({ ...createForm, user: e.target.value })}
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">重启策略</label>
                  <select
                    value={createForm.restart}
                    onChange={(e) => setCreateForm({ ...createForm, restart: e.target.value })}
                    className="mt-1 h-9 w-full px-3 rounded-md border border-input bg-background text-sm"
                  >
                    <option value="no">不重启</option>
                    <option value="on-success">成功时重启</option>
                    <option value="on-failure">失败时重启</option>
                    <option value="always">始终重启</option>
                    <option value="on-abnormal">异常时重启</option>
                  </select>
                </div>
                {/* 环境变量 */}
                <div>
                  <label className="text-sm font-medium">环境变量</label>
                  <div className="space-y-2 mt-1">
                    {createForm.env.map((e, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          placeholder="KEY"
                          value={e.name}
                          onChange={(ev) => {
                            const env = [...createForm.env];
                            env[i] = { ...env[i], name: ev.target.value };
                            setCreateForm({ ...createForm, env });
                          }}
                          className="flex-1 font-mono text-xs"
                        />
                        <Input
                          placeholder="value"
                          value={e.value}
                          onChange={(ev) => {
                            const env = [...createForm.env];
                            env[i] = { ...env[i], value: ev.target.value };
                            setCreateForm({ ...createForm, env });
                          }}
                          className="flex-1 font-mono text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-destructive"
                          onClick={() => {
                            const env = createForm.env.filter((_, j) => j !== i);
                            setCreateForm({ ...createForm, env });
                          }}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCreateForm({
                          ...createForm,
                          env: [...createForm.env, { name: "", value: "" }],
                        })
                      }
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      添加环境变量
                    </Button>
                  </div>
                </div>
              </>
            )}
            {osPlatform === "windows" && (
              <div>
                <label className="text-sm font-medium">启动类型</label>
                <select
                  value={createForm.startType}
                  onChange={(e) => setCreateForm({ ...createForm, startType: e.target.value })}
                  className="mt-1 h-9 w-full px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="Automatic">自动</option>
                  <option value="Manual">手动</option>
                  <option value="Disabled">禁用</option>
                </select>
              </div>
            )}
            <Button
              className="w-full"
              disabled={creating || !createForm.name.trim() || !createForm.execStart.trim()}
              onClick={async () => {
                setCreating(true);
                try {
                  const url = isRemoteNode
                    ? `/api/nodes/${selectedNodeId}/services/create`
                    : "/api/services/create";
                  const res = await apiPost<{ success: boolean; message?: string }>(url, createForm);
                  if (res.success) {
                    toast.success(res.message || "服务创建成功");
                    setCreateOpen(false);
                    setCreateForm({
                      name: "", displayName: "", description: "", execStart: "",
                      args: "", workingDir: "", user: "", restart: "on-failure",
                      startType: "Automatic", env: [],
                    });
                    await fetchServices();
                  } else {
                    toast.error(res.message || "创建失败");
                  }
                } catch (e: any) {
                  toast.error(e.message || "请求失败");
                } finally {
                  setCreating(false);
                }
              }}
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1.5" />
                  创建服务
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 日志对话框 */}
      <Dialog
        open={!!logService}
        onOpenChange={(v) => {
          if (!v) {
            setLogService(null);
            setLogs("");
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              服务日志 - {logService?.displayName}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {logsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">加载中...</span>
              </div>
            ) : (
              <pre className="text-xs font-mono bg-muted/50 rounded-lg p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-all">
                {logs || "暂无日志"}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
