"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  ArrowDown,
  FileText,
  Terminal,
} from "lucide-react";

interface DeployLogEntry {
  type: "stage" | "progress" | "done" | "error";
  message?: string;
  stage?: string;
  layer?: string;
  status?: string;
  detail?: string;
}

interface AddContainerDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isRemoteNode: boolean;
  selectedNodeId: string;
  apiBase: string;
  authHeaders: () => Record<string, string>;
  onSuccess: () => void;
  startDeployTask: (request: {
    title: string;
    icon?: string;
    url: string;
    headers: HeadersInit;
    body: string;
    targetUrl?: string;
    onDone?: () => void | Promise<void>;
  }) => string;
}

// ── 镜像拉取配置 ─────────────────────────────────────────────────

interface ImagePullConfig {
  image: string;
  name: string;
  ports: { hostPort: number; containerPort: number; protocol: string }[];
  volumes: { host: string; container: string }[];
  env: { name: string; value: string }[];
  restart: string;
  networkMode: string;
}

// ── Compose 配置 ─────────────────────────────────────────────────

interface ComposeConfig {
  content: string;
  projectName: string;
  pullPolicy: string; // "pull" | "no-pull"
}

// ── SSE 日志解析辅助 ──────────────────────────────────────────────

function parseSSELog(
  logs: DeployLogEntry[],
  setLogs: React.Dispatch<React.SetStateAction<DeployLogEntry[]>>,
  text: string
) {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    try {
      const data = JSON.parse(trimmed.slice(6));
      setLogs((prev) => [...prev, data as DeployLogEntry]);
    } catch {
      // ignore non-JSON lines
    }
  }
}

