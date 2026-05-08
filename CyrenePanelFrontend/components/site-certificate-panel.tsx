"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useTasks } from "@/lib/task-store";
import { API_BASE } from "@/lib/api-base";
import {
  CalendarClock,
  Loader2,
  Plus,
  RefreshCw,
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
  const [selectedId, setSelectedId] = useState("");
  const [forceHttps, setForceHttps] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    certificate: "",
    privateKey: "",
  });
  const [acmeOpen, setAcmeOpen] = useState(false);
  const [acmeForm, setAcmeForm] = useState({
    domains: domains.join("\n"),
    email: "",
    challenge: "http" as "http" | "dns",
    dnsProvider: "dns_cf",
    dnsEnv: "",
    staging: false,
    forceHttps: true,
  });

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
        setSelectedId((current) => current || certRes.certificates?.[0]?.id || "");
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

  const createCertificate = async () => {
    setSaving("create");
    try {
      const res = await apiPost<{ success: boolean; message?: string; certificate?: CertificateInfo }>(
        certBase,
        form
      );
      if (res.success) {
        toast.success(res.message || "证书已保存");
        setForm({ name: "", certificate: "", privateKey: "" });
        setShowCreate(false);
        setSelectedId(res.certificate?.id || "");
        await fetchData();
      } else {
        toast.error(res.message || "证书保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "证书保存失败");
    } finally {
      setSaving(null);
    }
  };

  const deployCertificate = async () => {
    if (!selectedId) {
      toast.error("请选择一个证书");
      return;
    }
    setSaving("deploy");
    try {
      const res = await apiPost<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(siteName)}/certificate/deploy`,
        { certificateId: selectedId, forceHttps }
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
        if (selectedId === id) setSelectedId("");
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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载证书中...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">证书列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {certificates.length === 0 ? (
                <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
                  暂无证书，请先粘贴 PEM 证书和私钥
                </div>
              ) : (
                certificates.map((cert) => (
                  <div
                    key={cert.id}
                    className={`rounded-md border p-3 transition-colors ${
                      selectedId === cert.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setSelectedId(cert.id)}
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
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                自动申请 SSL
                <Button variant="outline" size="sm" onClick={() => setAcmeOpen((value) => !value)}>
                  <ShieldCheck className="h-4 w-4" />
                  {acmeOpen ? "收起" : "申请"}
                </Button>
              </CardTitle>
            </CardHeader>
            {acmeOpen && (
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
            )}
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">一键部署到站点</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">选择证书</label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  <option value="">请选择证书</option>
                  {certificates.map((cert) => (
                    <option key={cert.id} value={cert.id}>
                      {cert.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">强制 HTTPS</div>
                  <div className="text-xs text-muted-foreground">HTTP 访问自动跳转到 HTTPS</div>
                </div>
                <Switch checked={forceHttps} onCheckedChange={setForceHttps} />
              </div>
              <Button className="w-full" onClick={deployCertificate} disabled={!selectedId || saving === "deploy"}>
                {saving === "deploy" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                部署到当前站点
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                添加证书
                <Button variant="outline" size="sm" onClick={() => setShowCreate((value) => !value)}>
                  <Plus className="h-4 w-4" />
                  {showCreate ? "收起" : "添加"}
                </Button>
              </CardTitle>
            </CardHeader>
            {showCreate && (
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">证书名称</label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">证书 PEM</label>
                  <Textarea
                    className="h-32 resize-none font-mono text-xs"
                    value={form.certificate}
                    onChange={(e) => setForm({ ...form, certificate: e.target.value })}
                    placeholder="-----BEGIN CERTIFICATE-----"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">私钥 PEM</label>
                  <Textarea
                    className="h-32 resize-none font-mono text-xs"
                    value={form.privateKey}
                    onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={createCertificate}
                  disabled={saving === "create" || !form.certificate.trim() || !form.privateKey.trim()}
                >
                  {saving === "create" && <Loader2 className="h-4 w-4 animate-spin" />}
                  保存证书
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
