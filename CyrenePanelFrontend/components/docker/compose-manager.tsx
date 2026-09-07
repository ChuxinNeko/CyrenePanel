"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import Editor from "@monaco-editor/react";
import { toast } from "sonner";
import {
  CircleCheck,
  FileCode2,
  FileText,
  Layers3,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Square,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { API_BASE } from "@/lib/api-base";
import { dockerDelete, dockerGet, dockerPost, type ApiResult } from "@/lib/docker-api";

const TEMPLATE = `services:
  app:
    image: nginx:alpine
    container_name: my-app
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./data:/usr/share/nginx/html
    environment:
      - TZ=Asia/Shanghai
`;

interface ComposeProject {
  name: string;
  managed: boolean;
  status: string;
  configFiles: string;
  serviceCount: number;
  runningCount: number;
}

interface ComposeService {
  name: string;
  service: string;
  image: string;
  state: string;
  status: string;
  health: string;
  ports: string[];
}

export function ComposeManager({ prefix }: { prefix: string }) {
  const { resolvedTheme } = useTheme();
  const [projects, setProjects] = useState<ComposeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 编辑器
  const [editorOpen, setEditorOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState(TEMPLATE);
  const [isNew, setIsNew] = useState(true);

  // 详情
  const [detailName, setDetailName] = useState<string | null>(null);
  const [services, setServices] = useState<ComposeService[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 日志
  const [logsName, setLogsName] = useState<string | null>(null);
  const [logs, setLogs] = useState("");

  // 流式操作输出
  const [streamOpen, setStreamOpen] = useState(false);
  const [streamTitle, setStreamTitle] = useState("");
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const streamEndRef = useRef<HTMLDivElement>(null);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<ComposeProject | null>(null);
  const [deleteVolumes, setDeleteVolumes] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dockerGet<{ success: boolean; projects?: ComposeProject[]; message?: string }>(
        `${prefix}/compose/projects`,
      );
      if (data.success && data.projects) setProjects(data.projects);
      else {
        toast.error(data.message || "获取编排项目失败");
        setProjects([]);
      }
    } catch {
      toast.error("获取编排项目失败");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamLines]);

  const openNew = () => {
    setIsNew(true);
    setEditName("");
    setEditContent(TEMPLATE);
    setEditorOpen(true);
  };

  const openEdit = async (project: ComposeProject) => {
    setBusy(true);
    try {
      const data = await dockerGet<{
        success: boolean;
        project?: { name: string; managed: boolean; content: string };
        message?: string;
      }>(`${prefix}/compose/projects/${encodeURIComponent(project.name)}`);

      if (data.success && data.project) {
        if (!data.project.managed) {
          toast.error("该项目不是通过面板创建的，没有可编辑的配置文件");
          return;
        }
        setIsNew(false);
        setEditName(project.name);
        setEditContent(data.project.content);
        setEditorOpen(true);
      } else {
        toast.error(data.message || "读取配置失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const name = editName.trim().toLowerCase();
    if (!name) {
      toast.error("请输入项目名称");
      return;
    }
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/compose/projects`, {
        name,
        content: editContent,
      });
      if (data.success) {
        toast.success(data.message || "已保存");
        setEditorOpen(false);
        load();
      } else {
        toast.error(data.message || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/compose/validate`, {
        content: editContent,
      });
      if (data.success) toast.success(data.message || "配置校验通过");
      else toast.error(data.message || "配置校验失败");
    } finally {
      setBusy(false);
    }
  };

  /** 生命周期操作走 SSE，实时显示 docker compose 的输出 */
  const runAction = async (name: string, action: string, extra?: Record<string, unknown>) => {
    const labels: Record<string, string> = {
      up: "部署",
      down: "移除",
      start: "启动",
      stop: "停止",
      restart: "重启",
      pull: "拉取镜像",
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
      load();
      if (detailName) openDetail(detailName);
    }
  };

  const openDetail = async (name: string) => {
    setDetailName(name);
    setDetailLoading(true);
    try {
      const data = await dockerGet<{
        success: boolean;
        project?: { services: ComposeService[] };
        message?: string;
      }>(`${prefix}/compose/projects/${encodeURIComponent(name)}`);
      if (data.success && data.project) setServices(data.project.services);
      else setServices([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const openLogs = async (name: string) => {
    setLogsName(name);
    setLogs("加载中...");
    const data = await dockerGet<{ success: boolean; logs?: string; message?: string }>(
      `${prefix}/compose/projects/${encodeURIComponent(name)}/logs?tail=500`,
    );
    setLogs(data.success ? data.logs || "（无日志）" : data.message || "获取日志失败");
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
        setDeleteTarget(null);
        load();
      } else {
        toast.error(data.message || "删除失败");
      }
    } finally {
      setBusy(false);
      setDeleteVolumes(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <Layers3 className="h-4 w-4 text-muted-foreground" />
            {projects.length} 个编排项目
          </span>
          <Badge variant="secondary">
            {projects.filter((p) => p.runningCount > 0).length} 个运行中
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" />
            新建项目
          </Button>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
              <FileCode2 className="h-8 w-8 opacity-40" />
              <div>还没有编排项目</div>
              <Button size="sm" variant="outline" onClick={openNew}>
                创建第一个
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-medium">项目</th>
                    <th className="p-3 text-left font-medium">服务</th>
                    <th className="p-3 text-left font-medium">状态</th>
                    <th className="p-3 text-left font-medium">来源</th>
                    <th className="p-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr
                      key={project.name}
                      className="border-b transition-colors last:border-0 hover:bg-muted/30"
                    >
                      <td className="p-3">
                        <button
                          className="font-medium text-primary hover:underline"
                          onClick={() => openDetail(project.name)}
                        >
                          {project.name}
                        </button>
                      </td>
                      <td className="p-3">
                        {project.runningCount}/{project.serviceCount}
                      </td>
                      <td className="p-3">
                        {project.runningCount > 0 ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                            运行中
                          </Badge>
                        ) : (
                          <Badge variant="outline">已停止</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        {project.managed ? (
                          <Badge variant="secondary">面板托管</Badge>
                        ) : (
                          <Badge variant="outline" title={project.configFiles}>
                            外部项目
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="部署 / 更新"
                            disabled={streaming}
                            onClick={() => runAction(project.name, "up")}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="重启"
                            disabled={streaming}
                            onClick={() => runAction(project.name, "restart")}
                          >
                            <RotateCw className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="停止"
                            disabled={streaming}
                            onClick={() => runAction(project.name, "stop")}
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="日志"
                            onClick={() => openLogs(project.name)}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title={project.managed ? "编辑配置" : "外部项目无法编辑"}
                            disabled={!project.managed || busy}
                            onClick={() => openEdit(project)}
                          >
                            <FileCode2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            title="删除项目"
                            onClick={() => setDeleteTarget(project)}
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

      {/* YAML 编辑器 */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="flex h-[85vh] w-[95vw] flex-col gap-0 p-0 sm:max-w-5xl">
          <DialogHeader className="border-b px-5 py-3">
            <DialogTitle>{isNew ? "新建编排项目" : `编辑 ${editName}`}</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-3 border-b px-5 py-3">
            <Label className="shrink-0">项目名称</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="my-stack"
              disabled={!isNew}
              className="max-w-64"
            />
            <span className="text-xs text-muted-foreground">
              小写字母、数字、下划线、短横线
            </span>
          </div>

          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language="yaml"
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              value={editContent}
              onChange={(value) => setEditContent(value ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                tabSize: 2,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>

          <DialogFooter className="border-t px-5 py-3">
            <Button variant="outline" onClick={handleValidate} disabled={busy}>
              <CircleCheck className="mr-1.5 h-4 w-4" />
              校验配置
            </Button>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              <Save className="mr-1.5 h-4 w-4" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 项目详情 */}
      <Dialog open={!!detailName} onOpenChange={(open) => !open && setDetailName(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>项目详情 · {detailName}</DialogTitle>
            <DialogDescription>该项目包含的服务及其运行状态</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : services.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              该项目当前没有容器（可能尚未部署）
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">服务</th>
                  <th className="p-2 text-left font-medium">镜像</th>
                  <th className="p-2 text-left font-medium">状态</th>
                  <th className="p-2 text-left font-medium">端口</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.name} className="border-b last:border-0">
                    <td className="p-2">
                      <div className="font-medium">{s.service || s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.name}</div>
                    </td>
                    <td className="max-w-56 p-2">
                      <div className="truncate text-xs" title={s.image}>
                        {s.image}
                      </div>
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={s.state === "running" ? "default" : "outline"}
                        className={
                          s.state === "running"
                            ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15"
                            : ""
                        }
                      >
                        {s.status || s.state}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{s.ports.join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogContent>
      </Dialog>

      {/* 日志 */}
      <Dialog open={!!logsName} onOpenChange={(open) => !open && setLogsName(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>项目日志 · {logsName}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] rounded-lg border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs">{logs}</pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => logsName && openLogs(logsName)}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              刷新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 流式操作输出 */}
      <Dialog open={streamOpen} onOpenChange={(open) => !streaming && setStreamOpen(open)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {streaming && <Loader2 className="h-4 w-4 animate-spin" />}
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
              {deleteTarget?.managed ? "然后删除面板保存的配置文件。" : "该项目的配置文件不由面板管理，不会被删除。"}
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
    </div>
  );
}
