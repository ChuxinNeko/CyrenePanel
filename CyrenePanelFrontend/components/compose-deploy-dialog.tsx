"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@iconify/react";
import yaml from "js-yaml";
import {
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  ArrowDown,
  Code2,
  Settings2,
} from "lucide-react";
import { useTasks } from "@/lib/task-store";

// ── 类型 ─────────────────────────────────────────────────────────────

export interface DeployLogEntry {
  type: "stage" | "progress" | "done" | "error";
  message?: string;
  stage?: string;
  layer?: string;
  status?: string;
  detail?: string;
}

interface PortMapping {
  hostPort: string;
  containerPort: string;
  protocol: string;
}

interface VolumeMapping {
  host: string;
  container: string;
}

interface EnvVar {
  name: string;
  value: string;
}

interface ComposeConfig {
  name: string;
  image: string;
  restart: string;
  networkMode: string;
  ports: PortMapping[];
  volumes: VolumeMapping[];
  env: EnvVar[];
}

// ── YAML 解析 → 可视化配置 ──────────────────────────────────────────

function parseYamlToConfig(yamlStr: string): ComposeConfig {
  try {
    const doc = yaml.load(yamlStr) as any;
    const services = doc?.services;
    if (!services) return emptyConfig();

    const serviceKey = Object.keys(services)[0];
    const svc = services[serviceKey];
    if (!svc) return emptyConfig();

    const ports: PortMapping[] = [];
    if (Array.isArray(svc.ports)) {
      for (const p of svc.ports) {
        if (typeof p === "string") {
          // "8080:80/tcp"
          const m = p.match(/^(\d+):(\d+)(?:\/(\w+))?$/);
          if (m) ports.push({ hostPort: m[1], containerPort: m[2], protocol: m[3] || "tcp" });
        } else if (typeof p === "object") {
          ports.push({
            hostPort: String(p.published || ""),
            containerPort: String(p.target || ""),
            protocol: p.protocol || "tcp",
          });
        }
      }
    }

    const volumes: VolumeMapping[] = [];
    if (Array.isArray(svc.volumes)) {
      for (const v of svc.volumes) {
        if (typeof v === "string") {
          const parts = v.split(":");
          if (parts.length >= 2) volumes.push({ host: parts[0], container: parts[1] });
        } else if (typeof v === "object") {
          volumes.push({ host: v.source || "", container: v.target || "" });
        }
      }
    }

    const env: EnvVar[] = [];
    if (Array.isArray(svc.environment)) {
      for (const e of svc.environment) {
        const idx = e.indexOf("=");
        if (idx > 0) env.push({ name: e.slice(0, idx), value: e.slice(idx + 1) });
      }
    } else if (svc.environment && typeof svc.environment === "object") {
      for (const [k, val] of Object.entries(svc.environment)) {
        env.push({ name: k, value: String(val ?? "") });
      }
    }

    return {
      name: svc.container_name || serviceKey || doc.name || "",
      image: svc.image || "",
      restart: svc.restart || "",
      networkMode: svc.network_mode || "",
      ports,
      volumes,
      env,
    };
  } catch {
    return emptyConfig();
  }
}

function emptyConfig(): ComposeConfig {
  return { name: "", image: "", restart: "", networkMode: "", ports: [], volumes: [], env: [] };
}

// ── 可视化配置 → YAML（重新生成干净的 compose） ─────────────────────