export function AddContainerDialog({
  open,
  onOpenChange,
  isRemoteNode,
  selectedNodeId,
  apiBase,
  authHeaders,
  onSuccess,
  startDeployTask,
}: AddContainerDialogProps) {
  const [activeTab, setActiveTab] = useState("image");
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState<DeployLogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // 镜像拉取配置
  const [imageConfig, setImageConfig] = useState<ImagePullConfig>({
    image: "",
    name: "",
    ports: [],
    volumes: [],
    env: [],
    restart: "",
    networkMode: "",
  });

  // Compose 配置
  const [composeConfig, setComposeConfig] = useState<ComposeConfig>({
    content: "",
    projectName: "",
    pullPolicy: "pull",
  });

  // 重置配置
  useEffect(() => {
    if (!open) {
      setDeploying(false);
      setLogs([]);
      setImageConfig({
        image: "",
        name: "",
        ports: [],
        volumes: [],
        env: [],
        restart: "",
        networkMode: "",
      });
      setComposeConfig({
        content: "",
        projectName: "",
        pullPolicy: "pull",
      });
      setActiveTab("image");
    }
  }, [open]);

  // 自动滚到底部
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const basePath = isRemoteNode
    ? `/api/nodes/${selectedNodeId}/docker`
    : "/api/docker";

  // ── 镜像拉取部署 ──────────────────────────────────────────────

  const handleImageDeploy = () => {
    if (!imageConfig.image.trim() || !imageConfig.name.trim()) return;

    const body = JSON.stringify({
      image: imageConfig.image.trim(),
      name: imageConfig.name.trim(),
      ports: imageConfig.ports.filter((p) => p.hostPort > 0),
      volumes: imageConfig.volumes.filter((v) => v.host && v.container),
      env: imageConfig.env.filter((e) => e.name),
      restart: imageConfig.restart === "__none__" ? "" : imageConfig.restart,
      networkMode: imageConfig.networkMode || undefined,
    });

    startDeployTask({
      title: `部署 ${imageConfig.name.trim()}`,
      url: `${apiBase}${basePath}/store/deploy-stream`,
      headers: authHeaders(),
      body,
      targetUrl: "/dashboard/docker",
      onDone: async () => {
        onOpenChange(false);
        onSuccess();
      },
    });

    onOpenChange(false);
  };

  // ── Compose 部署 ──────────────────────────────────────────────

  const handleComposeDeploy = () => {
    if (!composeConfig.content.trim()) return;

    const body = JSON.stringify({
      composeContent: composeConfig.content,
      projectName: composeConfig.projectName || undefined,
      pullPolicy: composeConfig.pullPolicy,
    });

    const title = composeConfig.projectName
      ? `Compose 部署 ${composeConfig.projectName}`
      : "Compose 部署";

    startDeployTask({
      title,
      url: `${apiBase}${basePath}/compose/deploy-stream`,
      headers: authHeaders(),
      body,
      targetUrl: "/dashboard/docker",
      onDone: async () => {
        onOpenChange(false);
        onSuccess();
      },
    });

    onOpenChange(false);
  };

  // ── 端口/卷/环境变量操作 ─────────────────────────────────────

  const addPort = () =>
    setImageConfig({
      ...imageConfig,
      ports: [...imageConfig.ports, { hostPort: 0, containerPort: 80, protocol: "tcp" }],
    });

  const removePort = (i: number) =>
    setImageConfig({
      ...imageConfig,
      ports: imageConfig.ports.filter((_, idx) => idx !== i),
    });

  const updatePort = (i: number, field: string, value: string | number) => {
    const ports = [...imageConfig.ports];
    (ports[i] as any)[field] = field === "protocol" ? value : Number(value);
    setImageConfig({ ...imageConfig, ports });
  };

  const addVolume = () =>
    setImageConfig({
      ...imageConfig,
      volumes: [...imageConfig.volumes, { host: "", container: "" }],
    });

  const removeVolume = (i: number) =>
    setImageConfig({
      ...imageConfig,
      volumes: imageConfig.volumes.filter((_, idx) => idx !== i),
    });

  const updateVolume = (i: number, field: "host" | "container", value: string) => {
    const volumes = [...imageConfig.volumes];
    volumes[i][field] = value;
    setImageConfig({ ...imageConfig, volumes });
  };

  const addEnv = () =>
    setImageConfig({
      ...imageConfig,
      env: [...imageConfig.env, { name: "", value: "" }],
    });

  const removeEnv = (i: number) =>
    setImageConfig({
      ...imageConfig,
      env: imageConfig.env.filter((_, idx) => idx !== i),
    });

  const updateEnv = (i: number, field: "name" | "value", value: string) => {
    const env = [...imageConfig.env];
    env[i][field] = value;
    setImageConfig({ ...imageConfig, env });
  };

  // ── 渲染日志面板 ─────────────────────────────────────────────

  const renderLogPanel = () => (
    <div
      ref={logRef}
      className="h-[350px] min-h-0 shrink-0 overflow-y-auto rounded border bg-black/90 text-green-400 p-3 font-mono text-xs"
    >
      {logs.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          正在连接...
        </div>
      ) : (
        <div className="space-y-0.5">
          {logs.map((entry, i) => (
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
                {entry.message ||
                  `${entry.layer ? `${entry.layer}: ` : ""}${entry.detail || ""}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── 检查是否可部署 ───────────────────────────────────────────

  const canDeploy =
    activeTab === "image"
      ? !!imageConfig.image.trim() && !!imageConfig.name.trim()
      : !!composeConfig.content.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onOpenChange(false); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            添加容器
          </DialogTitle>
          <DialogDescription>
            通过镜像拉取或 Docker Compose 方式部署新容器
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="image" className="flex items-center gap-1.5 flex-1">
              <FileText className="h-3.5 w-3.5" />
              镜像拉取
            </TabsTrigger>
            <TabsTrigger value="compose" className="flex items-center gap-1.5 flex-1">
              <Terminal className="h-3.5 w-3.5" />
              Docker Compose
            </TabsTrigger>
          </TabsList>

          {/* ── 镜像拉取 Tab ────────────────────────────────────── */}
          <TabsContent value="image" className="flex-1 flex flex-col min-h-0 mt-2">
            {!deploying ? (
              <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                {/* 镜像名称 */}
                <div className="space-y-1.5">
                  <Label>
                    镜像名称 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={imageConfig.image}
                    onChange={(e) =>
                      setImageConfig({ ...imageConfig, image: e.target.value })
                    }
                    placeholder="nginx:latest"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    输入完整的镜像名称，如 <code className="text-xs bg-muted px-1 rounded">nginx:latest</code>、
                    <code className="text-xs bg-muted px-1 rounded">mysql:8.0</code>
                  </p>
                </div>

                {/* 容器名称 */}
                <div className="space-y-1.5">
                  <Label>
                    容器名称 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={imageConfig.name}
                    onChange={(e) =>
                      setImageConfig({ ...imageConfig, name: e.target.value })
                    }
                    placeholder="my-nginx"
                  />
                </div>

                {/* 端口映射 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">
                      端口映射
                    </Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={addPort}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      添加
                    </Button>
                  </div>
                  {imageConfig.ports.length === 0 && (
                    <p className="text-xs text-muted-foreground">未配置端口映射</p>
                  )}
                  {imageConfig.ports.map((p, i) => (
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
                    <Label className="text-xs font-medium text-muted-foreground">
                      卷挂载
                    </Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={addVolume}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      添加
                    </Button>
                  </div>
                  {imageConfig.volumes.length === 0 && (
                    <p className="text-xs text-muted-foreground">未配置卷挂载</p>
                  )}
                  {imageConfig.volumes.map((v, i) => (
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
                    <Label className="text-xs font-medium text-muted-foreground">
                      环境变量
                    </Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={addEnv}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      添加
                    </Button>
                  </div>
                  {imageConfig.env.length === 0 && (
                    <p className="text-xs text-muted-foreground">未配置环境变量</p>
                  )}
                  {imageConfig.env.map((e, i) => (
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
                  <Label className="text-xs font-medium text-muted-foreground">
                    重启策略
                  </Label>
                  <Select
                    value={imageConfig.restart}
                    onValueChange={(v) =>
                      setImageConfig({ ...imageConfig, restart: v })
                    }
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

                {/* 网络模式 */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    网络模式
                  </Label>
                  <Select
                    value={imageConfig.networkMode}
                    onValueChange={(v) =>
                      setImageConfig({ ...imageConfig, networkMode: v })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="默认 (bridge)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">默认 (bridge)</SelectItem>
                      <SelectItem value="host">host</SelectItem>
                      <SelectItem value="none">none</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              renderLogPanel()
            )}
          </TabsContent>

          {/* ── Docker Compose Tab ──────────────────────────────── */}
          <TabsContent value="compose" className="flex-1 flex flex-col min-h-0 mt-2">
            {!deploying ? (
              <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                {/* 项目名称 */}
                <div className="space-y-1.5">
                  <Label>项目名称（可选）</Label>
                  <Input
                    value={composeConfig.projectName}
                    onChange={(e) =>
                      setComposeConfig({
                        ...composeConfig,
                        projectName: e.target.value,
                      })
                    }
                    placeholder="my-project"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    对应 docker compose -p 参数，不设置则使用默认值
                  </p>
                </div>

                {/* 拉取策略 */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    镜像拉取策略
                  </Label>
                  <Select
                    value={composeConfig.pullPolicy}
                    onValueChange={(v) =>
                      setComposeConfig({ ...composeConfig, pullPolicy: v })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pull">部署前拉取镜像</SelectItem>
                      <SelectItem value="no-pull">不拉取（使用本地镜像）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Compose 内容 */}
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center justify-between">
                    <Label>
                      docker-compose.yml 内容{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                  </div>
                  <Textarea
                    value={composeConfig.content}
                    onChange={(e) =>
                      setComposeConfig({
                        ...composeConfig,
                        content: e.target.value,
                      })
                    }
                    placeholder={`version: "3.8"\nservices:\n  web:\n    image: nginx:latest\n    ports:\n      - "80:80"\n    restart: unless-stopped`}
                    className="min-h-[250px] font-mono text-xs resize-y"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    粘贴完整的 docker-compose.yml 内容
                  </p>
                </div>
              </div>
            ) : (
              renderLogPanel()
            )}
          </TabsContent>
        </Tabs>

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
              <Button
                onClick={() =>
                  activeTab === "image" ? handleImageDeploy() : handleComposeDeploy()
                }
                disabled={!canDeploy}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {activeTab === "image" ? "拉取并部署" : "部署 Compose"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}