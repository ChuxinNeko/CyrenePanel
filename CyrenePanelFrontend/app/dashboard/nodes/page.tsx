"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Server,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  RefreshCw,
  Wifi,
  WifiOff,
  Key,
  Globe,
  Loader2,
} from "lucide-react";

// ── API 辅助 ─────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5677";

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
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

// ── 类型 ─────────────────────────────────────────────────────────────

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  apiKey: string;
  isMain: number;
  createdAt: number;
}

interface NodeStatus {
  [id: string]: boolean;
}

// ── 添加节点对话框 ───────────────────────────────────────────────────

function AddNodeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setAddress("");
    setApiKey("");
  };

  const handleSubmit = async () => {
    if (!name.trim() || !address.trim() || !apiKey.trim()) {
      toast.error("请填写所有字段");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiPost<{
        success: boolean;
        message?: string;
      }>("/api/nodes", {
        name: name.trim(),
        address: address.trim(),
        apiKey: apiKey.trim(),
      });

      if (res.success) {
        toast.success("节点添加成功");
        reset();
        onOpenChange(false);
        onCreated();
      } else {
        toast.error(res.message || "添加失败");
      }
    } catch {
      toast.error("请求失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加节点</DialogTitle>
          <DialogDescription>
            输入子节点的 API 地址和密钥进行绑定。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="node-name">节点名称</Label>
            <Input
              id="node-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：远程服务器"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="node-address">API 地址</Label>
            <Input
              id="node-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="例如：http://192.168.1.100:5677"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="node-apikey">API Key</Label>
            <Input
              id="node-apikey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="子节点的 API Key"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                验证中...
              </>
            ) : (
              "添加"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────

export default function NodesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ username: string; role: string } | null>(null);

  // 主节点信息
  const [mainKey, setMainKey] = useState("");
  const [mainHostname, setMainHostname] = useState("");
  const [mainAddress, setMainAddress] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // 子节点
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus>({});
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";

  const fetchMainKey = useCallback(async () => {
    try {
      const data = await apiGet<{
        success: boolean;
        key?: string;
        hostname?: string;
        address?: string;
      }>("/api/key");
      if (data.success) {
        setMainKey(data.key || "");
        setMainHostname(data.hostname || "");
        setMainAddress(data.address || "");
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchNodes = useCallback(async () => {
    try {
      const data = await apiGet<{
        success: boolean;
        nodes?: NodeInfo[];
      }>("/api/nodes");
      if (data.success && data.nodes) {
        setNodes(data.nodes);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchStatuses = useCallback(async () => {
    for (const node of nodes) {
      try {
        const data = await apiGet<{
          success: boolean;
          online?: boolean;
        }>(`/api/nodes/${node.id}/status`);
        setNodeStatus((prev) => ({
          ...prev,
          [node.id]: data.success && !!data.online,
        }));
      } catch {
        setNodeStatus((prev) => ({ ...prev, [node.id]: false }));
      }
    }
  }, [nodes]);

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await (
          await import("@/lib/api")
        ).api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
        const p = data.profile as { username: string; role: string };
        setProfile(p);
        await Promise.all([fetchMainKey(), fetchNodes()]);
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchMainKey, fetchNodes]);

  // 每 30 秒刷新节点状态
  useEffect(() => {
    if (nodes.length === 0) return;
    fetchStatuses();
    const timer = setInterval(fetchStatuses, 30000);
    return () => clearInterval(timer);
  }, [nodes, fetchStatuses]);

  const handleRegenerateKey = async () => {
    setRegenerating(true);
    try {
      const data = await apiPost<{
        success: boolean;
        key?: string;
        message?: string;
      }>("/api/key/regenerate");
      if (data.success && data.key) {
        setMainKey(data.key);
        toast.success("API Key 已重新生成");
      } else {
        toast.error(data.message || "重新生成失败");
      }
    } catch {
      toast.error("请求失败");
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = async (node: NodeInfo) => {
    setDeleting(node.id);
    try {
      const data = await apiDelete<{
        success: boolean;
        message?: string;
      }>(`/api/nodes/${node.id}`);
      if (data.success) {
        toast.success("节点已删除");
        await fetchNodes();
      } else {
        toast.error(data.message || "删除失败");
      }
    } catch {
      toast.error("请求失败");
    } finally {
      setDeleting(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto w-full">
        <Card>
          <CardHeader>
            <CardTitle>服务器节点</CardTitle>
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
        <h1 className="text-3xl font-bold tracking-tight">服务器节点</h1>
        {isAdmin && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            添加节点
          </Button>
        )}
      </div>

      {/* 主节点信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            主节点信息
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">节点名称</p>
              <p className="font-medium">{mainHostname || "-"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">API 地址</p>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm bg-muted px-2 py-1 rounded">
                  {mainAddress || "-"}
                </code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => copyToClipboard(mainAddress)}
                  title="复制地址"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">API Key</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
                {showKey ? mainKey : mainKey ? "•".repeat(32) : "-"}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? "隐藏" : "显示"}
              >
                {showKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => copyToClipboard(mainKey)}
                title="复制"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleRegenerateKey}
                  disabled={regenerating}
                  title="重新生成"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`}
                  />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 子节点列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            子节点列表
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>API 地址</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-medium">{node.name}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      {node.address}
                    </code>
                  </TableCell>
                  <TableCell>
                    {nodeStatus[node.id] !== undefined ? (
                      <Badge
                        variant={nodeStatus[node.id] ? "default" : "destructive"}
                      >
                        {nodeStatus[node.id] ? (
                          <Wifi className="h-3 w-3 mr-1" />
                        ) : (
                          <WifiOff className="h-3 w-3 mr-1" />
                        )}
                        {nodeStatus[node.id] ? "在线" : "离线"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">检测中</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(node)}
                        disabled={deleting === node.id}
                        title="删除节点"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {nodes.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground h-24"
                  >
                    暂无子节点
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 添加节点对话框 */}
      <AddNodeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={fetchNodes}
      />
    </div>
  );
}