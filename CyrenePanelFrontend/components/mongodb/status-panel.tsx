"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  DatabaseBackup,
  Download,
  Gauge,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
  XCircle,
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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_BASE } from "@/lib/api-base";
import {
  formatBytes,
  formatUptime,
  mongoDelete,
  mongoGet,
  mongoPost,
  type ApiResult,
  type MongoBackup,
  type MongoDatabase,
  type MongoOperation,
  type MongoStatus,
} from "@/lib/mongo-api";

export function MongoStatusPanel({ connectionId }: { connectionId: string }) {
  const [tab, setTab] = useState("overview");
  const [status, setStatus] = useState<MongoStatus | null>(null);
  const [operations, setOperations] = useState<MongoOperation[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [backups, setBackups] = useState<MongoBackup[]>([]);
  const [databases, setDatabases] = useState<MongoDatabase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [targetDb, setTargetDb] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<MongoBackup | null>(null);

  const load = useCallback(async () => {
    if (!connectionId) return;
    const [statusRes, opsRes] = await Promise.all([
      mongoGet<{ success: boolean; status?: MongoStatus; message?: string }>(
        `/api/mongodb/status?connectionId=${encodeURIComponent(connectionId)}`,
      ),
      mongoGet<{ success: boolean; operations?: MongoOperation[] }>(
        `/api/mongodb/operations?connectionId=${encodeURIComponent(connectionId)}`,
      ),
    ]);
    if (statusRes.success && statusRes.status) setStatus(statusRes.status);
    else if (statusRes.message) toast.error(statusRes.message);
    if (opsRes.success && opsRes.operations) setOperations(opsRes.operations);
    setLoading(false);
  }, [connectionId]);

  const loadBackups = useCallback(async () => {
    const [backupRes, dbRes] = await Promise.all([
      mongoGet<{ success: boolean; backups?: MongoBackup[] }>(
        `/api/mongodb/backups?connectionId=${encodeURIComponent(connectionId)}`,
      ),
      mongoGet<{ success: boolean; databases?: MongoDatabase[] }>(
        `/api/mongodb/databases?connectionId=${encodeURIComponent(connectionId)}`,
      ),
    ]);
    if (backupRes.success && backupRes.backups) setBackups(backupRes.backups);
    if (dbRes.success && dbRes.databases) setDatabases(dbRes.databases.filter((d) => !d.system));
  }, [connectionId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (tab === "backup") loadBackups();
    if (tab === "users" && users.length === 0) {
      mongoGet<{ success: boolean; users?: any[]; message?: string }>(
        `/api/mongodb/users?connectionId=${encodeURIComponent(connectionId)}`,
      ).then((res) => {
        if (res.success && res.users) setUsers(res.users);
        else if (res.message) toast.error(res.message);
      });
    }
  }, [tab, connectionId, loadBackups, users.length]);

  const handleKill = async (opid: string) => {
    const res = await mongoPost<ApiResult>("/api/mongodb/operations/kill", { connectionId, opid });
    if (res.success) {
      toast.success(res.message || "已终止");
      load();
    } else toast.error(res.message || "终止失败");
  };

  const handleBackup = async () => {
    if (!targetDb) {
      toast.error("请选择数据库");
      return;
    }
    setBusy(true);
    try {
      const res = await mongoPost<ApiResult & { method?: string }>("/api/mongodb/backups", {
        connectionId,
        database: targetDb,
      });
      if (res.success) {
        toast.success(
          res.method === "ejson"
            ? `${res.message}（宿主机无 mongodump，已按集合导出 EJSON）`
            : res.message || "备份完成",
        );
        setCreateOpen(false);
        loadBackups();
      } else toast.error(res.message || "备份失败");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      const res = await mongoPost<ApiResult>("/api/mongodb/backups/restore", {
        connectionId,
        file: restoreTarget.file,
      });
      if (res.success) toast.success(res.message || "恢复完成");
      else toast.error(res.message || "恢复失败");
      setRestoreTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBackup = async (backup: MongoBackup) => {
    const res = await mongoDelete<ApiResult>(
      `/api/mongodb/backups?connectionId=${encodeURIComponent(connectionId)}&file=${encodeURIComponent(backup.file)}`,
    );
    if (res.success) {
      toast.success(res.message || "已删除");
      loadBackups();
    } else toast.error(res.message || "删除失败");
  };

  const handleDownload = (backup: MongoBackup) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    fetch(
      `${API_BASE}/api/mongodb/backups/download?connectionId=${encodeURIComponent(connectionId)}&file=${encodeURIComponent(backup.file)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = backup.file;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => toast.error("下载失败"));
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between">
          <TabsList className="w-fit">
            <TabsTrigger value="overview" className="gap-1.5">
              <Gauge className="h-3.5 w-3.5" />
              运行概览
            </TabsTrigger>
            <TabsTrigger value="operations" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              当前操作
              {operations.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                  {operations.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              用户
            </TabsTrigger>
            <TabsTrigger value="backup" className="gap-1.5">
              <DatabaseBackup className="h-3.5 w-3.5" />
              备份
            </TabsTrigger>
          </TabsList>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-1 pt-4">
          <TabsContent value="overview" className="mt-0 space-y-4">
            {!status ? (
              <div className="py-16 text-center text-sm text-muted-foreground">无法获取运行状态</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{status.version}</Badge>
                  <span className="text-muted-foreground">已运行 {formatUptime(status.uptime)}</span>
                  {status.replicaSet && (
                    <Badge variant="outline">
                      副本集 {status.replicaSet} · {status.isPrimary ? "Primary" : "Secondary"}
                    </Badge>
                  )}
                  <span className="font-mono text-xs text-muted-foreground">{status.host}</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="当前连接" value={String(status.connectionsCurrent)} hint={`可用 ${status.connectionsAvailable}`} />
                  <Metric label="常驻内存" value={`${status.memResident} MB`} hint={`虚拟 ${status.memVirtual} MB`} />
                  <Metric label="累计请求" value={status.networkRequests.toLocaleString()} hint={`入 ${formatBytes(status.networkBytesIn)} / 出 ${formatBytes(status.networkBytesOut)}`} />
                  <Metric label="累计查询" value={status.opQuery.toLocaleString()} hint={`命令 ${status.opCommand.toLocaleString()}`} />
                </div>

                <Card>
                  <CardContent className="p-4">
                    <h4 className="mb-3 text-sm font-medium">操作计数</h4>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
                      <Row label="插入" value={status.opInsert.toLocaleString()} />
                      <Row label="查询" value={status.opQuery.toLocaleString()} />
                      <Row label="更新" value={status.opUpdate.toLocaleString()} />
                      <Row label="删除" value={status.opDelete.toLocaleString()} />
                      <Row label="getmore" value={status.opGetmore.toLocaleString()} />
                      <Row label="命令" value={status.opCommand.toLocaleString()} />
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="operations" className="mt-0">
            <Card>
              <CardContent className="p-0">
                {operations.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">当前没有活动操作</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left font-medium">opid</th>
                        <th className="p-2 text-left font-medium">类型</th>
                        <th className="p-2 text-left font-medium">命名空间</th>
                        <th className="p-2 text-left font-medium">耗时</th>
                        <th className="p-2 text-left font-medium">来源</th>
                        <th className="p-2 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operations.map((op) => (
                        <tr key={op.opid} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-2 font-mono text-xs">{op.opid}</td>
                          <td className="p-2">
                            <Badge variant={op.active ? "secondary" : "outline"}>{op.op}</Badge>
                          </td>
                          <td className="max-w-48 p-2">
                            <div className="truncate font-mono text-xs" title={op.ns}>
                              {op.ns || "-"}
                            </div>
                          </td>
                          <td className={`p-2 ${op.secsRunning > 10 ? "font-medium text-amber-600" : ""}`}>
                            {op.secsRunning}s
                          </td>
                          <td className="p-2 font-mono text-xs text-muted-foreground">{op.client || "-"}</td>
                          <td className="p-2 text-right">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              title="终止操作"
                              onClick={() => handleKill(op.opid)}
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

          <TabsContent value="users" className="mt-0">
            <Card>
              <CardContent className="p-0">
                {users.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    没有用户，或当前账号无权查看
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left font-medium">用户</th>
                        <th className="p-2 text-left font-medium">认证库</th>
                        <th className="p-2 text-left font-medium">角色</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-2 font-medium">{u.user}</td>
                          <td className="p-2">{u.db}</td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-1">
                              {(u.roles || []).map((r: string) => (
                                <Badge key={r} variant="outline" className="text-xs font-normal">
                                  {r}
                                </Badge>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="backup" className="mt-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {backups.length} 个备份 · {formatBytes(backups.reduce((s, b) => s + b.size, 0))}
              </span>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <DatabaseBackup className="mr-1.5 h-4 w-4" />
                立即备份
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {backups.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">还没有备份</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="p-3 text-left font-medium">数据库</th>
                        <th className="p-3 text-left font-medium">格式</th>
                        <th className="p-3 text-left font-medium">大小</th>
                        <th className="p-3 text-left font-medium">创建时间</th>
                        <th className="p-3 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map((b) => (
                        <tr key={b.file} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3 font-medium">{b.database}</td>
                          <td className="p-3">
                            <Badge variant="outline">
                              {b.format === "archive" ? "mongodump" : "EJSON"}
                            </Badge>
                          </td>
                          <td className="p-3">{formatBytes(b.size)}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {new Date(b.createdAt).toLocaleString("zh-CN", { hour12: false })}
                          </td>
                          <td className="p-3">
                            <div className="flex justify-end gap-1">
                              <Button size="icon-sm" variant="ghost" title="下载" onClick={() => handleDownload(b)}>
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button size="icon-sm" variant="ghost" title="恢复" onClick={() => setRestoreTarget(b)}>
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                title="删除"
                                onClick={() => handleDeleteBackup(b)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>立即备份</DialogTitle>
            <DialogDescription>
              有 mongodump 时使用归档格式，否则按集合导出 EJSON
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>选择数据库</Label>
            <Select value={targetDb} onValueChange={setTargetDb}>
              <SelectTrigger>
                <SelectValue placeholder="选择要备份的数据库" />
              </SelectTrigger>
              <SelectContent>
                {databases.map((db) => (
                  <SelectItem key={db.name} value={db.name}>
                    {db.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleBackup} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              开始备份
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>恢复备份</DialogTitle>
            <DialogDescription>
              将用 {restoreTarget?.file} 覆盖数据库 {restoreTarget?.database}，
              备份中包含的集合会先被清空再写入，当前数据将丢失。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleRestore} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              确认恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