function configToYaml(config: ComposeConfig): string {
  const svc: any = {};
  if (config.image) svc.image = config.image;
  if (config.restart) svc.restart = config.restart;
  if (config.networkMode) svc.network_mode = config.networkMode;
  if (config.ports.length > 0) {
    svc.ports = config.ports
      .filter((p) => p.hostPort && p.containerPort)
      .map((p) => ({
        target: parseInt(p.containerPort) || 0,
        published: p.hostPort,
        protocol: p.protocol || "tcp",
      }));
  }
  if (config.volumes.length > 0) {
    svc.volumes = config.volumes
      .filter((v) => v.host && v.container)
      .map((v) => ({
        type: "bind",
        source: v.host,
        target: v.container,
      }));
  }
  if (config.env.length > 0) {
    const envObj: Record<string, string> = {};
    for (const e of config.env) {
      if (e.name) envObj[e.name] = e.value;
    }
    svc.environment = envObj;
  }
  if (config.name) svc.container_name = config.name;

  const doc: any = {
    name: config.name || "app",
    services: { [config.name || "app"]: svc },
  };

  return yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

// ── 图标 ─────────────────────────────────────────────────────────────

function AppIcon({ icon, className = "" }: { icon: string; className?: string }) {
  if (icon.startsWith("http://") || icon.startsWith("https://")) {
    return <img src={icon} alt="" className={className} />;
  }
  if (icon.includes(":")) {
    return <Icon icon={icon} className={className} />;
  }
  return <span className={className}>{icon}</span>;
}

// ── 组件 ─────────────────────────────────────────────────────────────

const STORES_API = "https://docker.nekofun.top";

export function ComposeDeployDialog({
  appId,
  appTitle,
  appIcon,
  open,
  onOpenChange,
  apiBase,
  authHeaders,
  isRemoteNode,
  selectedNodeId,
  onDeploySuccess,
}: {
  appId: string;
  appTitle: string;
  appIcon: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  apiBase: string;
  authHeaders: () => Record<string, string>;
  isRemoteNode: boolean;
  selectedNodeId: string | null;
  onDeploySuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rawYaml, setRawYaml] = useState("");
  const [config, setConfig] = useState<ComposeConfig>(emptyConfig());
  const [activeTab, setActiveTab] = useState<string>("visual");
  const [deploying, setDeploying] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const { tasks, startDeployTask } = useTasks();
  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) || null,
    [tasks, activeTaskId],
  );
  const deployLog = activeTask?.logs || [];

  // 获取 docker-compose.yml
  useEffect(() => {
    if (!open || !appId) return;
    setLoading(true);
    setError("");
    setRawYaml("");
    setConfig(emptyConfig());
    setDeploying(false);
    setActiveTaskId(null);
    setActiveTab("visual");

    fetch(`${STORES_API}/apps/${appId}/docker-compose.yml`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setRawYaml(text);
        setConfig(parseYamlToConfig(text));
      })
      .catch((e) => setError(e.message || "获取配置失败"))
      .finally(() => setLoading(false));
  }, [open, appId]);

  // tab 切换：可视化 → 源码时，将当前 config 序列化
  // tab 切换：源码 → 可视化时，将 rawYaml 解析为 config
  const handleTabChange = (tab: string) => {
    if (tab === "source" && activeTab === "visual") {
      setRawYaml(configToYaml(config));
    } else if (tab === "visual" && activeTab === "source") {
      setConfig(parseYamlToConfig(rawYaml));
    }
    setActiveTab(tab);
  };

  // 日志自动滚动
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [deployLog]);

  useEffect(() => {
    if (activeTask && activeTask.status !== "running") {
      setDeploying(false);
    }
  }, [activeTask]);

  // 部署：发送完整 YAML 到后端
  const handleDeploy = async () => {
    // 确保从最新 tab 同步数据
    const finalYaml = activeTab === "visual" ? configToYaml(config) : rawYaml;
    const finalConfig = activeTab === "source" ? parseYamlToConfig(rawYaml) : config;

    if (!finalConfig.name.trim()) return;

    const basePath = isRemoteNode
      ? `/api/nodes/${selectedNodeId}/docker`
      : "/api/docker";

    const body = JSON.stringify({
      yaml: finalYaml,
      name: finalConfig.name,
      image: finalConfig.image,
      ports: finalConfig.ports
        .filter((p) => p.hostPort && p.containerPort)
        .map((p) => ({
          hostPort: parseInt(p.hostPort) || 0,
          containerPort: parseInt(p.containerPort) || 0,
          protocol: p.protocol || "tcp",
        })),
      volumes: finalConfig.volumes.filter((v) => v.host && v.container),
      env: finalConfig.env.filter((e) => e.name),
      restart: finalConfig.restart || undefined,
      networkMode: finalConfig.networkMode || undefined,
    });

    setDeploying(true);
    const taskId = startDeployTask({
      title: `部署 ${appTitle || finalConfig.name}`,
      icon: appIcon,
      url: `${apiBase}${basePath}/store/deploy-stream`,
      headers: authHeaders(),
      body,
      targetUrl: "/dashboard/docker",
      onDone: async () => {
        await onDeploySuccess();
        setDeploying(false);
        onOpenChange(false);
      },
    });
    setActiveTaskId(taskId);
  };

  // ── 可视化编辑辅助 ─────────────────────────────────────────────────

  const addPort = () => setConfig({
    ...config,
    ports: [...config.ports, { hostPort: "", containerPort: "80", protocol: "tcp" }],
  });
  const removePort = (i: number) => setConfig({
    ...config, ports: config.ports.filter((_, idx) => idx !== i),
  });
  const updatePort = (i: number, field: keyof PortMapping, value: string) => {
    const ports = [...config.ports];
    ports[i] = { ...ports[i], [field]: value };
    setConfig({ ...config, ports });
  };

  const addVolume = () => setConfig({
    ...config,
    volumes: [...config.volumes, { host: "", container: "" }],
  });
  const removeVolume = (i: number) => setConfig({
    ...config, volumes: config.volumes.filter((_, idx) => idx !== i),
  });
  const updateVolume = (i: number, field: keyof VolumeMapping, value: string) => {
    const volumes = [...config.volumes];
    volumes[i] = { ...volumes[i], [field]: value };
    setConfig({ ...config, volumes });
  };

  const addEnv = () => setConfig({
    ...config,
    env: [...config.env, { name: "", value: "" }],
  });
  const removeEnv = (i: number) => setConfig({
    ...config, env: config.env.filter((_, idx) => idx !== i),
  });
  const updateEnv = (i: number, field: keyof EnvVar, value: string) => {
    const env = [...config.env];
    env[i] = { ...env[i], [field]: value };
    setConfig({ ...config, env });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col h-[85vh] max-h-[85vh] p-0 gap-0 overflow-hidden"
        style={{ maxWidth: "680px", width: "95vw" }}
      >
        {/* 头部 */}
        <DialogHeader className="shrink-0 px-6 pt-5 pb-3 border-b border-border/30">
          <DialogTitle className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted/50 border border-border/40 overflow-hidden flex items-center justify-center shrink-0">
              <AppIcon icon={appIcon} className="w-5 h-5 object-contain" />
            </div>
            部署 {appTitle}
          </DialogTitle>
          {config.image && (
            <DialogDescription className="text-xs">
              镜像: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono">{config.image}</code>
            </DialogDescription>
          )}
        </DialogHeader>

        {/* 主体 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在获取配置...
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center text-sm text-destructive px-6">
              获取配置失败: {error}
            </div>
          ) : deploying ? (
            /* 部署日志 */
            <div ref={logRef} className="flex-1 overflow-y-auto bg-black/90 text-green-400 p-4 font-mono text-xs">
              {deployLog.length === 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在连接...
                </div>
              ) : (
                <div className="space-y-0.5">
                  {deployLog.map((entry, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      {entry.type === "stage" && <span className="text-cyan-400 shrink-0 mt-px">▶</span>}
                      {entry.type === "progress" && entry.status === "downloading" && (
                        <ArrowDown className="h-3 w-3 text-blue-400 shrink-0 mt-px" />
                      )}
                      {entry.type === "progress" && entry.status === "extracting" && (
                        <Loader2 className="h-3 w-3 text-yellow-400 animate-spin shrink-0 mt-px" />
                      )}
                      {entry.type === "progress" && entry.status === "info" && (
                        <span className="text-green-400 shrink-0 mt-px">✓</span>
                      )}
                      {entry.type === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0 mt-px" />}
                      {entry.type === "error" && <XCircle className="h-3 w-3 text-red-400 shrink-0 mt-px" />}
                      <span className="break-all leading-relaxed">
                        {entry.message || `${entry.layer ? `${entry.layer}: ` : ""}${entry.detail || ""}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* 编辑界面 */
            <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 min-h-0 flex flex-col">
              <div className="shrink-0 px-6 pt-3">
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="visual" className="gap-1.5 text-xs">
                    <Settings2 className="h-3.5 w-3.5" />
                    可视化编辑
                  </TabsTrigger>
                  <TabsTrigger value="source" className="gap-1.5 text-xs">
                    <Code2 className="h-3.5 w-3.5" />
                    源文件编辑
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* 可视化编辑 */}
              <TabsContent value="visual" className="flex-1 min-h-0 m-0">
                <ScrollArea className="h-full">
                  <div className="px-6 py-4 space-y-4">
                    {/* 容器名 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">容器名称 *</Label>
                      <Input
                        value={config.name}
                        onChange={(e) => setConfig({ ...config, name: e.target.value })}
                        placeholder="my-container"
                        className="h-8 text-sm"
                      />
                    </div>

                    {/* 镜像 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">镜像</Label>
                      <Input
                        value={config.image}
                        onChange={(e) => setConfig({ ...config, image: e.target.value })}
                        placeholder="nginx:latest"
                        className="h-8 text-sm font-mono"
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
                            value={p.hostPort}
                            onChange={(e) => updatePort(i, "hostPort", e.target.value)}
                            placeholder="主机端口"
                          />
                          <span className="text-muted-foreground text-xs">:</span>
                          <Input
                            className="w-20 h-7 text-xs"
                            value={p.containerPort}
                            onChange={(e) => updatePort(i, "containerPort", e.target.value)}
                            placeholder="容器端口"
                          />
                          <Select value={p.protocol} onValueChange={(v) => updatePort(i, "protocol", v)}>
                            <SelectTrigger className="w-16 h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="tcp">tcp</SelectItem>
                              <SelectItem value="udp">udp</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removePort(i)}>
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
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeVolume(i)}>
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
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeEnv(i)}>
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {/* 重启策略 & 网络模式 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">重启策略</Label>
                        <Select
                          value={config.restart || "__none__"}
                          onValueChange={(v) => setConfig({ ...config, restart: v === "__none__" ? "" : v })}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="不设置" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">不设置</SelectItem>
                            <SelectItem value="no">no</SelectItem>
                            <SelectItem value="always">always</SelectItem>
                            <SelectItem value="unless-stopped">unless-stopped</SelectItem>
                            <SelectItem value="on-failure">on-failure</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">网络模式</Label>
                        <Select
                          value={config.networkMode || "__default__"}
                          onValueChange={(v) => setConfig({ ...config, networkMode: v === "__default__" ? "" : v })}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="默认" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">默认</SelectItem>
                            <SelectItem value="bridge">bridge</SelectItem>
                            <SelectItem value="host">host</SelectItem>
                            <SelectItem value="none">none</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* 源码编辑 */}
              <TabsContent value="source" className="flex-1 min-h-0 m-0 px-6 py-4">
                <Textarea
                  value={rawYaml}
                  onChange={(e) => setRawYaml(e.target.value)}
                  className="h-full resize-none font-mono text-xs leading-relaxed"
                  spellCheck={false}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>

        {/* 底部 */}
        <DialogFooter className="shrink-0 px-6 py-3 border-t border-border/30">
          {deploying ? (
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
              <Button
                size="sm"
                onClick={handleDeploy}
                disabled={loading || !!error || !config.name.trim() || !config.image.trim()}
              >
                确认部署
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
