"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { API_BASE } from "@/lib/api-base";
import { fetchMe } from "@/lib/me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { RingGauge } from "@/components/ring-gauge";
import { MetricChart, type ChartSeries } from "@/components/metric-chart";
import {
  CpuDetailCard,
  DiskDetailCard,
  LoadDetailCard,
  MemoryDetailCard,
} from "@/components/gauge-details";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Box, Database, Globe2, RefreshCw, Server } from "lucide-react";

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
  kernelVersion: string;
  distro: string;
  architecture: string;
  hostAddress: string;
  bootTime: string;
  loadAverage: {
    one: number;
    five: number;
    fifteen: number;
    percentage: number;
    runningProcesses: number;
    totalProcesses: number;
    supported: boolean;
  };
  cpuDetail?: {
    times: {
      user: number; nice: number; system: number; idle: number; iowait: number;
      irq: number; softirq: number; steal: number; guest: number; guestNice: number;
    } | null;
    coreUsage: number[];
    fullTimesSupported: boolean;
  };
  cpuTopology?: {
    model: string;
    physicalCount: number;
    physicalCores: number;
    logicalCores: number;
  };
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
    sharedFormatted: string;
    availableFormatted: string;
    buffersFormatted: string;
    cachedFormatted: string;
    detailSupported: boolean;
    percentage: number;
  };
  network?: {
    downloadFormatted: string;
    uploadFormatted: string;
    receivedFormatted: string;
    transmittedFormatted: string;
  };
  diskIo?: {
    readFormatted: string;
    writeFormatted: string;
    readOps: number;
    writeOps: number;
    latencyMs: number;
  };
  disks: Array<{
    filesystem: string;
    mount: string;
    fstype: string;
    total: number;
    used: number;
    free: number;
    percentage: number;
    totalFormatted: string;
    usedFormatted: string;
    freeFormatted: string;
    inodes: { total: number; used: number; free: number; percentage: number } | null;
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
    usedFormatted: string;
    totalFormatted: string;
    percentage: number;
  };
  runningInstances?: number;
  totalInstances?: number;
  version?: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const formatRate = (value: number) => `${formatBytes(value)}/s`;

