"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Code2,
  FileCode2,
  FolderOpen,
  Globe2,
  Loader2,
  Network,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  ScrollText,
  Trash2,
  Wifi,
  WifiOff,
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

async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
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

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  isMain: boolean;
  online: boolean;
}

interface SiteInfo {
  name: string;
  domains: string[];
  primaryDomain: string;
  port: number;
  root: string;
  status: "running" | "stopped";
  ssl: boolean;
  php: boolean;
  configPath: string;
  rootExists: boolean;
  updatedAt: number | null;
  remark: string;
}

interface NginxInfo {
  installed: boolean;
  binary: string | null;
  version: string | null;
  mode: string;
  availableDir: string | null;
  enabledDir: string | null;
  rootBase: string;
  logDir: string;
}

interface SiteSummary {
  total: number;
  running: number;
  stopped: number;
  ssl: number;
  php: number;
}

interface CreateForm {
  domain: string;
  otherDomains: string;
  root: string;
  port: string;
  index: string;
  enablePhp: boolean;
  phpUpstream: string;
  remark: string;
}

interface SiteSettings {
  site: SiteInfo | null;
  config: { path: string; content: string };
  redirect: {
    enabled: boolean;
    sourcePath: string;
    targetUrl: string;
    code: number;
  };
  proxy: {
    enabled: boolean;
    path: string;
    target: string;
  };
  logs: {
    accessPath: string | null;
    errorPath: string | null;
    access: string;
    error: string;
  };
}

const defaultForm: CreateForm = {
  domain: "",
  otherDomains: "",
  root: "",
  port: "80",
  index: "index.html index.htm index.php",
  enablePhp: false,
  phpUpstream: "unix:/run/php/php-fpm.sock",
  remark: "",
};

const emptySettings: SiteSettings = {
  site: null,
  config: { path: "", content: "" },
  redirect: { enabled: false, sourcePath: "/", targetUrl: "", code: 301 },
  proxy: { enabled: false, path: "/api/", target: "" },
  logs: { accessPath: null, errorPath: null, access: "", error: "" },
};

function statusColor(status: SiteInfo["status"]) {
  return status === "running"
    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
    : "bg-muted text-muted-foreground border-muted";
}

function statusLabel(status: SiteInfo["status"]) {
  return status === "running" ? "运行中" : "已停止";
}

function modeLabel(mode?: string) {
  const map: Record<string, string> = {
    compiled: "编译安装",
    "debian-sites": "sites-available",
    "conf.d": "conf.d",
    unknown: "未检测",
  };
  return map[mode || "unknown"] || mode || "未检测";
}

