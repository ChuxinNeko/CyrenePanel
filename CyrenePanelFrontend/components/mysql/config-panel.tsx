"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import Editor from "@monaco-editor/react";
import { toast } from "sonner";
import { AlertTriangle, FileText, Loader2, RefreshCw, Save, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_BASE } from "@/lib/api-base";

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

export function MysqlConfigPanel({ connectionId }: { connectionId: string }) {
  const { resolvedTheme } = useTheme();
  const [tab, setTab] = useState("config");

  // my.cnf
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [configError, setConfigError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 慢查询
  const [slowLog, setSlowLog] = useState<{
    enabled: boolean;
    file: string;
    content: string;
    longQueryTime?: number;
    message?: string;
  } | null>(null);
  const [slowLoading, setSlowLoading] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<{ success: boolean; path?: string; content?: string; message?: string }>(
        "/api/mysql/config",
      );
      if (res.success && res.path) {
        setPath(res.path);
        setContent(res.content || "");
        setOriginal(res.content || "");
        setConfigError("");
      } else {
        setConfigError(res.message || "无法读取配置文件");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSlowLog = useCallback(async () => {
    if (!connectionId) return;
    setSlowLoading(true);
    try {
      const res = await call<any>(
        `/api/mysql/slow-log?connectionId=${encodeURIComponent(connectionId)}&lines=500`,
      );
      if (res.success) setSlowLog(res);
      else toast.error(res.message || "读取慢查询日志失败");
    } finally {
      setSlowLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (tab === "slow" && !slowLog) loadSlowLog();
  }, [tab, slowLog, loadSlowLog]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await call<{ success: boolean; message?: string; backup?: string }>(
        "/api/mysql/config",
        { method: "POST", body: JSON.stringify({ content }) },
      );
      if (res.success) {
        toast.success(res.message || "已保存");
        setOriginal(content);
      } else {
        toast.error(res.message || "保存失败");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="config" className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            配置文件
          </TabsTrigger>
          <TabsTrigger value="slow" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            慢查询日志
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : configError ? (
            <Card className="flex-1">
              <CardContent className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-8 w-8 opacity-40" />
                <p>{configError}</p>
                <p className="text-xs">
                  MySQL 运行在容器或远程主机时，配置文件不在本机，需要到对应位置修改
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-mono">
                    {path}
                  </Badge>
                  {content !== original && (
                    <span className="text-amber-600">有未保存的修改</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={loadConfig}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || content === original}>
                    {saving ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-4 w-4" />
                    )}
                    保存
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
                <Editor
                  height="100%"
                  language="ini"
                  theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                  value={content}
                  onChange={(v) => setContent(v ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>

              <p className="shrink-0 text-xs text-muted-foreground">
                保存前会自动把原文件备份为 <code>.cyrene.bak</code>。修改后需要重启 MySQL 才会生效；
                配置有误会导致 MySQL 无法启动，请谨慎修改。
              </p>
            </>
          )}
        </TabsContent>

        <TabsContent value="slow" className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {slowLog?.enabled ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                  已开启
                </Badge>
              ) : (
                <Badge variant="outline">未开启</Badge>
              )}
              {slowLog?.longQueryTime !== undefined && (
                <span className="text-xs text-muted-foreground">
                  阈值 {slowLog.longQueryTime}s
                </span>
              )}
              {slowLog?.file && (
                <span className="font-mono text-xs text-muted-foreground">{slowLog.file}</span>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={loadSlowLog} disabled={slowLoading}>
              <RefreshCw className={`h-4 w-4 ${slowLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <Card className="min-h-0 flex-1 overflow-hidden p-0">
            <CardContent className="h-full p-0">
              <ScrollArea className="h-full bg-[#0b0f19]">
                <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed text-emerald-100/90">
                  {slowLoading
                    ? "加载中..."
                    : slowLog?.content ||
                      slowLog?.message ||
                      "暂无慢查询记录"}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>

          {!slowLog?.enabled && (
            <p className="shrink-0 text-xs text-muted-foreground">
              在配置文件中加入 slow_query_log=1 与 long_query_time=1 并重启 MySQL 即可开启。
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
