"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status-dot";
import { AuditTabs } from "@/components/audit-tabs";
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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Globe2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  UserCheck,
  XCircle,
} from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import { useNow } from "@/hooks/use-now";
import {
  formatRelativeTime,
  formatServerTime,
  type ServerTimezone,
} from "@/lib/audit";

const ALL = "__all__";
const PAGE_SIZES = [20, 50, 100];
/** 导出一次最多取多少条。后端 pageSize 上限是 500，留出余量 */
const EXPORT_LIMIT = 300;

interface SshEntry {
  id: string;
  timestamp: number;
  user: string;
  ip: string;
  port: number | null;
  method: string;
  success: boolean;
  reason: string;
  location: { country: string; province: string; city: string; isp: string } | null;
  locationText: string;
}

interface SshStats {
  total: number;
  success: number;
  failed: number;
  uniqueIps: number;
}

/** 失败次数最多的来源，后端按全量算好，翻页时不跟着变 */
interface SshOffender {
  ip: string;
  count: number;
  locationText: string;
}

interface SshResponse {
  success?: boolean;
  message?: string;
  source?: string;
  stats?: SshStats | null;
  entries?: SshEntry[];
  total?: number;
  page?: number;
  pageSize?: number;
  topOffenders?: SshOffender[];
  timezone?: ServerTimezone | null;
}

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

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