function formatTime(ms: number | null) {
  if (!ms) return "-";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

export default function SitesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState("__main__");
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [nginx, setNginx] = useState<NginxInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(defaultForm);
  const [configSite, setConfigSite] = useState<SiteInfo | null>(null);
  const [configContent, setConfigContent] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [deleteSite, setDeleteSite] = useState<SiteInfo | null>(null);
  const [actingSite, setActingSite] = useState<string | null>(null);
  const [settingSite, setSettingSite] = useState<SiteInfo | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(emptySettings);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState<string | null>(null);
  const [rootValue, setRootValue] = useState("");
  const [settingsConfigContent, setSettingsConfigContent] = useState("");

  const isRemoteNode = selectedNodeId !== "__main__";
  const basePath = isRemoteNode ? `/api/nodes/${selectedNodeId}/sites` : "/api/sites";

  const fetchNodes = useCallback(async () => {
    try {
      const data = await apiGet<{ success: boolean; nodes?: NodeInfo[] }>(
        "/api/nodes/overview"
      );
      if (data.success && data.nodes) setNodes(data.nodes);
    } catch {
      // ignore
    }
  }, []);

  const fetchSites = useCallback(async () => {
    if (!selectedNodeId) return;
    setRefreshing(true);
    try {
      const data = await apiGet<{
        success: boolean;
        sites?: SiteInfo[];
        summary?: SiteSummary;
        nginx?: NginxInfo;
        message?: string;
      }>(basePath);
      if (data.success) {
        setSites(data.sites || []);
        setSummary(data.summary || null);
        setNginx(data.nginx || null);
        setError(null);
      } else {
        setSites([]);
        setSummary(null);
        setNginx(null);
        setError(data.message || "网站列表加载失败");
      }
    } catch (e: any) {
      setError(e.message || "网站列表加载失败");
    } finally {
      setRefreshing(false);
    }
  }, [basePath, selectedNodeId]);

  useEffect(() => {
    const init = async () => {
      try {
        const { api } = await import("@/lib/api");
        const { data, error } = await api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
        await fetchNodes();
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [fetchNodes, router]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const filteredSites = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((site) =>
      [
        site.primaryDomain,
        site.domains.join(" "),
        site.root,
        site.remark,
        site.configPath,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [search, sites]);

  const resetForm = () => setForm(defaultForm);

  const submitCreate = async () => {
    const domain = form.domain.trim().toLowerCase();
    if (!domain) {
      toast.error("请填写主域名");
      return;
    }
    setCreating(true);
    try {
      const domains = [
        domain,
        ...form.otherDomains.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
      ];
      const res = await apiPost<{ success: boolean; message?: string }>(basePath, {
        domains,
        root: form.root.trim() || undefined,
        port: Number(form.port || 80),
        index: form.index,
        enablePhp: form.enablePhp,
        phpUpstream: form.phpUpstream,
        remark: form.remark,
      });
      if (res.success) {
        toast.success(res.message || "网站创建成功");
        setCreateOpen(false);
        resetForm();
        await fetchSites();
      } else {
        toast.error(res.message || "网站创建失败");
      }
    } catch (e: any) {
      toast.error(e.message || "网站创建失败");
    } finally {
      setCreating(false);
    }
  };

  const runAction = async (site: SiteInfo, action: "enable" | "disable" | "reload" | "test") => {
    setActingSite(`${site.name}:${action}`);
    try {
      const res = await apiPost<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(site.name)}/${action}`
      );
      if (res.success) {
        toast.success(res.message || "操作成功");
        await fetchSites();
      } else {
        toast.error(res.message || "操作失败");
      }
    } catch (e: any) {
      toast.error(e.message || "操作失败");
    } finally {
      setActingSite(null);
    }
  };

  const openConfig = async (site: SiteInfo) => {
    setConfigSite(site);
    setConfigContent("");
    setConfigLoading(true);
    try {
      const res = await apiGet<{ success: boolean; content?: string; message?: string }>(
        `${basePath}/${encodeURIComponent(site.name)}/config`
      );
      if (res.success) {
        setConfigContent(res.content || "");
      } else {
        toast.error(res.message || "配置读取失败");
        setConfigSite(null);
      }
    } catch (e: any) {
      toast.error(e.message || "配置读取失败");
      setConfigSite(null);
    } finally {
      setConfigLoading(false);
    }
  };

  const openSettings = async (site: SiteInfo) => {
    setSettingSite(site);
    setSettings(emptySettings);
    setRootValue(site.root || "");
    setSettingsConfigContent("");
    setSettingsLoading(true);
    try {
      const res = await apiGet<SiteSettings & { success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(site.name)}/settings`
      );
      if (res.success) {
        const nextSettings = {
          site: res.site,
          config: res.config || { path: "", content: "" },
          redirect: res.redirect || emptySettings.redirect,
          proxy: res.proxy || emptySettings.proxy,
          logs: res.logs || emptySettings.logs,
        };
        setSettings(nextSettings);
        setRootValue(nextSettings.site?.root || site.root || "");
        setSettingsConfigContent(nextSettings.config.content || "");
      } else {
        toast.error(res.message || "设置读取失败");
        setSettingSite(null);
      }
    } catch (e: any) {
      toast.error(e.message || "设置读取失败");
      setSettingSite(null);
    } finally {
      setSettingsLoading(false);
    }
  };

  const refreshSettings = async () => {
    if (!settingSite) return;
    await openSettings(settingSite);
  };

  const saveRoot = async () => {
    if (!settingSite) return;
    setSavingSettings("root");
    try {
      const res = await apiPut<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(settingSite.name)}/root`,
        { root: rootValue }
      );
      if (res.success) {
        toast.success(res.message || "网站目录已保存");
        await fetchSites();
        await refreshSettings();
      } else {
        toast.error(res.message || "网站目录保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "网站目录保存失败");
    } finally {
      setSavingSettings(null);
    }
  };

  const saveSettingsConfig = async () => {
    if (!settingSite) return;
    setSavingSettings("config");
    try {
      const res = await apiPut<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(settingSite.name)}/config`,
        { content: settingsConfigContent }
      );
      if (res.success) {
        toast.success(res.message || "配置已保存");
        await fetchSites();
        await refreshSettings();
      } else {
        toast.error(res.message || "配置保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "配置保存失败");
    } finally {
      setSavingSettings(null);
    }
  };

  const saveRedirect = async () => {
    if (!settingSite) return;
    setSavingSettings("redirect");
    try {
      const res = await apiPut<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(settingSite.name)}/redirect`,
        settings.redirect
      );
      if (res.success) {
        toast.success(res.message || "重定向已保存");
        await fetchSites();
        await refreshSettings();
      } else {
        toast.error(res.message || "重定向保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "重定向保存失败");
    } finally {
      setSavingSettings(null);
    }
  };

  const saveProxy = async () => {
    if (!settingSite) return;
    setSavingSettings("proxy");
    try {
      const res = await apiPut<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(settingSite.name)}/proxy`,
        settings.proxy
      );
      if (res.success) {
        toast.success(res.message || "反向代理已保存");
        await fetchSites();
        await refreshSettings();
      } else {
        toast.error(res.message || "反向代理保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "反向代理保存失败");
    } finally {
      setSavingSettings(null);
    }
  };

  const refreshLogs = async () => {
    if (!settingSite) return;
    setSavingSettings("logs");
    try {
      const res = await apiGet<{
        success: boolean;
        message?: string;
        accessPath: string | null;
        errorPath: string | null;
        access: string;
        error: string;
      }>(`${basePath}/${encodeURIComponent(settingSite.name)}/logs?lines=300`);
      if (res.success) {
        setSettings((prev) => ({
          ...prev,
          logs: {
            accessPath: res.accessPath,
            errorPath: res.errorPath,
            access: res.access,
            error: res.error,
          },
        }));
      } else {
        toast.error(res.message || "日志读取失败");
      }
    } catch (e: any) {
      toast.error(e.message || "日志读取失败");
    } finally {
      setSavingSettings(null);
    }
  };

  const saveConfig = async () => {
    if (!configSite) return;
    setSavingConfig(true);
    try {
      const res = await apiPut<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(configSite.name)}/config`,
        { content: configContent }
      );
      if (res.success) {
        toast.success(res.message || "配置已保存");
        setConfigSite(null);
        await fetchSites();
      } else {
        toast.error(res.message || "配置保存失败");
      }
    } catch (e: any) {
      toast.error(e.message || "配置保存失败");
    } finally {
      setSavingConfig(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteSite) return;
    setActingSite(`${deleteSite.name}:delete`);
    try {
      const res = await apiDelete<{ success: boolean; message?: string }>(
        `${basePath}/${encodeURIComponent(deleteSite.name)}`
      );
      if (res.success) {
        toast.success(res.message || "站点已删除");
        setDeleteSite(null);
        await fetchSites();
      } else {
        toast.error(res.message || "删除失败");
      }
    } catch (e: any) {
      toast.error(e.message || "删除失败");
    } finally {
      setActingSite(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="h-9 w-32 animate-pulse rounded bg-muted" />
        <div className="grid gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, index) => (
            <Card key={index}>
              <CardContent className="h-24 animate-pulse bg-muted/40" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">网站管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            基于 Nginx 的站点创建、配置和运行状态管理
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => runAction({ name: "_nginx", domains: [], primaryDomain: "_nginx", port: 80, root: "", status: "running", ssl: false, php: false, configPath: "", rootExists: false, updatedAt: null, remark: "" }, "test")}>
            <ShieldCheck className="h-4 w-4" />
            检查配置
          </Button>
          <Button variant="outline" onClick={() => runAction({ name: "_nginx", domains: [], primaryDomain: "_nginx", port: 80, root: "", status: "running", ssl: false, php: false, configPath: "", rootExists: false, updatedAt: null, remark: "" }, "reload")}>
            <RotateCw className="h-4 w-4" />
            重载 Nginx
          </Button>
          <Button variant="outline" onClick={fetchSites} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Button onClick={() => setCreateOpen(true)} disabled={!nginx?.installed}>
            <Plus className="h-4 w-4" />
            添加网站
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-sm text-muted-foreground">目标节点</span>
          <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="选择节点" />
            </SelectTrigger>
            <SelectContent>
              {nodes.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  <span className="flex items-center gap-2">
                    {node.online ? (
                      <Wifi className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <WifiOff className="h-3 w-3 text-destructive" />
                    )}
                    {node.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索域名、目录或备注"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-3 py-5">
            <Server className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">无法加载网站管理</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Nginx</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{nginx?.installed ? "已安装" : "未安装"}</div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {nginx?.version ? `nginx/${nginx.version}` : modeLabel(nginx?.mode)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">网站总数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.total || 0}</div>
            <p className="mt-1 text-xs text-muted-foreground">{modeLabel(nginx?.mode)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">运行中</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{summary?.running || 0}</div>
            <p className="mt-1 text-xs text-muted-foreground">已启用配置</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">已停止</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.stopped || 0}</div>
            <p className="mt-1 text-xs text-muted-foreground">未启用配置</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">SSL / PHP</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.ssl || 0} / {summary?.php || 0}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">已检测配置</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-52">域名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>端口</TableHead>
                <TableHead className="min-w-64">根目录</TableHead>
                <TableHead>能力</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="w-64 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSites.map((site) => (
                <TableRow key={site.name}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Globe2 className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{site.primaryDomain}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {site.domains.slice(1).join(" ") || site.remark || site.name}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColor(site.status)}>
                      {statusLabel(site.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{site.port}</TableCell>
                  <TableCell>
                    <div className="max-w-72 truncate font-mono text-xs">{site.root || "-"}</div>
                    {!site.rootExists && (
                      <div className="text-xs text-amber-600">目录不存在</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {site.ssl && <Badge variant="secondary">SSL</Badge>}
                      {site.php && <Badge variant="secondary">PHP</Badge>}
                      {!site.ssl && !site.php && <span className="text-xs text-muted-foreground">静态</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTime(site.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {site.status === "running" ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="停止"
                          disabled={actingSite === `${site.name}:disable`}
                          onClick={() => runAction(site, "disable")}
                        >
                          <PauseCircle className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="启动"
                          disabled={actingSite === `${site.name}:enable`}
                          onClick={() => runAction(site, "enable")}
                        >
                          <PlayCircle className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-sm" title="编辑配置" onClick={() => openConfig(site)}>
                        <FileCode2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="测试配置" onClick={() => runAction(site, "test")}>
                        <Code2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="设置" onClick={() => openSettings(site)}>
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button variant="destructive" size="icon-sm" title="删除" onClick={() => setDeleteSite(site)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredSites.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    {sites.length === 0 ? "暂无网站，添加第一个 Nginx 站点" : "没有匹配的网站"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              添加网站
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">主域名</label>
              <Input
                placeholder="example.com"
                value={form.domain}
                onChange={(e) => {
                  const domain = e.target.value;
                  const rootBase = nginx?.rootBase || "/www/wwwroot";
                  setForm({
                    ...form,
                    domain,
                    root: form.root || (domain ? `${rootBase}/${domain}` : ""),
                  });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">监听端口</label>
              <Input
                inputMode="numeric"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">其他域名</label>
              <Input
                placeholder="www.example.com api.example.com"
                value={form.otherDomains}
                onChange={(e) => setForm({ ...form, otherDomains: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">网站目录</label>
              <Input
                className="font-mono text-sm"
                placeholder={`${nginx?.rootBase || "/www/wwwroot"}/example.com`}
                value={form.root}
                onChange={(e) => setForm({ ...form, root: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">默认文档</label>
              <Input
                className="font-mono text-sm"
                value={form.index}
                onChange={(e) => setForm({ ...form, index: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
              <div>
                <div className="text-sm font-medium">启用 PHP 转发</div>
                <div className="text-xs text-muted-foreground">写入 fastcgi_pass 配置</div>
              </div>
              <Switch
                checked={form.enablePhp}
                onCheckedChange={(checked) => setForm({ ...form, enablePhp: checked })}
              />
            </div>
            {form.enablePhp && (
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-sm font-medium">PHP FastCGI</label>
                <Input
                  className="font-mono text-sm"
                  value={form.phpUpstream}
                  onChange={(e) => setForm({ ...form, phpUpstream: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium">备注</label>
              <Input
                placeholder="项目、负责人或用途"
                value={form.remark}
                onChange={(e) => setForm({ ...form, remark: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={submitCreate} disabled={creating || !form.domain.trim()}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              创建网站
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!settingSite}
        onOpenChange={(open) => {
          if (!open) {
            setSettingSite(null);
            setSettings(emptySettings);
          }
        }}
      >
        <DialogContent
          className="max-h-[88vh] overflow-hidden p-0 sm:max-w-none"
          style={{ width: "min(96vw, 1320px)", maxWidth: "min(96vw, 1320px)" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 border-b px-6 py-4">
              <Settings className="h-4 w-4" />
              网站设置 - {settingSite?.primaryDomain}
            </DialogTitle>
          </DialogHeader>
          {settingsLoading ? (
            <div className="flex h-[66vh] items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              加载设置中...
            </div>
          ) : (
            <Tabs defaultValue="directory" className="min-h-0">
              <div className="grid h-[68vh] grid-cols-[200px_minmax(0,1fr)]">
                <div className="border-r bg-muted/30 p-3">
                  <TabsList className="h-auto w-full flex-col items-stretch justify-start gap-1 bg-transparent p-0">
                    <TabsTrigger value="directory" className="h-9 justify-start px-3">
                      <FolderOpen className="h-4 w-4" />
                      网站目录
                    </TabsTrigger>
                    <TabsTrigger value="config" className="h-9 justify-start px-3">
                      <FileCode2 className="h-4 w-4" />
                      配置文件
                    </TabsTrigger>
                    <TabsTrigger value="redirect" className="h-9 justify-start px-3">
                      <ArrowRightLeft className="h-4 w-4" />
                      重定向
                    </TabsTrigger>
                    <TabsTrigger value="proxy" className="h-9 justify-start px-3">
                      <Network className="h-4 w-4" />
                      反向代理
                    </TabsTrigger>
                    <TabsTrigger value="logs" className="h-9 justify-start px-3">
                      <ScrollText className="h-4 w-4" />
                      网站日志
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="min-w-0 overflow-hidden p-5">
              <TabsContent value="directory" className="mt-0 h-full overflow-y-auto">
                <div className="space-y-4">
                  <div className="rounded-md border p-4">
                    <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">网站根目录</label>
                        <Input
                          className="font-mono text-sm"
                          value={rootValue}
                          onChange={(e) => setRootValue(e.target.value)}
                        />
                      </div>
                      <Button onClick={saveRoot} disabled={savingSettings === "root"}>
                        {savingSettings === "root" && <Loader2 className="h-4 w-4 animate-spin" />}
                        保存目录
                      </Button>
                    </div>
                    <div className="mt-3 grid min-w-0 gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <div className="min-w-0 break-all">配置路径：{settings.config.path || "-"}</div>
                      <div className="min-w-0 break-all">目录状态：{settings.site?.rootExists ? "存在" : "不存在，保存时会自动创建"}</div>
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-sm font-medium">当前绑定域名</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(settings.site?.domains || settingSite?.domains || []).map((domain) => (
                        <Badge key={domain} variant="secondary">
                          {domain}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="config" className="mt-0 h-full overflow-hidden">
                <div className="space-y-3">
                  <div className="rounded-md border px-3 py-2 font-mono text-xs text-muted-foreground">
                    {settings.config.path || "未检测到配置文件"}
                  </div>
                  <Textarea
                    className="h-[52vh] resize-none font-mono text-xs leading-relaxed"
                    value={settingsConfigContent}
                    onChange={(e) => setSettingsConfigContent(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button onClick={saveSettingsConfig} disabled={savingSettings === "config"}>
                      {savingSettings === "config" && <Loader2 className="h-4 w-4 animate-spin" />}
                      保存并重载
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="redirect" className="mt-0 h-full overflow-y-auto">
                <div className="space-y-4 rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">启用重定向</div>
                      <div className="text-xs text-muted-foreground">保存后会写入当前站点 Nginx 配置</div>
                    </div>
                    <Switch
                      checked={settings.redirect.enabled}
                      onCheckedChange={(enabled) =>
                        setSettings((prev) => ({
                          ...prev,
                          redirect: { ...prev.redirect, enabled },
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">源路径</label>
                      <Input
                        value={settings.redirect.sourcePath}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            redirect: { ...prev.redirect, sourcePath: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">状态码</label>
                      <Select
                        value={String(settings.redirect.code)}
                        onValueChange={(value) =>
                          setSettings((prev) => ({
                            ...prev,
                            redirect: { ...prev.redirect, code: Number(value) },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="301">301 永久</SelectItem>
                          <SelectItem value="302">302 临时</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 md:col-span-3">
                      <label className="text-sm font-medium">目标 URL</label>
                      <Input
                        placeholder="https://example.com/new-path"
                        value={settings.redirect.targetUrl}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            redirect: { ...prev.redirect, targetUrl: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={saveRedirect} disabled={savingSettings === "redirect"}>
                      {savingSettings === "redirect" && <Loader2 className="h-4 w-4 animate-spin" />}
                      保存重定向
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="proxy" className="mt-0 h-full overflow-y-auto">
                <div className="space-y-4 rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">启用反向代理</div>
                      <div className="text-xs text-muted-foreground">适合把某个路径转发到 Node、Java、Docker 服务</div>
                    </div>
                    <Switch
                      checked={settings.proxy.enabled}
                      onCheckedChange={(enabled) =>
                        setSettings((prev) => ({
                          ...prev,
                          proxy: { ...prev.proxy, enabled },
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">代理路径</label>
                      <Input
                        value={settings.proxy.path}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            proxy: { ...prev.proxy, path: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">目标地址</label>
                      <Input
                        placeholder="http://127.0.0.1:3000"
                        value={settings.proxy.target}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            proxy: { ...prev.proxy, target: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={saveProxy} disabled={savingSettings === "proxy"}>
                      {savingSettings === "proxy" && <Loader2 className="h-4 w-4 animate-spin" />}
                      保存反向代理
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="logs" className="mt-0 h-full overflow-hidden">
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div>访问日志：{settings.logs.accessPath || "未配置"}</div>
                      <div>错误日志：{settings.logs.errorPath || "未配置"}</div>
                    </div>
                    <Button variant="outline" onClick={refreshLogs} disabled={savingSettings === "logs"}>
                      {savingSettings === "logs" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      刷新日志
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-sm font-medium">访问日志</div>
                      <pre className="h-[50vh] overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                        {settings.logs.access || "暂无访问日志"}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-medium">错误日志</div>
                      <pre className="h-[50vh] overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                        {settings.logs.error || "暂无错误日志"}
                      </pre>
                    </div>
                  </div>
                </div>
              </TabsContent>
                </div>
              </div>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!configSite} onOpenChange={(open) => !open && setConfigSite(null)}>
        <DialogContent className="max-h-[86vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4" />
              Nginx 配置 - {configSite?.primaryDomain}
            </DialogTitle>
          </DialogHeader>
          {configLoading ? (
            <div className="flex h-80 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              加载配置中...
            </div>
          ) : (
            <Textarea
              className="h-[56vh] resize-none font-mono text-xs leading-relaxed"
              value={configContent}
              onChange={(e) => setConfigContent(e.target.value)}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigSite(null)}>
              取消
            </Button>
            <Button onClick={saveConfig} disabled={savingConfig || configLoading}>
              {savingConfig && <Loader2 className="h-4 w-4 animate-spin" />}
              保存并重载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteSite} onOpenChange={(open) => !open && setDeleteSite(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              删除网站
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-sm">
              确定删除 <span className="font-medium">{deleteSite?.primaryDomain}</span> 的 Nginx 站点配置吗？
            </p>
            <p className="text-xs text-muted-foreground">
              只删除 Nginx 配置和启用链接，不删除网站根目录文件。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSite(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={!!actingSite}>
              {actingSite?.endsWith(":delete") && <Loader2 className="h-4 w-4 animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
