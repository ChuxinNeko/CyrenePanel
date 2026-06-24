"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  RefreshCw,
  Plus,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Filter,
  Pencil,
} from "lucide-react";
import { API_BASE } from "@/lib/api-base";

async function apiGet<T = any>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function apiPost(path: string, body?: any) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiPut(path: string, body?: any) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiDelete(path: string, body?: any) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

interface Column {
  name: string;
  type: number;
}

export function MysqlDataBrowser({
  connectionId,
  database,
  table,
}: {
  connectionId: string;
  database: string;
  table: string;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [orderBy, setOrderBy] = useState("");
  const [orderDir, setOrderDir] = useState<"ASC" | "DESC">("ASC");
  const [whereFilter, setWhereFilter] = useState("");
  const [filterInput, setFilterInput] = useState("");
  const [primaryKeyCol, setPrimaryKeyCol] = useState<string>("");

  // 编辑对话框
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<Record<string, any> | null>(null);
  const [isInsert, setIsInsert] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let url = `/api/mysql/databases/${database}/tables/${table}/data?connectionId=${connectionId}&page=${page}&pageSize=${pageSize}`;
    if (orderBy) url += `&orderBy=${orderBy}&orderDir=${orderDir}`;
    if (whereFilter) url += `&where=${encodeURIComponent(whereFilter)}`;

    const data = await apiGet(url);
    if (data.success) {
      setRows(data.rows || []);
      setColumns(data.columns || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } else {
      toast.error(data.message || "查询失败");
    }
    setLoading(false);
  }, [connectionId, database, table, page, pageSize, orderBy, orderDir, whereFilter]);

  // 获取主键
  useEffect(() => {
    const fetchPK = async () => {
      const data = await apiGet(
        `/api/mysql/databases/${database}/tables/${table}/structure?connectionId=${connectionId}`
      );
      if (data.success && data.columns) {
        const pk = data.columns.find((c: any) => c.key === "PRI");
        if (pk) setPrimaryKeyCol(pk.name);
        else if (data.columns.length > 0) setPrimaryKeyCol(data.columns[0].name);
      }
    };
    fetchPK();
  }, [connectionId, database, table]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [database, table]);

  const handleSort = (col: string) => {
    if (orderBy === col) {
      setOrderDir(orderDir === "ASC" ? "DESC" : "ASC");
    } else {
      setOrderBy(col);
      setOrderDir("ASC");
    }
  };

  const applyFilter = () => {
    setWhereFilter(filterInput);
    setPage(1);
  };

  const openInsert = () => {
    const emptyRow: Record<string, any> = {};
    columns.forEach((c) => { emptyRow[c.name] = ""; });
    setEditRow(emptyRow);
    setIsInsert(true);
    setEditOpen(true);
  };

  const openEdit = (row: any) => {
    setEditRow({ ...row });
    setIsInsert(false);
    setEditOpen(true);
  };

  const handleSaveRow = async () => {
    if (!editRow) return;
    if (isInsert) {
      const data = await apiPost(`/api/mysql/databases/${database}/tables/${table}/data`, {
        connectionId,
        row: editRow,
      });
      if (data.success) {
        toast.success("行已插入");
        setEditOpen(false);
        fetchData();
      } else {
        toast.error(data.message || "插入失败");
      }
    } else {
      const data = await apiPut(`/api/mysql/databases/${database}/tables/${table}/data`, {
        connectionId,
        row: editRow,
        primaryKey: { column: primaryKeyCol, value: editRow[primaryKeyCol] },
      });
      if (data.success) {
        toast.success("行已更新");
        setEditOpen(false);
        fetchData();
      } else {
        toast.error(data.message || "更新失败");
      }
    }
  };

  const handleDeleteRow = async (row: any) => {
    if (!primaryKeyCol) { toast.error("无法确定主键"); return; }
    if (!confirm("确定删除此行？")) return;
    const data = await apiDelete(`/api/mysql/databases/${database}/tables/${table}/data`, {
      connectionId,
      primaryKey: { column: primaryKeyCol, value: row[primaryKeyCol] },
    });
    if (data.success) {
      toast.success("行已删除");
      fetchData();
    } else {
      toast.error(data.message || "删除失败");
    }
  };

  const colNames = columns.length > 0 ? columns.map((c) => c.name) : (rows.length > 0 ? Object.keys(rows[0]) : []);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          刷新
        </Button>
        <Button variant="outline" size="sm" onClick={openInsert}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          插入
        </Button>
        <div className="flex-1" />
        <Input
          className="w-64 h-8 text-xs"
          placeholder="WHERE 条件 (例: id > 10)"
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyFilter()}
        />
        <Button variant="outline" size="sm" onClick={applyFilter}>
          <Filter className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground">
          共 {total} 行 | 第 {page}/{totalPages || 1} 页
        </span>
      </div>

      {/* 数据表格 */}
      <Card className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b">
                    <th className="p-1.5 text-left font-medium w-16">操作</th>
                    {colNames.map((col) => (
                      <th
                        key={col}
                        className="p-1.5 text-left font-medium cursor-pointer hover:bg-muted/50 whitespace-nowrap"
                        onClick={() => handleSort(col)}
                      >
                        <span className="flex items-center gap-1">
                          {col}
                          {orderBy === col && (
                            <ArrowUpDown className="h-3 w-3 text-primary" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="p-1 whitespace-nowrap">
                        <div className="flex gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => handleDeleteRow(row)}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </td>
                      {colNames.map((col) => (
                        <td key={col} className="p-1.5 font-mono max-w-48 truncate" title={String(row[col] ?? "")}>
                          {row[col] === null ? (
                            <span className="text-muted-foreground italic">NULL</span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={colNames.length + 1} className="text-center py-8 text-muted-foreground">
                        无数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </ScrollArea>
      </Card>

      {/* 分页 */}
      <div className="flex items-center justify-center gap-2 shrink-0">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-sm">{page} / {totalPages || 1}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 编辑/插入对话框 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isInsert ? "插入行" : "编辑行"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {editRow && colNames.map((col) => (
              <div key={col} className="grid grid-cols-3 gap-2 items-center">
                <Label className="text-xs font-mono truncate" title={col}>{col}</Label>
                <Input
                  className="col-span-2 h-8 text-xs font-mono"
                  value={editRow[col] ?? ""}
                  onChange={(e) => setEditRow({ ...editRow, [col]: e.target.value || null })}
                  placeholder="NULL"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSaveRow}>{isInsert ? "插入" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}