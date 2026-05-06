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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  RefreshCw,
  Loader2,
  Search,
  Download,
  Trash2,
  ArrowUpCircle,
  XCircle,
  Package,
  ExternalLink,
  Terminal,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Icon } from "@iconify/react";
import { useTasks } from "@/lib/task-store";

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

async function apiPost<T>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── 类型 ─────────────────────────────────────────────────────────────

interface EnvInfo {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  latestVersion: string | null;
  packageManager: string | null;
  installCommand: string | null;
  updateCommand: string | null;
  removeCommand: string | null;
  description: string;
  homepage: string | null;
  defaultVersion?: string | null;
  versionOptions?: VersionOption[];
}

interface VersionOption {
  value: string;
  label: string;
  recommended?: boolean;
}

interface EnvSummary {
  total: number;
  installed: number;
  notInstalled: number;
}

interface PackageManagerInfo {
  name: string;
  available: boolean;
  version: string | null;
}

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  isMain: boolean;
  online: boolean;
}

// ── Iconify 图标映射 ──────────────────────────────────────────────────

function getEnvIconId(icon: string): string {
  const map: Record<string, string> = {
    nodejs: "logos:nodejs-icon",
    npm: "logos:npm-icon",
    pnpm: "logos:pnpm",
    yarn: "logos:yarn",
    python: "logos:python",
    pip: "logos:python",
    java: "logos:java",
    php: "logos:php",
    go: "logos:go",
    rust: "logos:rust",
    cargo: "simple-icons:cargo",
    dotnet: "logos:dotnet",
    bun: "logos:bun",
    composer: "logos:composer",
    git: "logos:git-icon",
    docker: "logos:docker-icon",
    nginx: "logos:nginx",
  };
  return map[icon] || "mdi:code-braces";
}

// ── 主页面 ───────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  install: "安装",
  update: "更新",
  remove: "卸载",
};

