"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Icon } from "@iconify/react";
import {
  Container,
  Play,
  Square,
  RotateCw,
  FileText,
  RefreshCw,
  Loader2,
  Server,
  HardDrive,
  Box,
  Wifi,
  WifiOff,
  Store,
  Download,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { DeployAppDialog, type StoreApp, type DeployLogEntry } from "@/components/deploy-app-dialog";

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

async function apiPost<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
  });
  return res.json();
}

// ── 类型 ─────────────────────────────────────────────────────────────

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  isMain: boolean;
  online: boolean;
}

interface DockerInfo {
  containers: number;
  containersRunning: number;
  containersPaused: number;
  containersStopped: number;
  images: number;
  serverVersion: string;
  operatingSystem: string;
}

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: { publicPort?: number; privatePort: number; type: string }[];
  created: string;
}

interface DockerImage {
  ID: string;
  Repository: string;
  Tag: string;
  Size: string;
  CreatedAt: string;
}

// ── 容器状态颜色 ─────────────────────────────────────────────────────

function getStateColor(state: string) {
  switch (state) {
    case "running":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "paused":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    case "exited":
      return "bg-destructive/10 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-muted";
  }
}

function getStateLabel(state: string) {
  switch (state) {
    case "running":
      return "运行中";
    case "paused":
      return "已暂停";
    case "exited":
      return "已停止";
    default:
      return state;
  }
}

// ── 格式化时间 ───────────────────────────────────────────────────────

function formatTime(ts: string) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    return `${days} 天前`;
  } catch {
    return ts;
  }
}

// ── 图标组件 ───────────────────────────────────────────────────────

function AppIcon({ icon, className = "" }: { icon: string; className?: string }) {
  if (icon.includes(":")) {
    return <Icon icon={icon} className={className} />;
  }
  return <span className={className}>{icon}</span>;
}

// ── 主页面 ───────────────────────────────────────────────────────────

