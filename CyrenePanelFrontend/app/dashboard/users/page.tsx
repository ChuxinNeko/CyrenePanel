"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
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
import { UserPlus, KeyRound, Trash2, Shield, User } from "lucide-react";

interface UserInfo {
  id: number;
  username: string;
  role: string;
  createdAt: number;
}

export default function UsersPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ username: string; role: string } | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState("user");
  const [creating, setCreating] = useState(false);

  // Change password dialog
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState<UserInfo | null>(null);
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwChanging, setPwChanging] = useState(false);

  // Delete confirm dialog
  const [delOpen, setDelOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<UserInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = profile?.role === "admin";

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data, error } = await api.api.users.get();
      if (!error && data?.success) {
        setUsers(data.users as UserInfo[]);
      }
    } catch {
      // ignore
    }
  }, [isAdmin]);

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
        const p = data.profile as { username: string; role: string };
        setProfile(p);
        if (p.role === "admin") {
          const { data: ud, error: ue } = await api.api.users.get();
          if (!ue && ud?.success) {
            setUsers(ud.users as UserInfo[]);
          }
        }
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router]);

  // If not admin, fetch only self info from /api/me
  useEffect(() => {
    if (!loading && profile && !isAdmin) {
      // Regular user just sees their own info
      setUsers([{
        id: 0,
        username: profile.username,
        role: profile.role,
        createdAt: Date.now(),
      }]);
    }
  }, [loading, profile, isAdmin]);

  const handleCreate = async () => {
    if (!createUsername || !createPassword) {
      toast.error("请填写用户名和密码");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await api.api.users.post({
        username: createUsername,
        password: createPassword,
        role: createRole,
      });
      if (error) {
        toast.error("请求失败");
        return;
      }
      if (data?.success) {
        toast.success("用户创建成功");
        setCreateOpen(false);
        setCreateUsername("");
        setCreatePassword("");
        setCreateRole("user");
        await fetchUsers();
      } else {
        toast.error(data?.message || "创建失败");
      }
    } catch {
      toast.error("发生意外错误");
    } finally {
      setCreating(false);
    }
  };

  const handleChangePassword = async () => {
    if (!pwTarget) return;

    if (isAdmin && pwTarget.username !== profile?.username) {
      // Admin changing another user's password - no old password needed
      if (!pwNew) {
        toast.error("请填写新密码");
        return;
      }
      setPwChanging(true);
      try {
        const { data, error } = await (api as any).api.users[`${pwTarget.id}`].password.patch({
          password: pwNew,
        });
        if (error) {
          toast.error("请求失败");
          return;
        }
        if (data?.success) {
          toast.success("密码修改成功");
          closePwDialog();
        } else {
          toast.error(data?.message || "修改失败");
        }
      } catch {
        toast.error("发生意外错误");
      } finally {
        setPwChanging(false);
      }
    } else {
      // User changing own password - needs old password
      if (!pwOld || !pwNew) {
        toast.error("请填写原密码和新密码");
        return;
      }
      if (pwNew !== pwNew2) {
        toast.error("两次输入的新密码不一致");
        return;
      }
      setPwChanging(true);
      try {
        const { data, error } = await (api as any).api.users.me.password.patch({
          oldPassword: pwOld,
          newPassword: pwNew,
        });
        if (error) {
          toast.error("请求失败");
          return;
        }
        if (data?.success) {
          toast.success("密码修改成功");
          closePwDialog();
        } else {
          toast.error(data?.message || "修改失败");
        }
      } catch {
        toast.error("发生意外错误");
      } finally {
        setPwChanging(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      const { data, error } = await (api as any).api.users[`${delTarget.id}`].delete();
      if (error) {
        toast.error("请求失败");
        return;
      }
      if (data?.success) {
        toast.success("用户已删除");
        setDelOpen(false);
        setDelTarget(null);
        await fetchUsers();
      } else {
        toast.error(data?.message || "删除失败");
      }
    } catch {
      toast.error("发生意外错误");
    } finally {
      setDeleting(false);
    }
  };

  const closePwDialog = () => {
    setPwOpen(false);
    setPwTarget(null);
    setPwOld("");
    setPwNew("");
    setPwNew2("");
  };

  const openPwDialog = (user: UserInfo) => {
    setPwTarget(user);
    setPwOld("");
    setPwNew("");
    setPwNew2("");
    setPwOpen(true);
  };

  const openDelDialog = (user: UserInfo) => {
    setDelTarget(user);
    setDelOpen(true);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto w-full">
        <Card>
          <CardHeader>
            <CardTitle>用户管理</CardTitle>
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
        <h1 className="text-3xl font-bold tracking-tight">用户管理</h1>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1.5" />
            创建用户
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role === "admin" ? (
                        <><Shield className="h-3 w-3 mr-1" />管理员</>
                      ) : (
                        <><User className="h-3 w-3 mr-1" />普通用户</>
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openPwDialog(user)}
                        title="修改密码"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      {isAdmin && user.username !== profile?.username && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => openDelDialog(user)}
                          title="删除用户"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground h-24">
                    暂无用户
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新用户</DialogTitle>
            <DialogDescription>
              填写以下信息创建一个新的面板用户账号。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-username">用户名</Label>
              <Input
                id="create-username"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                placeholder="输入用户名"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">密码</Label>
              <Input
                id="create-password"
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="输入密码"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-role">角色</Label>
              <select
                id="create-role"
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={pwOpen} onOpenChange={(open) => { if (!open) closePwDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>
              {pwTarget && pwTarget.username === profile?.username
                ? "修改自己的密码，需要输入原密码验证。"
                : `修改用户 ${pwTarget?.username} 的密码。`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isAdmin && pwTarget && pwTarget.username !== profile?.username && (
              <p className="text-sm text-muted-foreground">
                管理员可以直接重置用户密码，无需输入原密码。
              </p>
            )}
            {(!isAdmin || (pwTarget && pwTarget.username === profile?.username)) && (
              <div className="space-y-2">
                <Label htmlFor="pw-old">原密码</Label>
                <Input
                  id="pw-old"
                  type="password"
                  value={pwOld}
                  onChange={(e) => setPwOld(e.target.value)}
                  placeholder="输入原密码"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="pw-new">新密码</Label>
              <Input
                id="pw-new"
                type="password"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                placeholder="输入新密码"
              />
            </div>
            {(!isAdmin || (pwTarget && pwTarget.username === profile?.username)) && (
              <div className="space-y-2">
                <Label htmlFor="pw-new2">确认新密码</Label>
                <Input
                  id="pw-new2"
                  type="password"
                  value={pwNew2}
                  onChange={(e) => setPwNew2(e.target.value)}
                  placeholder="再次输入新密码"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePwDialog}>
              取消
            </Button>
            <Button onClick={handleChangePassword} disabled={pwChanging}>
              {pwChanging ? "修改中..." : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={delOpen} onOpenChange={(open) => { if (!open) { setDelOpen(false); setDelTarget(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription>
              确定要删除用户 <strong>{delTarget?.username}</strong> 吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDelOpen(false); setDelTarget(null); }}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}