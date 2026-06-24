"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Database,
  Table,
  RefreshCw,
  Plus,
  Trash2,
  Loader2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import { MysqlTableStructure } from "@/components/mysql/table-structure";
import { MysqlDataBrowser } from "@/components/mysql/data-browser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

async function apiDelete(path: string, query?: string) {
  const token = localStorage.getItem("token");
  const url = query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

interface TableInfo {
  name: string;
  rows: number;
  size: number;
  comment: string;
  engine: string;
  collation: string;
}

export function MysqlDatabaseBrowser({ connectionId }: { connectionId: string }) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedDb, setExpandedDb] = useState<string | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<{ db: string; table: string } | null>(null);
  const [tableTab, setTableTab] = useState("data");
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [newDbName, setNewDbName] = useState("");

  const fetchDatabases = useCallback(async () => {
    if (!connectionId) return;
    setLoading(true);
    const data = await apiGet(`/api/mysql/databases?connectionId=${connectionId}`);
    if (data.success) setDatabases(data.databases);
    else toast.error(data.message || "获取数据库列表失败");
    setLoading(false);
  }, [connectionId]);

  useEffect(() => {
    fetchDatabases();
    setExpandedDb(null);
    setSelectedTable(null);
  }, [connectionId, fetchDatabases]);

  const fetchTables = async (db: string) => {
    setTablesLoading(true);
    const data = await apiGet(`/api/mysql/databases/${db}/tables?connectionId=${connectionId}`);
    if (data.success) setTables(data.tables);
    else toast.error(data.message || "获取表列表失败");
    setTablesLoading(false);
  };

  const toggleDb = (db: string) => {
    if (expandedDb === db) {
      setExpandedDb(null);
    } else {
      setExpandedDb(db);
      fetchTables(db);
    }
  };

  const handleCreateDb = async () => {
    if (!newDbName.trim()) return;
    const data = await apiPost("/api/mysql/databases", { connectionId, name: newDbName.trim() });
    if (data.success) {
      toast.success("数据库已创建");
      setCreateDbOpen(false);
      setNewDbName("");
      fetchDatabases();
    } else {
      toast.error(data.message || "创建失败");
    }
  };

  const handleDropDb = async (db: string) => {
    if (!confirm(`确定要删除数据库 "${db}" 吗？此操作不可恢复！`)) return;
    const data = await apiDelete(`/api/mysql/databases/${db}`, `connectionId=${connectionId}`);
    if (data.success) {
      toast.success("数据库已删除");
      if (expandedDb === db) setExpandedDb(null);
      if (selectedTable?.db === db) setSelectedTable(null);
      fetchDatabases();
    } else {
      toast.error(data.message || "删除失败");
    }
  };

  const handleDropTable = async (db: string, table: string) => {
    if (!confirm(`确定要删除表 "${table}" 吗？此操作不可恢复！`)) return;
    const data = await apiDelete(
      `/api/mysql/databases/${db}/tables/${table}`,
      `connectionId=${connectionId}`
    );
    if (data.success) {
      toast.success("表已删除");
      if (selectedTable?.table === table) setSelectedTable(null);
      fetchTables(db);
    } else {
      toast.error(data.message || "删除失败");
    }
  };

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* 左侧数据库/表树 */}
      <Card className="w-72 shrink-0 flex flex-col">
        <div className="flex items-center justify-between p-3 border-b">
          <span className="text-sm font-medium">数据库</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchDatabases}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCreateDbOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              databases.map((db) => (
                <div key={db}>
                  <div
                    className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-muted cursor-pointer group text-sm"
                    onClick={() => toggleDb(db)}
                  >
                    {expandedDb === db ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <Database className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <span className="truncate flex-1">{db}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); handleDropDb(db); }}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                  {expandedDb === db && (
                    <div className="ml-5 space-y-0.5">
                      {tablesLoading ? (
                        <div className="flex justify-center py-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                        </div>
                      ) : tables.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-2 py-1">无表</p>
                      ) : (
                        tables.map((t) => (
                          <div
                            key={t.name}
                            className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer group text-sm ${
                              selectedTable?.db === db && selectedTable?.table === t.name
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-muted"
                            }`}
                            onClick={() => { setSelectedTable({ db, table: t.name }); setTableTab("data"); }}
                          >
                            <Table className="h-3 w-3 shrink-0 text-orange-500" />
                            <span className="truncate flex-1">{t.name}</span>
                            <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                              {t.rows ?? "?"}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 opacity-0 group-hover:opacity-100"
                              onClick={(e) => { e.stopPropagation(); handleDropTable(db, t.name); }}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </Card>

      {/* 右侧内容区 */}
      <div className="flex-1 min-w-0">
        {selectedTable ? (
          <Tabs value={tableTab} onValueChange={setTableTab} className="h-full flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-lg font-semibold">
                {selectedTable.db}.{selectedTable.table}
              </h2>
              <TabsList>
                <TabsTrigger value="data">数据</TabsTrigger>
                <TabsTrigger value="structure">结构</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="data" className="flex-1 min-h-0 mt-0">
              <MysqlDataBrowser
                connectionId={connectionId}
                database={selectedTable.db}
                table={selectedTable.table}
              />
            </TabsContent>
            <TabsContent value="structure" className="flex-1 min-h-0 mt-0">
              <MysqlTableStructure
                connectionId={connectionId}
                database={selectedTable.db}
                table={selectedTable.table}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center text-muted-foreground">
              <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>选择左侧的表以查看数据</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 创建数据库对话框 */}
      <Dialog open={createDbOpen} onOpenChange={setCreateDbOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建数据库</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="数据库名称"
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateDb()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDbOpen(false)}>取消</Button>
            <Button onClick={handleCreateDb}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}