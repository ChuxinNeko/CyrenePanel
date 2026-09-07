"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  DatabaseBackup,
  Loader2,
  RefreshCw,
  RotateCcw,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { API_BASE } from "@/lib/api-base";

interface BackupItem {
  file: string;
  database: string;
  size: number;
  createdAt: string;
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

export function MysqlBackupManager({ connectionId }: { connectionId: string }) {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [targetDb, setTargetDb] = useState("");

  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);

  const load = useCallback(async () => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const [backupRes, dbRes] = await Promise.all([
        call<{ success: boolean; backups?: BackupItem[]; message?: string }>(
          `/api/mysql/backups?connectionId=${encodeURIComponent(connectionId)}`,
        ),
        call<{ success: boolean; databases?: { name: string }[] | string[] }>(
          `/api/mysql/databases?connectionId=${encodeURIComponent(connectionId)}`,
        ),
      ]);

      if (backupRes.success && backupRes.backups) setBackups(backupRes.backups);
      else if (backupRes.message) toast.error(backupRes.message);

      if (dbRes.success && dbRes.databases) {
        // 库列表接口可能返回字符串数组或对象数组，两种都兼容
        const names = (dbRes.databases as any[]).map((d) =>
          typeof d === "string" ? d : d.name,
        );
        setDatabases(names.filter(Boolean));
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!targetDb) {
      toast.error("请选择要备份的数据库");
      return;
    }
    setBusy(true);
    try {
      const res = await call<{ success: boolean; message?: string; method?: string }>(
        "/api/mysql/backups",
        { method: "POST", body: JSON.stringify({ connectionId, database: targetDb }) },
      );
      if (res.success) {
        toast.success(
          res.method === "sql"
            ? `${res.message}（宿主机无 mysqldump，已通过数据库连接生成）`
            : res.message || "备份完成",
        );
        setCreateOpen(false);
        load();
      } else {
        toast.error(res.message || "备份失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      const res = await call<{ success: boolean; message?: string }>(
        "/api/mysql/backups/restore",
        {
          method: "POST",
          body: JSON.stringify({ connectionId, file: restoreTarget.file }),
        },
      );
      if (res.success) {
        toast.success(res.message || "恢复完成");
        setRestoreTarget(null);
      } else {
        toast.error(res.message || "恢复失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await call<{ success: boolean; message?: string }>(
        `/api/mysql/backups?connectionId=${encodeURIComponent(connectionId)}&file=${encodeURIComponent(deleteTarget.file)}`,
        { method: "DELETE" },
      );
      if (res.success) {
        toast.success(res.message || "已删除");
        setDeleteTarget(null);
        load();
      } else {
        toast.error(res.message || "删除失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = (backup: BackupItem) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    // 下载走浏览器直连，需要把 token 放在查询串上
    const url = `${API_BASE}/api/mysql/backups/download?connectionId=${encodeURIComponent(
      connectionId,
    )}&file=${encodeURIComponent(backup.file)}`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = backup.file;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => toast.error("下载失败"));
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <DatabaseBackup className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{backups.length} 个备份</span>
          <Badge variant="secondary">
            {formatBytes(backups.reduce((sum, b) => sum + b.size, 0))}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <DatabaseBackup className="mr-1.5 h-4 w-4" />
            立即备份
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Card className="min-h-0 flex-1 overflow-hidden p-0">
        <CardContent className="h-full overflow-auto p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <DatabaseBackup className="h-8 w-8 opacity-40" />
              还没有备份
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 text-left font-medium">数据库</th>
                  <th className="p-3 text-left font-medium">文件</th>
                  <th className="p-3 text-left font-medium">大小</th>
                  <th className="p-3 text-left font-medium">创建时间</th>
                  <th className="p-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.file} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{b.database}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{b.file}</td>
                    <td className="p-3">{formatBytes(b.size)}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(b.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="下载"
                          onClick={() => handleDownload(b)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="恢复"
                          onClick={() => setRestoreTarget(b)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          title="删除"
                          onClick={() => setDeleteTarget(b)}
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

      {/* 新建备份 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>立即备份</DialogTitle>
            <DialogDescription>
              备份文件保存在面板数据目录下，gzip 压缩存储
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
                  <SelectItem key={db} value={db}>
                    {db}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              开始备份
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 恢复确认 */}
      <Dialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>恢复备份</DialogTitle>
            <DialogDescription>
              将用 {restoreTarget?.file} 覆盖数据库 {restoreTarget?.database}。
              备份中的表会先被 DROP 再重建，当前数据将全部丢失且无法撤销。
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

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除备份</DialogTitle>
            <DialogDescription>确定删除 {deleteTarget?.file} 吗？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
