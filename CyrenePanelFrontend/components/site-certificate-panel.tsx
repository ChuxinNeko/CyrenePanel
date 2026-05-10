"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import { useTasks } from "@/lib/task-store";
import { API_BASE } from "@/lib/api-base";
import {
  CalendarClock,
  FileKey,
  FileText,
  FolderArchive,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UploadCloud,
} from "lucide-react";

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

interface CertificateInfo {
  id: string;
  name: string;
  domains: string[];
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  expiresInDays: number | null;
  certPath: string;
  keyPath: string;
  createdAt: number;
}

interface SiteCertificateStatus {
  success: boolean;
  enabled: boolean;
  certPath: string | null;
  keyPath: string | null;
  forceHttps: boolean;
  certificate: {
    domains: string[];
    issuer: string | null;
    validTo: string | null;
    expiresInDays: number | null;
  } | null;
  message?: string;
}

interface AcmeEnvironment {
  success: boolean;
  tools: Record<string, string | null>;
  ready: {
    http: boolean;
    dns: boolean;
    installAcmeSh: boolean;
  };
  message?: string;
}

interface SiteCertificatePanelProps {
  siteName: string;
  basePath: string;
  domains?: string[];
  onDeployed?: () => Promise<void> | void;
}

function certBaseFromSiteBase(basePath: string): string {
  if (basePath.endsWith("/sites")) return basePath.slice(0, -"/sites".length) + "/certificates";
  return "/api/certificates";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function expiryColor(days: number | null) {
  if (days === null) return "bg-muted text-muted-foreground border-muted";
  if (days < 0) return "bg-destructive/10 text-destructive border-destructive/30";
  if (days <= 15) return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
  return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
}

export function SiteCertificatePanel({
  siteName,
  basePath,
  domains = [],
  onDeployed,
}: SiteCertificatePanelProps) {
  const certBase = useMemo(() => certBaseFromSiteBase(basePath), [basePath]);
  const { startDeployTask } = useTasks();
  const [loading, setLoading] = useState(true);
  const [certificates, setCertificates] = useState<CertificateInfo[]>([]);
  const [status, setStatus] = useState<SiteCertificateStatus | null>(null);
  const [acmeEnv, setAcmeEnv] = useState<AcmeEnvironment | null>(null);
  const [forceHttps, setForceHttps] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("current");

  // 当前证书 Tab: 手动部署
  const [manualForm, setManualForm] = useState({
    privateKey: "",
    certificate: "",
  });
  const [manualName, setManualName] = useState("");

  // 申请证书 Tab
  const [acmeForm, setAcmeForm] = useState({
    domains: domains.join("\n"),
    email: "",
    challenge: "http" as "http" | "dns",
    dnsProvider: "dns_cf",
    dnsEnv: "",
    staging: false,
    forceHttps: true,
  });

  // 证书夹 Tab
  const [vaultSelectedId, setVaultSelectedId] = useState("");
  const [vaultForceHttps, setVaultForceHttps] = useState(true);
  const [renewing, setRenewing] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [certRes, statusRes, envRes] = await Promise.all([
        apiGet<{ success: boolean; certificates?: CertificateInfo[]; message?: string }>(certBase),
        apiGet<SiteCertificateStatus>(`${basePath}/${encodeURIComponent(siteName)}/certificate`),
        apiGet<AcmeEnvironment>(`${certBase}/acme/environment`),
      ]);
      if (certRes.success) {
        setCertificates(certRes.certificates || []);
        setVaultSelectedId((current) => current || certRes.certificates?.[0]?.id || "");
      } else {
        toast.error(certRes.message || "证书列表读取失败");
      }
      if (statusRes.success) {
        setStatus(statusRes);
        setForceHttps(statusRes.forceHttps !== false);
      } else {
        toast.error(statusRes.message || "站点证书读取失败");
      }
      if (envRes.success) {
        setAcmeEnv(envRes);
      } else {
        setAcmeEnv(null);
      }
    } catch (e: any) {
      toast.error(e.message || "证书信息读取失败");
    } finally {
      setLoading(false);
    }
  }, [basePath, certBase, siteName]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refreshAcmeEnvironment = useCallback(async () => {
    try {
      const res = await apiGet<AcmeEnvironment>(`${certBase}/acme/environment`);
      if (res.success) {
        setAcmeEnv(res);
      } else {
        toast.error(res.message || "ACME 环境读取失败");
      }
    } catch (e: any) {
      toast.error(e.message || "ACME 环境读取失败");
    }
  }, [certBase]);

  useEffect(() => {
    setAcmeForm((current) => ({
      ...current,
      domains: current.domains.trim() ? current.domains : domains.join("\n"),
    }));
  }, [domains]);

  // === Tab 1: 当前证书 - 手动部署 ===
  const deployManualCertificate = async () => {
    if (!manualForm.privateKey.trim() || !manualForm.certificate.trim()) {
      toast.error("请填写私钥和证书内容");
      return;
    }
    setSaving("manual-deploy");
    try {
      // 先保存证书到证书夹
      const createRes = await apiPost<{ success: boolean; message?: string; certificate?: CertificateInfo }>(
        certBase,
        {
          name: manualName || siteName,
          certificate: manualForm.certificate,
          privateKey: manualForm.privateKey,
        }
      );
      if (createRes.success && createRes.certificate) {
        // 再部署到站点
        const deployRes = await apiPost<{ success: boolean; message?: string }>(
          `${basePath}/${encodeURIComponent(siteName)}/certificate/deploy`,
          { certificateId: createRes.certificate.id, forceHttps }
        );
        if (deployRes.success) {
          toast.success(deployRes.message || "证书已部署");
          setManualForm({ privateKey: "", certificate: "" });
          setManualName("");
          await fetchData();
          await onDeployed?.();
        } else {
          toast.error(deployRes.message || "证书部署失败");
        }
      } else {
        toast.error(createRes.message || "证书保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "证书部署失败");
    } finally {
      setSaving(null);
    }
  };

  // === Tab 2: 申请证书 ===
  const installAcmeSh = () => {
    if (!acmeForm.email.trim()) {
      toast.error("请先填写 ACME 邮箱");
      return;
    }
    startDeployTask({
      title: "安装 acme.sh",
      icon: "/favicon.ico",
      url: `${API_BASE}${certBase}/acme/install-stream`,
      headers: authHeaders(),
      body: JSON.stringify({ email: acmeForm.email.trim() }),
      targetUrl: "/dashboard/sites",
      onDone: async () => {
        toast.success("acme.sh 已安装");
        await refreshAcmeEnvironment();
      },
    });
    toast.success("安装任务已发送到消息中心");
  };

  const startAcmeRequest = () => {
    const requestedDomains = acmeForm.domains
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const dnsEnv = Object.fromEntries(
      acmeForm.dnsEnv
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf("=");
          return index === -1 ? [line, ""] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }),
    );

    if (!acmeForm.email.trim()) {
      toast.error("请填写 ACME 邮箱");
      return;
    }
    if (requestedDomains.length === 0) {
      toast.error("请填写申请域名");
      return;
    }
    if (acmeForm.challenge === "dns" && acmeEnv && !acmeEnv.ready.dns) {
      toast.error("DNS 验证需要先安装 acme.sh 和 openssl");
      return;
    }
    if (acmeForm.challenge === "http" && acmeEnv && !acmeEnv.ready.http) {
      toast.error("文件验证需要先安装 acme.sh 或 certbot，并确保 openssl 可用");
      return;
    }

    startDeployTask({
      title: `申请 SSL ${requestedDomains[0]}`,
      icon: "/favicon.ico",
      url: `${API_BASE}${basePath}/${encodeURIComponent(siteName)}/certificate/request-stream`,
      headers: authHeaders(),
      body: JSON.stringify({
        domains: requestedDomains,
        email: acmeForm.email.trim(),
        challenge: acmeForm.challenge,
        dnsProvider: acmeForm.challenge === "dns" ? acmeForm.dnsProvider.trim() : undefined,
        dnsEnv: acmeForm.challenge === "dns" ? dnsEnv : undefined,
        staging: acmeForm.staging,
        forceHttps: acmeForm.forceHttps,
      }),
      targetUrl: "/dashboard/sites",
      onDone: async () => {
        toast.success("证书已申请并部署");
        await fetchData();
        await onDeployed?.();
      },
    });
    toast.success("证书申请任务已发送到消息中心");
  };

  // === Tab 3: 证书夹 - 部署 ===
  const deployFromVault = async () => {
    if (!vaultSelectedId) {
      toast.error("请选择一个证书");
      return;
    }
    setSaving("vault-deploy");
    try {
      const res = await apiPost<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(siteName)}/certificate/deploy`,
        { certificateId: vaultSelectedId, forceHttps: vaultForceHttps }
      );
      if (res.success) {
        toast.success(res.message || "证书已部署");
        await fetchData();
        await onDeployed?.();
      } else {
        toast.error(res.message || "证书部署失败");
      }
    } catch (e: any) {
      toast.error(e.message || "证书部署失败");
    } finally {
      setSaving(null);
    }
  };

  const deleteCertificate = async (id: string) => {
    setSaving(`delete:${id}`);
    try {
      const res = await apiDelete<{ success: boolean; message?: string }>(
        `${certBase}/${encodeURIComponent(id)}`
      );
      if (res.success) {
        toast.success(res.message || "证书已删除");
        if (vaultSelectedId === id) setVaultSelectedId("");
        await fetchData();
      } else {
        toast.error(res.message || "证书删除失败");
      }
    } catch (e: any) {
      toast.error(e.message || "证书删除失败");
    } finally {
      setSaving(null);
    }
  };

  // === Tab 3: 证书夹 - 续签 ===
  const renewCertificate = (certId: string) => {
    setRenewing(certId);
    startDeployTask({
      title: "续签证书",
      icon: "/favicon.ico",
      url: `${API_BASE}${certBase}/${encodeURIComponent(certId)}/renew-stream`,
      headers: authHeaders(),
      body: JSON.stringify({ forceHttps: vaultForceHttps }),
      targetUrl: "/dashboard/sites",
      onDone: async () => {
        setRenewing(null);
        toast.success("证书续签完成");
        await fetchData();
        await onDeployed?.();
      },
    });
    toast.success("证书续签任务已发送到消息中心");
    setRenewing(null);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载证书中...
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
        <TabsList className="w-full justify-start gap-1">
          <TabsTrigger value="current" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            当前证书
          </TabsTrigger>
          <TabsTrigger value="apply" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            申请证书
          </TabsTrigger>
          <TabsTrigger value="vault" className="gap-1.5">
            <FolderArchive className="h-3.5 w-3.5" />
            证书夹
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: 当前证书 */}
        <TabsContent value="current" className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4">
            {/* 当前证书状态 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {status?.enabled ? (
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <ShieldOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  当前站点证书
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">证书状态</div>
                    <div className="mt-1 font-medium">{status?.enabled ? "已部署" : "未部署"}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">强制 HTTPS</div>
                    <div className="mt-1 font-medium">{status?.forceHttps ? "已启用" : "未启用"}</div>
                  </div>
                  <div className="rounded-md border p-3 md:col-span-2">
                    <div className="text-xs text-muted-foreground">证书路径</div>
                    <div className="mt-1 break-all font-mono text-xs">{status?.certPath || "-"}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">到期时间</div>
                    <div className="mt-1">{formatDate(status?.certificate?.validTo || null)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">剩余天数</div>
                    <Badge variant="outline" className={expiryColor(status?.certificate?.expiresInDays ?? null)}>
                      {status?.certificate?.expiresInDays ?? "-"} 天
                    </Badge>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={fetchData}>
                    <RefreshCw className="h-4 w-4" />
                    刷新
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 手动部署证书 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">部署证书到当前站点</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">证书名称（可选）</label>
                  <Input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder={siteName}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium">
                    <FileKey className="h-3.5 w-3.5" />
                    密钥 (KEY)
                  </label>
                  <Textarea
                    className="h-32 resize-none font-mono text-xs"
                    value={manualForm.privateKey}
                    onChange={(e) => setManualForm({ ...manualForm, privateKey: e.target.value })}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium">
                    <FileText className="h-3.5 w-3.5" />
                    证书 (PEM)
                  </label>
                  <Textarea
                    className="h-32 resize-none font-mono text-xs"
                    value={manualForm.certificate}
                    onChange={(e) => setManualForm({ ...manualForm, certificate: e.target.value })}
                    placeholder="-----BEGIN CERTIFICATE-----"
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">强制 HTTPS</div>
                    <div className="text-xs text-muted-foreground">HTTP 访问自动跳转到 HTTPS</div>
                  </div>
                  <Switch checked={forceHttps} onCheckedChange={setForceHttps} />
                </div>
                <Button
                  className="w-full"
                  onClick={deployManualCertificate}
                  disabled={saving === "manual-deploy" || !manualForm.privateKey.trim() || !manualForm.certificate.trim()}
                >
                  {saving === "manual-deploy" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="h-4 w-4" />
                  )}
                  保存并部署到当前站点
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: 申请证书 */}
        <TabsContent value="apply" className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4">
            {/* ACME 环境 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  ACME 环境
                  <Button variant="outline" size="sm" onClick={refreshAcmeEnvironment}>
                    <RefreshCw className="h-4 w-4" />
                    检查
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">ACME 邮箱</label>
                  <Input
                    type="email"
                    value={acmeForm.email}
                    onChange={(e) => setAcmeForm({ ...acmeForm, email: e.target.value })}
                    placeholder="admin@example.com"
                  />
                </div>
                <div className="grid gap-2 text-sm">
                  {[
                    ["acme.sh", acmeEnv?.tools?.acmeSh],
                    ["certbot", acmeEnv?.tools?.certbot],
                    ["openssl", acmeEnv?.tools?.openssl],
                    ["curl", acmeEnv?.tools?.curl],
                    ["wget", acmeEnv?.tools?.wget],
                    ["sh", acmeEnv?.tools?.sh],
                  ].map(([name, path]) => (
                    <div key={name} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                      <span className="font-medium">{name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{path || "未检测到"}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={acmeEnv?.ready?.http ? expiryColor(30) : expiryColor(-1)}>
                    文件验证 {acmeEnv?.ready?.http ? "可用" : "不可用"}
                  </Badge>
                  <Badge variant="outline" className={acmeEnv?.ready?.dns ? expiryColor(30) : expiryColor(-1)}>
                    DNS 验证 {acmeEnv?.ready?.dns ? "可用" : "不可用"}
                  </Badge>
                </div>
                {!acmeEnv?.tools?.acmeSh && (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={installAcmeSh}
                    disabled={!acmeEnv?.ready?.installAcmeSh || !acmeForm.email.trim()}
                  >
                    <UploadCloud className="h-4 w-4" />
                    安装 acme.sh
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* 申请表单 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">自动申请 SSL</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">申请域名</label>
                  <Textarea
                    className="h-20 resize-none font-mono text-xs"
                    value={acmeForm.domains}
                    onChange={(e) => setAcmeForm({ ...acmeForm, domains: e.target.value })}
                    placeholder={"example.com\n*.example.com"}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">ACME 邮箱</label>
                  <Input
                    type="email"
                    value={acmeForm.email}
                    onChange={(e) => setAcmeForm({ ...acmeForm, email: e.target.value })}
                    placeholder="admin@example.com"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">验证方式</label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={acmeForm.challenge}
                      onChange={(e) => setAcmeForm({ ...acmeForm, challenge: e.target.value as "http" | "dns" })}
                    >
                      <option value="http">文件验证</option>
                      <option value="dns">DNS 验证</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">强制 HTTPS</label>
                    <div className="flex h-9 items-center justify-between rounded-md border px-3">
                      <span className="text-sm text-muted-foreground">签发后部署</span>
                      <Switch
                        checked={acmeForm.forceHttps}
                        onCheckedChange={(checked) => setAcmeForm({ ...acmeForm, forceHttps: checked })}
                      />
                    </div>
                  </div>
                </div>
                {acmeForm.challenge === "dns" && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">acme.sh DNS API</label>
                      <Input
                        value={acmeForm.dnsProvider}
                        onChange={(e) => setAcmeForm({ ...acmeForm, dnsProvider: e.target.value })}
                        placeholder="dns_cf"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">DNS 环境变量</label>
                      <Textarea
                        className="h-24 resize-none font-mono text-xs"
                        value={acmeForm.dnsEnv}
                        onChange={(e) => setAcmeForm({ ...acmeForm, dnsEnv: e.target.value })}
                        placeholder={"CF_Token=...\nCF_Account_ID=..."}
                      />
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Let's Encrypt 测试环境</div>
                    <div className="text-xs text-muted-foreground">用于验证配置，测试证书不被浏览器信任</div>
                  </div>
                  <Switch
                    checked={acmeForm.staging}
                    onCheckedChange={(checked) => setAcmeForm({ ...acmeForm, staging: checked })}
                  />
                </div>
                <Button className="w-full" onClick={startAcmeRequest}>
                  <ShieldCheck className="h-4 w-4" />
                  开始申请并推送日志
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 3: 证书夹 */}
        <TabsContent value="vault" className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4">
            {certificates.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <FolderArchive className="mb-3 h-10 w-10 opacity-40" />
                  <p className="text-sm">证书夹为空</p>
                  <p className="mt-1 text-xs">请先通过「申请证书」或「当前证书」添加证书</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* 证书列表 */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      已保存证书 ({certificates.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {certificates.map((cert) => (
                      <div
                        key={cert.id}
                        className={`rounded-md border p-3 transition-colors ${
                          vaultSelectedId === cert.id ? "border-primary bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            className="min-w-0 flex-1 text-left"
                            onClick={() => setVaultSelectedId(cert.id)}
                          >
                            <div className="truncate font-medium">{cert.name}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {cert.domains.join(", ") || cert.subject || "未解析到域名"}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className={expiryColor(cert.expiresInDays)}>
                                <CalendarClock className="mr-1 h-3 w-3" />
                                {cert.expiresInDays ?? "-"} 天
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                到期：{formatDate(cert.validTo)}
                              </span>
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon-sm"
                              title="续签证书"
                              disabled={renewing === cert.id}
                              onClick={() => renewCertificate(cert.id)}
                            >
                              {renewing === cert.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="destructive"
                              size="icon-sm"
                              title="删除证书"
                              disabled={saving === `delete:${cert.id}`}
                              onClick={() => deleteCertificate(cert.id)}
                            >
                              {saving === `delete:${cert.id}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* 一键部署 */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">一键部署到站点</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <div className="text-sm font-medium">强制 HTTPS</div>
                        <div className="text-xs text-muted-foreground">HTTP 访问自动跳转到 HTTPS</div>
                      </div>
                      <Switch checked={vaultForceHttps} onCheckedChange={setVaultForceHttps} />
                    </div>
                    <Button
                      className="w-full"
                      onClick={deployFromVault}
                      disabled={!vaultSelectedId || saving === "vault-deploy"}
                    >
                      {saving === "vault-deploy" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UploadCloud className="h-4 w-4" />
                      )}
                      部署到当前站点
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}