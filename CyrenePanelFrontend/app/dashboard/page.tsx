"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { API_BASE } from "@/lib/api-base";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Server,
  RefreshCw,
  User,
  Monitor,
  Zap,
  Box,
  Wifi,
  WifiOff,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Activity,
  ShieldAlert,
  LogIn,
  FileText,
  KeyRound,
  Network,
} from "lucide-react";

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

interface MetricPoint {
  timestamp: number;
  cpu: number;
  memoryPercentage: number;
  networkDownload?: number;
  networkUpload?: number;
  diskRead?: number;
  diskWrite?: number;
  diskReadOps?: number;
  diskWriteOps?: number;
  diskLatency?: number;
}

interface SystemInfo {
  hostname: string;
  platform: string;
  osVersion: string;
  architecture: string;
  uptime: string;
  uptimeSeconds: number;
  serverUptime: string;
  runtimeVersion: string;
  panelVersion: string;
  cpu: { cores: number; model: string; usage: number };
  memory: {
    total: number;
    used: number;
    free: number;
    totalFormatted: string;
    usedFormatted: string;
    freeFormatted: string;
    percentage: number;
  };
  network?: {
    download: number;
    upload: number;
    downloadFormatted: string;
    uploadFormatted: string;
    receivedFormatted: string;
    transmittedFormatted: string;
    receivedBytes: number;
    transmittedBytes: number;
  };
  diskIo?: {
    read: number;
    write: number;
    readFormatted: string;
    writeFormatted: string;
    readOps: number;
    writeOps: number;
    readLatencyMs: number;
    writeLatencyMs: number;
    latencyMs: number;
  };
  disks: Array<{
    filesystem: string;
    mount: string;
    total: number;
    used: number;
    free: number;
    percentage: number;
    totalFormatted: string;
    usedFormatted: string;
    freeFormatted: string;
  }>;
  nodeCount: number;
  onlineNodeCount: number;
  metrics?: MetricPoint[];
}

interface Instance {
  id: string;
  name: string;
  status: "running" | "stopped" | "error";
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
}

interface AuditLogItem {
  id: string;
  timestamp: number;
  username: string;
  category: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  success: boolean;
  nodeId: string;
  nodeName: string;
}

const AUDIT_CATEGORY_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  auth: { label: "认证", icon: LogIn, color: "text-blue-500" },
  file: { label: "文件", icon: FileText, color: "text-amber-500" },
  certificate: { label: "证书", icon: KeyRound, color: "text-emerald-500" },
  user: { label: "用户", icon: User, color: "text-violet-500" },
  node: { label: "节点", icon: Network, color: "text-cyan-500" },
  instance: { label: "实例", icon: Box, color: "text-orange-500" },
  service: { label: "服务", icon: Activity, color: "text-rose-500" },
  site: { label: "网站", icon: Monitor, color: "text-sky-500" },
  docker: { label: "Docker", icon: Box, color: "text-indigo-500" },
  system: { label: "系统", icon: Server, color: "text-slate-500" },
};

