"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  HardDrive,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Tag,
  Trash2,
} from "lucide-react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { API_BASE } from "@/lib/api-base";
import {
  dockerDelete,
  dockerGet,
  dockerPost,
  formatBytes,
  formatRelative,
  type ApiResult,
  type DockerImageDetail,
  type DockerImageItem,
} from "@/lib/docker-api";

export function ImageManager({ prefix }: { prefix: string }) {
  const [images, setImages] = useState<DockerImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // 拉取镜像
  const [pullOpen, setPullOpen] = useState(false);
  const [pullImage, setPullImage] = useState("");
  const [useMirror, setUseMirror] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pullLogs, setPullLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 打标签
  const [tagTarget, setTagTarget] = useState<DockerImageItem | null>(null);
  const [tagValue, setTagValue] = useState("");

  // 详情
  const [detail, setDetail] = useState<DockerImageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dockerGet<{ success: boolean; images?: DockerImageItem[]; message?: string }>(
        `${prefix}/images`,
      );
      if (data.success && data.images) {
        setImages(data.images);
        setSelected(new Set());
      } else {
        toast.error(data.message || "获取镜像列表失败");
        setImages([]);
      }
    } catch {
      toast.error("获取镜像列表失败");
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [pullLogs]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return images;
    return images.filter(
      (img) => img.reference.toLowerCase().includes(kw) || img.id.toLowerCase().includes(kw),
    );
  }, [images, keyword]);

  const totalSize = useMemo(() => images.reduce((sum, i) => sum + i.size, 0), [images]);
  const danglingCount = useMemo(() => images.filter((i) => i.dangling).length, [images]);

  const allSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((i) => i.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── 拉取镜像（SSE 流式进度）──────────────────────────────────────
  const handlePull = async () => {
    const image = pullImage.trim();
    if (!image) {
      toast.error("请输入镜像名称");
      return;
    }

    setPulling(true);
    setPullLogs([`正在拉取 ${image} ...`]);

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const res = await fetch(`${API_BASE}${prefix}/images/pull-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ image, useMirror }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`拉取请求失败（${res.status}）`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk.replace(/^data:\s*/, "").trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "log") {
              setPullLogs((prev) => [...prev, event.line]);
            } else if (event.type === "done") {
              setPullLogs((prev) => [...prev, event.message]);
              if (event.success) {
                toast.success(event.message);
                setPullImage("");
                load();
              } else {
                toast.error(event.message);
              }
            }
          } catch {
            // 忽略无法解析的事件
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "拉取失败";
      setPullLogs((prev) => [...prev, message]);
      toast.error(message);
    } finally {
      setPulling(false);
    }
  };

  const handleDelete = async (image: DockerImageItem, force: boolean) => {
    setBusy(true);
    try {
      const data = await dockerDelete<ApiResult>(
        `${prefix}/images/${encodeURIComponent(image.id)}?force=${force}`,
      );
      if (data.success) {
        toast.success(data.message || "镜像已删除");
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
      const data = await dockerPost<ApiResult & { failed?: { id: string; message: string }[] }>(
        `${prefix}/images/batch-delete`,
        { ids: [...selected], force: false },
      );
      if (data.success) {
        toast.success(data.message || "批量删除完成");
      } else {
        // 部分失败时把首条原因带出来，通常是「仍被容器占用」
        toast.error(data.failed?.[0]?.message || data.message || "批量删除失败");
      }
      load();
    } finally {
      setBusy(false);
    }
  };

  const handlePrune = async (all: boolean) => {
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/images/prune`, { all });
      if (data.success) toast.success(data.message || "清理完成");
      else toast.error(data.message || "清理失败");
      load();
    } finally {
      setBusy(false);
    }
  };

  const handleTag = async () => {
    if (!tagTarget) return;
    const target = tagValue.trim();
    if (!target) {
      toast.error("请输入目标标签");
      return;
    }
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/images/tag`, {
        source: tagTarget.dangling ? tagTarget.id : tagTarget.reference,
        target,
      });
      if (data.success) {
        toast.success(data.message || "已打标签");
        setTagTarget(null);
        setTagValue("");
        load();
      } else {
        toast.error(data.message || "打标签失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (image: DockerImageItem) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await dockerGet<{ success: boolean; image?: DockerImageDetail; message?: string }>(
        `${prefix}/images/${encodeURIComponent(image.id)}/inspect`,
      );
      if (data.success && data.image) setDetail(data.image);
      else toast.error(data.message || "获取详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 概览 + 操作栏 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            {images.length} 个镜像
          </span>
          <Badge variant="secondary">{formatBytes(totalSize)}</Badge>
          {danglingCount > 0 && (
            <Badge variant="outline" className="text-amber-600 border-amber-500/40">
              {danglingCount} 个悬空
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索镜像"
              className="h-9 w-52 pl-8"
            />
          </div>
          <Button size="sm" onClick={() => setPullOpen(true)}>
            <Download className="mr-1.5 h-4 w-4" />
            拉取镜像
          </Button>
          <Button size="sm" variant="outline" onClick={() => handlePrune(false)} disabled={busy}>
            <Trash2 className="mr-1.5 h-4 w-4" />
            清理悬空
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2 text-sm">
          <span>已选择 {selected.size} 个镜像</span>
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

      {/* 列表 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Layers className="h-8 w-8 opacity-40" />
              {keyword ? "没有匹配的镜像" : "暂无本地镜像"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 p-3">
                      <Checkbox checked={allSelected} onChange={toggleAll} aria-label="全选" />
                    </th>
                    <th className="p-3 text-left font-medium">镜像</th>
                    <th className="p-3 text-left font-medium">ID</th>
                    <th className="p-3 text-left font-medium">大小</th>
                    <th className="p-3 text-left font-medium">创建时间</th>
                    <th className="p-3 text-left font-medium">状态</th>
                    <th className="p-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((image) => (
                    <tr key={image.id} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <Checkbox
                          checked={selected.has(image.id)}
                          onChange={() => toggleOne(image.id)}
                          aria-label={`选择 ${image.reference}`}
                        />
                      </td>
                      <td className="p-3">
                        <div className="font-medium">
                          {image.dangling ? (
                            <span className="text-muted-foreground">&lt;none&gt;</span>
                          ) : (
                            image.repository
                          )}
                        </div>
                        {!image.dangling && (
                          <div className="text-xs text-muted-foreground">{image.tag}</div>
                        )}
                      </td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">
                        {image.id.replace(/^sha256:/, "").slice(0, 12)}
                      </td>
                      <td className="p-3">{image.sizeText || formatBytes(image.size)}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatRelative(image.created)}
                      </td>
                      <td className="p-3">
                        {image.usedBy > 0 ? (
                          <Badge variant="secondary">{image.usedBy} 个容器使用中</Badge>
                        ) : image.dangling ? (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                            悬空
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">未使用</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="详情"
                            onClick={() => openDetail(image)}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="打标签"
                            onClick={() => {
                              setTagTarget(image);
                              setTagValue(image.dangling ? "" : image.reference);
                            }}
                          >
                            <Tag className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title={image.usedBy > 0 ? "被容器使用，需强制删除" : "删除"}
                            className="text-destructive hover:text-destructive"
                            disabled={busy}
                            onClick={() => handleDelete(image, image.usedBy > 0)}
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

      {/* 拉取镜像 */}
      <Dialog open={pullOpen} onOpenChange={(open) => !pulling && setPullOpen(open)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>拉取镜像</DialogTitle>
            <DialogDescription>
              输入完整镜像名，例如 nginx:alpine 或 registry.example.com/team/app:v1
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>镜像名称</Label>
              <Input
                value={pullImage}
                onChange={(e) => setPullImage(e.target.value)}
                placeholder="nginx:alpine"
                disabled={pulling}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !pulling) handlePull();
                }}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <div className="text-sm font-medium">使用镜像加速</div>
                <div className="text-xs text-muted-foreground">
                  通过设置中配置的加速地址拉取，完成后会自动改回原始标签
                </div>
              </div>
              <Switch checked={useMirror} onCheckedChange={setUseMirror} disabled={pulling} />
            </div>

            {pullLogs.length > 0 && (
              <ScrollArea className="h-56 rounded-lg border bg-muted/30 p-3">
                <div className="space-y-0.5 font-mono text-xs">
                  {pullLogs.map((line, i) => (
                    <div key={i} className="break-all text-muted-foreground">
                      {line}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </ScrollArea>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPullOpen(false)} disabled={pulling}>
              关闭
            </Button>
            <Button onClick={handlePull} disabled={pulling || !pullImage.trim()}>
              {pulling ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  拉取中
                </>
              ) : (
                "开始拉取"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 打标签 */}
      <Dialog open={!!tagTarget} onOpenChange={(open) => !open && setTagTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>为镜像打标签</DialogTitle>
            <DialogDescription>
              源镜像：{tagTarget?.dangling ? tagTarget.id.slice(0, 12) : tagTarget?.reference}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>目标标签</Label>
            <Input
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder="myapp:v1.0"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagTarget(null)}>
              取消
            </Button>
            <Button onClick={handleTag} disabled={busy}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情 */}
      <Dialog open={detailLoading || !!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>镜像详情</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : detail ? (
            <div className="space-y-4 text-sm">
              <DetailRow label="标签" value={detail.repoTags.join(", ") || "-"} />
              <DetailRow label="ID" value={detail.id} mono />
              <DetailRow label="大小" value={formatBytes(detail.size)} />
              <DetailRow label="系统 / 架构" value={`${detail.os} / ${detail.architecture}`} />
              <DetailRow label="创建时间" value={formatRelative(detail.created)} />
              {detail.dockerVersion && <DetailRow label="构建版本" value={detail.dockerVersion} />}
              {detail.workingDir && <DetailRow label="工作目录" value={detail.workingDir} mono />}
              {detail.entrypoint.length > 0 && (
                <DetailRow label="Entrypoint" value={detail.entrypoint.join(" ")} mono />
              )}
              {detail.cmd.length > 0 && <DetailRow label="Cmd" value={detail.cmd.join(" ")} mono />}
              {detail.exposedPorts.length > 0 && (
                <DetailRow label="暴露端口" value={detail.exposedPorts.join(", ")} />
              )}
              {detail.volumes.length > 0 && (
                <DetailRow label="数据卷" value={detail.volumes.join(", ")} mono />
              )}
              {detail.env.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">环境变量</div>
                  <ScrollArea className="max-h-40 rounded-lg border bg-muted/30 p-2">
                    <div className="space-y-0.5 font-mono text-xs">
                      {detail.env.map((line, i) => (
                        <div key={i} className="break-all">
                          {line}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
              <DetailRow label="层数" value={String(detail.layers.length)} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}
