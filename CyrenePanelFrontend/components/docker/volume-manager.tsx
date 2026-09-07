"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Database, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  dockerDelete,
  dockerGet,
  dockerPost,
  formatRelative,
  type ApiResult,
  type DockerVolumeItem,
} from "@/lib/docker-api";

export function VolumeManager({ prefix }: { prefix: string }) {
  const [volumes, setVolumes] = useState<DockerVolumeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dockerGet<{ success: boolean; volumes?: DockerVolumeItem[]; message?: string }>(
        `${prefix}/volumes`,
      );
      if (data.success && data.volumes) {
        setVolumes(data.volumes);
        setSelected(new Set());
      } else {
        toast.error(data.message || "获取存储卷列表失败");
        setVolumes([]);
      }
    } catch {
      toast.error("获取存储卷列表失败");
      setVolumes([]);
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return volumes;
    return volumes.filter((v) => v.name.toLowerCase().includes(kw));
  }, [volumes, keyword]);

  const unusedCount = useMemo(() => volumes.filter((v) => v.usedBy.length === 0).length, [volumes]);
  const allSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.name));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((v) => v.name)));
  };

  const toggleOne = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("请输入存储卷名称");
      return;
    }
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/volumes`, { name: name.trim() });
      if (data.success) {
        toast.success(data.message || "存储卷已创建");
        setCreateOpen(false);
        setName("");
        load();
      } else {
        toast.error(data.message || "创建失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (volume: DockerVolumeItem) => {
    setBusy(true);
    try {
      const data = await dockerDelete<ApiResult>(
        `${prefix}/volumes/${encodeURIComponent(volume.name)}`,
      );
      if (data.success) {
        toast.success(data.message || "存储卷已删除");
        load();
      } else {
        toast.error(data.message || "删除失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult & { failed?: { name: string; message: string }[] }>(
        `${prefix}/volumes/batch-delete`,
        { names: [...selected] },
      );
      if (data.success) toast.success(data.message || "批量删除完成");
      else toast.error(data.failed?.[0]?.message || data.message || "批量删除失败");
      load();
    } finally {
      setBusy(false);
    }
  };

  const handlePrune = async () => {
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/volumes/prune`);
      if (data.success) toast.success(data.message || "清理完成");
      else toast.error(data.message || "清理失败");
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            {volumes.length} 个存储卷
          </span>
          {unusedCount > 0 && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600">
              {unusedCount} 个未使用
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索存储卷"
              className="h-9 w-52 pl-8"
            />
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            创建存储卷
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrune} disabled={busy}>
            <Trash2 className="mr-1.5 h-4 w-4" />
            清理未使用
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2 text-sm">
          <span>已选择 {selected.size} 个存储卷</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
            <Button size="sm" variant="destructive" onClick={handleBatchDelete} disabled={busy}>
              批量删除
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Database className="h-8 w-8 opacity-40" />
              {keyword ? "没有匹配的存储卷" : "暂无存储卷"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 p-3">
                      <Checkbox checked={allSelected} onChange={toggleAll} aria-label="全选" />
                    </th>
                    <th className="p-3 text-left font-medium">名称</th>
                    <th className="p-3 text-left font-medium">驱动</th>
                    <th className="p-3 text-left font-medium">挂载点</th>
                    <th className="p-3 text-left font-medium">创建时间</th>
                    <th className="p-3 text-left font-medium">使用情况</th>
                    <th className="p-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((volume) => (
                    <tr key={volume.name} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <Checkbox
                          checked={selected.has(volume.name)}
                          onChange={() => toggleOne(volume.name)}
                          aria-label={`选择 ${volume.name}`}
                        />
                      </td>
                      <td className="max-w-56 p-3">
                        <div className="truncate font-medium" title={volume.name}>
                          {volume.name}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline">{volume.driver}</Badge>
                      </td>
                      <td className="max-w-72 p-3">
                        <div className="truncate font-mono text-xs text-muted-foreground" title={volume.mountpoint}>
                          {volume.mountpoint || "-"}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatRelative(volume.created)}
                      </td>
                      <td className="p-3">
                        {volume.usedBy.length > 0 ? (
                          <Badge variant="secondary" title={volume.usedBy.join(", ")}>
                            {volume.usedBy.length} 个容器
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">未使用</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            title={
                              volume.usedBy.length > 0
                                ? `被 ${volume.usedBy.join(", ")} 使用中`
                                : "删除"
                            }
                            disabled={busy || volume.usedBy.length > 0}
                            onClick={() => handleDelete(volume)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>创建存储卷</DialogTitle>
            <DialogDescription>
              存储卷由 Docker 管理，容器删除后数据仍然保留
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>名称 *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app-data"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
