"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eraser, Loader2, RefreshCw, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { API_BASE } from "@/lib/api-base";

interface TableSize {
  name: string;
  engine: string;
  rows: number;
  dataSize: number;
  indexSize: number;
  freeSize: number;
  totalSize: number;
  collation: string;
  updatedAt: string | null;
}

interface MaintResult {
  table: string;
  operation: string;
  type: string;
  message: string;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: authHeaders() });
  return res.json();
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const ACTIONS = [
  { value: "optimize", label: "优化表", hint: "重建表并回收碎片空间" },
  { value: "analyze", label: "分析表", hint: "更新索引统计信息，改善执行计划" },
  { value: "check", label: "检查表", hint: "检查表是否存在错误" },
  { value: "repair", label: "修复表", hint: "仅对 MyISAM 等引擎有效" },
];

export function MysqlMaintenancePanel({ connectionId }: { connectionId: string }) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState("");
  const [tables, setTables] = useState<TableSize[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [results, setResults] = useState<MaintResult[] | null>(null);
  const [truncateOpen, setTruncateOpen] = useState(false);

  useEffect(() => {
    if (!connectionId) return;
    call<{ success: boolean; databases?: any[] }>(
      `/api/mysql/databases?connectionId=${encodeURIComponent(connectionId)}`,
    ).then((res) => {
      if (res.success && res.databases) {
        const names = res.databases.map((d: any) => (typeof d === "string" ? d : d.name));
        setDatabases(names.filter(Boolean));
      }
    });
  }, [connectionId]);

  const loadTables = useCallback(async () => {
    if (!connectionId || !database) return;
    setLoading(true);
    try {
      const res = await call<{ success: boolean; tables?: TableSize[]; message?: string }>(
        `/api/mysql/sizes?connectionId=${encodeURIComponent(connectionId)}&database=${encodeURIComponent(database)}`,
      );
      if (res.success && res.tables) {
        setTables(res.tables);
        setSelected(new Set());
      } else {
        toast.error(res.message || "获取表信息失败");
        setTables([]);
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  const totals = useMemo(
    () => ({
      size: tables.reduce((s, t) => s + t.totalSize, 0),
      free: tables.reduce((s, t) => s + t.freeSize, 0),
      rows: tables.reduce((s, t) => s + t.rows, 0),
    }),
    [tables],
  );

  const allSelected = tables.length > 0 && tables.every((t) => selected.has(t.name));

  const runAction = async (action: string) => {
    if (selected.size === 0) {
      toast.error("请先选择数据表");
      return;
    }
    setBusy(true);
    try {
      const res = await call<{ success: boolean; message?: string; results?: MaintResult[] }>(
        "/api/mysql/maintenance",
        {
          method: "POST",
          body: JSON.stringify({ connectionId, database, action, tables: [...selected] }),
        },
      );
      if (res.success) {
        toast.success(res.message || "操作完成");
        setResults(res.results || []);
        loadTables();
      } else {
        toast.error(res.message || "操作失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTruncate = async () => {
    setBusy(true);
    try {
      const res = await call<{ success: boolean; message?: string }>(
        "/api/mysql/maintenance/truncate",
        {
          method: "POST",
          body: JSON.stringify({ connectionId, database, tables: [...selected] }),
        },
      );
      if (res.success) toast.success(res.message || "已清空");
      else toast.error(res.message || "清空失败");
      setTruncateOpen(false);
      loadTables();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Select value={database} onValueChange={setDatabase}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="选择数据库" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db} value={db}>
                {db}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {tables.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{tables.length} 张表</span>
            <Badge variant="secondary">{formatBytes(totals.size)}</Badge>
            {totals.free > 0 && (
              <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                碎片 {formatBytes(totals.free)}
              </Badge>
            )}
            <span>约 {totals.rows.toLocaleString()} 行</span>
          </div>
        )}

        <Button size="sm" variant="ghost" onClick={loadTables} disabled={loading || !database}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-2">
          <span className="text-sm">已选择 {selected.size} 张表</span>
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <Button
                key={a.value}
                size="sm"
                variant="outline"
                title={a.hint}
                disabled={busy}
                onClick={() => runAction(a.value)}
              >
                <Wrench className="mr-1.5 h-3.5 w-3.5" />
                {a.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setTruncateOpen(true)}
            >
              <Eraser className="mr-1.5 h-3.5 w-3.5" />
              清空数据
            </Button>
          </div>
        </div>
      )}

      <Card className="min-h-0 flex-1 overflow-hidden p-0">
        <CardContent className="h-full overflow-auto p-0">
          {!database ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              请先选择一个数据库
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : tables.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">该库没有数据表</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 p-3">
                    <Checkbox
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(tables.map((t) => t.name)))
                      }
                      aria-label="全选"
                    />
                  </th>
                  <th className="p-3 text-left font-medium">表名</th>
                  <th className="p-3 text-left font-medium">引擎</th>
                  <th className="p-3 text-right font-medium">行数</th>
                  <th className="p-3 text-right font-medium">数据</th>
                  <th className="p-3 text-right font-medium">索引</th>
                  <th className="p-3 text-right font-medium">碎片</th>
                  <th className="p-3 text-left font-medium">字符序</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.name} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox
                        checked={selected.has(t.name)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(t.name)) next.delete(t.name);
                            else next.add(t.name);
                            return next;
                          })
                        }
                        aria-label={`选择 ${t.name}`}
                      />
                    </td>
                    <td className="p-3 font-medium">{t.name}</td>
                    <td className="p-3">
                      <Badge variant="outline">{t.engine || "-"}</Badge>
                    </td>
                    <td className="p-3 text-right">{t.rows.toLocaleString()}</td>
                    <td className="p-3 text-right">{formatBytes(t.dataSize)}</td>
                    <td className="p-3 text-right">{formatBytes(t.indexSize)}</td>
                    <td
                      className={`p-3 text-right ${t.freeSize > 1024 * 1024 ? "text-amber-600" : "text-muted-foreground"}`}
                    >
                      {formatBytes(t.freeSize)}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{t.collation || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* 维护结果 */}
      <Dialog open={!!results} onOpenChange={(open) => !open && setResults(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>维护结果</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-96">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">表</th>
                  <th className="p-2 text-left font-medium">操作</th>
                  <th className="p-2 text-left font-medium">结果</th>
                </tr>
              </thead>
              <tbody>
                {(results || []).map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-2 font-mono text-xs">{r.table}</td>
                    <td className="p-2">{r.operation}</td>
                    <td className="p-2">
                      <span
                        className={
                          r.type === "status" && r.message === "OK"
                            ? "text-emerald-600"
                            : r.type === "error"
                              ? "text-destructive"
                              : ""
                        }
                      >
                        {r.message}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* 清空确认 */}
      <Dialog open={truncateOpen} onOpenChange={setTruncateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>清空数据表</DialogTitle>
            <DialogDescription>
              将执行 TRUNCATE 清空选中的 {selected.size} 张表，表结构保留但
              <span className="font-medium text-destructive">所有数据会被永久删除</span>
              ，且不可回滚。请确认已有备份。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTruncateOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleTruncate} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              确认清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