/** 导出当前筛选下的记录。字段里可能含逗号，按 RFC4180 转义 */
function toCsv(rows: SshEntry[], tz: ServerTimezone | null): string {
  const headers = ["时间", "用户", "IP 地址", "端口", "归属地", "运营商", "认证方式", "状态", "说明"];
  const escape = (v: string) => {
    const guarded = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  const body = rows.map((r) =>
    [
      formatServerTime(r.timestamp, tz),
      r.user,
      r.ip,
      r.port === null ? "" : String(r.port),
      r.locationText,
      r.location?.isp ?? "",
      r.method,
      r.success ? "成功" : "失败",
      r.reason,
    ]
      .map((c) => escape(String(c ?? "")))
      .join(","),
  );
  return `﻿${headers.map(escape).join(",")}\n${body.join("\n")}`;
}

export default function SshAuditPage() {
  const now = useNow(30_000);

  const [entries, setEntries] = useState<SshEntry[]>([]);
  const [stats, setStats] = useState<SshStats | null>(null);
  const [topOffenders, setTopOffenders] = useState<SshOffender[]>([]);
  const [timezone, setTimezone] = useState<ServerTimezone | null>(null);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  // 输入停顿 400ms 再查，避免每敲一个字打一次接口。换了关键词就回第一页
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(keywordDraft);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [keywordDraft]);

  const buildParams = useCallback(
    (targetPage: number, size: number) => {
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(size),
      });
      if (status !== ALL) params.set("status", status);
      if (keyword) params.set("keyword", keyword);
      return params;
    },
    [status, keyword],
  );

  /** 翻页点得快时响应可能乱序到达，只认最后一次发出的请求 */
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++reqRef.current;
    const res = await fetch(
      `${API_BASE}/api/audit/ssh?${buildParams(page, pageSize)}`,
      { headers: authHeaders() },
    );
    const data: SshResponse = await res.json();
    if (reqId !== reqRef.current) return;

    if (data?.success) {
      setEntries(data.entries ?? []);
      setStats(data.stats ?? null);
      setTopOffenders(data.topOffenders ?? []);
      setTimezone(data.timezone ?? null);
      setTotal(Number(data.total) || 0);
      setSource(data.source ?? "");
      setMessage(data.message ?? "");
      // 后端会把越界页码夹回最后一页，跟上它，否则页码和内容对不上
      if (typeof data.page === "number" && data.page !== page) setPage(data.page);
    } else {
      setMessage(data?.message || "获取 SSH 日志失败");
    }
  }, [buildParams, page, pageSize]);

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

  // 导出走一次单独的请求，否则只能导出当前这一页
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/audit/ssh?${buildParams(1, EXPORT_LIMIT)}`,
        { headers: authHeaders() },
      );
      const data: SshResponse = await res.json();
      const rows = data?.success ? (data.entries ?? []) : null;
      if (!rows || rows.length === 0) {
        toast.error(data?.message || "导出失败");
        return;
      }
      const blob = new Blob([toCsv(rows, timezone)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SSH登录日志-${formatServerTime(Date.now(), timezone).replace(/[: ]/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (total > rows.length) {
        toast.success(`已导出最近 ${rows.length} 条（共 ${total} 条）`);
      }
    } catch {
      toast.error("导出失败");
    } finally {
      setExporting(false);
    }
  };

  const filtersActive = keyword !== "" || status !== ALL;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

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
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const unavailable = source === "none";

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-display">审计日志</h1>
          <p className="text-sm text-muted-foreground">
            SSH 登录记录，来自系统日志
            {source && source !== "none" && (
              <>
                <span className="mx-1.5 text-mute">·</span>
                <span className="font-mono text-xs">{source}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || total === 0}
            title={`导出当前筛选下最近 ${EXPORT_LIMIT} 条`}
          >
            {exporting ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            导出 CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      <AuditTabs />

      {unavailable ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertCircle className="size-8 text-mute" />
            <p className="text-sm text-muted-foreground">{message || "当前系统无可读的 SSH 日志"}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              icon={ShieldAlert}
              label="登录记录"
              value={stats?.total ?? 0}
              sub="日志中的全部认证结论"
            />
            <StatTile
              icon={UserCheck}
              label="登录成功"
              value={stats?.success ?? 0}
              sub={
                stats && stats.total > 0
                  ? `占比 ${((stats.success / stats.total) * 100).toFixed(1)}%`
                  : "—"
              }
            />
            <StatTile
              icon={XCircle}
              label="登录失败"
              value={stats?.failed ?? 0}
              sub={
                stats && stats.failed > 0 ? "含暴力破解尝试" : "无失败记录"
              }
            />
            <StatTile
              icon={Globe2}
              label="来源 IP"
              value={stats?.uniqueIps ?? 0}
              sub="去重后的独立地址数"
            />
          </div>

          {/* 失败最多的来源，爆破一眼可见 */}
          {topOffenders.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">失败最多的来源</span>
              {topOffenders.map((offender) => (
                <button
                  key={offender.ip}
                  type="button"
                  onClick={() => setKeywordDraft(offender.ip)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  title={`筛选 ${offender.ip}`}
                >
                  <span className="font-mono">{offender.ip}</span>
                  {offender.locationText && (
                    <span className="text-mute">{offender.locationText}</span>
                  )}
                  <span className="font-mono text-destructive">{offender.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* 筛选条 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-mute" />
              <Input
                value={keywordDraft}
                onChange={(e) => setKeywordDraft(e.target.value)}
                placeholder="搜索 IP、用户或认证方式"
                className="h-8 pl-8"
              />
            </div>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部状态</SelectItem>
                <SelectItem value="success">仅成功</SelectItem>
                <SelectItem value="failed">仅失败</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setKeywordDraft("");
                  setKeyword("");
                  setStatus(ALL);
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
                  {filtersActive ? "当前筛选下无记录" : "暂无 SSH 登录记录"}
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className="w-[180px]"
                          title={
                            timezone
                              ? `服务器时区 ${timezone.name || timezone.label}`
                              : undefined
                          }
                        >
                          时间
                          {timezone && (
                            <span className="ml-1.5 opacity-70">{timezone.label}</span>
                          )}
                        </TableHead>
                        <TableHead className="w-[100px]">状态</TableHead>
                        <TableHead className="w-[110px]">用户</TableHead>
                        <TableHead className="w-[150px]">IP 地址</TableHead>
                        <TableHead className="w-[80px]">端口</TableHead>
                        <TableHead>归属地</TableHead>
                        <TableHead className="w-[110px]">认证方式</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry) => (
                        <TableRow key={`${entry.ip}:${entry.timestamp}:${entry.id}`}>
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {formatServerTime(entry.timestamp, timezone)}
                            <div className="text-[11px] text-mute">
                              {formatRelativeTime(entry.timestamp, now)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusDot
                              dot={entry.success ? "bg-success" : "bg-destructive"}
                            >
                              {entry.success ? "成功" : "失败"}
                            </StatusDot>
                          </TableCell>
                          <TableCell className="text-xs font-medium">{entry.user}</TableCell>
                          <TableCell className="font-mono text-xs">{entry.ip}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {entry.port ?? "—"}
                          </TableCell>
                          <TableCell className="max-w-[280px]">
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
                          <TableCell className="text-xs text-muted-foreground">
                            <div className="font-mono">{entry.method}</div>
                            {entry.reason && (
                              <div className="text-[11px] text-mute">{entry.reason}</div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* 分页。日志动辄几千条，一次铺满页面既拖慢渲染也不好定位 */}
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
                    <span className="font-mono text-[11px] text-mute">
                      第 {rangeStart}-{rangeEnd} 条 / 共 {total} 条
                    </span>
                    <div className="flex items-center gap-2">
                      <Select
                        value={String(pageSize)}
                        onValueChange={(v) => {
                          setPageSize(Number(v));
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
        </>
      )}
    </div>
  );
}
