"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  Box,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Activity,
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

function formatClock(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

/**
 * 占用率的严重度阶梯。按 dataviz 规则，填充色走 accent → warning → danger，
 * 未填充轨道用同一色相的浅一档，让状态在整条 bar 上都读得出来。
 */
function meterTone(pct: number) {
  if (pct >= 90)
    return { fill: "bg-destructive", track: "bg-destructive/15", text: "text-destructive" };
  if (pct >= 70)
    return { fill: "bg-warning", track: "bg-warning/15", text: "text-warning-fg" };
  return { fill: "bg-chart-1", track: "bg-chart-1/15", text: "text-foreground" };
}

/** 占用率计量条：数值直接标在旁边，不依赖颜色单独承载信息 */
function Meter({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const tone = meterTone(value);
  return (
    <Progress
      value={value}
      className={`h-1.5 ${tone.track} ${className ?? ""}`}
      indicatorClassName={tone.fill}
    />
  );
}

/**
 * 趋势图：2px 线 + 10% 同色相面积 + ≥8px 端点（带 2px 表面色描环）。
 * 悬停给十字准星和数值气泡——HTML 图表默认就该是可交互的。
 */
function TrendChart({
  data,
  color,
  title,
  subtitle,
  unit = "%",
}: {
  data: number[];
  color: string;
  title: string;
  subtitle: string;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  if (data.length < 2) {
    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="eyebrow">{title}</span>
        </div>
        <div className="flex h-24 items-center justify-center rounded-md bg-surface-inset text-xs text-mute">
          暂无趋势数据
        </div>
      </div>
    );
  }

  // 上界留一点余量，避免曲线永远贴顶
  const max = Math.max(Math.max(...data) * 1.15, 20);
  const coords = data.map((value, index) => ({
    x: (index / (data.length - 1)) * 100,
    y: 100 - (value / max) * 100,
    value,
  }));
  const line = coords.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `0,100 ${line} 100,100`;
  const last = coords[coords.length - 1];
  const active = hover === null ? last : coords[hover];

  const clampIndex = (index: number) =>
    Math.min(Math.max(index, 0), data.length - 1);

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(clampIndex(Math.round(ratio * (data.length - 1))));
  };

  // 键盘要能读到和悬停一样的值，不能让数值只挂在鼠标上
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setHover((prev) => clampIndex((prev ?? data.length - 1) + step));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHover(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHover(data.length - 1);
    } else if (event.key === "Escape") {
      setHover(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow truncate">{title}</span>
        {/* 直接标注当前值：颜色之外始终有文字承载信息，键盘逐点时同步播报 */}
        <span className="shrink-0 text-sm font-semibold tabular-nums" aria-live="polite">
          {active.value}
          {unit}
        </span>
      </div>

      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-label={`${title}趋势，方向键逐点读数`}
        className="relative h-24 w-full cursor-crosshair rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => setHover(null)}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={`${title}趋势，当前 ${active.value}${unit}`}
        >
          {/* 网格线：贴近表面的灰、1px 实线、退到后面 */}
          {[25, 50, 75].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polygon points={area} fill={color} fillOpacity="0.1" />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {hover !== null && (
            <line
              x1={active.x}
              x2={active.x}
              y1="0"
              y2="100"
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* 端点单独用 DOM 画：SVG 在 preserveAspectRatio=none 下会把圆压成椭圆 */}
        <span
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${active.x}%`,
            top: `${active.y}%`,
            backgroundColor: color,
            boxShadow: "0 0 0 2px var(--card)",
          }}
        />

        {hover !== null && (
          <span
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md bg-primary px-1.5 py-0.5 font-mono text-[11px] text-primary-foreground shadow-elev-4"
            style={{ left: `${active.x}%`, top: `${Math.max(active.y - 6, 6)}%` }}
          >
            {active.value}
            {unit}
          </span>
        )}
      </div>

      <p className="truncate text-xs text-mute">{subtitle}</p>
    </div>
  );
}

/** 键值指标行：标签在左、等宽数值在右 */
function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-surface-inset px-2.5 py-2">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-mute" />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-mono text-xs font-medium">{value}</span>
    </div>
  );
}

/**
 * KPI 磁贴。规范：label 句式小写、value 用无衬线 600。
 * 大数字用比例数字而非 tabular——tabular 会让显示级数字显得松散。
 */
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
        {sub && <p className="truncate text-xs text-mute" title={sub}>{sub}</p>}
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
  }, [router, fetchSystem, fetchInstances, fetchNodesOverview]);

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
    ]);
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

  const runningCount = instances.filter((i) => i.status === "running").length;
  const stoppedCount = instances.filter((i) => i.status === "stopped").length;
  const errorCount = instances.filter((i) => i.status === "error").length;

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
            <Card key={i} size="sm">
              <CardContent className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* KPI 行：只给当前值，趋势交给下面的图，不重复编码同一份数据 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Server}
          label="在线节点"
          value={`${system?.onlineNodeCount ?? 0} / ${system?.nodeCount ?? 0}`}
          sub={`共 ${system?.nodeCount ?? 0} 个节点接入`}
        />
        <StatTile
          icon={Cpu}
          label="CPU 使用率"
          value={`${system?.cpu.usage ?? 0}%`}
          sub={`${system?.cpu.cores ?? 0} 核 · ${system?.cpu.model ?? "未知"}`}
        />
        <StatTile
          icon={MemoryStick}
          label="内存使用"
          value={system?.memory.usedFormatted ?? "—"}
          sub={`共 ${system?.memory.totalFormatted ?? "—"} · ${system?.memory.percentage ?? 0}%`}
        />
        <StatTile
          icon={Box}
          label="实例运行"
          value={`${runningCount} / ${instances.length}`}
          sub={`运行 ${runningCount} · 停止 ${stoppedCount}${errorCount > 0 ? ` · 异常 ${errorCount}` : ""}`}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* 资源趋势 */}
        <Card className="lg:col-span-2">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">资源使用</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {system ? (
              <>
                <div className="grid gap-5 md:grid-cols-2">
                  <TrendChart
                    data={cpuTrend}
                    color="var(--chart-1)"
                    title="CPU"
                    subtitle={`${system.cpu.cores} 核 · ${system.cpu.model}`}
                  />
                  <TrendChart
                    data={memoryTrend}
                    color="var(--chart-2)"
                    title="内存"
                    subtitle={`${system.memory.usedFormatted} / ${system.memory.totalFormatted}`}
                  />
                </div>

                <div className="space-y-2">
                  <p className="eyebrow">网络</p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricRow icon={DownloadIcon} label="实时下载" value={downloadRate} />
                    <MetricRow icon={UploadIcon} label="实时上传" value={uploadRate} />
                    <MetricRow icon={DownloadIcon} label="总接收" value={totalReceived} />
                    <MetricRow icon={UploadIcon} label="总发送" value={totalTransmitted} />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="eyebrow">磁盘 IO</p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <MetricRow icon={DownloadIcon} label="读取" value={diskReadRate} />
                    <MetricRow icon={UploadIcon} label="写入" value={diskWriteRate} />
                    <MetricRow icon={Activity} label="读次数" value={diskReadOps} />
                    <MetricRow icon={Activity} label="写次数" value={diskWriteOps} />
                    <MetricRow icon={Activity} label="IO 延迟" value={diskLatency} />
                  </div>
                </div>

                {system.disks.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="eyebrow">磁盘容量</p>
                    {system.disks.map((disk) => (
                      <div key={disk.mount} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <HardDrive className="size-3 shrink-0 text-mute" />
                            <span className="shrink-0 font-mono">{disk.filesystem}</span>
                            <span className="truncate text-mute">{disk.mount}</span>
                          </span>
                          <span
                            className={`shrink-0 font-mono font-medium ${meterTone(disk.percentage).text}`}
                          >
                            {disk.usedFormatted} / {disk.totalFormatted} ·{" "}
                            {disk.percentage}%
                          </span>
                        </div>
                        <Meter value={disk.percentage} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="py-8 text-center text-sm text-mute">暂无系统数据</p>
            )}
          </CardContent>
        </Card>

        {/* 系统信息 */}
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">系统信息</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border text-sm">
              {[
                { k: "主机名", v: system?.hostname, mono: true },
                {
                  k: "系统",
                  v: system ? `${system.platform} ${system.architecture}` : undefined,
                },
                { k: "内核", v: system?.osVersion, mono: true },
                { k: "运行时", v: system?.runtimeVersion, mono: true },
                { k: "面板版本", v: system?.panelVersion, mono: true },
                { k: "系统运行时间", v: system?.uptime },
                { k: "服务运行时间", v: system?.serverUptime },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <dt className="shrink-0 text-muted-foreground">{row.k}</dt>
                  <dd
                    className={`min-w-0 truncate text-right font-medium ${row.mono ? "font-mono text-xs" : ""}`}
                    title={row.v ?? undefined}
                  >
                    {row.v ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

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
