"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@iconify/react";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { TaskLogEntry } from "@/lib/task-store";

export interface GameApp {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: string;
  defaultCommand: string;
  defaultEnv: Record<string, string>;
  downloadUrl?: string;
}

export interface NodeItem {
  id: string;
  name: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 1 ? 0 : 1)} ${units[exponent - 1]}`;
}

export function DeployGameDialog({
  app,
  open,
  onOpenChange,
  onDeploy,
  deploying,
  deployLog,
  nodes,
}: {
  app: GameApp | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeploy: (config: { name: string; cwd: string; nodeId: string }) => Promise<void>;
  deploying: boolean;
  deployLog: TaskLogEntry[];
  nodes: NodeItem[];
}) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [nodeId, setNodeId] = useState("__main__");

  useEffect(() => {
    if (app) {
      setName(`${app.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}-${Math.floor(Math.random() * 1000)}`);
      setCwd(`/opt/games/${app.id}`);
      setNodeId("__main__");
    }
  }, [app]);

  const downloadProgress = useMemo(
    () => [...deployLog].reverse().find((entry) => entry.stage === "download" && entry.downloadedBytes !== undefined),
    [deployLog],
  );
  const latestMessage = deployLog[deployLog.length - 1]?.message || "正在连接部署服务...";
  const percent = downloadProgress?.totalBytes
    ? Math.min((downloadProgress.downloadedBytes! / downloadProgress.totalBytes) * 100, 100)
    : undefined;

  if (!app) return null;

  const handleDeploy = () => {
    onDeploy({ name, cwd, nodeId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon icon={app.icon} className="w-6 h-6" />
            部署 {app.name}
          </DialogTitle>
          <DialogDescription>
            {app.description}
          </DialogDescription>
        </DialogHeader>

          {deploying ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="truncate">{latestMessage}</span>
              </div>
              {downloadProgress && (
                <div className="space-y-1.5">
                  {percent !== undefined ? (
                    <Progress value={percent} />
                  ) : (
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                    </div>
                  )}
                  <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
                    <span>
                      已下载 {formatBytes(downloadProgress.downloadedBytes || 0)}
                      {downloadProgress.totalBytes ? ` / ${formatBytes(downloadProgress.totalBytes)}` : ""}
                      {percent !== undefined ? ` (${Math.floor(percent)}%)` : ""}
                    </span>
                    {downloadProgress.speedBytes !== undefined && (
                      <span>{formatBytes(downloadProgress.speedBytes)}/s</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">实例名称</Label>
            <Input
              className="col-span-3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={deploying}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">部署节点</Label>
            <Select value={nodeId} onValueChange={setNodeId} disabled={deploying}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="选择节点" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__main__">主节点 (本机)</SelectItem>
                {nodes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">安装路径 (CWD)</Label>
            <Input
              className="col-span-3"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              disabled={deploying}
              placeholder="/opt/games/my-server"
            />
          </div>
            </div>
          )}

        <DialogFooter>
          {deploying ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              后台运行
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={handleDeploy} disabled={!name || !cwd}>
                开始部署
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
