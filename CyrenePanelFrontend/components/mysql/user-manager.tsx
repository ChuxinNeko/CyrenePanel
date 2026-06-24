"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Shield, Key, RefreshCw } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

interface MysqlUser {
  user: string;
  host: string;
  hasPassword: boolean;
  locked: boolean;
  passwordExpired: boolean;
}

async function apiGet<T = any>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function apiPost(path: string, body?: any) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiPut(path: string, body?: any) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function MysqlUserManager({ connectionId }: { connectionId: string }) {
  const [users, setUsers] = useState<MysqlUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<MysqlUser | null>(null);
  const [grants, setGrants] = useState<string[]>([]);
  const [form, setForm] = useState({ username: "", host: "%", password: "" });
  const [newPassword, setNewPassword] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    const data = await apiGet(`/api/mysql/users?connectionId=${connectionId}`);
    if (data.success) setUsers(data.users || []);
    else toast.error(data.message || "获取用户列表失败");
    setLoading(false);
  };

  useEffect(() => {
    if (connectionId) fetchUsers();
  }, [connectionId]);

  const handleCreate = async () => {
    if (!form.username) { toast.error("请输入用户名"); return; }
    const data = await apiPost("/api/mysql/users", {
      connectionId,
      username: form.username,
      host: form.host || "%",
      password: form.password,
    });
    if (data.success) {
      toast.success("用户已创建");
      setCreateOpen(false);
      setForm({ username: "", host: "%", password: "" });
      fetchUsers();
    } else {
      toast.error(data.message || "创建失败");
    }
  };

  const handleDrop = async (user: MysqlUser) => {
    if (!confirm(`确定删除用户 "${user.user}"@"${user.host}" 吗？`)) return;
    const data = await apiPost("/api/mysql/users/drop", {
      connectionId,
      username: user.user,
      host: user.host,
    });
    if (data.success) {
      toast.success("用户已删除");
      fetchUsers();
    } else {
      toast.error(data.message || "删除失败");
    }
  };

  const handleViewGrants = async (user: MysqlUser) => {
    setSelectedUser(user);
    const data = await apiGet(
      `/api/mysql/users/privileges?connectionId=${connectionId}&username=${encodeURIComponent(user.user)}&host=${encodeURIComponent(user.host)}`
    );
    if (data.success) {
      setGrants(data.grants || []);
      setGrantsOpen(true);
    } else {
      toast.error(data.message || "获取权限失败");
    }
  };

  const openChangePassword = (user: MysqlUser) => {
    setSelectedUser(user);
    setNewPassword("");
    setPasswordOpen(true);
  };

  const handleChangePassword = async () => {
    if (!selectedUser) return;
    const data = await apiPut("/api/mysql/users/password", {
      connectionId,
      username: selectedUser.user,
      host: selectedUser.host,
      password: newPassword,
    });
    if (data.success) {
      toast.success("密码已修改");
      setPasswordOpen(false);
    } else {
      toast.error(data.message || "修改失败");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">MySQL 用户</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchUsers}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            刷新
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            创建用户
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">用户名</th>
                <th className="text-left p-3 font-medium">主机</th>
                <th className="text-left p-3 font-medium">状态</th>
                <th className="text-right p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={`${user.user}@${user.host}`} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">{user.user}</td>
                  <td className="p-3 font-mono text-xs">{user.host}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      {user.hasPassword && <Badge variant="secondary" className="text-[10px]">有密码</Badge>}
                      {user.locked && <Badge variant="destructive" className="text-[10px]">已锁定</Badge>}
                      {user.passwordExpired && <Badge variant="outline" className="text-[10px]">密码过期</Badge>}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleViewGrants(user)} title="查看权限">
                        <Shield className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openChangePassword(user)} title="修改密码">
                        <Key className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDrop(user)} title="删除">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-muted-foreground">无用户</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 创建用户对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建 MySQL 用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>用户名</Label>
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>主机</Label>
                <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="%" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>密码</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 修改密码对话框 */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码 - {selectedUser?.user}@{selectedUser?.host}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label>新密码</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>取消</Button>
            <Button onClick={handleChangePassword}>确认修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 查看权限对话框 */}
      <Dialog open={grantsOpen} onOpenChange={setGrantsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>权限 - {selectedUser?.user}@{selectedUser?.host}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            {grants.length === 0 ? (
              <p className="text-sm text-muted-foreground">无权限</p>
            ) : (
              grants.map((g, i) => (
                <pre key={i} className="text-xs font-mono bg-muted p-2 rounded whitespace-pre-wrap">{g}</pre>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantsOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}