function getCategoryMeta(category: string) {
  return (
    AUDIT_CATEGORY_META[category] ?? {
      label: category || "其他",
      icon: ShieldAlert,
      color: "text-muted-foreground",
    }
  );
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatAbsoluteTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function displayUsername(username: string): string {
  if (!username) return "(匿名)";
  if (username === "__api_node__") return "主节点代理";
  return username;
}

function getProgressColor(pct: number) {
  if (pct >= 90) return "bg-destructive";
  if (pct >= 70) return "bg-primary/60";
  return "bg-primary";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatBandwidth(bytesPerSecond?: number): string {
  return `${formatBytes(bytesPerSecond ?? 0)}/s`;
}

function formatOps(value?: number): string {
  if (!Number.isFinite(value ?? 0) || (value ?? 0) <= 0) return "0/s";
  return `${(value ?? 0).toFixed((value ?? 0) >= 100 ? 0 : 1)}/s`;
}

function formatLatency(value?: number): string {
  if (!Number.isFinite(value ?? 0) || (value ?? 0) <= 0) return "0 ms";
  return `${(value ?? 0).toFixed((value ?? 0) >= 10 ? 0 : 1)} ms`;
}

function ResourceTrendChart({
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
      <div className="flex h-16 items-center justify-center rounded bg-muted/30 text-xs text-muted-foreground">
        暂无趋势数据
      </div>
    );
  }

  const max = Math.max(Math.max(...data), 20);
  const points = data.map((value, index) => {
    const x = (index / Math.max(data.length - 1, 1)) * 100;
    const y = 100 - (value / max) * 100;
    return `${x},${y}`;
  });
  const polyline = points.join(" ");
  const areaPoints = `0,100 ${polyline} 100,100`;
  const current = data[data.length - 1];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="font-medium" style={{ color }}>
          {current}{unit}
        </span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-16 w-full rounded"
        style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}
      >
        <polygon points={areaPoints} fill={color} fillOpacity="0.1" />
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function BandwidthCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border bg-muted/20 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
        <span>{label}</span>
      </div>
      <span className="shrink-0 font-mono text-xs font-semibold">{value}</span>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        {sub && (
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ username: string } | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [nodesOverview, setNodesOverview] = useState<NodeOverview[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditNodeFilter, setAuditNodeFilter] = useState<string>("__all__");
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<string>("__all__");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSystem = useCallback(async () => {
    try {
      const { data, error } = await api.api.system.get();
      if (!error && data?.success) {
        setSystem(data.system as SystemInfo);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchInstances = useCallback(async () => {
    try {
      const data = await apiGet<{ success: boolean; instances: Instance[] }>(
        "/api/instances"
      );
      if (data.success) {
        setInstances(data.instances);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchNodesOverview = useCallback(async () => {
    try {
      const data = await apiGet<{ success: boolean; nodes: NodeOverview[] }>(
        "/api/nodes/overview"
      );
      if (data.success) {
        setNodesOverview(data.nodes);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const data = await apiGet<{ success: boolean; logs: AuditLogItem[] }>(
        "/api/audit/aggregate?limit=100"
      );
      if (data.success) {
        setAuditLogs(data.logs);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
        setProfile(data.profile as { username: string });
        await Promise.all([fetchSystem(), fetchInstances(), fetchNodesOverview(), fetchAuditLogs()]);
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchSystem, fetchInstances, fetchNodesOverview, fetchAuditLogs]);

  useEffect(() => {
    if (loading) return;
    const timer = setInterval(fetchSystem, 5000);
    const auditTimer = setInterval(fetchAuditLogs, 15000);
    return () => {
      clearInterval(timer);
      clearInterval(auditTimer);
    };
  }, [loading, fetchSystem, fetchAuditLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchSystem(), fetchInstances(), fetchNodesOverview(), fetchAuditLogs()]);
    setRefreshing(false);
  };

  const cpuTrend = system?.metrics?.map((metric) => metric.cpu) ?? [];
  const memoryTrend =
    system?.metrics?.map((metric) => metric.memoryPercentage) ?? [];
  const latestMetric =
    system?.metrics && system.metrics.length > 0
      ? system.metrics[system.metrics.length - 1]
      : undefined;
  const downloadRate =
    system?.network?.downloadFormatted ??
    formatBandwidth(latestMetric?.networkDownload);
  const uploadRate =
    system?.network?.uploadFormatted ??
    formatBandwidth(latestMetric?.networkUpload);
  const totalReceived = system?.network?.receivedFormatted ?? "0 B";
  const totalTransmitted = system?.network?.transmittedFormatted ?? "0 B";
  const diskReadRate =
    system?.diskIo?.readFormatted ?? formatBandwidth(latestMetric?.diskRead);
  const diskWriteRate =
    system?.diskIo?.writeFormatted ?? formatBandwidth(latestMetric?.diskWrite);
  const diskReadOps = formatOps(system?.diskIo?.readOps ?? latestMetric?.diskReadOps);
  const diskWriteOps = formatOps(
    system?.diskIo?.writeOps ?? latestMetric?.diskWriteOps
  );
  const diskLatency = formatLatency(
    system?.diskIo?.latencyMs ?? latestMetric?.diskLatency
  );

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 mb-1" />
                <Skeleton className="h-3 w-32" />
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
        <h1 className="text-3xl font-bold tracking-tight">概览</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            欢迎回来，{profile?.username}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            刷新
          </Button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Server}
          label="在线节点"
          value={system?.onlineNodeCount ?? 0}
          sub={`共 ${system?.nodeCount ?? 0} 个节点`}
          color="text-primary"
        />
        <StatCard
          icon={Cpu}
          label="CPU 使用率"
          value={`${system?.cpu.usage ?? 0}%`}
          sub={`${system?.cpu.cores ?? 0} 核 · ${system?.cpu.model ?? "未知"}`}
          color="text-primary"
        />
        <StatCard
          icon={MemoryStick}
          label="内存使用"
          value={system?.memory.usedFormatted ?? "—"}
          sub={`共 ${system?.memory.totalFormatted ?? "—"}`}
          color="text-primary"
        />
        <StatCard
          icon={Box}
          label="实例状态"
          value={`${instances.filter((i) => i.status === "running").length} / ${instances.length}`}
          sub={`运行中 ${instances.filter((i) => i.status === "running").length} · 已停止 ${instances.filter((i) => i.status === "stopped").length}${instances.filter((i) => i.status === "error").length > 0 ? ` · 异常 ${instances.filter((i) => i.status === "error").length}` : ""}`}
          color="text-primary"
        />
      </div>

      {/* Node overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4" />
            节点状态总览
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nodesOverview.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无节点数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>节点名称</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>内存</TableHead>
                  <TableHead>实例</TableHead>
                  <TableHead>版本</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodesOverview.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {node.name}
                        {node.isMain && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            主
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {node.address}
                      </span>
                    </TableCell>
                    <TableCell>
                      {node.online ? (
                        <Badge variant="default" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0">
                          <Wifi className="h-3 w-3 mr-1" />
                          在线
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <WifiOff className="h-3 w-3 mr-1" />
                          离线
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {node.online && node.cpu !== undefined ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16">
                            <Progress
                              value={node.cpu}
                              indicatorClassName={getProgressColor(node.cpu)}
                              className="h-2"
                            />
                          </div>
                          <span className="text-xs font-medium w-10 text-right">{node.cpu}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {node.online && node.memory ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16">
                            <Progress
                              value={node.memory.percentage}
                              indicatorClassName={getProgressColor(node.memory.percentage)}
                              className="h-2"
                            />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {node.memory.usedFormatted}/{node.memory.totalFormatted}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {node.online && node.totalInstances !== undefined ? (
                        <span className="text-sm">
                          <span className="font-medium text-primary">{node.runningInstances}</span>
                          <span className="text-muted-foreground"> / {node.totalInstances}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {node.online && node.version ? (
                        <span className="text-xs font-mono text-muted-foreground">{node.version}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sensitive action audit log */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" />
              敏感操作日志
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                {auditLogs.length}
              </Badge>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={auditNodeFilter}
                onChange={(e) => setAuditNodeFilter(e.target.value)}
                className="h-7 rounded border bg-background px-2 text-xs"
              >
                <option value="__all__">全部节点</option>
                {Array.from(new Set(auditLogs.map((log) => log.nodeId))).map((nodeId) => {
                  const sample = auditLogs.find((l) => l.nodeId === nodeId);
                  return (
                    <option key={nodeId} value={nodeId}>
                      {sample?.nodeName ?? nodeId}
                    </option>
                  );
                })}
              </select>
              <select
                value={auditCategoryFilter}
                onChange={(e) => setAuditCategoryFilter(e.target.value)}
                className="h-7 rounded border bg-background px-2 text-xs"
              >
                <option value="__all__">全部分类</option>
                {Array.from(new Set(auditLogs.map((log) => log.category))).map((cat) => (
                  <option key={cat} value={cat}>
                    {getCategoryMeta(cat).label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const filtered = auditLogs.filter(
              (log) =>
                (auditNodeFilter === "__all__" || log.nodeId === auditNodeFilter) &&
                (auditCategoryFilter === "__all__" || log.category === auditCategoryFilter),
            );
            if (filtered.length === 0) {
              return (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {auditLogs.length === 0 ? "暂无操作记录" : "当前筛选下无记录"}
                </p>
              );
            }
            return (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">时间</TableHead>
                      <TableHead className="w-[110px]">用户</TableHead>
                      <TableHead className="w-[100px]">分类</TableHead>
                      <TableHead className="w-[110px]">操作</TableHead>
                      <TableHead>对象</TableHead>
                      <TableHead className="w-[140px]">节点</TableHead>
                      <TableHead className="w-[110px]">来源 IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((log) => {
                      const meta = getCategoryMeta(log.category);
                      const Icon = meta.icon;
                      return (
                        <TableRow key={log.id}>
                          <TableCell
                            className="font-mono text-xs text-muted-foreground"
                            title={formatAbsoluteTime(log.timestamp)}
                          >
                            {formatRelativeTime(log.timestamp)}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {displayUsername(log.username)}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center gap-1 text-xs ${meta.color}`}>
                              <Icon className="h-3 w-3" />
                              {meta.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            {log.success ? (
                              log.action
                            ) : (
                              <span className="text-destructive">{log.action}（失败）</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[260px]">
                            <div className="truncate text-xs" title={log.target}>
                              {log.target || "—"}
                            </div>
                            {log.detail && (
                              <div
                                className="truncate text-[10px] text-muted-foreground"
                                title={log.detail}
                              >
                                {log.detail}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">{log.nodeName}</span>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {log.ip || "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* Resource usage */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4" />
              资源使用
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {system && (
              <>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <BandwidthCard
                    icon={DownloadIcon}
                    label="实时下载"
                    value={downloadRate}
                    color="text-sky-500"
                  />
                  <BandwidthCard
                    icon={UploadIcon}
                    label="实时上传"
                    value={uploadRate}
                    color="text-emerald-500"
                  />
                  <BandwidthCard
                    icon={DownloadIcon}
                    label="总接收"
                    value={totalReceived}
                    color="text-sky-500"
                  />
                  <BandwidthCard
                    icon={UploadIcon}
                    label="总发送"
                    value={totalTransmitted}
                    color="text-emerald-500"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <ResourceTrendChart
                    data={cpuTrend}
                    color="hsl(221, 83%, 53%)"
                    label={`CPU · ${system.cpu.cores} 核`}
                  />
                  <ResourceTrendChart
                    data={memoryTrend}
                    color="hsl(262, 83%, 58%)"
                    label={`内存 · ${system.memory.usedFormatted} / ${system.memory.totalFormatted}`}
                  />
                </div>

                <div className="space-y-2 rounded border bg-muted/10 p-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    磁盘 IO
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <BandwidthCard
                      icon={DownloadIcon}
                      label="读取"
                      value={diskReadRate}
                      color="text-blue-500"
                    />
                    <BandwidthCard
                      icon={UploadIcon}
                      label="写入"
                      value={diskWriteRate}
                      color="text-orange-500"
                    />
                    <BandwidthCard
                      icon={Activity}
                      label="读次数"
                      value={diskReadOps}
                      color="text-blue-500"
                    />
                    <BandwidthCard
                      icon={Activity}
                      label="写次数"
                      value={diskWriteOps}
                      color="text-orange-500"
                    />
                    <BandwidthCard
                      icon={Zap}
                      label="IO 延迟"
                      value={diskLatency}
                      color="text-amber-500"
                    />
                  </div>
                </div>

                {system.disks.map((disk) => (
                  <div key={disk.mount} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <HardDrive className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="shrink-0 font-mono">{disk.filesystem}</span>
                        <span className="truncate text-muted-foreground">{disk.mount}</span>
                      </span>
                      <span className="shrink-0 font-medium">
                        {disk.usedFormatted} / {disk.totalFormatted} ({disk.percentage}%)
                      </span>
                    </div>
                    <Progress
                      value={disk.percentage}
                      indicatorClassName={getProgressColor(disk.percentage)}
                      className="h-1.5"
                    />
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* User & System info */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                用户信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">用户名</span>
                <span className="font-medium">{profile?.username}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">面板版本</span>
                <span className="font-medium">{system?.panelVersion}</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="w-full mt-2"
                onClick={() => {
                  localStorage.removeItem("token");
                  router.push("/login");
                }}
              >
                退出登录
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Monitor className="h-4 w-4" />
                系统信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">主机名</span>
                <span className="font-medium font-mono">{system?.hostname}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">系统</span>
                <span className="font-medium">
                  {system?.platform} {system?.architecture}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">内核</span>
                <span className="font-medium font-mono text-xs">{system?.osVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">运行时</span>
                <span className="font-medium">{system?.runtimeVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">系统运行时间</span>
                <span className="font-medium">{system?.uptime}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">服务运行时间</span>
                <span className="font-medium">{system?.serverUptime}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
