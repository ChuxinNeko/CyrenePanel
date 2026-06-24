"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Plug, Loader2, Pencil } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

interface MysqlConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  createdAt: number;
}

async function apiRequest(path: string, options?: RequestInit) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  return res.json();
}

export function MysqlConnectionManager({
  onConnectionsChange,
}: {
  onConnectionsChange: () => void;
}) {
  const [connections, setConnections] = useState<MysqlConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MysqlConnection | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    host: "127.0.0.1",
    port: "3306",
    username: "root",
    password: "",
  });

  const fetchConnections = async () => {
    setLoading(true);
    const data = await apiRequest("/api/mysql/connections");
    if (data.success) setConnections(data.connections);
    setLoading(false);
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", host: "127.0.0.1", port: "3306", username: "root", password: "" });
    setDialogOpen(true);
  };

  const openEdit = (conn: MysqlConnection) => {
    setEditing(conn);
    setForm({
      name: conn.name,
      host: conn.host,
      port: String(conn.port),
      username: conn.username,
      password: "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.host || !form.username) {
      toast.error("请填写名称、主机和用户名");
      return;
    }
    const payload = {
      name: form.name,
      host: form.host,
      port: parseInt(form.port) || 3306,
      username: form.username,
      password: form.password,
    };

    if (editing) {
      const data = await apiRequest(`/api/mysql/connections/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (data.success) {
        toast.success("连接已更新");
        setDialogOpen(false);
        fetchConnections();
        onConnectionsChange();
      } else {
        toast.error(data.message || "更新失败");
      }
    } else {
      const data = await apiRequest("/api/mysql/connections", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (data.success) {
        toast.success("连接已创建");
        setDialogOpen(false);
        fetchConnections();
        onConnectionsChange();
      } else {
        toast.error(data.message || "创建失败");
      }
    }
  };

  const handleDelete = async (id: string) => {
    const data = await apiRequest(`/api/mysql/connections/${id}`, { method: "DELETE" });
    if (data.success) {
      toast.success("连接已删除");
      fetchConnections();
      onConnectionsChange();
    } else {
      toast.error(data.message || "删除失败");
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    const data = await apiRequest(`/api/mysql/connections/${id}/test`, { method: "POST" });
    setTesting(null);
    if (data.success) {
      toast.success(`连接成功 (MySQL ${data.version})`);
    } else {
      toast.error(data.message || "连接失败");
    }
  };

  const handleTestNew = async () => {
    setTesting("__new__");
    const data = await apiRequest("/api/mysql/connections/test-new", {
      method: "POST",
      body: JSON.stringify({
        host: form.host,
        port: parseInt(form.port) || 3306,
        username: form.username,
        password: form.password,
      }),
    });
    setTesting(null);
    if (data.success) {
      toast.success(`连接成功 (MySQL ${data.version})`);
    } else {
      toast.error(data.message || "连接失败");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          新建连接
        </Button>
      </div>

      {connections.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Plug className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">暂无 MySQL 连接</h3>
            <p className="text-muted-foreground text-sm mb-4">
              添加一个 MySQL 连接以开始管理数据库
            </p>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              新建连接
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {connections.map((conn) => (
            <Card key={conn.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{conn.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {conn.username}@{conn.host}:{conn.port}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(conn.id)}
                    disabled={testing === conn.id}
                  >
                    {testing === conn.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plug className="h-3 w-3" />
                    )}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(conn)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(conn.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑连接" : "新建连接"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>连接名称</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如: 本地 MySQL"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label>主机</Label>
                <Input
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>端口</Label>
                <Input
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>用户名</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>密码</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editing ? "留空保持不变" : ""}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleTestNew}
              disabled={testing === "__new__"}
            >
              {testing === "__new__" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plug className="h-4 w-4 mr-2" />
              )}
              测试连接
            </Button>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}