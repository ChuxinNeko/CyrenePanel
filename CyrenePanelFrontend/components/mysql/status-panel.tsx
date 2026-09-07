"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  Database,
  Gauge,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Timer,
  Users,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_BASE } from "@/lib/api-base";

interface MysqlStatus {
  version: string;
  versionComment: string;
  uptime: number;
  queries: number;
  qps: number;
  slowQueries: number;
  threadsConnected: number;
  threadsRunning: number;
  threadsCached: number;
  threadsCreated: number;
  maxConnections: number;
  maxUsedConnections: number;
  connectionUsage: number;
  abortedConnects: number;
  abortedClients: number;
  bufferPoolSize: number;
  bufferHitRate: number;
  keyBufferSize: number;
  keyHitRate: number;
  tmpTables: number;
  tmpDiskTables: number;
  tmpDiskRatio: number;
  bytesReceived: number;
  bytesSent: number;
  openTables: number;
  openedTables: number;
  tableOpenCache: number;
  slowLogEnabled: boolean;
  slowLogFile: string;
  longQueryTime: number;
}

interface ProcessRow {
  id: number;
  user: string;
  host: string;
  db: string | null;
  command: string;
  time: number;
  state: string | null;
  info: string | null;
}

async function apiGet<T>(path: string): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  if (!seconds) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