function formatClock(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 占用率的严重度阶梯，与环形计量条共用同一套阈值 */
function meterTone(pct: number) {
  if (pct >= 90)
    return { fill: "bg-destructive", track: "bg-destructive/15", text: "text-destructive" };
  if (pct >= 70)
    return { fill: "bg-warning", track: "bg-warning/15", text: "text-warning-fg" };
  return { fill: "bg-chart-1", track: "bg-chart-1/15", text: "text-foreground" };
}

function Meter({ value, className }: { value: number; className?: string }) {
  const tone = meterTone(value);
  return (
    <Progress
      value={value}
      className={`h-1.5 ${tone.track} ${className ?? ""}`}
      indicatorClassName={tone.fill}
    />
  );
}

/** 顶部 KPI 磁贴 */
function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardContent className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow truncate">{label}</span>
          <Icon className="size-3.5 shrink-0 text-mute" />
        </div>
        <div className="text-[28px] leading-8 font-semibold tracking-display">
          {value}
        </div>
        {sub && (
          <p className="truncate text-xs text-mute" title={sub}>
            {sub}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** 系统信息卡的键值行 */
function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className="min-w-0 truncate text-right font-mono text-xs font-medium"
        title={value || undefined}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ username: string } | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [nodesOverview, setNodesOverview] = useState<NodeOverview[]>([]);
  const [siteCount, setSiteCount] = useState(0);
  const [dbConnCount, setDbConnCount] = useState({ mysql: 0, mongo: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const fetchSystem = useCallback(async () => {
    try {
      const { data, error } = await api.api.system.get();
      if (!error && data?.success) {
        setSystem(data.system as SystemInfo);
        setUpdatedAt(Date.now());
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
      if (data.success) setInstances(data.instances);
    } catch {
      // ignore
    }
  }, []);

  const fetchNodesOverview = useCallback(async () => {
    try {
      const data = await apiGet<{ success: boolean; nodes: NodeOverview[] }>(
        "/api/nodes/overview"
      );
      if (data.success) setNodesOverview(data.nodes);
    } catch {
      // ignore
    }
  }, []);

  // 网站与数据库连接数只用于 KPI，各自失败不影响其他卡片
  const fetchCounts = useCallback(async () => {
    const [sites, mysql, mongo] = await Promise.allSettled([
      apiGet<{ success: boolean; sites?: unknown[] }>("/api/sites"),
      apiGet<{ success: boolean; connections?: unknown[] }>("/api/mysql/connections"),
      apiGet<{ success: boolean; connections?: unknown[] }>("/api/mongodb/connections"),
    ]);
    if (sites.status === "fulfilled" && sites.value.success) {
      setSiteCount(sites.value.sites?.length ?? 0);
    }
    setDbConnCount({
      mysql:
        mysql.status === "fulfilled" && mysql.value.success
          ? mysql.value.connections?.length ?? 0
          : 0,
      mongo:
        mongo.status === "fulfilled" && mongo.value.success
          ? mongo.value.connections?.length ?? 0
          : 0,
    });
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        // 鉴权与数据并行发出：/api/me 的结果只用于决定是否跳登录页，
        // 其余接口各自独立鉴权，没必要等它先返回再发起（那样要多花一个 RTT）
        const [me] = await Promise.all([
          fetchMe(),
          fetchSystem(),
          fetchInstances(),
          fetchNodesOverview(),
          fetchCounts(),
        ]);

        if (!me) {
          router.push("/login");
          return;
        }
        setProfile(me);
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchSystem, fetchInstances, fetchNodesOverview, fetchCounts]);

  useEffect(() => {
    if (loading) return;
    const timer = setInterval(fetchSystem, 5000);
    return () => clearInterval(timer);
  }, [loading, fetchSystem]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      fetchSystem(),
      fetchInstances(),
      fetchNodesOverview(),
      fetchCounts(),
    ]);
    setRefreshing(false);
  };

  const metrics = useMemo(() => system?.metrics ?? [], [system]);

  // 四个监控视图共用一份采样序列，Tab 只切换渲染哪几条
  const charts = useMemo<Record<string, ChartSeries[]>>(
    () => ({
      cpu: [
        {
          name: "CPU 使用率",
          color: "var(--chart-1)",
          data: metrics.map((m) => m.cpu),
          format: (v) => `${v}%`,
        },
      ],
      memory: [
        {
          name: "内存使用率",
          color: "var(--chart-2)",
          data: metrics.map((m) => m.memoryPercentage),
          format: (v) => `${v}%`,
        },
      ],
      network: [
        {
          name: "下载",
          color: "var(--chart-1)",
          data: metrics.map((m) => m.networkDownload ?? 0),
          format: formatRate,
        },
        {
          name: "上传",
          color: "var(--chart-2)",
          data: metrics.map((m) => m.networkUpload ?? 0),
          format: formatRate,
        },
      ],
      diskio: [
        {
          name: "读取",
          color: "var(--chart-1)",
          data: metrics.map((m) => m.diskRead ?? 0),
          format: formatRate,
        },
        {
          name: "写入",
          color: "var(--chart-2)",
          data: metrics.map((m) => m.diskWrite ?? 0),
          format: formatRate,
        },
      ],
    }),
    [metrics]
  );

  const runningCount = instances.filter((i) => i.status === "running").length;
  const stoppedCount = instances.filter((i) => i.status === "stopped").length;
  const errorCount = instances.filter((i) => i.status === "error").length;
  const dbTotal = dbConnCount.mysql + dbConnCount.mongo;

  // 状态卡默认展示主节点：/api/system 返回的就是本机数据
  const primaryDisk = system?.disks?.[0];
  const load = system?.loadAverage;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-display">概览</h1>
          <p className="text-sm text-muted-foreground">
            欢迎回来，{profile?.username}
            {system?.hostname && (
              <>
                <span className="mx-1.5 text-mute">·</span>
                <span className="font-mono text-xs">{system.hostname}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="font-mono text-[11px] text-mute">
              更新于 {formatClock(updatedAt)}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* KPI 行 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Server}
          label="在线节点"
          value={`${system?.onlineNodeCount ?? 0} / ${system?.nodeCount ?? 0}`}
          sub={`共 ${system?.nodeCount ?? 0} 个节点接入`}
        />
        <StatTile
          icon={Box}
          label="实例运行"
          value={`${runningCount} / ${instances.length}`}
          sub={`运行 ${runningCount} · 停止 ${stoppedCount}${errorCount > 0 ? ` · 异常 ${errorCount}` : ""}`}
        />
        <StatTile
          icon={Globe2}
          label="网站数量"
          value={siteCount}
          sub={siteCount > 0 ? "已配置站点" : "尚未添加站点"}
        />
        <StatTile
          icon={Database}
          label="数据库连接"
          value={dbTotal}
          sub={`MySQL ${dbConnCount.mysql} · MongoDB ${dbConnCount.mongo}`}
        />
      </div>

      {/* 状态 + 系统信息 */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b pb-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">状态</CardTitle>
              <Badge variant="secondary">主节点</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {system ? (
              <div className="flex flex-wrap items-start justify-around gap-6 py-2">
                {/* Windows 上 loadavg 恒为 0，没有等价概念，直接不展示 */}
                {load?.supported && (
                  <RingGauge
                    value={load.percentage}
                    label="运行负载"
                    caption={`${load.one} / ${load.five} / ${load.fifteen}`}
                    details={
                      <LoadDetailCard
                        load={load}
                        times={system.cpuDetail?.times ?? null}
                        fullTimesSupported={system.cpuDetail?.fullTimesSupported ?? false}
                      />
                    }
                  />
                )}
                <RingGauge
                  value={system.cpu.usage}
                  label="CPU"
                  caption={`${system.cpu.cores} 核`}
                  details={
                    <CpuDetailCard
                      model={system.cpuTopology?.model ?? system.cpu.model}
                      physicalCount={system.cpuTopology?.physicalCount ?? 1}
                      physicalCores={system.cpuTopology?.physicalCores ?? system.cpu.cores}
                      logicalCores={system.cpuTopology?.logicalCores ?? system.cpu.cores}
                      coreUsage={system.cpuDetail?.coreUsage ?? []}
                    />
                  }
                />
                <RingGauge
                  value={system.memory.percentage}
                  label="内存"
                  caption={`${system.memory.usedFormatted} / ${system.memory.totalFormatted}`}
                  details={
                    <MemoryDetailCard
                      free={system.memory.freeFormatted}
                      used={system.memory.usedFormatted}
                      total={system.memory.totalFormatted}
                      shared={system.memory.sharedFormatted}
                      available={system.memory.availableFormatted}
                      buffers={system.memory.buffersFormatted}
                      cached={system.memory.cachedFormatted}
                      detailSupported={system.memory.detailSupported}
                    />
                  }
                />
                {primaryDisk && (
                  <RingGauge
                    value={primaryDisk.percentage}
                    label="磁盘"
                    caption={`${primaryDisk.usedFormatted} / ${primaryDisk.totalFormatted}`}
                    details={
                      <DiskDetailCard
                        mount={primaryDisk.mount}
                        filesystem={primaryDisk.filesystem}
                        fstype={primaryDisk.fstype}
                        totalFormatted={primaryDisk.totalFormatted}
                        freeFormatted={primaryDisk.freeFormatted}
                        usedFormatted={primaryDisk.usedFormatted}
                        percentage={primaryDisk.percentage}
                        inodes={primaryDisk.inodes}
                      />
                    }
                  />
                )}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-mute">暂无系统数据</p>
            )}

            {/* 主盘之外的挂载点用条形计量条补充，避免环形铺满一屏 */}
            {system && system.disks.length > 1 && (
              <div className="mt-4 space-y-2.5 border-t pt-4">
                <p className="eyebrow">其他挂载点</p>
                {system.disks.slice(1).map((disk) => (
                  <div key={disk.mount} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 font-mono">{disk.filesystem}</span>
                        <span className="truncate text-mute">{disk.mount}</span>
                      </span>
                      <span
                        className={`shrink-0 font-mono font-medium ${meterTone(disk.percentage).text}`}
                      >
                        {disk.usedFormatted} / {disk.totalFormatted} · {disk.percentage}%
                      </span>
                    </div>
                    <Meter value={disk.percentage} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">系统信息</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <InfoRow label="主机名称" value={system?.hostname} />
              <InfoRow label="发行版本" value={system?.distro} />
              <InfoRow label="内核版本" value={system?.kernelVersion ?? system?.osVersion} />
              <InfoRow label="系统类型" value={system?.architecture} />
              <InfoRow label="主机地址" value={system?.hostAddress} />
              <InfoRow label="启动时间" value={system?.bootTime} />
              <InfoRow label="运行时间" value={system?.uptime} />
              <InfoRow label="运行时" value={system?.runtimeVersion} />
              <InfoRow label="面板版本" value={system?.panelVersion} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* 监控：四个视图共用一份采样，Tab 切换 */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-base">监控</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="cpu">
            <TabsList className="w-fit">
              <TabsTrigger value="cpu">CPU</TabsTrigger>
              <TabsTrigger value="memory">内存</TabsTrigger>
              <TabsTrigger value="network">网络</TabsTrigger>
              <TabsTrigger value="diskio">磁盘 IO</TabsTrigger>
            </TabsList>
            {Object.entries(charts).map(([key, series]) => (
              <TabsContent key={key} value={key} className="pt-4">
                <MetricChart series={series} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* 节点状态总览 */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            节点状态总览
            <Badge variant="secondary">{nodesOverview.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {nodesOverview.length === 0 ? (
            <p className="py-8 text-center text-sm text-mute">暂无节点数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>节点名称</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-[160px]">CPU</TableHead>
                  <TableHead className="w-[200px]">内存</TableHead>
                  <TableHead>实例</TableHead>
                  <TableHead>版本</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodesOverview.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        {node.name}
                        {node.isMain && <Badge variant="secondary">主</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {node.address}
                    </TableCell>
                    <TableCell>
                      <StatusDot dot={node.online ? "bg-success" : "bg-destructive"}>
                        {node.online ? "在线" : "离线"}
                      </StatusDot>
                    </TableCell>
                    <TableCell>
                      {node.online && node.cpu !== undefined ? (
                        <div className="flex items-center gap-2">
                          <Meter value={node.cpu} className="w-16 shrink-0" />
                          <span
                            className={`w-10 shrink-0 text-right font-mono text-xs ${meterTone(node.cpu).text}`}
                          >
                            {node.cpu}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-mute">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {node.online && node.memory ? (
                        <div className="flex items-center gap-2">
                          <Meter value={node.memory.percentage} className="w-16 shrink-0" />
                          <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                            {node.memory.usedFormatted}/{node.memory.totalFormatted}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-mute">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {node.online && node.totalInstances !== undefined ? (
                        <>
                          <span className="font-medium">{node.runningInstances}</span>
                          <span className="text-mute"> / {node.totalInstances}</span>
                        </>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {node.online && node.version ? node.version : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
