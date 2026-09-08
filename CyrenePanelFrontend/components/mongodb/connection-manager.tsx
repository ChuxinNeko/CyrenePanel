"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Pencil, Plus, Plug, Trash2 } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import {
  mongoDelete,
  mongoGet,
  mongoPost,
  mongoPut,
  type ApiResult,
  type MongoConnection,
} from "@/lib/mongo-api";

const EMPTY_FORM = {
  name: "",
  host: "127.0.0.1",
  port: 27017,
  username: "",
  password: "",
  authDb: "admin",
  uri: "",
};

export function MongoConnectionManager({
  onConnectionsChange,
}: {
  onConnectionsChange?: () => void;
}) {
  const [connections, setConnections] = useState<MongoConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [useUri, setUseUri] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<MongoConnection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mongoGet<{ success: boolean; connections?: MongoConnection[] }>(
        "/api/mongodb/connections",
      );
      if (res.success && res.connections) setConnections(res.connections);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setUseUri(false);
    setDialogOpen(true);
  };

  const openEdit = (conn: MongoConnection) => {
    setEditingId(conn.id);
    setForm({
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: "",
      authDb: conn.authDb,
      uri: "",
    });
    setUseUri(conn.hasUri);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("请输入连接名称");
      return;
    }
    setBusy(true);
    try {
      const payload = useUri
        ? { name: form.name, uri: form.uri, host: "", port: 27017 }
        : { ...form, uri: "" };

      const res = editingId
        ? await mongoPut<ApiResult>(`/api/mongodb/connections/${editingId}`, payload)
        : await mongoPost<ApiResult>("/api/mongodb/connections", payload);

      if (res.success) {
        toast.success(res.message || "已保存");
        setDialogOpen(false);
        load();
        onConnectionsChange?.();
      } else {
        toast.error(res.message || "保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTestNew = async () => {
    setBusy(true);
    try {
      const payload = useUri ? { uri: form.uri } : form;
      const res = await mongoPost<ApiResult & { version?: string }>(
        "/api/mongodb/connections/test-new",
        payload,
      );
      if (res.success) toast.success(`${res.message}${res.version ? `（${res.version}）` : ""}`);
      else toast.error(res.message || "连接失败");
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (conn: MongoConnection) => {
    setTestingId(conn.id);
    try {
      const res = await mongoPost<ApiResult & { version?: string }>(
        `/api/mongodb/connections/${conn.id}/test`,
      );
      if (res.success) toast.success(`${res.message}${res.version ? `（${res.version}）` : ""}`);
      else toast.error(res.message || "连接失败");
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await mongoDelete<ApiResult>(`/api/mongodb/connections/${deleteTarget.id}`);
      if (res.success) {
        toast.success(res.message || "已删除");
        setDeleteTarget(null);
        load();
        onConnectionsChange?.();
      } else {
        toast.error(res.message || "删除失败");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          共 {connections.length} 个 MongoDB 连接
        </span>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          新建连接
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载中...
        </div>
      ) : connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            <Plug className="h-8 w-8 opacity-40" />
            还没有 MongoDB 连接
            <Button size="sm" variant="outline" onClick={openCreate}>
              创建第一个
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((conn) => (
            <Card key={conn.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{conn.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {conn.hasUri ? "使用完整连接串" : `${conn.host}:${conn.port}`}
                    </div>
                  </div>
                  {conn.username ? (
                    <Badge variant="secondary">{conn.username}</Badge>
                  ) : (
                    <Badge variant="outline">免认证</Badge>
                  )}
                </div>

                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={testingId === conn.id}
                    onClick={() => handleTest(conn)}
                  >
                    {testingId === conn.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    测试
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => openEdit(conn)} title="编辑">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(conn)}
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑连接" : "新建 MongoDB 连接"}</DialogTitle>
            <DialogDescription>
              副本集或 Atlas 等场景建议直接填完整连接串
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>连接名称 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="本地 MongoDB"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <div className="text-sm font-medium">使用完整连接串</div>
                <div className="text-xs text-muted-foreground">
                  形如 mongodb://user:pass@host:27017/?replicaSet=rs0
                </div>
              </div>
              <Switch checked={useUri} onCheckedChange={setUseUri} />
            </div>

            {useUri ? (
              <div className="space-y-2">
                <Label>连接串</Label>
                <Input
                  value={form.uri}
                  onChange={(e) => setForm({ ...form, uri: e.target.value })}
                  placeholder="mongodb://..."
                />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_7rem] gap-3">
                  <div className="space-y-2">
                    <Label>主机</Label>
                    <Input
                      value={form.host}
                      onChange={(e) => setForm({ ...form, host: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>端口</Label>
                    <Input
                      type="number"
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 27017 })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>用户名</Label>
                    <Input
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="留空表示免认证"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>密码</Label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder={editingId ? "留空则不修改" : ""}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>认证数据库</Label>
                  <Input
                    value={form.authDb}
                    onChange={(e) => setForm({ ...form, authDb: e.target.value })}
                    placeholder="admin"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleTestNew} disabled={busy}>
              测试连接
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除连接</DialogTitle>
            <DialogDescription>
              仅删除面板中保存的连接配置，不会影响 MongoDB 里的数据。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
