"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RequestMap } from "@/components/request-map";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Globe2,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import { formatServerTime, type ServerTimezone } from "@/lib/audit";
import {
  deltaRatio,
  EMPTY_METRICS,
  formatCount,
  formatTraffic,
  METRIC_CARDS,
  statusTone,
  type AccessMetrics,
  type DayRange,
  type OverviewResponse,
  type RequestsResponse,
  type SiteStatRow,
} from "@/lib/site-stats";

const MAIN_NODE = "__main__";
const PAGE_SIZES = [20, 50, 100];
const STATUS_ALL = "__all__";

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return res.json();
}

interface NodeInfo {
  id: string;
  name: string;
  online: boolean;
}

/** 今日的大数字 + 昨日/前日两行对照，和宝塔那套信息结构一致 */
function MetricCard({
  label,
  hint,
  value,
  yesterday,
  dayBefore,
  ratio,
}: {
  label: string;
  hint: string;
  value: string;
  yesterday: string;
  dayBefore: string;
  ratio: number | null;
}) {
  const up = ratio !== null && ratio > 0;
  return (
    <Card size="sm" className="gap-2">
      <CardContent className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow truncate" title={hint}>
            {label}
          </span>
          {ratio !== null && Math.abs(ratio) >= 0.01 && (
            <span
              className={`inline-flex items-center gap-0.5 font-mono text-[11px] ${
                up ? "text-success-fg" : "text-destructive"
              }`}
              title="与昨日同项相比"
            >
              {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {Math.abs(ratio * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="text-[28px] leading-8 font-semibold tracking-display">{value}</div>
        <div className="space-y-0.5 text-xs text-mute">
          <p className="truncate">昨日 {yesterday}</p>
          <p className="truncate">前日 {dayBefore}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** 下钻页顶部的小指标块，只看选中的那一天 */
function MiniMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border px-3 py-2" title={hint}>
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-0.5 truncate font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

function metricsOf(row: SiteStatRow | undefined, key: string): AccessMetrics {
  return row?.metrics?.[key] ?? EMPTY_METRICS;
}

export default function SiteStatsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-7xl space-y-6">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <SiteStatsContent />
    </Suspense>
  );
}

function SiteStatsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nodeId = searchParams.get("node") || MAIN_NODE;
  const siteName = searchParams.get("site") || "";

  const basePath = nodeId === MAIN_NODE ? "/api/sites" : `/api/nodes/${nodeId}/sites`;

  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    apiGet<{ success: boolean; nodes?: NodeInfo[] }>("/api/nodes/overview")
      .then((data) => {
        if (data.success && data.nodes) setNodes(data.nodes);
      })
      .catch(() => {
        // 拿不到节点列表就只留主节点，不影响统计本身
      });
  }, []);

  const loadOverview = useCallback(async () => {
    const data = await apiGet<OverviewResponse>(`${basePath}/stats/overview`);
    setOverview(data);
  }, [basePath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadOverview();
      // 换节点时不回到骨架屏：留着上一份数据，用刷新按钮的转圈表示在取新的
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOverview]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadOverview();
    } finally {
      setRefreshing(false);
    }
  };

  const setParam = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.push(`/dashboard/sites/stats${query ? `?${query}` : ""}`);
  };

  const ranges = overview?.ranges ?? [];
  const timezone = overview?.timezone ?? null;
  const totals = overview?.totals ?? {};

  /** 今日请求数最多的 5 个站点 */
  const topSites = useMemo(() => {
    const sites = overview?.sites ?? [];
    return [...sites]
      .filter((site) => site.readable)
      .sort((a, b) => metricsOf(b, "today").requests - metricsOf(a, "today").requests)
      .slice(0, 5);
  }, [overview]);

  const backHref = `/dashboard/sites${nodeId === MAIN_NODE ? "" : `?node=${nodeId}`}`;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (siteName) {
    return (
      <SiteRequestsView
        basePath={basePath}
        siteName={siteName}
        ranges={ranges}
        onBack={() => setParam({ site: null, range: null })}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            返回网站管理
          </Link>
          <h1 className="text-2xl leading-8 font-semibold tracking-display">统计总览</h1>
          <p className="text-sm text-muted-foreground">
            来自 nginx 访问日志，只覆盖最近三天
            {timezone && (
              <>
                <span className="mx-1.5 text-mute">·</span>
                <span title={`服务器时区 ${timezone.name || timezone.label}`}>
                  服务器时间 {timezone.label}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {nodes.length > 1 && (
            <Select value={nodeId} onValueChange={(value) => setParam({ node: value, site: null })}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {overview?.success === false ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertCircle className="size-8 text-mute" />
            <p className="text-sm text-muted-foreground">
              {overview.message || "统计读取失败"}
            </p>
          </CardContent>
        </Card>
      ) : !overview?.available ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertCircle className="size-8 text-mute" />
            <p className="text-sm text-muted-foreground">
              没有找到可读的访问日志。检查站点配置里的 access_log 是否开启。
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {METRIC_CARDS.map((card) => {
              const today = totals.today?.[card.key] ?? 0;
              const yesterday = totals.yesterday?.[card.key] ?? 0;
              return (
                <MetricCard
                  key={card.key}
                  label={card.label}
                  hint={card.hint}
                  value={card.format(today)}
                  yesterday={card.format(yesterday)}
                  dayBefore={card.format(totals.dayBefore?.[card.key] ?? 0)}
                  ratio={deltaRatio(today, yesterday)}
                />
              );
            })}
          </div>

          {overview.truncated && (
            <p className="text-xs text-mute">
              有日志体积过大，只统计了文件尾部，数字可能偏小。
            </p>
          )}

          <Card>
            <CardContent className="space-y-3 px-0">
              <div className="flex items-center justify-between gap-3 px-4">
                <span className="eyebrow">今日网站排名 TOP5</span>
                <span className="font-mono text-[11px] text-mute">按请求数排序</span>
              </div>
              {topSites.length === 0 ? (
                <p className="py-12 text-center text-sm text-mute">今日还没有访问记录</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">排名</TableHead>
                      <TableHead>域名</TableHead>
                      <TableHead className="w-[120px]">流量</TableHead>
                      <TableHead className="w-[100px]">请求数</TableHead>
                      <TableHead className="w-[80px]">IP</TableHead>
                      <TableHead className="w-[80px]">UV</TableHead>
                      <TableHead className="w-[80px]">PV</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topSites.map((site, index) => {
                      const today = metricsOf(site, "today");
                      return (
                        <TableRow
                          key={site.name}
                          tabIndex={0}
                          className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                          onClick={() => setParam({ site: site.name })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setParam({ site: site.name });
                            }
                          }}
                        >
                          <TableCell className="font-mono text-xs text-mute">
                            {index + 1}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              <Globe2 className="size-3 shrink-0 text-mute" />
                              {site.domain}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {formatTraffic(today.bytes)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {formatCount(today.requests)}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {formatCount(today.ips)}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {formatCount(today.uv)}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {formatCount(today.pv)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* 全部站点：TOP5 之外的也要能点进去看 */}
          {(overview.sites?.length ?? 0) > topSites.length && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">全部站点</span>
              {(overview.sites ?? []).map((site) => (
                <button
                  key={site.name}
                  type="button"
                  disabled={!site.readable}
                  onClick={() => setParam({ site: site.name })}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  title={site.readable ? `查看 ${site.domain} 的请求日志` : "没有可读的访问日志"}
                >
                  {site.domain}
                  {site.readable && (
                    <span className="font-mono text-mute">
                      {formatCount(metricsOf(site, "today").requests)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SiteRequestsView({
  basePath,
  siteName,
  ranges,
  onBack,
}: {
  basePath: string;
  siteName: string;
  ranges: DayRange[];
  onBack: () => void;
}) {
  const [data, setData] = useState<RequestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [range, setRange] = useState("today");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [statusClass, setStatusClass] = useState(STATUS_ALL);

  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(keywordDraft);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [keywordDraft]);

  /** 翻页点得快时响应可能乱序，只认最后一次 */
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++reqRef.current;
    const params = new URLSearchParams({
      site: siteName,
      range,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (keyword) params.set("keyword", keyword);
    if (statusClass !== STATUS_ALL) params.set("statusClass", statusClass);
    const result = await apiGet<RequestsResponse>(`${basePath}/stats/requests?${params}`);
    if (reqId !== reqRef.current) return;
    setData(result);
    // 后端会把越界页码夹回最后一页
    if (typeof result.page === "number" && result.page !== page) setPage(result.page);
  }, [basePath, siteName, range, page, pageSize, keyword, statusClass]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const timezone: ServerTimezone | null = data?.timezone ?? null;
  const metrics = data?.metrics ?? EMPTY_METRICS;
  const total = data?.total ?? 0;
  const entries = data?.entries ?? [];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const filtersActive = keyword !== "" || statusClass !== STATUS_ALL;
  const rangeOptions = ranges.length > 0 ? ranges : [{ key: "today", label: "今日", from: 0, to: 0 }];

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (data?.success === false) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          返回统计总览
        </button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertCircle className="size-8 text-mute" />
            <p className="text-sm text-muted-foreground">{data.message || "请求日志读取失败"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            返回统计总览
          </button>
          <h1 className="text-2xl leading-8 font-semibold tracking-display">
            {data?.site?.domain || siteName}
          </h1>
          <p className="font-mono text-xs text-mute" title={data?.site?.logPath || ""}>
            {data?.site?.logPath || ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={range}
            onValueChange={(value) => {
              setRange(value);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rangeOptions.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.label}
                </SelectItem>
              ))}
              <SelectItem value="recent">近三天</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {METRIC_CARDS.map((card) => (
          <MiniMetric
            key={card.key}
            label={card.label}
            hint={card.hint}
            value={card.format(metrics[card.key])}
          />
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="eyebrow">请求来源分布</span>
            <span className="font-mono text-[11px] text-mute">
              {data?.range?.label ?? ""} · 点大小表示请求数
            </span>
          </div>
          <RequestMap points={data?.geo ?? []} coverage={data?.geoCoverage} />
        </CardContent>
      </Card>

      {(data?.topPaths?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">热门路径</span>
          {(data?.topPaths ?? []).map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => setKeywordDraft(item.path)}
              className="inline-flex max-w-xs items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              title={`筛选 ${item.path}`}
            >
              <span className="truncate font-mono">{item.path}</span>
              <span className="font-mono text-mute">{formatCount(item.count)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-mute" />
          <Input
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            placeholder="搜索 IP、路径或 User-Agent"
            className="h-8 pl-8"
          />
        </div>
        <Select
          value={statusClass}
          onValueChange={(value) => {
            setStatusClass(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>全部状态</SelectItem>
            <SelectItem value="2">2xx 成功</SelectItem>
            <SelectItem value="3">3xx 跳转</SelectItem>
            <SelectItem value="4">4xx 客户端</SelectItem>
            <SelectItem value="5">5xx 服务端</SelectItem>
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKeywordDraft("");
              setKeyword("");
              setStatusClass(STATUS_ALL);
              setPage(1);
            }}
          >
            <RotateCcw className="size-3.5" />
            重置
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="px-0">
          {entries.length === 0 ? (
            <p className="py-16 text-center text-sm text-mute">
              {filtersActive ? "当前筛选下无记录" : "这个时间段没有请求记录"}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">
                      时间
                      {timezone && <span className="ml-1.5 opacity-70">{timezone.label}</span>}
                    </TableHead>
                    <TableHead className="w-[70px]">状态</TableHead>
                    <TableHead className="w-[140px]">IP 地址</TableHead>
                    <TableHead className="w-[200px]">归属地</TableHead>
                    <TableHead>请求</TableHead>
                    <TableHead className="w-[90px]">流量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry, index) => (
                    <TableRow key={`${entry.timestamp}:${entry.ip}:${index}`}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {formatServerTime(entry.timestamp, timezone)}
                      </TableCell>
                      <TableCell>
                        <span className={`font-mono text-xs ${statusTone(entry.status)}`}>
                          {entry.status}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.ip}</TableCell>
                      <TableCell className="max-w-[200px]">
                        <div className="truncate text-xs" title={entry.locationText}>
                          {entry.locationText || "—"}
                        </div>
                        {entry.location?.isp && (
                          <div
                            className="truncate text-[11px] text-mute"
                            title={entry.location.isp}
                          >
                            {entry.location.isp}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="truncate font-mono text-xs" title={entry.path}>
                          <span className="text-mute">{entry.method} </span>
                          {entry.path}
                        </div>
                        {entry.userAgent && (
                          <div
                            className="truncate text-[11px] text-mute"
                            title={entry.userAgent}
                          >
                            {entry.userAgent}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatTraffic(entry.bytes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
                <span className="font-mono text-[11px] text-mute">
                  第 {rangeStart}-{rangeEnd} 条 / 共 {formatCount(total)} 条
                </span>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger size="sm" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZES.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          每页 {size} 条
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={page <= 1}
                    onClick={() => setPage(1)}
                    aria-label="第一页"
                  >
                    <ChevronsLeft className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    aria-label="上一页"
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {page} / {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={page >= pageCount}
                    onClick={() => setPage(page + 1)}
                    aria-label="下一页"
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={page >= pageCount}
                    onClick={() => setPage(pageCount)}
                    aria-label="最后一页"
                  >
                    <ChevronsRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {data?.truncated && (
        <p className="text-xs text-mute">日志体积过大，只统计了文件尾部，数字可能偏小。</p>
      )}
    </div>
  );
}
