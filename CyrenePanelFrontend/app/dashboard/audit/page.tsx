"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Users,
  Clock,
  XCircle,
} from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import { useNow } from "@/hooks/use-now";
import {
  categoryMeta,
  displayUsername,
  formatAbsoluteTime,
  formatRelativeTime,
  formatSpan,
  logsToCsv,
  rangeToFrom,
  TIME_RANGES,
  type AuditLogItem,
  type AuditStats,
  type TimeRangeValue,
} from "@/lib/audit";

const PAGE_SIZE = 100;
const ALL = "__all__";

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return res.json();
}

interface NodeOption {
  id: string;
  name: string;
}

/** 顶部统计磁贴 */
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

export default function AuditPage() {
  const now = useNow(30_000);

  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [detail, setDetail] = useState<AuditLogItem | null>(null);

  // 筛选条件。keyword 单独存一份草稿，避免每敲一个字就发请求
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<TimeRangeValue>("7d");
  const [nodeId, setNodeId] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [username, setUsername] = useState(ALL);
  const [result, setResult] = useState(ALL);

  // 输入停顿 400ms 再真正触发查询
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordDraft), 400);
    return () => clearTimeout(timer);
  }, [keywordDraft]);

  /**
   * 时间下界要在一次查询序列里保持不变。
   * 如果每翻一页都重新算「此刻减 7 天」，窗口会持续右移，游标分页就会漏记录。
   * 锚点在 load() 里取一次存进 ref，加载更多时复用同一个值。
   */
  // 初值留 0：load() 必定先于任何查询把它填上，渲染期不读时钟
  const anchorRef = useRef(0);

  const buildQuery = useCallback(
    (anchor: number, before?: number) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      const from = rangeToFrom(range, anchor);
      if (from !== undefined) params.set("from", String(from));
      if (nodeId !== ALL) params.set("nodeId", nodeId);
      if (category !== ALL) params.set("category", category);
      if (username !== ALL) params.set("username", username);
      if (result !== ALL) params.set("success", result === "success" ? "true" : "false");
      if (keyword) params.set("keyword", keyword);
      if (before !== undefined) params.set("before", String(before));
      return params.toString();
    },
    [range, nodeId, category, username, result, keyword]
  );

  const load = useCallback(async () => {
    // 在 effect / 事件回调里读时钟是安全的，渲染期读才违反纯度
    anchorRef.current = Date.now();
    const qs = buildQuery(anchorRef.current);
    const [logRes, statRes] = await Promise.all([
      apiGet<{ success: boolean; logs?: AuditLogItem[]; hasMore?: boolean }>(
        `/api/audit/aggregate?${qs}`
      ),
      apiGet<{ success: boolean; stats?: AuditStats }>(
        `/api/audit/stats/aggregate?${qs}`
      ),
    ]);
    if (logRes.success && logRes.logs) {
      setLogs(logRes.logs);
      setHasMore(Boolean(logRes.hasMore));
    }
    if (statRes.success && statRes.stats) setStats(statRes.stats);
  }, [buildQuery]);

  // 节点列表只拉一次，用来填筛选下拉
  useEffect(() => {
    apiGet<{ success: boolean; nodes?: Array<{ id: string; name: string }> }>(
      "/api/nodes"
    )
      .then((data) => {
        if (data.success && data.nodes) setNodes(data.nodes);
      })
      .catch(() => {
        // 拉不到就只留主节点选项，不影响主流程
      });
  }, []);

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

  const handleLoadMore = async () => {
    const oldest = logs[logs.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const data = await apiGet<{
        success: boolean;
        logs?: AuditLogItem[];
        hasMore?: boolean;
      }>(`/api/audit/aggregate?${buildQuery(anchorRef.current, oldest.timestamp)}`);
      if (data.success && data.logs) {
        // 同一毫秒内的记录可能被两页都取到，按 id 去重
        setLogs((prev) => {
          const seen = new Set(prev.map((l) => l.id));
          return [...prev, ...data.logs!.filter((l) => !seen.has(l.id))];
        });
        setHasMore(Boolean(data.hasMore));
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const handleExport = () => {
    const blob = new Blob([logsToCsv(logs)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `审计日志-${formatAbsoluteTime(Date.now()).replace(/[: ]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setKeywordDraft("");
    setKeyword("");
    setRange("7d");
    setNodeId(ALL);
    setCategory(ALL);
    setUsername(ALL);
    setResult(ALL);
  };

  const filtersActive =
    keyword !== "" ||
    range !== "7d" ||
    nodeId !== ALL ||
    category !== ALL ||
    username !== ALL ||
    result !== ALL;

  const categoryEntries = useMemo(
    () =>
      Object.entries(stats?.byCategory ?? {}).sort((a, b) => b[1] - a[1]),
    [stats]
  );

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-display">审计日志</h1>
          <p className="text-sm text-muted-foreground">
            记录面板上的敏感操作，跨全部节点聚合
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={logs.length === 0}
            title="导出当前已加载的记录"
          >
            <Download className="size-3.5" />
            导出 CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 统计。数字来自服务端整表聚合，不受当前页数限制 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={ShieldAlert}
          label="记录总数"
          value={stats?.total ?? 0}
          sub="当前筛选范围内"
        />
        <StatTile
          icon={XCircle}
          label="失败操作"
          value={stats?.failed ?? 0}
          sub={
            stats && stats.total > 0
              ? `占比 ${((stats.failed / stats.total) * 100).toFixed(1)}%`
              : "—"
          }
        />
        <StatTile
          icon={Users}
          label="涉及用户"
          value={stats?.usernames.length ?? 0}
          sub={stats?.usernames.map(displayUsername).join("、") || "—"}
        />
        <StatTile
          icon={Clock}
          label="时间跨度"
          value={formatSpan(stats?.earliest ?? null, stats?.latest ?? null)}
          sub={
            stats?.earliest
              ? `最早 ${formatAbsoluteTime(stats.earliest).slice(0, 16)}`
              : "—"
          }
        />
      </div>

      {/* 分类分布：既是概览也是快捷筛选 */}
      {categoryEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">分类分布</span>
          {categoryEntries.map(([cat, count]) => {
            const meta = categoryMeta(cat);
            const Icon = meta.icon;
            const active = category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(active ? ALL : cat)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <Icon className="size-3" />
                {meta.label}
                <span className="font-mono opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-mute" />
          <Input
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            placeholder="搜索操作、对象、详情或 IP"
            className="h-8 pl-8"
          />
        </div>

        <Select value={range} onValueChange={(v) => setRange(v as TimeRangeValue)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={nodeId} onValueChange={setNodeId}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部节点</SelectItem>
            <SelectItem value="__main__">主节点</SelectItem>
            {nodes.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                {node.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={username} onValueChange={setUsername}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部用户</SelectItem>
            {(stats?.usernames ?? []).map((u) => (
              <SelectItem key={u} value={u}>
                {displayUsername(u)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={result} onValueChange={setResult}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部结果</SelectItem>
            <SelectItem value="success">仅成功</SelectItem>
            <SelectItem value="failed">仅失败</SelectItem>
          </SelectContent>
        </Select>

        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <RotateCcw className="size-3.5" />
            重置
          </Button>
        )}
      </div>

      {/* 日志表 */}
      <Card>
        <CardContent className="px-0">
          {logs.length === 0 ? (
            <p className="py-16 text-center text-sm text-mute">
              {filtersActive ? "当前筛选下无记录" : "暂无操作记录"}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">时间</TableHead>
                    <TableHead className="w-[110px]">用户</TableHead>
                    <TableHead className="w-[100px]">分类</TableHead>
                    <TableHead className="w-[130px]">操作</TableHead>
                    <TableHead>对象</TableHead>
                    <TableHead className="w-[140px]">节点</TableHead>
                    <TableHead className="w-[120px]">来源 IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const meta = categoryMeta(log.category);
                    const Icon = meta.icon;
                    return (
                      <TableRow
                        key={log.id}
                        tabIndex={0}
                        className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                        onClick={() => setDetail(log)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetail(log);
                          }
                        }}
                      >
                        <TableCell
                          className="font-mono text-xs text-muted-foreground"
                          title={formatAbsoluteTime(log.timestamp)}
                        >
                          {formatRelativeTime(log.timestamp, now)}
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          {displayUsername(log.username)}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Icon className="size-3 shrink-0 text-mute" />
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.success ? (
                            log.action
                          ) : (
                            <StatusDot dot="bg-destructive">{log.action}</StatusDot>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <div className="truncate text-xs" title={log.target}>
                            {log.target || "—"}
                          </div>
                          {log.detail && (
                            <div
                              className="truncate text-[11px] text-mute"
                              title={log.detail}
                            >
                              {log.detail}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="truncate text-xs text-muted-foreground">
                          {log.nodeName}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {log.ip || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between gap-3 px-4 pt-3">
                <span className="font-mono text-[11px] text-mute">
                  已显示 {logs.length}
                  {stats ? ` / ${stats.total}` : ""} 条
                </span>
                {hasMore && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore && <RefreshCw className="size-3.5 animate-spin" />}
                    加载更多
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 详情：列表里 target / detail 会被截断，这里给完整内容 */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.action}
              {detail && (
                <Badge variant={detail.success ? "success" : "destructive"}>
                  {detail.success ? "成功" : "失败"}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {detail ? formatAbsoluteTime(detail.timestamp) : ""}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="divide-y divide-border text-sm">
              {[
                { k: "用户", v: displayUsername(detail.username) },
                { k: "分类", v: categoryMeta(detail.category).label },
                { k: "节点", v: detail.nodeName },
                { k: "来源 IP", v: detail.ip || "—", mono: true },
                { k: "记录 ID", v: detail.id, mono: true },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                >
                  <dt className="shrink-0 text-xs text-muted-foreground">{row.k}</dt>
                  <dd
                    className={`min-w-0 truncate text-right text-xs font-medium ${row.mono ? "font-mono" : ""}`}
                    title={row.v}
                  >
                    {row.v}
                  </dd>
                </div>
              ))}
              <div className="space-y-1.5 py-2.5">
                <dt className="eyebrow">对象</dt>
                <dd className="rounded-md bg-surface-inset px-2.5 py-1.5 font-mono text-xs break-all">
                  {detail.target || "—"}
                </dd>
              </div>
              <div className="space-y-1.5 py-2.5 last:pb-0">
                <dt className="eyebrow">详情</dt>
                <dd className="rounded-md bg-surface-inset px-2.5 py-1.5 font-mono text-xs leading-relaxed break-all">
                  {detail.detail || "—"}
                </dd>
              </div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
