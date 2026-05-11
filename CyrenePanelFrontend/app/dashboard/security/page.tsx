"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { API_BASE } from "@/lib/api-base";
import {
  Shield,
  ShieldCheck,
  Plus,
  Trash2,
  RefreshCw,
  Server,
  KeyRound,
  Save,
  Power,
  PowerOff,
  RotateCw,
  Loader2,
  AlertTriangle,
  Ban,
} from "lucide-react";

// ── API 辅助 ─────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers || {}) },
  });
  return res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` })) as Promise<T>;
}

// ── 类型 ─────────────────────────────────────────────────────────────

interface NodeInfo {
  id: string;
  name: string;
  isMain: boolean;
  online: boolean;
}

type FirewallBackend = "ufw" | "firewalld" | "iptables" | "netsh" | "none";

interface FirewallStatus {
  backend: FirewallBackend;
  installed: boolean;
  enabled: boolean;
  pingBlocked: boolean;
  message?: string;
}

interface SshStatus {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  serviceName: string;
  port: number;
  permitRootLogin: string;
  passwordAuthentication: string;
  configPath: string;
  message?: string;
}

interface FirewallRule {
  id: string;
  action: "allow" | "deny" | "reject";
  protocol: "tcp" | "udp" | "any";
  port: string;
  source?: string;
  raw?: string;
}

const BACKEND_LABEL: Record<FirewallBackend, string> = {
  ufw: "UFW",
  firewalld: "firewalld",
  iptables: "iptables",
  netsh: "Windows Defender",
  none: "未检测到",
};

// ── 页面 ─────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("__main__");

  const [info, setInfo] = useState<{
    platform?: string;
    firewall?: FirewallStatus;
    ssh?: SshStatus;
  } | null>(null);
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const isRemote = selectedNodeId !== "__main__";
  const basePath = isRemote ? `/api/nodes/${selectedNodeId}/security` : "/api/security";

  // 添加规则对话框
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    action: "allow" as "allow" | "deny" | "reject",
    protocol: "tcp" as "tcp" | "udp" | "any",
    port: "",
    source: "",
  });
  const [adding, setAdding] = useState(false);

  // SSH 配置编辑
  const [sshPort, setSshPort] = useState<number>(22);
  const [sshRoot, setSshRoot] = useState<string>("yes");
  const [sshPwd, setSshPwd] = useState<string>("yes");
  const [sshSaving, setSshSaving] = useState(false);

  // 初始化
  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
        const p = data.profile as { role: string };
        if (p.role !== "admin") {
          toast.error("仅管理员可访问安全页面");
          router.push("/dashboard");
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
  }, [router]);

  const fetchNodes = async () => {
    try {
      const data = await apiRequest<{ success: boolean; nodes?: NodeInfo[] }>(
        "/api/nodes/overview",
      );
      if (data.success && data.nodes) setNodes(data.nodes);
    } catch {
      // ignore
    }
  };

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const infoData = await apiRequest<{
        success: boolean;
        platform?: string;
        firewall?: FirewallStatus;
        ssh?: SshStatus;
        message?: string;
      }>(`${basePath}/info`);
      if (infoData.success) {
        setInfo(infoData);
        if (infoData.ssh) {
          setSshPort(infoData.ssh.port || 22);
          setSshRoot(infoData.ssh.permitRootLogin || "yes");
          setSshPwd(infoData.ssh.passwordAuthentication || "yes");
        }
      } else {
        toast.error(infoData.message || "获取安全信息失败");
        setInfo(null);
      }

      const rulesData = await apiRequest<{
        success: boolean;
        rules?: FirewallRule[];
      }>(`${basePath}/firewall/rules`);
      if (rulesData.success && rulesData.rules) {
        setRules(rulesData.rules);
      } else {
        setRules([]);
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }, [basePath]);

  useEffect(() => {
    if (!loading) {
      void fetchAll();
    }
  }, [loading, selectedNodeId, fetchAll]);

  // 操作
  const handleAddRule = async () => {
    if (!addForm.port.trim()) {
      toast.error("请填写端口");
      return;
    }
    setAdding(true);
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>(
        `${basePath}/firewall/rules`,
        {
          method: "POST",
          body: JSON.stringify({
            action: addForm.action,
            protocol: addForm.protocol,
            port: addForm.port.trim(),
            source: addForm.source.trim() || undefined,
          }),
        },
      );
      if (data.success) {
        toast.success("规则已添加");
        setAddOpen(false);
        setAddForm({ action: "allow", protocol: "tcp", port: "", source: "" });
        await fetchAll();
      } else {
        toast.error(data.message || "添加失败");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("确认删除该防火墙规则？")) return;
    setActing(`del:${id}`);
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>(
        `${basePath}/firewall/rules/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (data.success) {
        toast.success("规则已删除");
        await fetchAll();
      } else {
        toast.error(data.message || "删除失败");
      }
    } finally {
      setActing(null);
    }
  };

  const handleToggleFirewall = async (enable: boolean) => {
    setActing("toggle-firewall");
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>(
        `${basePath}/firewall/toggle`,
        { method: "POST", body: JSON.stringify({ enable }) },
      );
      if (data.success) {
        toast.success(enable ? "防火墙已启用" : "防火墙已禁用");
        await fetchAll();
      } else {
        toast.error(data.message || "操作失败");
      }
    } finally {
      setActing(null);
    }
  };

  const handleTogglePing = async (block: boolean) => {
    setActing("toggle-ping");
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>(
        `${basePath}/firewall/ping`,
        { method: "POST", body: JSON.stringify({ block }) },
      );
      if (data.success) {
        toast.success(block ? "已禁止 ping" : "已允许 ping");
        await fetchAll();
      } else {
        toast.error(data.message || "操作失败");
      }
    } finally {
      setActing(null);
    }
  };

  const handleSshAction = async (action: "start" | "stop" | "restart" | "enable" | "disable") => {
    if ((action === "stop" || action === "disable") && !confirm(`确认对 SSH 服务执行 ${action} 操作？这可能导致你无法远程登录服务器。`)) {
      return;
    }
    setActing(`ssh:${action}`);
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>(
        `${basePath}/ssh/${action}`,
        { method: "POST" },
      );
      if (data.success) {
        toast.success(`SSH ${action} 成功`);
        await fetchAll();
      } else {
        toast.error(data.message || `SSH ${action} 失败`);
      }
    } finally {
      setActing(null);
    }
  };

  const handleSaveSshConfig = async () => {
    if (!Number.isFinite(sshPort) || sshPort < 1 || sshPort > 65535) {
      toast.error("端口范围 1-65535");
      return;
    }
    setSshSaving(true);
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>(
        `${basePath}/ssh/config`,
        {
          method: "PUT",
          body: JSON.stringify({
            port: sshPort,
            permitRootLogin: sshRoot,
            passwordAuthentication: sshPwd,
          }),
        },
      );
      if (data.success) {
        toast.success("SSH 配置已保存，重启 SSH 服务后生效");
        await fetchAll();
      } else {
        toast.error(data.message || "保存失败");
      }
    } finally {
      setSshSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto w-full">
        <Card>
          <CardHeader>
            <CardTitle>安全</CardTitle>
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

  const fw = info?.firewall;
  const ssh = info?.ssh;

  return (
    <div className="space-y-6 max-w-5xl mx-auto w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">安全</h1>
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
            <SelectTrigger className="w-60">
              <SelectValue placeholder="选择节点" />
            </SelectTrigger>
            <SelectContent>
              {nodes.map((node) => (
                <SelectItem key={node.id} value={node.id} disabled={!node.online}>
                  <div className="flex items-center gap-2">
                    <span>{node.name}</span>
                    {node.isMain && <Badge variant="secondary" className="text-[10px] h-4 px-1">主</Badge>}
                    {!node.online && <Badge variant="destructive" className="text-[10px] h-4 px-1">离线</Badge>}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => fetchAll()} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="firewall" className="space-y-6">
        <TabsList>
          <TabsTrigger value="firewall" className="gap-1.5">
            <Shield className="h-4 w-4" />
            系统防火墙
          </TabsTrigger>
          <TabsTrigger value="ssh" className="gap-1.5">
            <KeyRound className="h-4 w-4" />
            SSH 管理
          </TabsTrigger>
        </TabsList>

        {/* ── 系统防火墙 ─────────────────────────────────────────── */}
        <TabsContent value="firewall">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>防火墙状态</CardTitle>
                <CardDescription>
                  自动检测节点上可用的防火墙后端（UFW / firewalld / iptables / Windows Defender）。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!fw || fw.backend === "none" ? (
                  <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-medium">未检测到可用防火墙</div>
                      <p className="mt-1">请在节点上安装 ufw / firewalld 之一，或确认 iptables 可用。</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">后端</div>
                        <div className="mt-1 font-medium">{BACKEND_LABEL[fw.backend]}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">防火墙</div>
                        <div className="mt-1">
                          <Badge variant={fw.enabled ? "default" : "secondary"}>
                            {fw.enabled ? "已启用" : "已禁用"}
                          </Badge>
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">ICMP / Ping</div>
                        <div className="mt-1">
                          <Badge variant={fw.pingBlocked ? "destructive" : "secondary"}>
                            {fw.pingBlocked ? "已禁止" : "允许"}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="font-medium">启用防火墙</div>
                        <p className="text-sm text-muted-foreground">
                          关闭防火墙后所有流量将不受过滤，请谨慎操作。
                        </p>
                      </div>
                      <Switch
                        checked={fw.enabled}
                        disabled={acting === "toggle-firewall"}
                        onCheckedChange={(v) => handleToggleFirewall(v)}
                      />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="font-medium">禁止 Ping（阻止 ICMP Echo）</div>
                        <p className="text-sm text-muted-foreground">
                          通过 sysctl 控制 net.ipv4.icmp_echo_ignore_all，重启后仍生效。
                        </p>
                      </div>
                      <Switch
                        checked={fw.pingBlocked}
                        disabled={acting === "toggle-ping"}
                        onCheckedChange={(v) => handleTogglePing(v)}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>端口规则</CardTitle>
                  <CardDescription>当前节点上由防火墙后端管理的入站端口规则。</CardDescription>
                </div>
                <Button onClick={() => setAddOpen(true)} disabled={!fw || fw.backend === "none"}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  添加规则
                </Button>
              </CardHeader>
              <CardContent>
                {rules.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    暂无规则
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>动作</TableHead>
                        <TableHead>协议</TableHead>
                        <TableHead>端口</TableHead>
                        <TableHead>来源</TableHead>
                        <TableHead className="w-[80px] text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rules.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Badge
                              variant={r.action === "allow" ? "default" : r.action === "deny" ? "destructive" : "secondary"}
                            >
                              {r.action.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{r.protocol}</TableCell>
                          <TableCell className="font-mono text-sm">{r.port}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {r.source || "任意"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={acting === `del:${r.id}`}
                              onClick={() => handleDeleteRule(r.id)}
                              title="删除规则"
                            >
                              {acting === `del:${r.id}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-destructive" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── SSH 管理 ───────────────────────────────────────────── */}
        <TabsContent value="ssh">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>SSH 服务</CardTitle>
                <CardDescription>
                  管理 SSH 服务的运行状态、开机自启以及监听端口、登录策略。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!ssh || !ssh.installed ? (
                  <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-medium">未检测到 SSH 服务</div>
                      <p className="mt-1">{ssh?.message || "请确认节点已安装 openssh-server"}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">运行状态</div>
                        <div className="mt-1">
                          <Badge variant={ssh.active ? "default" : "secondary"}>
                            {ssh.active ? "运行中" : "已停止"}
                          </Badge>
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">开机自启</div>
                        <div className="mt-1">
                          <Badge variant={ssh.enabled ? "default" : "secondary"}>
                            {ssh.enabled ? "启用" : "禁用"}
                          </Badge>
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">服务名</div>
                        <div className="mt-1 font-mono text-sm">{ssh.serviceName}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">监听端口</div>
                        <div className="mt-1 font-mono text-sm">{ssh.port}</div>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting === "ssh:start" || ssh.active}
                        onClick={() => handleSshAction("start")}
                      >
                        <Power className="h-4 w-4 mr-1.5" />
                        启动
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting === "ssh:stop" || !ssh.active}
                        onClick={() => handleSshAction("stop")}
                      >
                        <PowerOff className="h-4 w-4 mr-1.5" />
                        停止
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting === "ssh:restart" || !ssh.active}
                        onClick={() => handleSshAction("restart")}
                      >
                        <RotateCw className="h-4 w-4 mr-1.5" />
                        重启
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting === "ssh:enable" || ssh.enabled}
                        onClick={() => handleSshAction("enable")}
                      >
                        <ShieldCheck className="h-4 w-4 mr-1.5" />
                        启用自启
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting === "ssh:disable" || !ssh.enabled}
                        onClick={() => handleSshAction("disable")}
                      >
                        <Ban className="h-4 w-4 mr-1.5" />
                        禁用自启
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {ssh?.installed && (
              <Card>
                <CardHeader>
                  <CardTitle>SSH 配置</CardTitle>
                  <CardDescription>
                    修改后会自动校验 sshd 配置；如校验失败会回滚。保存成功后请手动重启 SSH 服务才能生效。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ssh-port">监听端口</Label>
                      <Input
                        id="ssh-port"
                        type="number"
                        min={1}
                        max={65535}
                        value={sshPort}
                        onChange={(e) => setSshPort(Number(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ssh-root">PermitRootLogin</Label>
                      <select
                        id="ssh-root"
                        value={sshRoot}
                        onChange={(e) => setSshRoot(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="yes">yes（允许 root 直接登录）</option>
                        <option value="no">no（禁止 root 登录）</option>
                        <option value="prohibit-password">prohibit-password（仅密钥）</option>
                        <option value="forced-commands-only">forced-commands-only</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ssh-pwd">PasswordAuthentication</Label>
                      <select
                        id="ssh-pwd"
                        value={sshPwd}
                        onChange={(e) => setSshPwd(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="yes">yes（允许密码登录）</option>
                        <option value="no">no（仅密钥登录）</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleSshAction("restart")}
                      disabled={acting === "ssh:restart" || !ssh.active}
                    >
                      <RotateCw className="h-4 w-4 mr-1.5" />
                      保存后重启 SSH
                    </Button>
                    <Button onClick={handleSaveSshConfig} disabled={sshSaving}>
                      {sshSaving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                      保存配置
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* 添加规则对话框 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加防火墙规则</DialogTitle>
            <DialogDescription>
              当前后端：{fw ? BACKEND_LABEL[fw.backend] : "未检测到"}。firewalld 仅支持 allow 规则。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>动作</Label>
                <select
                  value={addForm.action}
                  onChange={(e) => setAddForm({ ...addForm, action: e.target.value as any })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="allow">允许 (allow)</option>
                  <option value="deny">拒绝 (deny / drop)</option>
                  <option value="reject">拒绝并响应 (reject)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>协议</Label>
                <select
                  value={addForm.protocol}
                  onChange={(e) => setAddForm({ ...addForm, protocol: e.target.value as any })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="any">any</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>端口</Label>
              <Input
                placeholder="例如：80 或 8000:8100"
                value={addForm.port}
                onChange={(e) => setAddForm({ ...addForm, port: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                单端口或端口范围（用冒号分隔）。
              </p>
            </div>
            <div className="space-y-2">
              <Label>来源 IP / CIDR（可选）</Label>
              <Input
                placeholder="例如：192.168.1.0/24，留空表示任意来源"
                value={addForm.source}
                onChange={(e) => setAddForm({ ...addForm, source: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
              取消
            </Button>
            <Button onClick={handleAddRule} disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
