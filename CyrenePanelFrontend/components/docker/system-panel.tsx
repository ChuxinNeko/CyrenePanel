"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  CircleCheck,
  CircleX,
  HardDrive,
  Info,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  dockerGet,
  dockerPost,
  formatBytes,
  type ApiResult,
  type DockerDaemonStatus,
  type DockerDiskItem,
  type DockerVersionInfo,
} from "@/lib/docker-api";

const DISK_TYPE_LABELS: Record<string, string> = {
  Images: "镜像",
  Containers: "容器",
  "Local Volumes": "本地存储卷",
  "Build Cache": "构建缓存",
};

export function DockerSystemPanel({ prefix, isRemote }: { prefix: string; isRemote: boolean }) {
  const [version, setVersion] = useState<DockerVersionInfo | null>(null);
  const [disk, setDisk] = useState<{ items: DockerDiskItem[]; totalSize: number; totalReclaimable: number } | null>(null);
  const [daemon, setDaemon] = useState<DockerDaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneAll, setPruneAll] = useState(false);
  const [pruneVolumes, setPruneVolumes] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [versionRes, diskRes, daemonRes] = await Promise.all([
        dockerGet<{ success: boolean; version?: DockerVersionInfo; message?: string }>(`${prefix}/version`),
        dockerGet<{ success: boolean; items?: DockerDiskItem[]; totalSize?: number; totalReclaimable?: number; message?: string }>(
          `${prefix}/system/df`,
        ),
        // 远程节点的守护进程管理走的是子节点自身的 systemd，主节点这里只读状态
        dockerGet<{ success: boolean; daemon?: DockerDaemonStatus; message?: string }>(
          `${prefix}/daemon/status`,
        ),
      ]);

      setVersion(versionRes.success ? versionRes.version ?? null : null);
      setDisk(
        diskRes.success
          ? {
              items: diskRes.items ?? [],
              totalSize: diskRes.totalSize ?? 0,
              totalReclaimable: diskRes.totalReclaimable ?? 0,
            }
          : null,
      );
      setDaemon(daemonRes.success ? daemonRes.daemon ?? null : null);
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDaemonAction = async (action: string) => {
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/daemon/${action}`);
      if (data.success) {
        toast.success(data.message || "操作成功");
        // 守护进程重启需要时间，稍等再刷新状态
        setTimeout(load, 2000);
      } else {
        toast.error(data.message || "操作失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePrune = async () => {
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/system/prune`, {
        all: pruneAll,
        volumes: pruneVolumes,
      });
      if (data.success) toast.success(data.message || "清理完成");
      else toast.error(data.message || "清理失败");
      setPruneOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          刷新
        </Button>
      </div>

      {/* 守护进程 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Docker 服务
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!daemon ? (
            <p className="text-sm text-muted-foreground">
              无法获取服务状态（该系统可能未使用 systemd 管理 Docker）
            </p>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                {daemon.active ? (
                  <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                    <CircleCheck className="h-3.5 w-3.5" />
                    运行中
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <CircleX className="h-3.5 w-3.5" />
                    {daemon.activeState}
                  </Badge>
                )}
                <Badge variant={daemon.enabled ? "secondary" : "outline"}>
                  {daemon.enabled ? "已开机自启" : "未开机自启"}
                </Badge>
                {daemon.since && (
                  <span className="text-xs text-muted-foreground">启动于 {daemon.since}</span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || daemon.active}
                  onClick={() => handleDaemonAction("start")}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  启动
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !daemon.active}
                  onClick={() => handleDaemonAction("restart")}
                >
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                  重启
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={busy || !daemon.active}
                  onClick={() => handleDaemonAction("stop")}
                >
                  <Square className="mr-1.5 h-3.5 w-3.5" />
                  停止
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleDaemonAction(daemon.enabled ? "disable" : "enable")}
                >
                  {daemon.enabled ? "取消自启" : "设为自启"}
                </Button>
              </div>
            </div>
          )}
          {isRemote && (
            <p className="mt-3 text-xs text-muted-foreground">
              当前操作的是远程节点上的 Docker 服务，停止后该节点的容器将全部不可用。
            </p>
          )}
        </CardContent>
      </Card>

      {/* 磁盘占用 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4" />
              磁盘占用
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setPruneOpen(true)} disabled={busy}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              全局清理
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!disk ? (
            <p className="text-sm text-muted-foreground">无法获取磁盘占用信息</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <div>
                  <span className="text-2xl font-semibold">{formatBytes(disk.totalSize)}</span>
                  <span className="ml-2 text-sm text-muted-foreground">总占用</span>
                </div>
                {disk.totalReclaimable > 0 && (
                  <div className="text-sm text-amber-600">
                    可回收 {formatBytes(disk.totalReclaimable)}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {disk.items.map((item) => {
                  const percent = disk.totalSize > 0 ? (item.size / disk.totalSize) * 100 : 0;
                  return (
                    <div key={item.type} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {DISK_TYPE_LABELS[item.type] || item.type}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {item.active}/{item.totalCount} 使用中
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {item.sizeText}
                          {item.reclaimable > 0 && (
                            <span className="ml-2 text-amber-600">可回收 {item.reclaimableText}</span>
                          )}
                        </span>
                      </div>
                      <Progress value={percent} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 版本信息 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" />
            版本信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!version ? (
            <p className="text-sm text-muted-foreground">无法获取版本信息</p>
          ) : (
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <VersionField label="Docker 服务端" value={version.serverVersion} highlight />
              <VersionField label="Docker 客户端" value={version.clientVersion} />
              <VersionField label="Compose" value={version.composeVersion || "未安装"} />
              <VersionField label="API 版本" value={version.serverApiVersion} />
              <VersionField label="最低 API 版本" value={version.serverMinApiVersion} />
              <VersionField label="Go 版本" value={version.serverGoVersion} />
              <VersionField label="系统 / 架构" value={`${version.serverOs} / ${version.serverArch}`} />
              <VersionField label="内核" value={version.serverKernel} />
              <VersionField label="构建时间" value={version.buildTime?.slice(0, 19).replace("T", " ")} />
            </div>
          )}

          {version && version.components.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <div className="mb-2 text-xs font-medium text-muted-foreground">组件</div>
              <div className="flex flex-wrap gap-2">
                {version.components.map((c) => (
                  <Badge key={c.name} variant="outline" className="font-normal">
                    {c.name} {c.version}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 全局清理确认 */}
      <Dialog open={pruneOpen} onOpenChange={setPruneOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>全局清理</DialogTitle>
            <DialogDescription>
              默认清理已停止的容器、未被使用的网络、悬空镜像和构建缓存。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">同时清理未使用的镜像</div>
                <div className="text-xs text-muted-foreground">
                  不只是悬空镜像，所有没有容器在用的镜像都会被删除
                </div>
              </div>
              <Switch checked={pruneAll} onCheckedChange={setPruneAll} />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border border-destructive/30 p-3">
              <div>
                <div className="text-sm font-medium text-destructive">同时清理存储卷</div>
                <div className="text-xs text-muted-foreground">
                  未被容器使用的存储卷会被删除，其中的数据将永久丢失
                </div>
              </div>
              <Switch checked={pruneVolumes} onCheckedChange={setPruneVolumes} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPruneOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handlePrune} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              确认清理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VersionField({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={highlight ? "text-base font-semibold" : "text-sm"}>{value || "-"}</div>
    </div>
  );
}
