"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";

interface PanelUpdateInfo {
  success: boolean;
  currentVersion?: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  changelog?: string[];
  releaseDate?: string | null;
  downloadUrl?: string | null;
  message?: string;
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
  const [updateInfo, setUpdateInfo] = useState<PanelUpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // API Key
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

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
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchSettings]);

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

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const { data, error } = await api.api.system.update.get();
      if (error || !data?.success) {
        toast.error((data as PanelUpdateInfo | undefined)?.message || "检查更新失败");
        return;
      }

      const info = data as PanelUpdateInfo;
      setUpdateInfo(info);
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="font-medium">当前版本</div>
                    <p className="text-sm text-muted-foreground">
                      后端当前运行的 CyrenePanel 版本。
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono">
                    {currentVersion || "未知"}
                  </Badge>
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
                      查看更新
                    </a>
                  </Button>
                )}
                <Button onClick={handleCheckUpdate} disabled={checkingUpdate}>
                  <RefreshCw className={`h-4 w-4 mr-1.5 ${checkingUpdate ? "animate-spin" : ""}`} />
                  {checkingUpdate ? "检测中..." : "手动检测更新"}
                </Button>
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
      </Tabs>
    </div>
  );
}