export default function DockerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("__main__");

  const [dockerInfo, setDockerInfo] = useState<DockerInfo | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [showAllContainers, setShowAllContainers] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dockerError, setDockerError] = useState<string | null>(null);

  // 日志对话框
  const [logContainer, setLogContainer] = useState<DockerContainer | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);

  // 操作状态
  const [actingId, setActingId] = useState<string | null>(null);

  // 应用商店
  const [activeTab, setActiveTab] = useState("containers");
  const [storeApps, setStoreApps] = useState<StoreApp[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeCategory, setStoreCategory] = useState<string>("");
  const [storeSearch, setStoreSearch] = useState("");
  const [deployApp, setDeployApp] = useState<StoreApp | null>(null);
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployLog, setDeployLog] = useState<DeployLogEntry[]>([]);

  // Docker 设置（镜像仓库）
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [mirrorUrl, setMirrorUrl] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<DockerContainer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [alsoDeleteImage, setAlsoDeleteImage] = useState(false);

  // 镜像删除
  const [deleteImageTarget, setDeleteImageTarget] = useState<DockerImage | null>(null);
  const [deletingImage, setDeletingImage] = useState(false);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const isRemoteNode = selectedNodeId !== "__main__";

  // 初始化：获取用户信息和节点列表
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

  // 获取 Docker 数据
  const fetchDockerData = useCallback(async () => {
    if (!selectedNodeId) return;

    setDockerError(null);

    // 远程节点走代理
    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    try {
      // 并行获取 info, containers, images
      const [infoRes, containersRes, imagesRes] = await Promise.all([
        apiGet<{ success: boolean; info?: DockerInfo; message?: string }>(`${basePath}/info`),
        apiGet<{ success: boolean; containers?: DockerContainer[]; message?: string }>(
          `${basePath}/containers?all=${showAllContainers}`
        ),
        apiGet<{ success: boolean; images?: DockerImage[]; message?: string }>(`${basePath}/images`),
      ]);

      if (infoRes.message && !infoRes.success) {
        setDockerError(infoRes.message);
        setDockerInfo(null);
        setContainers([]);
        setImages([]);
        return;
      }

      if (infoRes.info) setDockerInfo(infoRes.info);
      if (containersRes.containers) setContainers(containersRes.containers);
      if (imagesRes.images) setImages(imagesRes.images);
    } catch (e: any) {
      setDockerError(e.message || "请求失败");
    }
  }, [selectedNodeId, isRemoteNode, showAllContainers]);

  useEffect(() => {
    if (selectedNodeId) {
      fetchDockerData();
    }
  }, [selectedNodeId, fetchDockerData]);

  // 容器操作
  const containerAction = async (id: string, action: "start" | "stop" | "restart") => {
    if (!selectedNodeId) return;
    setActingId(id);

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    try {
      const res = await apiPost<{ success: boolean; message?: string }>(
        `${basePath}/containers/${id}/${action}`
      );
      if (res.success) {
        const labels: Record<string, string> = {
          start: "已启动",
          stop: "已停止",
          restart: "已重启",
        };
        toast.success(labels[action]);
        await fetchDockerData();
      } else {
        toast.error(res.message || "操作失败");
      }
    } catch (e: any) {
      toast.error(e.message || "请求失败");
    } finally {
      setActingId(null);
    }
  };

  // 删除容器
  const containerDelete = async (id: string, force: boolean, alsoDelete: boolean = false) => {
    if (!selectedNodeId) return;
    setDeleting(true);

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    try {
      const qsParts: string[] = [];
      if (force) qsParts.push("force=true");
      if (alsoDelete) qsParts.push("alsoDeleteImage=true");
      const qs = qsParts.length > 0 ? `?${qsParts.join("&")}` : "";
      // DELETE 请求需要单独处理
      const delRes = await fetch(`${API_BASE}${basePath}/containers/${id}${qs}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await delRes.json();
      if (data.success) {
        toast.success(alsoDelete ? "容器及镜像已删除" : "容器已删除");
        setDeleteTarget(null);
        setAlsoDeleteImage(false);
        await fetchDockerData();
      } else {
        toast.error(data.message || "删除失败");
      }
    } catch (e: any) {
      toast.error(e.message || "请求失败");
    } finally {
      setDeleting(false);
    }
  };

  // 删除镜像
  const imageDelete = async (id: string) => {
    if (!selectedNodeId) return;
    setDeletingImage(true);

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    try {
      const delRes = await fetch(`${API_BASE}${basePath}/images/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await delRes.json();
      if (data.success) {
        toast.success("镜像已删除");
        setDeleteImageTarget(null);
        await fetchDockerData();
      } else {
        toast.error(data.message || "删除失败");
      }
    } catch (e: any) {
      toast.error(e.message || "请求失败");
    } finally {
      setDeletingImage(false);
    }
  };

  // 查看日志
  const viewLogs = async (container: DockerContainer) => {
    setLogContainer(container);
    setLogs("");
    setLogsLoading(true);

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    try {
      const res = await apiGet<{ success: boolean; logs?: string; message?: string }>(
        `${basePath}/containers/${container.id}/logs?tail=300&timestamps=true`
      );
      if (res.logs) {
        setLogs(res.logs);
      } else if (res.message) {
        setLogs(res.message);
      }
    } catch (e: any) {
      setLogs(`获取日志失败: ${e.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDockerData();
    setRefreshing(false);
  };

  // ── 应用商店 ──────────────────────────────────────────────────────

  const fetchStoreApps = useCallback(async () => {
    if (!selectedNodeId) return;
    setStoreLoading(true);

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    try {
      const res = await apiGet<{ success: boolean; apps?: StoreApp[] }>(
        `${basePath}/store`
      );
      if (res.apps) setStoreApps(res.apps);
    } catch {
      // ignore
    } finally {
      setStoreLoading(false);
    }
  }, [selectedNodeId, isRemoteNode]);

  useEffect(() => {
    if (activeTab === "store") {
      fetchStoreApps();
    }
  }, [activeTab, fetchStoreApps]);

  // ── Docker 设置 ──────────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    if (!selectedNodeId) return;
    setSettingsLoading(true);

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    try {
      const res = await apiGet<{ success: boolean; settings?: { mirrorEnabled: boolean; mirrorUrl: string } }>(
        `${basePath}/settings`
      );
      if (res.settings) {
        setMirrorEnabled(res.settings.mirrorEnabled);
        setMirrorUrl(res.settings.mirrorUrl || "");
      }
    } catch {
      // ignore
    } finally {
      setSettingsLoading(false);
    }
  }, [selectedNodeId, isRemoteNode]);

  useEffect(() => {
    if (activeTab === "settings") {
      fetchSettings();
    }
  }, [activeTab, fetchSettings]);

  const saveSettings = async () => {
    if (!selectedNodeId) return;
    setSettingsSaving(true);

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    try {
      const res = await fetch(`${API_BASE}${basePath}/settings`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ mirrorEnabled, mirrorUrl }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("设置已保存");
      } else {
        toast.error(data.message || "保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "请求失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleDeploy = async (config: {
    name: string;
    ports: { hostPort: number; containerPort: number; protocol: string }[];
    volumes: { host: string; container: string }[];
    env: { name: string; value: string }[];
    restart: string;
    networkMode: string;
  }) => {
    if (!deployApp) return;
    setDeploying(true);
    setDeployLog([]);

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    const body = JSON.stringify({
      appId: deployApp.id,
      name: config.name,
      ports: config.ports.filter((p) => p.hostPort > 0),
      volumes: config.volumes.filter((v) => v.host && v.container),
      env: config.env.filter((e) => e.name),
      restart: config.restart === "__none__" ? "" : config.restart,
      networkMode: config.networkMode || undefined,
    });

    try {
      const res = await fetch(`${API_BASE}${basePath}/store/deploy-stream`, {
        method: "POST",
        headers: authHeaders(),
        body,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        toast.error(err.message || "请求失败");
        setDeploying(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as DeployLogEntry;
              setDeployLog((prev) => [...prev, event]);

              if (event.type === "done") {
                toast.success(event.message || "部署成功");
                setDeployDialogOpen(false);
                setDeployApp(null);
                setDeployLog([]);
                setActiveTab("containers");
                await fetchDockerData();
                setDeploying(false);
                return;
              }
              if (event.type === "error") {
                toast.error(event.message || "部署失败");
                setDeploying(false);
                return;
              }
            } catch {
              // 跳过无法解析的行
            }
          }
        }
      }
    } catch (e: any) {
      toast.error(e.message || "请求失败");
    } finally {
      setDeploying(false);
    }
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
        <h1 className="text-3xl font-bold tracking-tight">Docker 管理</h1>
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
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="containers" className="flex items-center gap-1.5">
            <Container className="h-3.5 w-3.5" />
            容器管理
          </TabsTrigger>
          <TabsTrigger value="store" className="flex items-center gap-1.5">
            <Store className="h-3.5 w-3.5" />
            应用商店
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            设置
          </TabsTrigger>
        </TabsList>

        <TabsContent value="containers">
          {/* Docker 不可用 */}
          {dockerError && (
            <Card className="border-destructive/50">
              <CardContent className="flex items-center gap-3 py-6">
                <div className="shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <Server className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="font-medium text-destructive">Docker 不可用</p>
                  <p className="text-sm text-muted-foreground">{dockerError}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Docker 概览 */}
          {dockerInfo && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    总容器
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{dockerInfo.containers}</p>
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
                    {dockerInfo.containersRunning}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    已停止
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-destructive">
                    {dockerInfo.containersStopped}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    镜像
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{dockerInfo.images}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 容器列表 */}
          {dockerInfo && (
            <Card className="mt-4">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Box className="h-4 w-4" />
                    容器列表
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllContainers(!showAllContainers)}
                  >
                    {showAllContainers ? "仅显示运行中" : "显示全部"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {containers.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Container className="h-8 w-8 mr-2 opacity-50" />
                    暂无容器
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="text-left p-3 font-medium">名称</th>
                          <th className="text-left p-3 font-medium">镜像</th>
                          <th className="text-left p-3 font-medium">状态</th>
                          <th className="text-left p-3 font-medium hidden md:table-cell">
                            端口
                          </th>
                          <th className="text-left p-3 font-medium hidden lg:table-cell">
                            创建
                          </th>
                          <th className="text-right p-3 font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {containers.map((c) => (
                          <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50">
                            <td className="p-3">
                              <span className="font-mono text-sm font-medium">
                                {c.name}
                              </span>
                              <br />
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {c.id.slice(0, 12)}
                              </span>
                            </td>
                            <td className="p-3 text-sm max-w-[200px] truncate">
                              {c.image}
                            </td>
                            <td className="p-3">
                              <Badge
                                variant="outline"
                                className={`text-[11px] px-1.5 py-0 ${getStateColor(c.state)}`}
                              >
                                {getStateLabel(c.state)}
                              </Badge>
                              {c.status && c.status !== c.state && (
                                <span className="block text-[10px] text-muted-foreground mt-0.5">
                                  {c.status}
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-xs font-mono hidden md:table-cell">
                              {c.ports.length === 0 ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span>
                                  {c.ports.map((p, i) => (
                                    <span key={i}>
                                      {p.publicPort ? `${p.publicPort}:` : ""}
                                      {p.privatePort}/{p.type}
                                      {i < c.ports.length - 1 ? ", " : ""}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-xs text-muted-foreground hidden lg:table-cell">
                              {formatTime(c.created)}
                            </td>
                            <td className="p-3">
                              <div className="flex items-center justify-end gap-1">
                                {c.state === "running" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => containerAction(c.id, "stop")}
                                    disabled={actingId === c.id}
                                  >
                                    {actingId === c.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Square className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                )}
                                {(c.state === "exited" || c.state === "created") && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-emerald-500"
                                    onClick={() => containerAction(c.id, "start")}
                                    disabled={actingId === c.id}
                                  >
                                    {actingId === c.id ? (
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
                                  onClick={() => containerAction(c.id, "restart")}
                                  disabled={actingId === c.id}
                                >
                                  {actingId === c.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCw className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => viewLogs(c)}
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(c)}
                                  disabled={deleting}
                                >
                                  {deleting && actingId === c.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
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
          )}

          {/* 镜像列表 */}
          {images.length > 0 && (
            <Card className="mt-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  镜像列表
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left p-3 font-medium">仓库</th>
                        <th className="text-left p-3 font-medium">标签</th>
                        <th className="text-left p-3 font-medium">ID</th>
                        <th className="text-right p-3 font-medium">大小</th>
                        <th className="text-right p-3 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {images.map((img, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="p-3 text-sm max-w-[250px] truncate">
                            {img.Repository === "<none>" ? (
                              <span className="text-muted-foreground">&lt;none&gt;</span>
                            ) : (
                              img.Repository
                            )}
                          </td>
                          <td className="p-3 text-sm">
                            <Badge variant="secondary" className="text-[11px] px-1.5 py-0">
                              {img.Tag || "latest"}
                            </Badge>
                          </td>
                          <td className="p-3 text-xs font-mono text-muted-foreground">
                            {img.ID?.slice(7, 19) || img.ID}
                          </td>
                          <td className="p-3 text-xs text-right">{img.Size}</td>
                          <td className="p-3">
                            <div className="flex items-center justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteImageTarget(img)}
                                disabled={deletingImage}
                              >
                                {deletingImage ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 日志对话框 */}
          <Dialog
            open={!!logContainer}
            onOpenChange={(v) => {
              if (!v) {
                setLogContainer(null);
                setLogs("");
              }
            }}
          >
            <DialogContent className="max-w-3xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  容器日志 - {logContainer?.name}
                </DialogTitle>
                <DialogDescription>
                  {logContainer?.id?.slice(0, 12)} | {logContainer?.image}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="h-[50vh] rounded border bg-black text-green-400 p-3">
                {logsLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                    {logs || "暂无日志"}
                  </pre>
                )}
              </ScrollArea>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setLogContainer(null);
                    setLogs("");
                  }}
                >
                  关闭
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="store">
          {/* 分类筛选与搜索 */}
          <div className="flex items-center gap-3 flex-wrap">
            <Select
              value={storeCategory}
              onValueChange={(v) => setStoreCategory(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="w-40 h-8 text-sm">
                <SelectValue placeholder="全部分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部分类</SelectItem>
                {(() => {
                  const categories = [...new Set(storeApps.map((a) => a.category))];
                  return categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ));
                })()}
              </SelectContent>
            </Select>

            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="h-8 w-full rounded-lg border border-input bg-transparent pl-8 pr-3 text-sm outline-none focus-visible:border-ring"
                placeholder="搜索应用..."
                value={storeSearch}
                onChange={(e) => setStoreSearch(e.target.value)}
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={fetchStoreApps}
              disabled={storeLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${storeLoading ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>

          {/* 应用卡片网格 */}
          {storeLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {[...Array(6)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="h-5 w-20 bg-muted rounded animate-pulse mb-2" />
                    <div className="h-4 w-full bg-muted rounded animate-pulse mb-1" />
                    <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {storeApps
                .filter((a) => !storeCategory || a.category === storeCategory)
                .filter(
                  (a) =>
                    !storeSearch ||
                    a.name.toLowerCase().includes(storeSearch.toLowerCase()) ||
                    a.description.toLowerCase().includes(storeSearch.toLowerCase())
                )
                .map((app) => (
                  <Card
                    key={app.id}
                    className="hover:shadow-md transition-shadow cursor-pointer group"
                    onClick={() => {
                      setDeployApp(app);
                      setDeployDialogOpen(true);
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-xl overflow-hidden">
                          <AppIcon icon={app.icon} className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm truncate">{app.name}</h3>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mt-1">
                            {app.category}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                        {app.description}
                      </p>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t">
                        <code className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                          {app.image}
                        </code>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-7 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Download className="h-3 w-3" />
                          部署
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          {!storeLoading && storeApps.length === 0 && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Store className="h-8 w-8 mr-2 opacity-50" />
              暂无应用
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings">
          {settingsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Docker 设置
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* 镜像仓库开关 */}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium">启用镜像仓库</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      开启后拉取镜像将通过代理仓库，解决中国大陆无法访问 Docker Hub 的问题
                    </p>
                  </div>
                  <Switch
                    checked={mirrorEnabled}
                    onCheckedChange={setMirrorEnabled}
                  />
                </div>

                {/* 镜像地址 */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">镜像地址</label>
                  <Input
                    value={mirrorUrl}
                    onChange={(e) => setMirrorUrl(e.target.value)}
                    placeholder="https://docker.1ms.run"
                    disabled={!mirrorEnabled}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    实际使用示例:{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded select-all">
                      {(() => {
                        const host = (mirrorUrl || "https://docker.1ms.run")
                          .replace(/^https?:\/\//, "")
                          .replace(/\/+$/, "");
                        return `${host}/nginx:latest`;
                      })()}
                    </code>
                  </p>
                </div>

                <Button
                  onClick={saveSettings}
                  disabled={settingsSaving}
                  className="w-full"
                >
                  {settingsSaving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  保存设置
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* 删除确认对话框 */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) { setDeleteTarget(null); setAlsoDeleteImage(false); }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              删除容器
            </DialogTitle>
            <DialogDescription>
              确定要删除容器 <strong>{deleteTarget?.name}</strong> 吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 py-1">
            <Checkbox
              id="alsoDeleteImage"
              checked={alsoDeleteImage}
              onChange={(e) => setAlsoDeleteImage(e.target.checked)}
              disabled={deleting}
            />
            <label
              htmlFor="alsoDeleteImage"
              className="text-sm text-muted-foreground cursor-pointer select-none"
            >
              同时删除镜像
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setAlsoDeleteImage(false); }} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && containerDelete(deleteTarget.id, false, alsoDeleteImage)}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              删除
            </Button>
            {deleteTarget?.state === "running" && (
              <Button
                variant="destructive"
                onClick={() => deleteTarget && containerDelete(deleteTarget.id, true, alsoDeleteImage)}
                disabled={deleting}
              >
                {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                强制删除
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 镜像删除确认对话框 */}
      <Dialog
        open={!!deleteImageTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteImageTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              删除镜像
            </DialogTitle>
            <DialogDescription>
              确定要删除镜像 <strong>{deleteImageTarget?.Repository === "<none>" ? "<none>" : deleteImageTarget?.Repository}:{deleteImageTarget?.Tag || "latest"}</strong> 吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteImageTarget(null)} disabled={deletingImage}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteImageTarget && imageDelete(deleteImageTarget.ID)}
              disabled={deletingImage}
            >
              {deletingImage && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 部署对话框 */}
      <DeployAppDialog
        app={deployApp}
        open={deployDialogOpen}
        onOpenChange={(v) => {
          setDeployDialogOpen(v);
          if (!v) setDeployApp(null);
        }}
        onDeploy={handleDeploy}
        deploying={deploying}
        deployLog={deployLog}
      />
    </div>
  );
}