export function MysqlStatusPanel({ connectionId }: { connectionId: string }) {
  const [status, setStatus] = useState<MysqlStatus | null>(null);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [variables, setVariables] = useState<{ name: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [varKeyword, setVarKeyword] = useState("");
  const [tab, setTab] = useState("overview");

  const load = useCallback(async () => {
    if (!connectionId) return;
    const [statusRes, processRes] = await Promise.all([
      apiGet<{ success: boolean; status?: MysqlStatus; message?: string }>(
        `/api/mysql/status?connectionId=${encodeURIComponent(connectionId)}`,
      ),
      apiGet<{ success: boolean; processes?: ProcessRow[] }>(
        `/api/mysql/processlist?connectionId=${encodeURIComponent(connectionId)}`,
      ),
    ]);

    if (statusRes.success && statusRes.status) setStatus(statusRes.status);
    else if (statusRes.message) toast.error(statusRes.message);

    if (processRes.success && processRes.processes) setProcesses(processRes.processes);
    setLoading(false);
  }, [connectionId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  // 变量列表数据量大，只在切到该页签时才拉
  useEffect(() => {
    if (tab !== "variables" || variables.length > 0 || !connectionId) return;
    apiGet<{ success: boolean; variables?: { name: string; value: string }[] }>(
      `/api/mysql/variables?connectionId=${encodeURIComponent(connectionId)}`,
    ).then((res) => {
      if (res.success && res.variables) setVariables(res.variables);
    });
  }, [tab, variables.length, connectionId]);

  const filteredVars = useMemo(() => {
    const kw = varKeyword.trim().toLowerCase();
    if (!kw) return variables;
    return variables.filter(
      (v) => v.name.toLowerCase().includes(kw) || v.value.toLowerCase().includes(kw),
    );
  }, [variables, varKeyword]);

  const handleKill = async (id: number) => {
    const res = await apiPost<{ success: boolean; message?: string }>(
      "/api/mysql/processlist/kill",
      { connectionId, id },
    );
    if (res.success) {
      toast.success(res.message || "会话已终止");
      load();
    } else {
      toast.error(res.message || "终止失败");
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中...
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        无法获取运行状态，请检查连接是否可用
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">{status.version}</Badge>
          <span className="text-muted-foreground">
            已运行 {formatUptime(status.uptime)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={autoRefresh ? "default" : "outline"}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {autoRefresh ? "自动刷新中" : "已暂停刷新"}
          </Button>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="overview" className="gap-1.5">
            <Gauge className="h-3.5 w-3.5" />
            运行概览
          </TabsTrigger>
          <TabsTrigger value="processes" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            进程列表
            {processes.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                {processes.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="variables" className="gap-1.5">
            <Database className="h-3.5 w-3.5" />
            全局变量
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-auto px-1 pt-4">
          <TabsContent value="overview" className="mt-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<Gauge className="h-4 w-4" />}
                label="平均 QPS"
                value={status.qps.toFixed(2)}
                hint={`累计 ${status.queries.toLocaleString()} 次查询`}
              />
              <MetricCard
                icon={<Users className="h-4 w-4" />}
                label="当前连接"
                value={`${status.threadsConnected} / ${status.maxConnections}`}
                hint={`峰值 ${status.maxUsedConnections}`}
                percent={status.connectionUsage}
              />
              <MetricCard
                icon={<Timer className="h-4 w-4" />}
                label="慢查询"
                value={status.slowQueries.toLocaleString()}
                hint={
                  status.slowLogEnabled
                    ? `阈值 ${status.longQueryTime}s`
                    : "慢查询日志未开启"
                }
                warn={status.slowQueries > 0}
              />
              <MetricCard
                icon={<Activity className="h-4 w-4" />}
                label="活跃线程"
                value={String(status.threadsRunning)}
                hint={`缓存 ${status.threadsCached} · 累计创建 ${status.threadsCreated}`}
              />
            </div>

            <Card>
              <CardContent className="space-y-4 p-4">
                <h4 className="text-sm font-medium">缓存命中率</h4>
                <RateBar
                  label="InnoDB 缓冲池"
                  value={status.bufferHitRate}
                  hint={`缓冲池 ${formatBytes(status.bufferPoolSize)}`}
                />
                <RateBar
                  label="MyISAM Key 缓存"
                  value={status.keyHitRate}
                  hint={`Key 缓冲 ${formatBytes(status.keyBufferSize)}`}
                />
                <RateBar
                  label="临时表落盘比例"
                  value={status.tmpDiskRatio}
                  hint={`${status.tmpDiskTables.toLocaleString()} / ${status.tmpTables.toLocaleString()} 张落盘`}
                  invert
                />
                <p className="text-xs text-muted-foreground">
                  缓冲池命中率长期低于 95% 说明内存不足；临时表落盘比例偏高时可调大
                  tmp_table_size 与 max_heap_table_size。
                </p>
              </CardContent>
            </Card>

            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <CardContent className="space-y-2 p-4">
                  <h4 className="mb-2 text-sm font-medium">连接与流量</h4>
                  <Row label="接收流量" value={formatBytes(status.bytesReceived)} />
                  <Row label="发送流量" value={formatBytes(status.bytesSent)} />
                  <Row
                    label="失败连接"
                    value={String(status.abortedConnects)}
                    warn={status.abortedConnects > 0}
                  />
                  <Row
                    label="异常中断的客户端"
                    value={String(status.abortedClients)}
                    warn={status.abortedClients > 0}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-2 p-4">
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <HardDrive className="h-4 w-4" />
                    表缓存
                  </h4>
                  <Row label="已打开的表" value={String(status.openTables)} />
                  <Row label="累计打开次数" value={status.openedTables.toLocaleString()} />
                  <Row label="table_open_cache" value={String(status.tableOpenCache)} />
                  <p className="pt-1 text-xs text-muted-foreground">
                    累计打开次数远大于已打开数时，说明 table_open_cache 偏小。
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="processes" className="mt-0">
            <Card>
              <CardContent className="p-0">
                {processes.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">暂无会话</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left font-medium">ID</th>
                        <th className="p-2 text-left font-medium">用户</th>
                        <th className="p-2 text-left font-medium">来源</th>
                        <th className="p-2 text-left font-medium">数据库</th>
                        <th className="p-2 text-left font-medium">命令</th>
                        <th className="p-2 text-left font-medium">耗时</th>
                        <th className="p-2 text-left font-medium">状态 / SQL</th>
                        <th className="p-2 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processes.map((p) => (
                        <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-2 font-mono text-xs">{p.id}</td>
                          <td className="p-2">{p.user}</td>
                          <td className="p-2 font-mono text-xs text-muted-foreground">{p.host}</td>
                          <td className="p-2">{p.db || "-"}</td>
                          <td className="p-2">
                            <Badge variant={p.command === "Sleep" ? "outline" : "secondary"}>
                              {p.command}
                            </Badge>
                          </td>
                          <td className={`p-2 ${p.time > 10 ? "font-medium text-amber-600" : ""}`}>
                            {p.time}s
                          </td>
                          <td className="max-w-md p-2">
                            <div className="truncate text-xs text-muted-foreground" title={p.info || p.state || ""}>
                              {p.info || p.state || "-"}
                            </div>
                          </td>
                          <td className="p-2 text-right">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              title="终止会话"
                              onClick={() => handleKill(p.id)}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="variables" className="mt-0 space-y-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={varKeyword}
                onChange={(e) => setVarKeyword(e.target.value)}
                placeholder="搜索变量名或值"
                className="h-9 pl-8"
              />
            </div>
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[28rem]">
                  <table className="w-full text-sm">
                    <tbody>
                      {filteredVars.map((v) => (
                        <tr key={v.name} className="border-b last:border-0">
                          <td className="w-1/2 p-2 font-mono text-xs">{v.name}</td>
                          <td className="p-2 break-all font-mono text-xs text-muted-foreground">
                            {v.value || <span className="italic">（空）</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  percent,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  percent?: number;
  warn?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold ${warn ? "text-amber-600" : ""}`}>{value}</div>
        {percent !== undefined && <Progress value={percent} className="mt-2 h-1.5" />}
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function RateBar({
  label,
  value,
  hint,
  invert,
}: {
  label: string;
  value: number;
  hint: string;
  invert?: boolean;
}) {
  // invert：这个指标越低越好（临时表落盘比例）
  const good = invert ? value < 25 : value >= 95;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className={good ? "text-emerald-600" : "text-amber-600"}>{value}%</span>
      </div>
      <Progress value={Math.min(value, 100)} className="h-1.5" />
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={warn ? "text-amber-600" : ""}>{value}</span>
    </div>
  );
}