export default function EnvironmentsPage() {
  const router = useRouter();
  const { startDeployTask } = useTasks();
  const [loading, setLoading] = useState(true);
  const [environments, setEnvironments] = useState<EnvInfo[]>([]);
  const [summary, setSummary] = useState<EnvSummary | null>(null);
  const [packageManagers, setPackageManagers] = useState<PackageManagerInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // 节点选择
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("__main__");

  // 搜索和过滤
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "installed" | "not_installed">("all");

  // 操作状态
  const [actingId, setActingId] = useState<string | null>(null);

  // 详情对话框
  const [detailEnv, setDetailEnv] = useState<EnvInfo | null>(null);

  // 确认对话框
  const [confirmAction, setConfirmAction] = useState<{
    envId: string;
    envName: string;
    action: "install" | "update" | "remove";
    command: string;
    selectedVersion?: string;
    versionOptions?: VersionOption[];
  } | null>(null);

  const isRemoteNode = selectedNodeId !== "__main__";

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

  const fetchEnvironments = useCallback(async () => {
    if (!selectedNodeId) return;
    setScanning(true);
    try {
      const url = isRemoteNode
        ? `/api/nodes/${selectedNodeId}/environments`
        : "/api/environments";
      const data = await apiGet<{
        success: boolean;
        environments?: EnvInfo[];
        summary?: EnvSummary;
        packageManagers?: PackageManagerInfo[];
        message?: string;
      }>(url);
      if (data.success) {
        setEnvironments(data.environments || []);
        setSummary(data.summary || null);
        setPackageManagers(data.packageManagers || []);
        setError(null);
      } else {
        setError(data.message || "获取环境列表失败");
      }
    } catch (e: any) {
      setError(e.message || "请求失败");
    } finally {
      setScanning(false);
    }
  }, [selectedNodeId, isRemoteNode]);

  useEffect(() => {
    if (selectedNodeId) {
      fetchEnvironments();
    }
  }, [selectedNodeId, fetchEnvironments]);

  // 过滤后的环境列表
  const filteredEnvironments = useMemo(() => {
    return environments.filter((e) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.name.toLowerCase().includes(q) &&
          !e.displayName.toLowerCase().includes(q) &&
          !e.description.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (filterStatus === "installed" && !e.installed) return false;
      if (filterStatus === "not_installed" && e.installed) return false;
      return true;
    });
  }, [environments, search, filterStatus]);

  // 操作
  const executeAction = async (
    envId: string,
    action: "install" | "update" | "remove",
    version?: string
  ) => {
    setActingId(envId);
    setConfirmAction(null);

    const env = environments.find((e) => e.id === envId);
    const label = ACTION_LABELS[action] || action;
    const versionText = version && action !== "remove" ? ` ${version}` : "";
    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/environments/${envId}`
      : `/api/environments/${envId}`;

    startDeployTask({
      title: `${label} ${env?.displayName || envId}${versionText}`,
      icon: env?.icon,
      url: `${API_BASE}${basePath}/${action}/stream`,
      headers: authHeaders(),
      body: JSON.stringify(version ? { version } : {}),
      targetUrl: "/dashboard/environments",
      onDone: async () => {
        toast.success(`${label}任务完成`);
        await fetchEnvironments();
      },
    });
    setActingId(null);
  };

  const openConfirmAction = (
    env: EnvInfo,
    action: "install" | "update" | "remove",
    command: string
  ) => {
    const versionOptions = action === "remove" ? [] : env.versionOptions || [];
    const selectedVersion =
      env.defaultVersion || versionOptions.find((item) => item.recommended)?.value || versionOptions[0]?.value;
    setConfirmAction({
      envId: env.id,
      envName: env.displayName,
      action,
      command,
      selectedVersion,
      versionOptions,
    });
  };

  const getConfirmCommand = () => {
    if (!confirmAction) return "";
    const { command, action, selectedVersion } = confirmAction;
    if (!selectedVersion || action === "remove") return command;
    return command.replace(
      new RegExp(`(bash -s -- ${action})(?:\\s+\\S+)?$`),
      `$1 ${selectedVersion}`
    );
  };

  const handleRefresh = async () => {
    await fetchEnvironments();
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto w-full">
        <div className="h-9 w-32 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
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
        <h1 className="text-3xl font-bold tracking-tight">环境管理</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={scanning}
        >
          <RefreshCw
            className={`h-4 w-4 mr-1.5 ${scanning ? "animate-spin" : ""}`}
          />
          {scanning ? "扫描中..." : "刷新"}
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
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 错误提示 */}
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-3 py-6">
            <div className="shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-medium text-destructive">无法加载环境列表</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 概览卡片 */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                检测环境数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                已安装
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-emerald-500">
                {summary.installed}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                未安装
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-muted-foreground">
                {summary.notInstalled}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 包管理器信息 */}
      {packageManagers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              系统包管理器
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {packageManagers.map((pm) => (
                <Badge
                  key={pm.name}
                  variant={pm.available ? "default" : "secondary"}
                  className={`text-xs px-2.5 py-1 ${
                    pm.available
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      : ""
                  }`}
                >
                  {pm.name}
                  {pm.available && pm.version && (
                    <span className="ml-1.5 text-[10px] opacity-70">
                      {pm.version.split("\n")[0]}
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 搜索和过滤 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索环境名称、描述..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(e.target.value as "all" | "installed" | "not_installed")
                }
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="all">全部</option>
                <option value="installed">已安装</option>
                <option value="not_installed">未安装</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 环境卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredEnvironments.map((env) => (
          <Card
            key={env.id}
            className={`group relative overflow-hidden transition-all hover:shadow-md ${
              !env.installed ? "border-dashed opacity-80" : ""
            }`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      env.installed
                        ? "bg-primary/10"
                        : "bg-muted"
                    }`}
                  >
                    <Icon
                      icon={getEnvIconId(env.icon)}
                      className={`h-5 w-5 ${
                        env.installed ? "text-primary" : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      {env.displayName}
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {env.description}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={env.installed ? "default" : "secondary"}
                  className={`text-[10px] px-1.5 py-0 shrink-0 ${
                    env.installed
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      : ""
                  }`}
                >
                  {env.installed ? "已安装" : "未安装"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="space-y-2">
                {env.installed && env.version && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">当前版本</span>
                    <span className="font-mono font-medium">{env.version}</span>
                  </div>
                )}
                {env.installed && env.path && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">路径</span>
                    <span className="font-mono text-[10px] max-w-[180px] truncate" title={env.path}>
                      {env.path}
                    </span>
                  </div>
                )}
                {env.installed && env.latestVersion && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">最新版本</span>
                    <span className="font-mono text-emerald-500">{env.latestVersion}</span>
                  </div>
                )}
                {env.packageManager && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">包管理器</span>
                    <span className="text-xs">{env.packageManager}</span>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2 mt-3 pt-3 border-t">
                {!env.installed ? (
                  <Button
                    size="sm"
                    className="flex-1 h-8 text-xs"
                    disabled={actingId === env.id}
                    onClick={() => {
                      if (env.installCommand) {
                        openConfirmAction(env, "install", env.installCommand);
                      }
                    }}
                  >
                    {actingId === env.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-1" />
                    )}
                    安装
                  </Button>
                ) : (
                  <>
                    {env.updateCommand && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs"
                        disabled={actingId === env.id}
                        onClick={() => {
                          openConfirmAction(env, "update", env.updateCommand!);
                        }}
                      >
                        {actingId === env.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
                        )}
                        更新
                      </Button>
                    )}
                    {env.removeCommand && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={actingId === env.id}
                        onClick={() => {
                          openConfirmAction(env, "remove", env.removeCommand!);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        卸载
                      </Button>
                    )}
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 shrink-0"
                  onClick={() => setDetailEnv(env)}
                  title="查看详情"
                >
                  <Package className="h-3.5 w-3.5" />
                </Button>
                {env.homepage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={() => window.open(env.homepage!, "_blank")}
                    title="访问官网"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredEnvironments.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
            <Package className="h-8 w-8 mr-2 opacity-50" />
            {environments.length === 0 ? "暂无检测到的环境" : "没有匹配的环境"}
          </CardContent>
        </Card>
      )}

      {/* 详情对话框 */}
      <Dialog open={!!detailEnv} onOpenChange={(v) => { if (!v) setDetailEnv(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon
                icon={getEnvIconId(detailEnv?.icon || "")}
                className="h-5 w-5"
              />
              {detailEnv?.displayName} 详情
            </DialogTitle>
            <DialogDescription>{detailEnv?.description}</DialogDescription>
          </DialogHeader>
          {detailEnv && (
            <div className="space-y-3 py-2">
              <DetailRow label="状态">
                <Badge
                  variant={detailEnv.installed ? "default" : "secondary"}
                  className={`text-[11px] ${
                    detailEnv.installed
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      : ""
                  }`}
                >
                  {detailEnv.installed ? "已安装" : "未安装"}
                </Badge>
              </DetailRow>
              {detailEnv.version && (
                <DetailRow label="当前版本">
                  <span className="font-mono text-sm">{detailEnv.version}</span>
                </DetailRow>
              )}
              {detailEnv.path && (
                <DetailRow label="安装路径">
                  <span className="font-mono text-xs break-all">{detailEnv.path}</span>
                </DetailRow>
              )}
              {detailEnv.latestVersion && (
                <DetailRow label="最新版本">
                  <span className="font-mono text-sm text-emerald-500">
                    {detailEnv.latestVersion}
                  </span>
                </DetailRow>
              )}
              {detailEnv.packageManager && (
                <DetailRow label="包管理器">
                  <span className="text-sm">{detailEnv.packageManager}</span>
                </DetailRow>
              )}
              {detailEnv.homepage && (
                <DetailRow label="官方网站">
                  <a
                    href={detailEnv.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {detailEnv.homepage}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </DetailRow>
              )}
              {detailEnv.installCommand && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    {detailEnv.installed ? "更新命令" : "安装命令"}
                  </p>
                  <pre className="text-xs font-mono bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                    {detailEnv.installed
                      ? detailEnv.updateCommand || detailEnv.installCommand
                      : detailEnv.installCommand}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 确认操作对话框 */}
      <Dialog open={!!confirmAction} onOpenChange={(v) => { if (!v) setConfirmAction(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmAction?.action === "install" && <Download className="h-4 w-4" />}
              {confirmAction?.action === "update" && <ArrowUpCircle className="h-4 w-4" />}
              {confirmAction?.action === "remove" && <Trash2 className="h-4 w-4 text-destructive" />}
              {confirmAction?.action === "install" && "安装"}
              {confirmAction?.action === "update" && "更新"}
              {confirmAction?.action === "remove" && "卸载"}{confirmAction?.envName}
            </DialogTitle>
            <DialogDescription>
              {confirmAction?.action === "remove"
                ? `确定要卸载 ${confirmAction?.envName} 吗？此操作不可撤销。`
                : `确定要${confirmAction?.action === "install" ? "安装" : "更新"} ${confirmAction?.envName} 吗？`}
            </DialogDescription>
          </DialogHeader>
          {confirmAction && (
            <div className="space-y-3">
              {confirmAction.versionOptions && confirmAction.versionOptions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    版本
                  </p>
                  <Select
                    value={confirmAction.selectedVersion}
                    onValueChange={(value) =>
                      setConfirmAction((prev) =>
                        prev ? { ...prev, selectedVersion: value } : prev
                      )
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="选择版本" />
                    </SelectTrigger>
                    <SelectContent>
                      {confirmAction.versionOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}{item.recommended ? "（推荐）" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  将执行的命令
                </p>
                <pre className="text-xs font-mono bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
                  {getConfirmCommand()}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction(null)}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant={confirmAction?.action === "remove" ? "destructive" : "default"}
              disabled={actingId !== null}
              onClick={() => {
                if (confirmAction) {
                  executeAction(
                    confirmAction.envId,
                    confirmAction.action,
                    confirmAction.selectedVersion
                  );
                }
              }}
            >
              {actingId && (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              )}
              {confirmAction?.action === "install" && "安装"}
              {confirmAction?.action === "update" && "更新"}
              {confirmAction?.action === "remove" && "卸载"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 详情行组件 ────────────────────────────────────────────────────────

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  );
}
