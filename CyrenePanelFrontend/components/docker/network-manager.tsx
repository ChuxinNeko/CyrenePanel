"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Info, Loader2, Network, Plus, RefreshCw, Search, Trash2, Unplug } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  dockerDelete,
  dockerGet,
  dockerPost,
  formatRelative,
  type ApiResult,
  type DockerNetworkDetail,
  type DockerNetworkItem,
} from "@/lib/docker-api";

const DRIVERS = [
  { value: "bridge", label: "bridge（默认，单机容器互联）" },
  { value: "macvlan", label: "macvlan（容器直连物理网络）" },
  { value: "ipvlan", label: "ipvlan（共享父接口 MAC）" },
  { value: "overlay", label: "overlay（跨主机，需 Swarm）" },
];

export function NetworkManager({ prefix }: { prefix: string }) {
  const [networks, setNetworks] = useState<DockerNetworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [keyword, setKeyword] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    driver: "bridge",
    subnet: "",
    gateway: "",
    ipRange: "",
    internal: false,
    attachable: false,
    ipv6: false,
  });

  const [detail, setDetail] = useState<DockerNetworkDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dockerGet<{ success: boolean; networks?: DockerNetworkItem[]; message?: string }>(
        `${prefix}/networks`,
      );
      if (data.success && data.networks) setNetworks(data.networks);
      else {
        toast.error(data.message || "获取网络列表失败");
        setNetworks([]);
      }
    } catch {
      toast.error("获取网络列表失败");
      setNetworks([]);
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return networks;
    return networks.filter(
      (n) => n.name.toLowerCase().includes(kw) || n.driver.toLowerCase().includes(kw),
    );
  }, [networks, keyword]);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("请输入网络名称");
      return;
    }
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/networks`, form);
      if (data.success) {
        toast.success(data.message || "网络已创建");
        setCreateOpen(false);
        setForm({
          name: "",
          driver: "bridge",
          subnet: "",
          gateway: "",
          ipRange: "",
          internal: false,
          attachable: false,
          ipv6: false,
        });
        load();
      } else {
        toast.error(data.message || "创建失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (network: DockerNetworkItem) => {
    setBusy(true);
    try {
      const data = await dockerDelete<ApiResult>(`${prefix}/networks/${encodeURIComponent(network.id)}`);
      if (data.success) {
        toast.success(data.message || "网络已删除");
        load();
      } else {
        toast.error(data.message || "删除失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePrune = async () => {
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(`${prefix}/networks/prune`);
      if (data.success) toast.success(data.message || "清理完成");
      else toast.error(data.message || "清理失败");
      load();
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (network: DockerNetworkItem) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await dockerGet<{ success: boolean; network?: DockerNetworkDetail; message?: string }>(
        `${prefix}/networks/${encodeURIComponent(network.id)}`,
      );
      if (data.success && data.network) setDetail(data.network);
      else toast.error(data.message || "获取详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDisconnect = async (networkId: string, container: string) => {
    setBusy(true);
    try {
      const data = await dockerPost<ApiResult>(
        `${prefix}/networks/${encodeURIComponent(networkId)}/disconnect`,
        { container, force: true },
      );
      if (data.success) {
        toast.success("已断开连接");
        setDetail(null);
        load();
      } else {
        toast.error(data.message || "断开失败");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <Network className="h-4 w-4 text-muted-foreground" />
            {networks.length} 个网络
          </span>
          <Badge variant="secondary">
            {networks.filter((n) => !n.builtin).length} 个自定义
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索网络"
              className="h-9 w-52 pl-8"
            />
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            创建网络
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrune} disabled={busy}>
            <Trash2 className="mr-1.5 h-4 w-4" />
            清理未使用
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
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Network className="h-8 w-8 opacity-40" />
              没有匹配的网络
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left font-medium">名称</th>
                    <th className="p-3 text-left font-medium">驱动</th>
                    <th className="p-3 text-left font-medium">子网</th>
                    <th className="p-3 text-left font-medium">网关</th>
                    <th className="p-3 text-left font-medium">容器</th>
                    <th className="p-3 text-left font-medium">属性</th>
                    <th className="p-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((network) => (
                    <tr key={network.id} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium">{network.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {network.id.slice(0, 12)}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline">{network.driver}</Badge>
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {network.subnets.map((s) => s.subnet).filter(Boolean).join(", ") || "-"}
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {network.subnets.map((s) => s.gateway).filter(Boolean).join(", ") || "-"}
                      </td>
                      <td className="p-3">
                        {network.containerCount > 0 ? (
                          <Badge variant="secondary">{network.containerCount}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {network.builtin && <Badge variant="outline">内置</Badge>}
                          {network.internal && <Badge variant="outline">内部</Badge>}
                          {network.attachable && <Badge variant="outline">可附加</Badge>}
                          {network.ipv6 && <Badge variant="outline">IPv6</Badge>}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="详情"
                            onClick={() => openDetail(network)}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            title={network.builtin ? "内置网络不可删除" : "删除"}
                            disabled={busy || network.builtin}
                            onClick={() => handleDelete(network)}
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

      {/* 创建网络 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>创建网络</DialogTitle>
            <DialogDescription>
              自定义网络内的容器可以通过容器名互相访问，比默认 bridge 更适合多容器编排
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>网络名称 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="my-app-net"
              />
            </div>

            <div className="space-y-2">
              <Label>驱动</Label>
              <Select value={form.driver} onValueChange={(v) => setForm({ ...form, driver: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DRIVERS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>子网</Label>
                <Input
                  value={form.subnet}
                  onChange={(e) => setForm({ ...form, subnet: e.target.value })}
                  placeholder="172.20.0.0/16"
                />
              </div>
              <div className="space-y-2">
                <Label>网关</Label>
                <Input
                  value={form.gateway}
                  onChange={(e) => setForm({ ...form, gateway: e.target.value })}
                  placeholder="172.20.0.1"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              留空由 Docker 自动分配。指定网关或 IP 范围时必须同时填写子网。
            </p>

            <div className="space-y-2 rounded-lg border p-3">
              <ToggleRow
                label="内部网络"
                hint="禁止该网络内的容器访问外网"
                checked={form.internal}
                onChange={(v) => setForm({ ...form, internal: v })}
              />
              <ToggleRow
                label="可附加"
                hint="允许独立容器手动加入该网络"
                checked={form.attachable}
                onChange={(v) => setForm({ ...form, attachable: v })}
              />
              <ToggleRow
                label="启用 IPv6"
                hint="为该网络分配 IPv6 地址"
                checked={form.ipv6}
                onChange={(v) => setForm({ ...form, ipv6: v })}
              />
            </div>
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

      {/* 网络详情 */}
      <Dialog open={detailLoading || !!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>网络详情{detail ? ` · ${detail.name}` : ""}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : detail ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="驱动" value={detail.driver} />
                <Field label="作用域" value={detail.scope} />
                <Field label="创建时间" value={formatRelative(detail.created)} />
                <Field label="ID" value={detail.id.slice(0, 20)} mono />
              </div>

              {(detail.ipam?.Config || []).length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">地址分配</div>
                  <div className="space-y-1 rounded-lg border bg-muted/30 p-2 font-mono text-xs">
                    {(detail.ipam.Config || []).map((c, i) => (
                      <div key={i}>
                        子网 {c.Subnet || "-"} · 网关 {c.Gateway || "-"}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  已连接容器（{detail.containers.length}）
                </div>
                {detail.containers.length === 0 ? (
                  <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                    暂无容器连接
                  </div>
                ) : (
                  <ScrollArea className="max-h-56 rounded-lg border">
                    <table className="w-full text-xs">
                      <tbody>
                        {detail.containers.map((c) => (
                          <tr key={c.id} className="border-b last:border-0">
                            <td className="p-2 font-medium">{c.name}</td>
                            <td className="p-2 font-mono text-muted-foreground">{c.ipv4 || "-"}</td>
                            <td className="p-2 text-right">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title="断开连接"
                                disabled={busy}
                                onClick={() => handleDisconnect(detail.id, c.name)}
                              >
                                <Unplug className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`break-all ${mono ? "font-mono text-xs" : ""}`}>{value || "-"}</div>
    </div>
  );
}
