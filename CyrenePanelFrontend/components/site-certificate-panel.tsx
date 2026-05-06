"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5677";

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

interface SiteCertificatePanelProps {
  siteName: string;
  basePath: string;
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
  onDeployed,
}: SiteCertificatePanelProps) {
  const certBase = useMemo(() => certBaseFromSiteBase(basePath), [basePath]);
  const [loading, setLoading] = useState(true);
  const [certificates, setCertificates] = useState<CertificateInfo[]>([]);
  const [status, setStatus] = useState<SiteCertificateStatus | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [forceHttps, setForceHttps] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    certificate: "",
    privateKey: "",
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [certRes, statusRes] = await Promise.all([
        apiGet<{ success: boolean; certificates?: CertificateInfo[]; message?: string }>(certBase),
        apiGet<SiteCertificateStatus>(`${basePath}/${encodeURIComponent(siteName)}/certificate`),
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
    } catch (e: any) {
      toast.error(e.message || "证书信息读取失败");
    } finally {
      setLoading(false);
    }
  }, [basePath, certBase, siteName]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
