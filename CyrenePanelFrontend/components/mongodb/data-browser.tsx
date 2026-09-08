"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import Editor from "@monaco-editor/react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Eraser,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  extractId,
  formatBytes,
  mongoDelete,
  mongoGet,
  mongoPost,
  type ApiResult,
  type MongoCollection,
  type MongoDatabase,
  type MongoIndex,
} from "@/lib/mongo-api";

export function MongoDataBrowser({ connectionId }: { connectionId: string }) {
  const { resolvedTheme } = useTheme();
  const editorTheme = resolvedTheme === "dark" ? "vs-dark" : "light";

  const [databases, setDatabases] = useState<MongoDatabase[]>([]);
  const [activeDb, setActiveDb] = useState<string | null>(null);
  const [collections, setCollections] = useState<MongoCollection[]>([]);
  const [activeColl, setActiveColl] = useState<string | null>(null);

  const [loadingDbs, setLoadingDbs] = useState(true);
  const [loadingColls, setLoadingColls] = useState(false);
  const [busy, setBusy] = useState(false);

  // 文档查询
  const [filter, setFilter] = useState("{}");
  const [sort, setSort] = useState("{}");
  const [docs, setDocs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [querying, setQuerying] = useState(false);
  const pageSize = 20;

  // 文档编辑
  const [editDoc, setEditDoc] = useState<{ id: string; text: string } | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertText, setInsertText] = useState('{\n  \n}');

  // 索引
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexes, setIndexes] = useState<MongoIndex[]>([]);
  const [newIndexKeys, setNewIndexKeys] = useState('{"field": 1}');
  const [newIndexUnique, setNewIndexUnique] = useState(false);

  // 新建/删除
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const [newDbColl, setNewDbColl] = useState("");
  const [createCollOpen, setCreateCollOpen] = useState(false);
  const [newCollName, setNewCollName] = useState("");
  const [dropTarget, setDropTarget] = useState<{ kind: "db" | "coll"; name: string } | null>(null);
  const [truncateTarget, setTruncateTarget] = useState<string | null>(null);

  const loadDatabases = useCallback(async () => {
    if (!connectionId) return;
    setLoadingDbs(true);
    try {
      const res = await mongoGet<{ success: boolean; databases?: MongoDatabase[]; message?: string }>(
        `/api/mongodb/databases?connectionId=${encodeURIComponent(connectionId)}`,
      );
      if (res.success && res.databases) setDatabases(res.databases);
      else toast.error(res.message || "获取数据库失败");
    } finally {
      setLoadingDbs(false);
    }
  }, [connectionId]);

  const loadCollections = useCallback(
    async (db: string) => {
      setLoadingColls(true);
      try {
        const res = await mongoGet<{ success: boolean; collections?: MongoCollection[]; message?: string }>(
          `/api/mongodb/databases/${encodeURIComponent(db)}/collections?connectionId=${encodeURIComponent(connectionId)}`,
        );
        if (res.success && res.collections) setCollections(res.collections);
        else {
          toast.error(res.message || "获取集合失败");
          setCollections([]);
        }
      } finally {
        setLoadingColls(false);
      }
    },
    [connectionId],
  );

  const runQuery = useCallback(
    async (targetPage = page) => {
      if (!activeDb || !activeColl) return;
      setQuerying(true);
      try {
        const res = await mongoPost<{
          success: boolean;
          documents?: any[];
          total?: number;
          message?: string;
        }>("/api/mongodb/documents/find", {
          connectionId,
          database: activeDb,
          collection: activeColl,
          filter,
          sort,
          limit: pageSize,
          skip: targetPage * pageSize,
        });

        if (res.success) {
          setDocs(res.documents || []);
          setTotal(res.total || 0);
          setPage(targetPage);
        } else {
          toast.error(res.message || "查询失败");
        }
      } finally {
        setQuerying(false);
      }
    },
    [activeDb, activeColl, connectionId, filter, sort, page],
  );

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  useEffect(() => {
    if (activeDb) loadCollections(activeDb);
    setActiveColl(null);
    setDocs([]);
  }, [activeDb, loadCollections]);

  useEffect(() => {
    if (activeColl) {
      setFilter("{}");
      setPage(0);
      runQuery(0);
    }
    // runQuery 依赖 filter/page，这里只想在切集合时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeColl]);

  const openIndexes = async () => {
    if (!activeDb || !activeColl) return;
    setIndexOpen(true);
    const res = await mongoGet<{ success: boolean; indexes?: MongoIndex[]; message?: string }>(
      `/api/mongodb/databases/${encodeURIComponent(activeDb)}/collections/${encodeURIComponent(activeColl)}/indexes?connectionId=${encodeURIComponent(connectionId)}`,
    );
    if (res.success && res.indexes) setIndexes(res.indexes);
    else toast.error(res.message || "获取索引失败");
  };

  const handleCreateIndex = async () => {
    if (!activeDb || !activeColl) return;
    setBusy(true);
    try {
      const res = await mongoPost<ApiResult>(
        `/api/mongodb/databases/${encodeURIComponent(activeDb)}/collections/${encodeURIComponent(activeColl)}/indexes`,
        { connectionId, keys: newIndexKeys, unique: newIndexUnique },
      );
      if (res.success) {
        toast.success(res.message || "索引已创建");
        openIndexes();
      } else toast.error(res.message || "创建索引失败");
    } finally {
      setBusy(false);
    }
  };

  const handleDropIndex = async (name: string) => {
    if (!activeDb || !activeColl) return;
    const res = await mongoDelete<ApiResult>(
      `/api/mongodb/databases/${encodeURIComponent(activeDb)}/collections/${encodeURIComponent(activeColl)}/indexes/${encodeURIComponent(name)}?connectionId=${encodeURIComponent(connectionId)}`,
    );
    if (res.success) {
      toast.success(res.message || "索引已删除");
      openIndexes();
    } else toast.error(res.message || "删除失败");
  };

  const handleSaveDoc = async () => {
    if (!editDoc || !activeDb || !activeColl) return;
    setBusy(true);
    try {
      const res = await mongoPost<ApiResult>("/api/mongodb/documents/update", {
        connectionId,
        database: activeDb,
        collection: activeColl,
        id: editDoc.id,
        document: editDoc.text,
      });
      if (res.success) {
        toast.success(res.message || "已更新");
        setEditDoc(null);
        runQuery();
      } else toast.error(res.message || "更新失败");
    } finally {
      setBusy(false);
    }
  };

  const handleInsert = async () => {
    if (!activeDb || !activeColl) return;
    setBusy(true);
    try {
      const res = await mongoPost<ApiResult>("/api/mongodb/documents/insert", {
        connectionId,
        database: activeDb,
        collection: activeColl,
        document: insertText,
      });
      if (res.success) {
        toast.success(res.message || "已插入");
        setInsertOpen(false);
        setInsertText('{\n  \n}');
        runQuery();
      } else toast.error(res.message || "插入失败");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDoc = async (doc: any) => {
    if (!activeDb || !activeColl) return;
    const id = extractId(doc);
    if (!id) {
      toast.error("该文档没有可识别的 _id，无法单条删除");
      return;
    }
    const res = await mongoPost<ApiResult>("/api/mongodb/documents/delete", {
      connectionId,
      database: activeDb,
      collection: activeColl,
      id,
    });
    if (res.success) {
      toast.success(res.message || "已删除");
      runQuery();
    } else toast.error(res.message || "删除失败");
  };

  const handleCreateDb = async () => {
    setBusy(true);
    try {
      const res = await mongoPost<ApiResult>("/api/mongodb/databases", {
        connectionId,
        name: newDbName.trim(),
        collection: newDbColl.trim(),
      });
      if (res.success) {
        toast.success(res.message || "已创建");
        setCreateDbOpen(false);
        setNewDbName("");
        setNewDbColl("");
        loadDatabases();
      } else toast.error(res.message || "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateColl = async () => {
    if (!activeDb) return;
    setBusy(true);
    try {
      const res = await mongoPost<ApiResult>(
        `/api/mongodb/databases/${encodeURIComponent(activeDb)}/collections`,
        { connectionId, name: newCollName.trim() },
      );
      if (res.success) {
        toast.success(res.message || "已创建");
        setCreateCollOpen(false);
        setNewCollName("");
        loadCollections(activeDb);
      } else toast.error(res.message || "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async () => {
    if (!dropTarget) return;
    setBusy(true);
    try {
      const res =
        dropTarget.kind === "db"
          ? await mongoDelete<ApiResult>(
              `/api/mongodb/databases/${encodeURIComponent(dropTarget.name)}?connectionId=${encodeURIComponent(connectionId)}`,
            )
          : await mongoDelete<ApiResult>(
              `/api/mongodb/databases/${encodeURIComponent(activeDb!)}/collections/${encodeURIComponent(dropTarget.name)}?connectionId=${encodeURIComponent(connectionId)}`,
            );
      if (res.success) {
        toast.success(res.message || "已删除");
        setDropTarget(null);
        if (dropTarget.kind === "db") {
          setActiveDb(null);
          loadDatabases();
        } else {
          setActiveColl(null);
          loadCollections(activeDb!);
        }
      } else toast.error(res.message || "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const handleTruncate = async () => {
    if (!truncateTarget || !activeDb) return;
    setBusy(true);
    try {
      const res = await mongoPost<ApiResult>(
        `/api/mongodb/databases/${encodeURIComponent(activeDb)}/collections/${encodeURIComponent(truncateTarget)}/truncate`,
        { connectionId },
      );
      if (res.success) {
        toast.success(res.message || "已清空");
        setTruncateTarget(null);
        loadCollections(activeDb);
        runQuery(0);
      } else toast.error(res.message || "清空失败");
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex h-full gap-4">
      {/* 左：数据库与集合 */}
      <Card className="flex w-64 shrink-0 flex-col overflow-hidden p-0">
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">
            {activeDb ? activeDb : "数据库"}
          </span>
          <div className="flex gap-0.5">
            {activeDb && (
              <Button size="icon-sm" variant="ghost" title="返回库列表" onClick={() => setActiveDb(null)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              title={activeDb ? "新建集合" : "新建数据库"}
              onClick={() => (activeDb ? setCreateCollOpen(true) : setCreateDbOpen(true))}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="刷新"
              onClick={() => (activeDb ? loadCollections(activeDb) : loadDatabases())}
            >
              <RefreshCw className={`h-4 w-4 ${loadingDbs || loadingColls ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {!activeDb ? (
            loadingDbs ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
            ) : (
              databases.map((db) => (
                <div
                  key={db.name}
                  className="group flex cursor-pointer items-center justify-between border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/60"
                  onClick={() => setActiveDb(db.name)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{db.name}</span>
                    {db.system && <Badge variant="outline" className="px-1 py-0 text-[10px]">系统</Badge>}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(db.sizeOnDisk)}
                  </span>
                </div>
              ))
            )
          ) : loadingColls ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : collections.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">该库没有集合</div>
          ) : (
            collections.map((c) => (
              <div
                key={c.name}
                className={`flex cursor-pointer items-center justify-between border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/60 ${
                  activeColl === c.name ? "bg-muted" : ""
                }`}
                onClick={() => setActiveColl(c.name)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.name}</span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.count.toLocaleString()}
                </span>
              </div>
            ))
          )}
        </ScrollArea>

        {activeDb && (
          <div className="shrink-0 border-t p-2">
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => setDropTarget({ kind: "db", name: activeDb })}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              删除该数据库
            </Button>
          </div>
        )}
      </Card>

      {/* 右：文档 */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {!activeColl ? (
          <Card className="flex flex-1 items-center justify-center">
            <div className="text-sm text-muted-foreground">
              {activeDb ? "从左侧选择一个集合" : "从左侧选择数据库"}
            </div>
          </Card>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {activeDb}.{activeColl}
              </Badge>
              <span className="text-sm text-muted-foreground">{total.toLocaleString()} 条文档</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={openIndexes}>
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  索引
                </Button>
                <Button size="sm" variant="outline" onClick={() => setInsertOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  插入
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setTruncateTarget(activeColl)}
                >
                  <Eraser className="mr-1.5 h-3.5 w-3.5" />
                  清空
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDropTarget({ kind: "coll", name: activeColl })}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  删除集合
                </Button>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder='查询条件，如 {"status": "active"}'
                className="font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") runQuery(0);
                }}
              />
              <Input
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                placeholder='排序，如 {"_id": -1}'
                className="w-52 font-mono text-xs"
              />
              <Button size="sm" onClick={() => runQuery(0)} disabled={querying}>
                {querying ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                )}
                查询
              </Button>
            </div>

            <Card className="min-h-0 flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                {docs.length === 0 ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    {querying ? "查询中..." : "没有匹配的文档"}
                  </div>
                ) : (
                  <div className="divide-y">
                    {docs.map((doc, i) => {
                      const id = extractId(doc);
                      return (
                        <div key={id || i} className="group p-3 hover:bg-muted/30">
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="font-mono text-xs text-muted-foreground">
                              _id: {id || "(无)"}
                            </span>
                            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title="编辑"
                                onClick={() =>
                                  setEditDoc({ id, text: JSON.stringify(doc, null, 2) })
                                }
                              >
                                <Play className="h-3.5 w-3.5 rotate-90" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                title="删除"
                                onClick={() => handleDeleteDoc(doc)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                            {JSON.stringify(doc, null, 2)}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </Card>

            <div className="flex shrink-0 items-center justify-between text-sm text-muted-foreground">
              <span>
                第 {page + 1} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0 || querying}
                  onClick={() => runQuery(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= totalPages || querying}
                  onClick={() => runQuery(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 编辑文档 */}
      <Dialog open={!!editDoc} onOpenChange={(open) => !open && setEditDoc(null)}>
        <DialogContent className="flex h-[70vh] flex-col gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-5 py-3">
            <DialogTitle>编辑文档</DialogTitle>
            <DialogDescription className="font-mono text-xs">_id: {editDoc?.id}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language="json"
              theme={editorTheme}
              value={editDoc?.text || ""}
              onChange={(v) => setEditDoc((prev) => (prev ? { ...prev, text: v ?? "" } : prev))}
              options={{ minimap: { enabled: false }, fontSize: 12, automaticLayout: true }}
            />
          </div>
          <DialogFooter className="border-t px-5 py-3">
            <Button variant="outline" onClick={() => setEditDoc(null)}>
              取消
            </Button>
            <Button onClick={handleSaveDoc} disabled={busy}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 插入文档 */}
      <Dialog open={insertOpen} onOpenChange={setInsertOpen}>
        <DialogContent className="flex h-[70vh] flex-col gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-5 py-3">
            <DialogTitle>插入文档</DialogTitle>
            <DialogDescription>
              支持单个对象或数组批量插入，可用 {"{"}"$oid": "..."{"}"} 等扩展类型
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language="json"
              theme={editorTheme}
              value={insertText}
              onChange={(v) => setInsertText(v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 12, automaticLayout: true }}
            />
          </div>
          <DialogFooter className="border-t px-5 py-3">
            <Button variant="outline" onClick={() => setInsertOpen(false)}>
              取消
            </Button>
            <Button onClick={handleInsert} disabled={busy}>
              插入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 索引管理 */}
      <Dialog open={indexOpen} onOpenChange={setIndexOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>索引管理</DialogTitle>
            <DialogDescription>
              {activeDb}.{activeColl}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <ScrollArea className="max-h-64 rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left font-medium">名称</th>
                    <th className="p-2 text-left font-medium">字段</th>
                    <th className="p-2 text-left font-medium">属性</th>
                    <th className="p-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {indexes.map((idx) => (
                    <tr key={idx.name} className="border-b last:border-0">
                      <td className="p-2 font-mono text-xs">{idx.name}</td>
                      <td className="p-2 font-mono text-xs text-muted-foreground">
                        {JSON.stringify(idx.keys)}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          {idx.unique && <Badge variant="outline">唯一</Badge>}
                          {idx.sparse && <Badge variant="outline">稀疏</Badge>}
                          {idx.expireAfterSeconds !== undefined && (
                            <Badge variant="outline">TTL {idx.expireAfterSeconds}s</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={idx.name === "_id_"}
                          title={idx.name === "_id_" ? "主键索引不可删除" : "删除"}
                          onClick={() => handleDropIndex(idx.name)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            <div className="space-y-2 rounded-lg border p-3">
              <Label className="text-sm">新建索引</Label>
              <Input
                value={newIndexKeys}
                onChange={(e) => setNewIndexKeys(e.target.value)}
                placeholder='{"field": 1}  1 升序 / -1 降序'
                className="font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newIndexUnique}
                    onChange={(e) => setNewIndexUnique(e.target.checked)}
                  />
                  唯一索引
                </label>
                <Button size="sm" onClick={handleCreateIndex} disabled={busy}>
                  创建
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 新建数据库 */}
      <Dialog open={createDbOpen} onOpenChange={setCreateDbOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建数据库</DialogTitle>
            <DialogDescription>
              MongoDB 的空库不会被保存，因此需要同时指定一个初始集合
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>数据库名</Label>
              <Input value={newDbName} onChange={(e) => setNewDbName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>初始集合名</Label>
              <Input value={newDbColl} onChange={(e) => setNewDbColl(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDbOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateDb} disabled={busy}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建集合 */}
      <Dialog open={createCollOpen} onOpenChange={setCreateCollOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建集合</DialogTitle>
            <DialogDescription>在 {activeDb} 中创建</DialogDescription>
          </DialogHeader>
          <Input
            value={newCollName}
            onChange={(e) => setNewCollName(e.target.value)}
            placeholder="集合名"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateCollOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateColl} disabled={busy}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!dropTarget} onOpenChange={(open) => !open && setDropTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              删除{dropTarget?.kind === "db" ? "数据库" : "集合"}
            </DialogTitle>
            <DialogDescription>
              将永久删除 {dropTarget?.name} 及其中的全部数据，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDropTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDrop} disabled={busy}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 清空确认 */}
      <Dialog open={!!truncateTarget} onOpenChange={(open) => !open && setTruncateTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>清空集合</DialogTitle>
            <DialogDescription>
              将删除 {truncateTarget} 中的全部文档，索引保留。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTruncateTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleTruncate} disabled={busy}>
              确认清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
