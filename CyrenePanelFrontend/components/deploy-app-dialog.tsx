"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

import { Loader2, Plus, Trash2, CheckCircle2, XCircle, ArrowDown } from "lucide-react";

export interface DeployLogEntry {
  type: "stage" | "progress" | "done" | "error";
  message?: string;
  stage?: string;
  layer?: string;
  status?: string;
  detail?: string;
}

export interface StoreApp {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  image: string;
  defaultPorts: { container: number; host?: number; protocol: string; label?: string }[];
  defaultVolumes: { container: string; host?: string; label?: string }[];
  defaultEnv: { name: string; value: string; label?: string; required?: boolean }[];
  note?: string;
  restart?: string;
  networkMode?: string;
}

interface DeployConfig {
  name: string;
  ports: { hostPort: number; containerPort: number; protocol: string }[];
  volumes: { host: string; container: string }[];
  env: { name: string; value: string }[];
  restart: string;
  networkMode: string;
}

export function DeployAppDialog({
  app,
  open,
  onOpenChange,
  onDeploy,
  deploying,
  deployLog,
}: {
  app: StoreApp | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeploy: (config: DeployConfig) => Promise<void>;
  deploying: boolean;
  deployLog: DeployLogEntry[];
}) {
  const [config, setConfig] = useState<DeployConfig>({
    name: "",
    ports: [],
    volumes: [],
    env: [],
    restart: "",
    networkMode: "",
  });

  const logRef = useRef<HTMLDivElement>(null);

  // 当 app 变化时重置配置
  useEffect(() => {
    if (!app) return;
    setConfig({
      name: app.id,
      ports: app.defaultPorts
        .filter((p) => p.host !== undefined)
        .map((p) => ({
          hostPort: p.host!,
          containerPort: p.container,
          protocol: p.protocol || "tcp",
        })),
      volumes: app.defaultVolumes
        .filter((v) => v.host !== undefined)
        .map((v) => ({
          host: v.host!,
          container: v.container,
        })),
      env: app.defaultEnv.map((e) => ({
        name: e.name,
        value: e.value || "",
      })),
      restart: app.restart || "",
      networkMode: "",
    });
  }, [app]);

  // 新日志到来时自动滚到底部
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [deployLog]);

  if (!app) return null;

  const addPort = () => {
    setConfig({
      ...config,
      ports: [...config.ports, { hostPort: 0, containerPort: 80, protocol: "tcp" }],
    });
  };

  const removePort = (i: number) => {
    setConfig({ ...config, ports: config.ports.filter((_, idx) => idx !== i) });
  };

  const updatePort = (i: number, field: string, value: string | number) => {
    const ports = [...config.ports];
    (ports[i] as any)[field] = field === "protocol" ? value : Number(value);
    setConfig({ ...config, ports });
  };

  const addVolume = () => {
    setConfig({
      ...config,
      volumes: [...config.volumes, { host: "", container: "" }],
    });
  };

  const removeVolume = (i: number) => {
    setConfig({ ...config, volumes: config.volumes.filter((_, idx) => idx !== i) });
  };

  const updateVolume = (i: number, field: "host" | "container", value: string) => {
    const volumes = [...config.volumes];
    volumes[i][field] = value;
    setConfig({ ...config, volumes });
  };

  const addEnv = () => {
    setConfig({
      ...config,
      env: [...config.env, { name: "", value: "" }],
    });
  };

  const removeEnv = (i: number) => {
    setConfig({ ...config, env: config.env.filter((_, idx) => idx !== i) });
  };

  const updateEnv = (i: number, field: "name" | "value", value: string) => {
    const env = [...config.env];
    env[i][field] = value;
    setConfig({ ...config, env });
  };

  const handleDeploy = async () => {
    if (!config.name.trim()) return;
    await onDeploy(config);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onOpenChange(false); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{app.icon}</span>
            部署 {app.name}
          </DialogTitle>
          <DialogDescription>
            镜像: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{app.image}</code>
          </DialogDescription>
        </DialogHeader>

        {!deploying ? (
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
            {/* 容器名称 */}
            <div className="space-y-1.5">
              <Label>容器名称 *</Label>
              <Input
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                placeholder="my-container"
              />
            </div>

            {/* 端口映射 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">端口映射</Label>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={addPort}>
                  <Plus className="h-3 w-3 mr-1" />添加
                </Button>
              </div>
              {config.ports.length === 0 && (
                <p className="text-xs text-muted-foreground">未配置端口映射</p>
              )}
              {config.ports.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    className="w-20 h-7 text-xs"
                    type="number"
                    value={p.hostPort || ""}
                    onChange={(e) => updatePort(i, "hostPort", e.target.value)}
                    placeholder="主机"
                  />
                  <span className="text-muted-foreground text-xs">:</span>
                  <Input
                    className="w-20 h-7 text-xs"
                    type="number"
                    value={p.containerPort || ""}
                    onChange={(e) => updatePort(i, "containerPort", e.target.value)}
                    placeholder="容器"
                  />
                  <Select
                    value={p.protocol}
                    onValueChange={(v) => updatePort(i, "protocol", v)}
                  >
                    <SelectTrigger className="w-16 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tcp">tcp</SelectItem>
                      <SelectItem value="udp">udp</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => removePort(i)}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>

            {/* 卷挂载 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">卷挂载</Label>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={addVolume}>
                  <Plus className="h-3 w-3 mr-1" />添加
                </Button>
              </div>
              {config.volumes.length === 0 && (
                <p className="text-xs text-muted-foreground">未配置卷挂载</p>
              )}
              {config.volumes.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    className="flex-1 h-7 text-xs"
                    value={v.host}
                    onChange={(e) => updateVolume(i, "host", e.target.value)}
                    placeholder="主机路径"
                  />
                  <span className="text-muted-foreground text-xs">:</span>
                  <Input
                    className="flex-1 h-7 text-xs"
                    value={v.container}
                    onChange={(e) => updateVolume(i, "container", e.target.value)}
                    placeholder="容器路径"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => removeVolume(i)}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>

            {/* 环境变量 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">环境变量</Label>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={addEnv}>
                  <Plus className="h-3 w-3 mr-1" />添加
                </Button>
              </div>
              {config.env.length === 0 && (
                <p className="text-xs text-muted-foreground">未配置环境变量</p>
              )}
              {config.env.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    className="flex-[2] h-7 text-xs"
                    value={e.name}
                    onChange={(ev) => updateEnv(i, "name", ev.target.value)}
                    placeholder="变量名"
                  />
                  <span className="text-muted-foreground text-xs">=</span>
                  <Input
                    className="flex-[3] h-7 text-xs"
                    value={e.value}
                    onChange={(ev) => updateEnv(i, "value", ev.target.value)}
                    placeholder="值"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => removeEnv(i)}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>

            {/* 重启策略 */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">重启策略</Label>
              <Select
                value={config.restart}
                onValueChange={(v) => setConfig({ ...config, restart: v })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="不设置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不设置</SelectItem>
                  <SelectItem value="no">no</SelectItem>
                  <SelectItem value="always">always</SelectItem>
                  <SelectItem value="unless-stopped">unless-stopped</SelectItem>
                  <SelectItem value="on-failure">on-failure</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {app.note && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded p-2">
                {app.note}
              </p>
            )}
          </div>
        ) : (
          <div ref={logRef} className="h-[300px] min-h-0 shrink-0 overflow-y-auto rounded border bg-black/90 text-green-400 p-3 font-mono text-xs">
            {deployLog.length === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                正在连接...
              </div>
            ) : (
              <div className="space-y-0.5">
                {deployLog.map((entry, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    {entry.type === "stage" && (
                      <span className="text-cyan-400 shrink-0 mt-px">▶</span>
                    )}
                    {entry.type === "progress" && entry.status === "downloading" && (
                      <ArrowDown className="h-3 w-3 text-blue-400 shrink-0 mt-px" />
                    )}
                    {entry.type === "progress" && entry.status === "extracting" && (
                      <Loader2 className="h-3 w-3 text-yellow-400 animate-spin shrink-0 mt-px" />
                    )}
                    {entry.type === "progress" && entry.status === "info" && (
                      <span className="text-green-400 shrink-0 mt-px">✓</span>
                    )}
                    {entry.type === "done" && (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0 mt-px" />
                    )}
                    {entry.type === "error" && (
                      <XCircle className="h-3 w-3 text-red-400 shrink-0 mt-px" />
                    )}
                    <span className="break-all leading-relaxed">
                      {entry.message || `${entry.layer ? `${entry.layer}: ` : ""}${entry.detail || ""}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="pt-2">
          {deploying ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={handleDeploy} disabled={!config.name.trim()}>
                部署
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}