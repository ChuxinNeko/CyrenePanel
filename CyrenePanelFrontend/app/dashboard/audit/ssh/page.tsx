"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/audit";

const ALL = "__all__";

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

/** 导出当前已加载的结果。字段里可能含逗号，按 RFC4180 转义 */
function toCsv(rows: SshEntry[]): string {
  const headers = ["时间", "用户", "IP 地址", "端口", "归属地", "运营商", "认证方式", "状态", "说明"];
  const escape = (v: string) => {
    const guarded = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  const body = rows.map((r) =>
    [
      formatAbsoluteTime(r.timestamp),
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
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState(ALL);

  // 输入停顿 400ms 再查，避免每敲一个字打一次接口
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordDraft), 400);
    return () => clearTimeout(timer);
  }, [keywordDraft]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "300" });
    if (status !== ALL) params.set("status", status);
    if (keyword) params.set("keyword", keyword);
    const res = await fetch(`${API_BASE}/api/audit/ssh?${params}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (data?.success) {
      setEntries(data.entries ?? []);
      setStats(data.stats ?? null);
      setSource(data.source ?? "");
      setMessage(data.message ?? "");
    } else {
      setMessage(data?.message || "获取 SSH 日志失败");
    }
  }, [status, keyword]);

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

  const handleExport = () => {
    const blob = new Blob([toCsv(entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SSH登录日志-${formatAbsoluteTime(Date.now()).replace(/[: ]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtersActive = keyword !== "" || status !== ALL;

  /** 失败次数最多的来源 IP，用来一眼看出是否在被爆破 */
  const topOffenders = useMemo(() => {
    const counts = new Map<string, { count: number; location: string }>();
    for (const e of entries) {
      if (e.success) continue;
      const prev = counts.get(e.ip);
      counts.set(e.ip, {
        count: (prev?.count ?? 0) + 1,
        location: e.locationText || prev?.location || "",
      });
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
  }, [entries]);

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
            disabled={entries.length === 0}
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
              {topOffenders.map(([ip, info]) => (
                <button
                  key={ip}
                  type="button"
                  onClick={() => setKeywordDraft(ip)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  title={`筛选 ${ip}`}
                >
                  <span className="font-mono">{ip}</span>
                  {info.location && <span className="text-mute">{info.location}</span>}
                  <span className="font-mono text-destructive">{info.count}</span>
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
            <Select value={status} onValueChange={setStatus}>
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
                        <TableHead className="w-[130px]">时间</TableHead>
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
                          <TableCell
                            className="font-mono text-xs text-muted-foreground"
                            title={formatAbsoluteTime(entry.timestamp)}
                          >
                            {formatRelativeTime(entry.timestamp, now)}
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

                  <div className="px-4 pt-3">
                    <span className="font-mono text-[11px] text-mute">
                      已显示 {entries.length}
                      {stats ? ` / ${stats.total}` : ""} 条
                    </span>
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
