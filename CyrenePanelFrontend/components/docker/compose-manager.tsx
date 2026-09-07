"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import Editor from "@monaco-editor/react";
import { toast } from "sonner";
import {
  CircleCheck,
  FileCode2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Upload,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_BASE } from "@/lib/api-base";
import { dockerDelete, dockerGet, dockerPost, type ApiResult } from "@/lib/docker-api";

import { ContainerDetailDialog } from "./container-detail-dialog";

const TEMPLATE = `services:
  app:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "\${WEB_PORT}:80"
    volumes:
      - ./data:/usr/share/nginx/html
    environment:
      - TZ=Asia/Shanghai
`;

const ENV_TEMPLATE = `WEB_PORT=8080
`;

interface ComposeProject {
  name: string;
  managed: boolean;
  status: string;
  configFiles: string;
  serviceCount: number;
  runningCount: number;
  remark: string;
}

interface ComposeService {
  id: string;
  name: string;
  service: string;
  image: string;
  state: string;
  status: string;
  health: string;
  ports: string[];
}

interface ProjectDetail {
  name: string;
  managed: boolean;
  composeFile: string;
  envFile: string;
  dir: string;
  content: string;
  envContent: string;
  remark: string;
  services: ComposeService[];
}

export function ComposeManager({ prefix }: { prefix: string }) {
  const { resolvedTheme } = useTheme();
  const editorTheme = resolvedTheme === "dark" ? "vs-dark" : "light";

  const [projects, setProjects] = useState<ComposeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [activeName, setActiveName] = useState<string | null>(null);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // 配置文件编辑缓冲
  const [yamlDraft, setYamlDraft] = useState("");
  const [envDraft, setEnvDraft] = useState("");
  const dirty =
    !!detail && (yamlDraft !== detail.content || envDraft !== detail.envContent);

  // 编排日志
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logService, setLogService] = useState<string>("");

  // 新建项目
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  // 备注
  const [remarkTarget, setRemarkTarget] = useState<ComposeProject | null>(null);
  const [remarkValue, setRemarkValue] = useState("");

  // 删除
  const [deleteTarget, setDeleteTarget] = useState<ComposeProject | null>(null);
  const [deleteVolumes, setDeleteVolumes] = useState(false);

  // 容器终端
  const [terminalContainer, setTerminalContainer] = useState<{
    id: string;
    name: string;
    state: string;
  } | null>(null);

  // 流式操作
  const [streamOpen, setStreamOpen] = useState(false);
  const [streamTitle, setStreamTitle] = useState("");
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const streamEndRef = useRef<HTMLDivElement>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dockerGet<{ success: boolean; projects?: ComposeProject[]; message?: string }>(
        `${prefix}/compose/projects`,
      );
      if (data.success && data.projects) {
        setProjects(data.projects);
        // 首次进入自动选中第一个项目，避免右侧空白
        setActiveName((prev) => prev ?? data.projects![0]?.name ?? null);
      } else {
        toast.error(data.message || "获取编排项目失败");
        setProjects([]);
      }
    } catch {
      toast.error("获取编排项目失败");
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  const loadDetail = useCallback(
    async (name: string) => {
      setDetailLoading(true);
      try {
        const data = await dockerGet<{ success: boolean; project?: ProjectDetail; message?: string }>(
          `${prefix}/compose/projects/${encodeURIComponent(name)}`,
        );
        if (data.success && data.project) {
          setDetail(data.project);
          setYamlDraft(data.project.content);
          setEnvDraft(data.project.envContent);
        } else {
          toast.error(data.message || "获取项目详情失败");
          setDetail(null);
        }
      } finally {
        setDetailLoading(false);
      }
    },
    [prefix],
  );

  const loadLogs = useCallback(
    async (name: string, service = "") => {
      setLogsLoading(true);
      setLogService(service);
      try {
        const query = service ? `&service=${encodeURIComponent(service)}` : "";
        const data = await dockerGet<{ success: boolean; logs?: string; message?: string }>(
          `${prefix}/compose/projects/${encodeURIComponent(name)}/logs?tail=500${query}`,
        );
        setLogs(data.success ? data.logs || "（无日志）" : data.message || "获取日志失败");
      } finally {
        setLogsLoading(false);
      }
    },
    [prefix],
  );

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!activeName) return;
    loadDetail(activeName);
    loadLogs(activeName);
  }, [activeName, loadDetail, loadLogs]);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamLines]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(kw) || p.remark.toLowerCase().includes(kw),
    );
  }, [projects, keyword]);

  const runAction = async (name: string, action: string, extra?: Record<string, unknown>) => {
    const labels: Record<string, string> = {
      up: "部署",
      down: "移除",
      start: "启动",
      stop: "停止",
      restart: "重启",
      pull: "拉取镜像",
      update: "更新镜像",
      recreate: "重建",
    };

    setStreamTitle(`${labels[action] || action} · ${name}`);
    setStreamLines([]);
    setStreamOpen(true);
    setStreaming(true);

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const res = await fetch(
        `${API_BASE}${prefix}/compose/projects/${encodeURIComponent(name)}/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(extra || {}),
        },
      );
      if (!res.ok || !res.body) throw new Error(`请求失败（${res.status}）`);

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
            if (event.type === "start" || event.type === "log") {
              setStreamLines((prev) => [...prev, event.line || event.message]);
            } else if (event.type === "done") {
              setStreamLines((prev) => [...prev, event.message]);
              if (event.success) toast.success(event.message);
              else toast.error(event.message);
            }
          } catch {
            // 忽略
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "操作失败";
      setStreamLines((prev) => [...prev, message]);
      toast.error(message);
    } finally {
      setStreaming(false);
      loadProjects();
      if (activeName) {
        loadDetail(activeName);
        loadLogs(activeName);
      }
    }
  };

  const handleSaveConfig = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/compose/projects`, {
        name: detail.name,
        content: yamlDraft,
        envContent: envDraft,
      });
      if (data.success) {
        toast.success(data.message || "已保存");
        loadDetail(detail.name);
      } else {
        toast.error(data.message || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim().toLowerCase();
    if (!name) {
      toast.error("请输入项目名称");
      return;
    }
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/compose/projects`, {
        name,
        content: TEMPLATE,
        envContent: ENV_TEMPLATE,
      });
      if (data.success) {
        toast.success("项目已创建，可继续编辑配置后部署");
        setCreateOpen(false);
        setNewName("");
        await loadProjects();
        setActiveName(name);
      } else {
        toast.error(data.message || "创建失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRemark = async () => {
    if (!remarkTarget) return;
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(
        `${prefix}/compose/projects/${encodeURIComponent(remarkTarget.name)}/remark`,
        { remark: remarkValue },
      );
      if (data.success) {
        toast.success("备注已保存");
        setRemarkTarget(null);
        loadProjects();
      } else {
        toast.error(data.message || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const data = await dockerDelete<ApiResult>(
        `${prefix}/compose/projects/${encodeURIComponent(deleteTarget.name)}?volumes=${deleteVolumes}`,
      );
      if (data.success) {
        toast.success(data.message || "项目已删除");
        if (activeName === deleteTarget.name) {
          setActiveName(null);
          setDetail(null);
        }
        setDeleteTarget(null);
        loadProjects();
      } else {
        toast.error(data.message || "删除失败");
      }
    } finally {
      setBusy(false);
      setDeleteVolumes(false);
    }
  };

  return (
    <div className="flex h-full min-h-[34rem] flex-col gap-4 lg:flex-row">
      {/* ── 左侧项目列表 ─────────────────────────────────────── */}
      <Card className="flex w-full shrink-0 flex-col overflow-hidden p-0 lg:w-72">
        <div className="space-y-2 border-b p-3">
          <Button className="w-full" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            添加容器编排
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索项目或备注"
              className="h-8 pl-8"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              {keyword ? "没有匹配的项目" : "还没有编排项目"}
            </div>
          ) : (
            filtered.map((project) => (
              <button
                key={project.name}
                onClick={() => setActiveName(project.name)}
                className={`flex w-full flex-col gap-1 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/60 ${
                  activeName === project.name ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={project.runningCount > 0 ? "default" : "outline"}
                    className={
                      project.runningCount > 0
                        ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15"
                        : ""
                    }
                  >
                    {project.runningCount > 0 ? "运行中" : "已停止"}
                  </Badge>
                  <span className="truncate font-medium">{project.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className="truncate hover:text-foreground hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRemarkTarget(project);
                      setRemarkValue(project.remark);
                    }}
                  >
                    {project.remark || "点击编辑备注"}
                  </span>
                  {!project.managed && (
                    <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">
                      外部
                    </Badge>
                  )}
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </Card>

      {/* ── 右侧详情 ─────────────────────────────────────────── */}
      {!activeName || !detail ? (
        <Card className="flex flex-1 items-center justify-center">
          <div className="text-sm text-muted-foreground">
            {detailLoading ? "加载中..." : "从左侧选择一个编排项目"}
          </div>
        </Card>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {/* 顶部标题与操作 */}
          <Card className="shrink-0">
            <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-xl font-semibold">{detail.name}</h3>
                  {!detail.managed && <Badge variant="outline">外部项目</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  <span>服务数量：{detail.services.length}</span>
                  <span className="truncate" title={detail.composeFile}>
                    配置：{detail.composeFile || "未找到"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={streaming} onClick={() => runAction(detail.name, "up")}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  部署
                </Button>
                <Button size="sm" variant="outline" disabled={streaming} onClick={() => runAction(detail.name, "stop")}>
                  <Square className="mr-1.5 h-3.5 w-3.5" />
                  停止
                </Button>
                <Button size="sm" variant="outline" disabled={streaming} onClick={() => runAction(detail.name, "restart")}>
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                  重启
                </Button>
                <Button size="sm" variant="outline" disabled={streaming} onClick={() => runAction(detail.name, "update")}>
                  更新镜像
                </Button>
                <Button size="sm" variant="outline" disabled={streaming} onClick={() => runAction(detail.name, "recreate")}>
                  重建
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    setDeleteTarget(projects.find((p) => p.name === detail.name) ?? null)
                  }
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
            {/* 左：容器列表 + 编排日志 */}
            <div className="flex min-h-0 flex-col gap-4">
              <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                <div className="shrink-0 border-b px-4 py-2.5 text-sm font-medium">容器列表</div>
                <ScrollArea className="min-h-0 flex-1">
                  {detail.services.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      该项目当前没有容器，点击「部署」创建
                    </div>
                  ) : (
                    detail.services.map((s) => (
                      <div key={s.name} className="border-b px-4 py-3 last:border-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{s.name}</span>
                              <Badge
                                variant={s.state === "running" ? "default" : "outline"}
                                className={
                                  s.state === "running"
                                    ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15"
                                    : ""
                                }
                              >
                                {s.state === "running" ? "运行中" : s.state || "已停止"}
                              </Badge>
                            </div>
                            <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                              {s.id ? s.id.slice(0, 12) : s.image}
                            </div>
                            {s.ports.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {s.ports.map((p) => (
                                  <span
                                    key={p}
                                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex shrink-0 gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={s.state !== "running"}
                              onClick={() =>
                                setTerminalContainer({ id: s.id, name: s.name, state: s.state })
                              }
                            >
                              <TerminalIcon className="mr-1 h-3.5 w-3.5" />
                              终端
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => loadLogs(detail.name, s.service || s.name)}
                            >
                              <FileText className="mr-1 h-3.5 w-3.5" />
                              日志
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </ScrollArea>
              </Card>

              <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
                  <span className="text-sm font-medium">
                    编排日志
                    {logService && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        · 仅 {logService}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-1">
                    {logService && (
                      <Button size="sm" variant="ghost" onClick={() => loadLogs(detail.name)}>
                        全部服务
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => loadLogs(detail.name, logService)}
                    >
                      <RefreshCw className={`h-4 w-4 ${logsLoading ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </div>
                <ScrollArea className="min-h-0 flex-1 bg-[#0b0f19]">
                  <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed text-emerald-100/90">
                    {logsLoading ? "加载中..." : logs}
                  </pre>
                </ScrollArea>
              </Card>
            </div>

            {/* 右：配置文件 */}
            <Card className="flex min-h-0 flex-col overflow-hidden p-0">
              <Tabs defaultValue="yaml" className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
                  <TabsList>
                    <TabsTrigger value="yaml" className="gap-1.5">
                      <FileCode2 className="h-3.5 w-3.5" />
                      docker-compose.yml
                    </TabsTrigger>
                    <TabsTrigger value="env" className="gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      .env
                    </TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-2">
                    {dirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
                    <Button size="sm" onClick={handleSaveConfig} disabled={busy || !dirty}>
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      保存
                    </Button>
                  </div>
                </div>

                <TabsContent value="yaml" className="mt-0 min-h-0 flex-1">
                  <Editor
                    height="100%"
                    language="yaml"
                    theme={editorTheme}
                    value={yamlDraft}
                    onChange={(v) => setYamlDraft(v ?? "")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      tabSize: 2,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                </TabsContent>

                <TabsContent value="env" className="mt-0 min-h-0 flex-1">
                  <Editor
                    height="100%"
                    language="ini"
                    theme={editorTheme}
                    value={envDraft}
                    onChange={(v) => setEnvDraft(v ?? "")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </div>
      )}

      {/* 新建项目 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加容器编排</DialogTitle>
            <DialogDescription>
              会先创建一个带模板的项目，保存后可在右侧编辑配置再部署
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>项目名称</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-stack"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <p className="text-xs text-muted-foreground">
              小写字母、数字、下划线和短横线，需以字母或数字开头
            </p>
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

      {/* 备注 */}
      <Dialog open={!!remarkTarget} onOpenChange={(open) => !open && setRemarkTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑备注</DialogTitle>
            <DialogDescription>{remarkTarget?.name}</DialogDescription>
          </DialogHeader>
          <Input
            value={remarkValue}
            onChange={(e) => setRemarkValue(e.target.value)}
            placeholder="例如：生产环境 API 服务"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveRemark();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemarkTarget(null)}>
              取消
            </Button>
            <Button onClick={handleSaveRemark} disabled={busy}>
              <Pencil className="mr-1.5 h-4 w-4" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 流式操作输出 */}
      <Dialog open={streamOpen} onOpenChange={(open) => !streaming && setStreamOpen(open)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CircleCheck className="h-4 w-4 text-emerald-500" />
              )}
              {streamTitle}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-80 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-0.5 font-mono text-xs">
              {streamLines.map((line, i) => (
                <div key={i} className="break-all text-muted-foreground">
                  {line}
                </div>
              ))}
              <div ref={streamEndRef} />
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStreamOpen(false)} disabled={streaming}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除编排项目</DialogTitle>
            <DialogDescription>
              将先停止并移除 {deleteTarget?.name} 的所有容器，
              {deleteTarget?.managed
                ? "然后删除面板保存的配置文件。"
                : "该项目配置文件在面板目录之外，不会被删除。"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-destructive/30 p-3">
            <div>
              <div className="text-sm font-medium text-destructive">同时删除数据卷</div>
              <div className="text-xs text-muted-foreground">
                该项目创建的数据卷会被删除，其中数据将永久丢失
              </div>
            </div>
            <Switch checked={deleteVolumes} onCheckedChange={setDeleteVolumes} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 容器终端 */}
      <ContainerDetailDialog
        container={terminalContainer}
        prefix={prefix}
        onClose={() => setTerminalContainer(null)}
      />
    </div>
  );
}
