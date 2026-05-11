"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { API_BASE } from "@/lib/api-base";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { usePanelName } from "@/lib/panel-name-context";
import { Textarea } from "@/components/ui/textarea";
import { EnvironmentSelfCheckDialog } from "@/components/environment-self-check-dialog";
import {
  Settings,
  Save,
  RefreshCw,
  Shield,
  Container,
  Eye,
  EyeOff,
  Copy,
  Check,
  Code,
  PackageCheck,
  ExternalLink,
  Download,
  Loader2,
  Server,
  Bell,
  Send,
} from "lucide-react";

interface PanelUpdateInfo {
  success: boolean;
  currentVersion?: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  changelog?: string[];
  releaseDate?: string | null;
  downloadUrl?: string | null;
  githubDownloadUrl?: string | null;
  canAutoUpdate?: boolean;
  message?: string;
}

interface PanelUpdateLogs {
  success: boolean;
  logs?: string[];
  running?: boolean;
  completed?: boolean;
  failed?: boolean;
  lastLine?: string;
  status?: {
    status?: string;
    version?: string;
    message?: string;
    updatedAt?: string;
  } | null;
  message?: string;
}

function updateAuthHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function updateRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(updateAuthHeaders());
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` }));
  if (!res.ok) {
    return {
      success: false,
      message: data?.message || `HTTP ${res.status}`,
    } as T;
  }
  return data as T;
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<{ username: string; role: string } | null>(null);
  const { updatePanelName } = usePanelName();

  // 通用设置
  const [panelName, setPanelName] = useState("CyrenePanel");
  const [logLevel, setLogLevel] = useState("INFO");

  // Docker 设置
  const [dockerMirrorEnabled, setDockerMirrorEnabled] = useState(false);
  const [dockerMirrorUrl, setDockerMirrorUrl] = useState("");

  // 页脚代码
  const [footerCode, setFooterCode] = useState("");

  // Version update
  const [currentVersion, setCurrentVersion] = useState("");
  const [nodes, setNodes] = useState<any[]>([]);
  const [updateInfo, setUpdateInfo] = useState<PanelUpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updatingNodeId, setUpdatingNodeId] = useState<string | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateSubmitted, setUpdateSubmitted] = useState(false);
  const updateLogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const updateToastIdRef = useRef<string | number | null>(null);

  // API Key
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // 告警设置
  type AlertRuleType =
    | "auth_login_success"
    | "auth_login_failed"
    | "sensitive_action"
    | "cpu_high"
    | "memory_high";
  interface AlertRule {
    type: AlertRuleType;
    enabled: boolean;
    threshold?: number;
    cooldownMin?: number;
    label?: string;
  }
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState<number>(465);
  const [smtpEncryption, setSmtpEncryption] = useState<"ssl" | "starttls" | "none">("ssl");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpPassConfigured, setSmtpPassConfigured] = useState(false);
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpTo, setSmtpTo] = useState("");
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [testingAlert, setTestingAlert] = useState(false);

  const RULE_DESCRIPTIONS: Record<AlertRuleType, string> = {
    auth_login_success: "用户登录成功时发送邮件通知。",
    auth_login_failed: "用户登录失败时发送邮件通知（密码错误、用户不存在等）。",
    sensitive_action: "敏感操作（用户/证书/节点/系统类、含删除/重置/重新生成等关键字）触发时发送通知。",
    cpu_high: "本机 CPU 使用率持续高于阈值时发送通知。",
    memory_high: "本机内存使用率高于阈值时发送通知。",
  };

  const fetchSettings = useCallback(async () => {
    try {
      const { data, error } = await (api as any).api.settings.get();
      if (error) {
        toast.error("获取设置失败");
        return;
      }
      if (data?.success && data.settings) {
        const s = data.settings as Record<string, any>;
        const name = s.panelName || "CyrenePanel";
        setPanelName(name);
        setLogLevel(s.logLevel || "INFO");
        setDockerMirrorEnabled(!!s.dockerMirrorEnabled);
        setDockerMirrorUrl(s.dockerMirrorUrl || "");
        setFooterCode(s.footerCode || "");
        setApiKey(s.apiKey || "");
        // 同步面板名称到全局上下文
        updatePanelName(name);
      }
    } catch {
      // ignore
    }
  }, [updatePanelName]);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await updateRequest<{
        success: boolean;
        smtp?: {
          host: string;
          port: number;
          encryption: "ssl" | "starttls" | "none";
          user: string;
          from: string;
          to: string;
          passConfigured: boolean;
        };
        rules?: AlertRule[];
        message?: string;
      }>("/api/alerts/settings");
      if (!data?.success) return;
      if (data.smtp) {
        setSmtpHost(data.smtp.host || "");
        setSmtpPort(data.smtp.port || 465);
        setSmtpEncryption(data.smtp.encryption || "ssl");
        setSmtpUser(data.smtp.user || "");
        setSmtpFrom(data.smtp.from || "");
        setSmtpTo(data.smtp.to || "");
        setSmtpPassConfigured(!!data.smtp.passConfigured);
        setSmtpPass("");
      }
      if (Array.isArray(data.rules)) setAlertRules(data.rules);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
        const p = data.profile as { username: string; role: string };
        setProfile(p);
        if ((data as any).version) {
          setCurrentVersion((data as any).version);
        }
        if (p.role !== "admin") {
          toast.error("仅管理员可访问设置页面");
          router.push("/dashboard");
          return;
        }
        await fetchSettings();
        await fetchAlerts();
        try {
          const overviewRes = await (api as any).api.nodes.overview.get();
          if (overviewRes?.data?.success) {
            setNodes(overviewRes.data.nodes || []);
          }
        } catch {}
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
    }, [router, fetchSettings]);

  useEffect(() => {
    return () => {
      if (updateLogTimerRef.current) {
        clearInterval(updateLogTimerRef.current);
      }
    };
  }, []);

  const handleSaveGeneral = async () => {
    setSaving(true);
    try {
      const { data, error } = await (api as any).api.settings.general.put({
        panelName,
        logLevel,
      });
      if (error) {
        toast.error("保存失败");
        return;
      }
      if (data?.success) {
        updatePanelName(panelName);
        toast.success("通用设置已保存");
      } else {
        toast.error(data?.message || "保存失败");
      }
    } catch {
      toast.error("发生意外错误");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFooter = async () => {
    setSaving(true);
    try {
      const { data, error } = await (api as any).api.settings.footer.put({
        code: footerCode,
      });
      if (error) {
        toast.error("保存失败");
        return;
      }
      if (data?.success) {
        toast.success("页脚设置已保存");
      } else {
        toast.error(data?.message || "保存失败");
      }
    } catch {
      toast.error("发生意外错误");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDocker = async () => {
    setSaving(true);
    try {
      const { data, error } = await (api as any).api.settings.docker.put({
        mirrorEnabled: dockerMirrorEnabled,
        mirrorUrl: dockerMirrorUrl,
      });
      if (error) {
        toast.error("保存失败");
        return;
      }
      if (data?.success) {
        toast.success("Docker 设置已保存");
      } else {
        toast.error(data?.message || "保存失败");
      }
    } catch {
      toast.error("发生意外错误");
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateApiKey = async () => {
    setRegenerating(true);
    try {
      const { data, error } = await (api as any).api.settings["regenerate-api-key"].post();
      if (error) {
        toast.error("重新生成失败");
        return;
      }
      if (data?.success && data.apiKey) {
        setApiKey(data.apiKey);
        toast.success("API Key 已重新生成");
      } else {
        toast.error(data?.message || "重新生成失败");
      }
    } catch {
      toast.error("发生意外错误");
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopyApiKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    toast.success("API Key 已复制到剪贴板");
    setTimeout(() => setCopied(false), 2000);
  };

  const buildAlertPayload = (includePass: boolean) => ({
    smtp: {
      host: smtpHost.trim(),
      port: Number(smtpPort) || 0,
      encryption: smtpEncryption,
      user: smtpUser,
      ...(includePass ? { pass: smtpPass } : {}),
      from: smtpFrom.trim(),
      to: smtpTo.trim(),
    },
  });

  const handleSaveAlerts = async () => {
    setSaving(true);
    try {
      const payload = {
        ...buildAlertPayload(smtpPass.length > 0),
        rules: alertRules.map((r) => ({
          type: r.type,
          enabled: r.enabled,
          threshold: r.threshold,
          cooldownMin: r.cooldownMin,
        })),
      };
      const data = await updateRequest<{ success: boolean; message?: string }>(
        "/api/alerts/settings",
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );
      if (data?.success) {
        toast.success("告警设置已保存");
        setSmtpPass("");
        await fetchAlerts();
      } else {
        toast.error(data?.message || "保存失败");
      }
    } catch {
      toast.error("发生意外错误");
    } finally {
      setSaving(false);
    }
  };

  const handleTestAlert = async () => {
    if (!smtpHost.trim() || !smtpFrom.trim() || !smtpTo.trim()) {
      toast.error("请先填写 SMTP 主机、发件人和收件人");
      return;
    }
    setTestingAlert(true);
    try {
      const data = await updateRequest<{ success: boolean; message?: string }>(
        "/api/alerts/test",
        {
          method: "POST",
          body: JSON.stringify(buildAlertPayload(smtpPass.length > 0)),
        },
      );
      if (data?.success) {
        toast.success("测试邮件发送成功，请查收");
      } else {
        toast.error(data?.message || "测试邮件发送失败");
      }
    } catch {
      toast.error("发生意外错误");
    } finally {
      setTestingAlert(false);
    }
  };

  const updateRule = (type: AlertRuleType, patch: Partial<AlertRule>) => {
    setAlertRules((prev) => prev.map((r) => (r.type === type ? { ...r, ...patch } : r)));
  };

  const handleCheckNodeUpdate = async (nodeId: string) => {
    setCheckingUpdate(true);
    setUpdatingNodeId(nodeId);
    try {
      const path = nodeId === "__main__"
        ? "/api/system/update"
        : `/api/nodes/${encodeURIComponent(nodeId)}/system/update`;
      const data = await updateRequest<PanelUpdateInfo>(path);

      if (!data?.success) {
        toast.error((data as PanelUpdateInfo | undefined)?.message || "检查更新失败");
        return;
      }

      const info = data as PanelUpdateInfo;
      setUpdateInfo(info);
      setUpdateSubmitted(false);
      setUpdateDialogOpen(true);
      setCurrentVersion(info.currentVersion || currentVersion);
      if (info.hasUpdate) {
        toast.info(`检测到新版本 ${info.latestVersion}`);
      } else {
        toast.success("当前已是最新版本");
      }
    } catch {
      toast.error("检查更新失败");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const stopUpdateLogPolling = () => {
    if (updateLogTimerRef.current) {
      clearInterval(updateLogTimerRef.current);
      updateLogTimerRef.current = null;
    }
  };

  const formatUpdateLogDescription = (logs?: string[], status?: PanelUpdateLogs["status"]) => {
    const latestLogs = (logs || []).slice(-3);
    if (latestLogs.length > 0) return latestLogs.join(" / ");
    if (status?.message) return status.message;
    if (status?.status) return `Update status: ${status.status}`;
    return latestLogs.length > 0 ? latestLogs.join(" / ") : "等待更新助手开始执行...";
  };

  const pollUpdateLogs = async (nodeId: string) => {
    try {
      const path = nodeId === "__main__"
        ? "/api/system/update/logs"
        : `/api/nodes/${encodeURIComponent(nodeId)}/system/update/logs`;
      const data = await updateRequest<PanelUpdateLogs>(path);

      if (!data?.success) return;

      const logInfo = data as PanelUpdateLogs;
      const id = updateToastIdRef.current || "panel-update-log";
      updateToastIdRef.current = id;

      if (logInfo.completed) {
        stopUpdateLogPolling();
        toast.success("面板更新完成", {
          id,
          description: logInfo.lastLine || "服务正在重启，请稍后刷新页面。",
          duration: 10000,
        });
        return;
      }

      if (logInfo.failed) {
        stopUpdateLogPolling();
        toast.error("面板更新失败", {
          id,
          description: logInfo.lastLine || "请查看后端更新日志。",
          duration: 15000,
        });
        return;
      }

      if (!logInfo.running && !logInfo.status && (logInfo.logs || []).length === 0) {
        stopUpdateLogPolling();
        toast.error("更新任务未启动", {
          id,
          description: "后端没有找到更新请求或日志，请检查 cyrene-updater.path 是否已启用。",
          duration: 15000,
        });
        return;
      }

      toast.loading("正在更新面板", {
        id,
        description: formatUpdateLogDescription(logInfo.logs, logInfo.status),
      });
    } catch {
      const id = updateToastIdRef.current || "panel-update-log";
      updateToastIdRef.current = id;
      toast.loading("正在更新面板", {
        id,
        description: "服务可能正在重启，稍后将继续尝试读取更新日志。",
      });
    }
  };

  const startUpdateLogPolling = (nodeId: string) => {
    stopUpdateLogPolling();
    const id = "panel-update-log";
    updateToastIdRef.current = id;
    toast.loading("正在更新面板", {
      id,
      description: "更新任务已提交，正在等待更新助手接管...",
    });
    void pollUpdateLogs(nodeId);
    updateLogTimerRef.current = setInterval(() => {
      void pollUpdateLogs(nodeId);
    }, 2000);
  };

  const handleApplyUpdate = async () => {
    if (!updatingNodeId) return;
    setApplyingUpdate(true);
    try {
      const path = updatingNodeId === "__main__"
        ? "/api/system/update/apply"
        : `/api/nodes/${encodeURIComponent(updatingNodeId)}/system/update/apply`;
      const data = await updateRequest<PanelUpdateInfo>(path, { method: "POST" });

      if (!data?.success) {
        toast.error(data?.message || "提交更新失败");
        return;
      }
      setUpdateSubmitted(true);
      startUpdateLogPolling(updatingNodeId);
    } catch {
      toast.error("提交更新失败");
    } finally {
      setApplyingUpdate(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto w-full">
        <Card>
          <CardHeader>
            <CardTitle>系统设置</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              加载中...
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">系统设置</h1>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general" className="gap-1.5">
            <Settings className="h-4 w-4" />
            通用设置
          </TabsTrigger>
          <TabsTrigger value="docker" className="gap-1.5">
            <Container className="h-4 w-4" />
            Docker 设置
          </TabsTrigger>
          <TabsTrigger value="footer" className="gap-1.5">
            <Code className="h-4 w-4" />
            页脚设置
          </TabsTrigger>
          <TabsTrigger value="environment" className="gap-1.5">
            <PackageCheck className="h-4 w-4" />
            环境检测
          </TabsTrigger>
          <TabsTrigger value="version" className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            版本更新
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5">
            <Shield className="h-4 w-4" />
            安全设置
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5">
            <Bell className="h-4 w-4" />
            告警设置
          </TabsTrigger>
        </TabsList>

        {/* ── 通用设置 ────────────────────────────────────────────── */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>通用设置</CardTitle>
              <CardDescription>
                配置面板的基本信息和日志级别。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="panel-name">面板名称</Label>
                <Input
                  id="panel-name"
                  value={panelName}
                  onChange={(e) => setPanelName(e.target.value)}
                  placeholder="输入面板名称"
                />
                <p className="text-sm text-muted-foreground">
                  面板显示名称，当前用于标识面板实例。
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="log-level">日志级别</Label>
                <select
                  id="log-level"
                  value={logLevel}
                  onChange={(e) => setLogLevel(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="DEBUG">DEBUG - 调试（详细日志）</option>
                  <option value="INFO">INFO - 信息（默认）</option>
                  <option value="WARN">WARN - 警告</option>
                  <option value="ERROR">ERROR - 错误</option>
                </select>
                <p className="text-sm text-muted-foreground">
                  设置后端日志级别。DEBUG 级别会记录详细的请求和响应信息。
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveGeneral} disabled={saving}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {saving ? "保存中..." : "保存设置"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Docker 设置 ─────────────────────────────────────────── */}
        <TabsContent value="docker">
          <Card>
            <CardHeader>
              <CardTitle>Docker 设置</CardTitle>
              <CardDescription>
                配置 Docker 镜像仓库镜像，加速镜像拉取。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="mirror-enabled">启用镜像仓库</Label>
                  <p className="text-sm text-muted-foreground">
                    启用后，拉取镜像时会自动使用配置的镜像仓库地址。
                  </p>
                </div>
                <Switch
                  id="mirror-enabled"
                  checked={dockerMirrorEnabled}
                  onCheckedChange={setDockerMirrorEnabled}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="mirror-url">镜像仓库地址</Label>
                <Input
                  id="mirror-url"
                  value={dockerMirrorUrl}
                  onChange={(e) => setDockerMirrorUrl(e.target.value)}
                  placeholder="例如：https://mirror.ccs.tencentyun.com"
                  disabled={!dockerMirrorEnabled}
                />
                <p className="text-sm text-muted-foreground">
                  输入镜像仓库的 URL 地址。启用后，Docker 镜像拉取会通过该仓库代理。
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveDocker} disabled={saving}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {saving ? "保存中..." : "保存设置"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 页脚设置 ────────────────────────────────────────────── */}
        <TabsContent value="footer">
          <Card>
            <CardHeader>
              <CardTitle>页脚设置</CardTitle>
              <CardDescription>
                自定义页脚区域的附加代码。自定义内容将显示在全局页脚（Copyright 信息）下方，不会覆盖全局页脚。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="footer-code">自定义页脚代码</Label>
                <Textarea
                  id="footer-code"
                  value={footerCode}
                  onChange={(e) => setFooterCode(e.target.value)}
                  placeholder="<!-- 在此输入自定义 HTML/CSS/JS 代码 -->"
                  rows={8}
                  className="font-mono text-sm"
                />
                <p className="text-sm text-muted-foreground">
                  支持 HTML、内联 CSS 和 JavaScript 代码。该代码将渲染在全局页脚下方。
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveFooter} disabled={saving}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {saving ? "保存中..." : "保存设置"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 环境检测 ────────────────────────────────────────────── */}
        <TabsContent value="environment">
          <Card>
            <CardHeader>
              <CardTitle>环境检测</CardTitle>
              <CardDescription>
                检查主节点与子节点运行所需的系统命令与依赖，发现缺失项后可由面板自动安装。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <PackageCheck className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="space-y-1">
                    <div className="font-medium">面板环境自检</div>
                    <p className="text-sm text-muted-foreground">
                      当前会检测主节点和所有子节点中文件管理压缩/解压所需的 tar、zip、unzip 等依赖。Linux 节点支持通过系统包管理器自动安装缺失项。
                    </p>
                  </div>
                </div>
              </div>

              <EnvironmentSelfCheckDialog
                autoCheck={false}
                trigger={
                  <Button>
                    <PackageCheck className="h-4 w-4 mr-1.5" />
                    开始环境检测
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 版本更新 ────────────────────────────────────────────── */}
        <TabsContent value="version">
          <Card>
            <CardHeader>
              <CardTitle>版本更新</CardTitle>
              <CardDescription>
                查看当前面板版本，并手动连接官方服务器检测新版和更新内容。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
                <div className="flex flex-col gap-1">
                  <div className="font-medium">节点版本状态</div>
                  <p className="text-sm text-muted-foreground">
                    各节点的 CyrenePanel 当前运行版本。
                  </p>
                </div>

                <div className="flex flex-col gap-2 mt-2">
                  {nodes.length > 0 ? nodes.map((node) => (
                    <div key={node.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded border bg-background/50">
                      <div className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm truncate">{node.name}</span>
                        {node.isMain && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0">主</Badge>}
                        {!node.online && <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4 shrink-0">离线</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                         <Badge variant="outline" className="font-mono">{node.panelVersion || (node.isMain ? currentVersion : "未知")}</Badge>
                         <Button
                           variant="ghost"
                           size="sm"
                           className="h-7 text-xs px-2"
                           disabled={!node.online || checkingUpdate}
                           onClick={() => handleCheckNodeUpdate(node.id)}
                         >
                           {checkingUpdate && updatingNodeId === node.id ? (
                             <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                           ) : (
                             <RefreshCw className="h-3 w-3 mr-1" />
                           )}
                           检测更新
                         </Button>
                      </div>
                    </div>
                  )) : (
                    <div className="text-sm text-muted-foreground py-2">加载节点信息中...</div>
                  )}
                </div>

                {updateInfo && (
                  <>
                    <Separator />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <div className="font-medium">检测结果</div>
                        <p className="text-sm text-muted-foreground">
                          {updateInfo.hasUpdate
                            ? "官方服务器检测到可用的新版本。"
                            : "当前版本已是官方服务器返回的最新版本。"}
                        </p>
                      </div>
                      <Badge variant={updateInfo.hasUpdate ? "default" : "secondary"} className="font-mono">
                        {updateInfo.hasUpdate ? `可更新到 ${updateInfo.latestVersion}` : "已是最新"}
                      </Badge>
                    </div>

                    {updateInfo.releaseDate && (
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">发布日期</span>
                        <span>{updateInfo.releaseDate}</span>
                      </div>
                    )}

                    {updateInfo.changelog && updateInfo.changelog.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <div className="text-sm font-medium">更新内容</div>
                        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                          {updateInfo.changelog.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {updateInfo?.downloadUrl && (
                  <Button variant="outline" asChild>
                    <a href={updateInfo.downloadUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" />
                      查看更新说明
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 安全设置 ────────────────────────────────────────────── */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>API Key</CardTitle>
              <CardDescription>
                API Key 用于节点连接和外部 API 访问认证。请妥善保管。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>当前 API Key</Label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      value={showApiKey ? apiKey : "•".repeat(32)}
                      readOnly
                      className="pr-10 font-mono text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyApiKey}
                    title="复制 API Key"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>重新生成 API Key</Label>
                <p className="text-sm text-muted-foreground">
                  重新生成 API Key 后，旧的 API Key 将立即失效。所有使用旧 Key 的节点需要重新配置。
                </p>
                <Button
                  variant="destructive"
                  onClick={handleRegenerateApiKey}
                  disabled={regenerating}
                >
                  <RefreshCw className={`h-4 w-4 mr-1.5 ${regenerating ? "animate-spin" : ""}`} />
                  {regenerating ? "生成中..." : "重新生成 API Key"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 告警设置 ────────────────────────────────────────────── */}
        <TabsContent value="alerts">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>SMTP 邮件配置</CardTitle>
                <CardDescription>
                  配置发送告警邮件的 SMTP 服务器。告警邮件将从当前节点（主节点）通过此 SMTP 服务器发出。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-host">SMTP 主机</Label>
                    <Input
                      id="smtp-host"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="例如：smtp.example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-port">端口</Label>
                    <Input
                      id="smtp-port"
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(Number(e.target.value) || 0)}
                      placeholder="465 / 587 / 25"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-encryption">加密方式</Label>
                    <select
                      id="smtp-encryption"
                      value={smtpEncryption}
                      onChange={(e) =>
                        setSmtpEncryption(e.target.value as "ssl" | "starttls" | "none")
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="ssl">SSL/TLS（隐式 TLS，常用端口 465）</option>
                      <option value="starttls">STARTTLS（常用端口 587）</option>
                      <option value="none">不加密（不推荐，端口 25）</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-from">发件人地址</Label>
                    <Input
                      id="smtp-from"
                      value={smtpFrom}
                      onChange={(e) => setSmtpFrom(e.target.value)}
                      placeholder='例如：CyrenePanel <noreply@example.com>'
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-user">用户名</Label>
                    <Input
                      id="smtp-user"
                      value={smtpUser}
                      onChange={(e) => setSmtpUser(e.target.value)}
                      placeholder="SMTP 登录用户名"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-pass">密码 / 授权码</Label>
                    <div className="relative">
                      <Input
                        id="smtp-pass"
                        type={showSmtpPass ? "text" : "password"}
                        value={smtpPass}
                        onChange={(e) => setSmtpPass(e.target.value)}
                        placeholder={smtpPassConfigured ? "（已设置，留空表示不修改）" : "请输入密码或授权码"}
                        className="pr-10"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="button"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setShowSmtpPass((v) => !v)}
                      >
                        {showSmtpPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp-to">告警收件人</Label>
                  <Input
                    id="smtp-to"
                    value={smtpTo}
                    onChange={(e) => setSmtpTo(e.target.value)}
                    placeholder="多个邮箱以逗号分隔，例如：admin@example.com, ops@example.com"
                  />
                  <p className="text-sm text-muted-foreground">
                    所有触发的告警都会发送到这些邮箱。
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={handleTestAlert} disabled={testingAlert || saving}>
                    {testingAlert ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-1.5" />
                    )}
                    {testingAlert ? "发送中..." : "发送测试邮件"}
                  </Button>
                  <Button onClick={handleSaveAlerts} disabled={saving}>
                    <Save className="h-4 w-4 mr-1.5" />
                    {saving ? "保存中..." : "保存设置"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>告警规则</CardTitle>
                <CardDescription>
                  开启需要监控的事件。CPU / 内存类规则会每 30 秒检查一次本机指标。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {alertRules.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2">加载规则中...</div>
                ) : (
                  alertRules.map((rule, idx) => (
                    <div key={rule.type}>
                      {idx > 0 && <Separator className="my-2" />}
                      <div className="flex items-start justify-between gap-3 py-2">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="font-medium">{rule.label || rule.type}</div>
                          <p className="text-sm text-muted-foreground">
                            {RULE_DESCRIPTIONS[rule.type]}
                          </p>
                          {(rule.type === "cpu_high" || rule.type === "memory_high") && (
                            <div className="flex flex-wrap items-center gap-3 pt-1">
                              <Label htmlFor={`threshold-${rule.type}`} className="text-xs text-muted-foreground">
                                阈值(%)
                              </Label>
                              <Input
                                id={`threshold-${rule.type}`}
                                type="number"
                                min={1}
                                max={100}
                                value={rule.threshold ?? 90}
                                onChange={(e) =>
                                  updateRule(rule.type, {
                                    threshold: Math.max(1, Math.min(100, Number(e.target.value) || 0)),
                                  })
                                }
                                className="h-8 w-24"
                                disabled={!rule.enabled}
                              />
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-3 pt-1">
                            <Label htmlFor={`cooldown-${rule.type}`} className="text-xs text-muted-foreground">
                              冷却时间(分钟)
                            </Label>
                            <Input
                              id={`cooldown-${rule.type}`}
                              type="number"
                              min={0}
                              value={rule.cooldownMin ?? 0}
                              onChange={(e) =>
                                updateRule(rule.type, {
                                  cooldownMin: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="h-8 w-24"
                              disabled={!rule.enabled}
                            />
                            <span className="text-xs text-muted-foreground">
                              同一规则在该时间内只发送一次。
                            </span>
                          </div>
                        </div>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(v) => updateRule(rule.type, { enabled: v })}
                        />
                      </div>
                    </div>
                  ))
                )}
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSaveAlerts} disabled={saving}>
                    <Save className="h-4 w-4 mr-1.5" />
                    {saving ? "保存中..." : "保存规则"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>检查更新结果</DialogTitle>
            <DialogDescription>
              版本信息来自官方服务器，自动更新将从 GitHub Release 下载对应系统架构的安装包。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">节点当前版本</div>
                <div className="mt-1 font-mono font-medium">{updateInfo?.currentVersion || "未知"}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">最新版本</div>
                <div className="mt-1 font-mono font-medium">{updateInfo?.latestVersion || "未知"}</div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <div className="font-medium">
                  {updateInfo?.hasUpdate ? "发现新版本" : "当前已是最新版本"}
                </div>
                {updateInfo?.releaseDate && (
                  <div className="mt-1 text-sm text-muted-foreground">发布时间：{updateInfo.releaseDate}</div>
                )}
              </div>
              <Badge variant={updateInfo?.hasUpdate ? "default" : "secondary"}>
                {updateInfo?.hasUpdate ? "可更新" : "无需更新"}
              </Badge>
            </div>

            {updateInfo?.changelog && updateInfo.changelog.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">更新内容</div>
                <div className="max-h-44 overflow-auto rounded-md border bg-muted/30 p-3">
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {updateInfo.changelog.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {updateSubmitted && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                更新任务已提交。面板会在后台下载 GitHub Release 并自动重启，页面可能会短暂断开。
              </div>
            )}
          </div>

          <DialogFooter>
            {updateInfo?.downloadUrl && (
              <Button variant="outline" asChild>
                <a href={updateInfo.downloadUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  查看说明
                </a>
              </Button>
            )}
            <Button
              onClick={handleApplyUpdate}
              disabled={!updateInfo?.hasUpdate || !updateInfo?.canAutoUpdate || applyingUpdate || updateSubmitted}
            >
              {applyingUpdate ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              {updateSubmitted ? "已提交更新" : "自动下载并更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
