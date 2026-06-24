"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { Icon } from "@iconify/react";
import {
  Download,
  Trash2,
  RefreshCw,
  Loader2,
  CircleCheck,
  CircleX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useTasks } from "@/lib/task-store";
import { API_BASE } from "@/lib/api-base";
import { api } from "@/lib/api";
import { MysqlDatabaseBrowser } from "@/components/mysql/database-browser";
import { MysqlSqlConsole } from "@/components/mysql/sql-console";
import { MysqlUserManager } from "@/components/mysql/user-manager";
import { MysqlImportExport } from "@/components/mysql/import-export-dialog";

// ── API 辅助 ─────────────────────────────────────────────────────────

async function apiGet<T = any>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── 类型 ─────────────────────────────────────────────────────────────

interface DatabaseInfo {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  installed: boolean;
  version: string | null;
  port: number;
  running: boolean;
  description: string;
}

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  isMain: boolean;
  online: boolean;
}

// ── 页面 ─────────────────────────────────────────────────────────────

export default function DatabasePage() {
  const router = useRouter();
  const { startDeployTask } = useTasks();
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("mysql");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installDialogDb, setInstallDialogDb] = useState<DatabaseInfo | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("__main__");

  // ── MySQL 内联管理状态 ──────────────────────────────────────────────
  const [mysqlConnId, setMysqlConnId] = useState<string>("");
  const [mysqlConnLoading, setMysqlConnLoading] = useState(false);
  const [mysqlSubTab, setMysqlSubTab] = useState("browser");

  // 获取或自动创建默认本地连接
  const ensureMysqlConnection = useCallback(async () => {
    setMysqlConnLoading(true);
    try {
      // 优先调用 auto-setup，自动检测密码并创建/更新连接
      const setupRes = await fetch(`${API_BASE}/api/mysql/connections/auto-setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      }).then((r) => r.json());

      if (setupRes.success && setupRes.connection) {
        setMysqlConnId(setupRes.connection.id);
        return;
      }

      // fallback: 查找已有连接
      const data = await apiGet<{ success: boolean; connections: { id: string }[] }>(
        "/api/mysql/connections"
      );
      if (data.success && data.connections.length > 0) {
        setMysqlConnId(data.connections[0].id);
      }
    } catch {
      // ignore
    } finally {
      setMysqlConnLoading(false);
    }
  }, []);

  const isRemoteNode = selectedNodeId !== "__main__";

  const fetchNodes = async () => {
    try {
      const data = await apiGet<{ success: boolean; nodes?: NodeInfo[] }>("/api/nodes/overview");
      if (data.success && data.nodes) {
        setNodes(data.nodes);
      }
    } catch {
      // ignore
    }
  };

  const fetchDatabases = useCallback(async () => {
    try {
      setLoading(true);
      const url = isRemoteNode
        ? `/api/nodes/${selectedNodeId}/databases`
        : "/api/databases";
      const data = await apiGet<{ success: boolean; databases: DatabaseInfo[] }>(url);
      if (data.success) {
        setDatabases(data.databases);
      }
    } catch {
      toast.error("获取数据库状态失败");
    } finally {
      setLoading(false);
    }
  }, [selectedNodeId, isRemoteNode]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data, error } = await api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
      } catch {
        router.push("/login");
        return;
      }
      await fetchNodes();
      fetchDatabases();
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    fetchDatabases();
  }, [selectedNodeId, fetchDatabases]);

  // MySQL 连接列表：当 MySQL tab 激活且已安装运行时拉取
  useEffect(() => {
    const db = getDbById("mysql");
    if (activeTab === "mysql" && db?.installed && db?.running) {
      ensureMysqlConnection();
    }
  }, [activeTab, databases, ensureMysqlConnection]);

  const handleInstall = (db: DatabaseInfo, version?: string, mode?: string) => {
    setInstallingId(db.id);
    const token = localStorage.getItem("token") || "";
    const url = isRemoteNode
      ? `${API_BASE}/api/nodes/${selectedNodeId}/databases/${db.id}/install/stream`
      : `${API_BASE}/api/databases/${db.id}/install/stream`;
    startDeployTask({
      title: `安装 ${db.displayName}${version ? " " + version : ""}`,
      icon: db.icon,
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ version, mode }),
      onDone: () => {
        setInstallingId(null);
        fetchDatabases();
        toast.success(`${db.displayName} 安装成功`);
      },
    });
    toast.info(`${db.displayName} 安装任务已启动，请在任务中心查看进度`);
  };

  const handleRemove = (db: DatabaseInfo) => {
    const token = localStorage.getItem("token") || "";
    const url = isRemoteNode
      ? `${API_BASE}/api/nodes/${selectedNodeId}/databases/${db.id}/remove/stream`
      : `${API_BASE}/api/databases/${db.id}/remove/stream`;
    startDeployTask({
      title: `卸载 ${db.displayName}`,
      icon: db.icon,
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
      onDone: () => {
        fetchDatabases();
        toast.success(`${db.displayName} 已卸载`);
      },
    });
    toast.info(`${db.displayName} 卸载任务已启动`);
  };

  const getDbById = (id: string) => databases.find((db) => db.id === id);

  const DB_TABS = [
    { id: "mysql", label: "MySQL" },
    { id: "postgresql", label: "PostgreSQL" },
    { id: "mongodb", label: "MongoDB" },
    { id: "redis", label: "Redis" },
  ];

  if (loading && databases.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">数据库管理</h1>
          <p className="text-muted-foreground text-sm mt-1">管理服务器上的数据库服务</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchDatabases}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      {/* 节点选择器 */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground shrink-0">目标节点:</span>
        <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
          <SelectTrigger className="w-64">
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {DB_TABS.map((tab) => {
            const db = getDbById(tab.id);
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-2">
                {tab.label}
                {db?.installed && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    已安装
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {DB_TABS.map((tab) => {
          const db = getDbById(tab.id);
          return (
            <TabsContent key={tab.id} value={tab.id} className="mt-4">
              {/* MySQL 已安装且运行中时，直接展示内联管理界面 */}
              {tab.id === "mysql" && db?.installed && db.running ? (
                <MysqlInlineManager
                  connId={mysqlConnId}
                  connLoading={mysqlConnLoading}
                  subTab={mysqlSubTab}
                  setSubTab={setMysqlSubTab}
                  db={db}
                  onRemove={handleRemove}
                />
              ) : db && !db.installed ? (
                <DatabaseEmptyState db={db} onClickInstall={() => setInstallDialogDb(db)} installing={installingId === db.id} />
              ) : db ? (
                <DatabaseInstalledCard db={db} onRemove={handleRemove} />
              ) : null}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* 安装对话框 */}
      <DatabaseInstallDialog
        db={installDialogDb}
        open={!!installDialogDb}
        onOpenChange={(open) => { if (!open) setInstallDialogDb(null); }}
        onConfirm={(db, version, mode) => {
          setInstallDialogDb(null);
          handleInstall(db, version, mode);
        }}
        selectedNodeId={selectedNodeId}
        isRemoteNode={isRemoteNode}
      />
    </div>
  );
}

// ── Empty State 组件 ─────────────────────────────────────────────────

function DatabaseEmptyState({
  db,
  onClickInstall,
  installing,
}: {
  db: DatabaseInfo;
  onClickInstall: () => void;
  installing: boolean;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Icon icon={db.icon} className="h-12 w-12 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{db.displayName} 未安装</h3>
        <p className="text-muted-foreground text-sm mb-6 max-w-md">
          {db.description}。点击下方按钮安装 {db.displayName} 到当前服务器。
        </p>
        <Button onClick={onClickInstall} disabled={installing}>
          {installing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {installing ? "安装中..." : `安装 ${db.displayName}`}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── 安装对话框组件 ───────────────────────────────────────────────────

interface VersionOption {
  value: string;
  label: string;
}

interface ModeOption {
  value: string;
  label: string;
}

function DatabaseInstallDialog({
  db,
  open,
  onOpenChange,
  onConfirm,
  selectedNodeId,
  isRemoteNode,
}: {
  db: DatabaseInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (db: DatabaseInfo, version: string, mode: string) => void;
  selectedNodeId: string;
  isRemoteNode: boolean;
}) {
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [modes, setModes] = useState<ModeOption[]>([
    { value: "fast", label: "极速安装 (官方仓库)" },
    { value: "compile", label: "编译安装 (源码编译)" },
  ]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [selectedMode, setSelectedMode] = useState<string>("fast");
  const [loadingVersions, setLoadingVersions] = useState(false);

  useEffect(() => {
    if (!db || !open) return;
    const fetchVersions = async () => {
      setLoadingVersions(true);
      try {
        const url = isRemoteNode
          ? `/api/nodes/${selectedNodeId}/databases/${db.id}/versions`
          : `/api/databases/${db.id}/versions`;
        const data = await apiGet<{
          success: boolean;
          versions?: VersionOption[];
          modes?: ModeOption[];
          default?: string;
        }>(url);
        if (data.success && data.versions) {
          setVersions(data.versions);
          if (data.default) setSelectedVersion(data.default);
          else if (data.versions.length > 0) setSelectedVersion(data.versions[0].value);
          if (data.modes) setModes(data.modes);
        }
      } catch {
        // fallback
      } finally {
        setLoadingVersions(false);
      }
    };
    fetchVersions();
  }, [db?.id, open, selectedNodeId, isRemoteNode]);

  if (!db) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Icon icon={db.icon} className="h-6 w-6" />
            安装 {db.displayName}
          </DialogTitle>
          <DialogDescription>
            选择要安装的版本和安装方式
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">版本</label>
            <Select
              value={selectedVersion}
              onValueChange={setSelectedVersion}
              disabled={loadingVersions}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingVersions ? "加载版本列表..." : "选择版本"} />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">安装方式</label>
            <Select
              value={selectedMode}
              onValueChange={setSelectedMode}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择安装方式" />
              </SelectTrigger>
              <SelectContent>
                {modes.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedMode === "compile" && (
              <p className="text-xs text-amber-600">
                编译安装耗时较长，需要充足的内存和磁盘空间
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm(db, selectedVersion, selectedMode)}
            disabled={loadingVersions || !selectedVersion}
          >
            <Download className="h-4 w-4 mr-2" />
            开始安装
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 已安装状态组件 ───────────────────────────────────────────────────

function DatabaseInstalledCard({
  db,
  onRemove,
}: {
  db: DatabaseInfo;
  onRemove: (db: DatabaseInfo) => void;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-muted p-3">
              <Icon icon={db.icon} className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">{db.displayName}</h3>
              <p className="text-muted-foreground text-sm">{db.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="destructive" size="sm" onClick={() => onRemove(db)}>
              <Trash2 className="h-4 w-4 mr-2" />
              卸载
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">版本</p>
            <p className="text-sm font-medium">{db.version || "未知"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">端口</p>
            <p className="text-sm font-medium">{db.port}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">状态</p>
            <div className="flex items-center gap-1.5">
              {db.running ? (
                <>
                  <CircleCheck className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium text-green-600">运行中</span>
                </>
              ) : (
                <>
                  <CircleX className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium text-red-600">已停止</span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── MySQL 内联管理组件 ───────────────────────────────────────────────

function MysqlInlineManager({
  connId,
  connLoading,
  subTab,
  setSubTab,
  db,
  onRemove,
}: {
  connId: string;
  connLoading: boolean;
  subTab: string;
  setSubTab: (v: string) => void;
  db: DatabaseInfo;
  onRemove: (db: DatabaseInfo) => void;
}) {
  const [rootPwdOpen, setRootPwdOpen] = useState(false);
  const [rootPwdNew, setRootPwdNew] = useState("");
  const [rootPwdConfirm, setRootPwdConfirm] = useState("");
  const [rootPwdLoading, setRootPwdLoading] = useState(false);

  const handleChangeRootPassword = async () => {
    if (!rootPwdNew) { toast.error("请输入新密码"); return; }
    if (rootPwdNew !== rootPwdConfirm) { toast.error("两次输入的密码不一致"); return; }
    setRootPwdLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/api/mysql/connections/${connId}/root-password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword: rootPwdNew }),
      }).then((r) => r.json());
      if (res.success) {
        toast.success("root 密码已修改");
        setRootPwdOpen(false);
        setRootPwdNew("");
        setRootPwdConfirm("");
      } else {
        toast.error(res.message || "修改失败");
      }
    } catch {
      toast.error("请求失败");
    } finally {
      setRootPwdLoading(false);
    }
  };

  if (connLoading || !connId) {
    return (
      <div className="flex items-center justify-center h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">MySQL 管理</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRootPwdOpen(true)}>
            修改 root 密码
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onRemove(db)}>
            <Trash2 className="h-4 w-4 mr-2" />
            卸载
          </Button>
        </div>
      </div>

      <Tabs value={subTab} onValueChange={setSubTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0">
          <TabsTrigger value="browser">数据库浏览</TabsTrigger>
          <TabsTrigger value="sql">SQL 控制台</TabsTrigger>
          <TabsTrigger value="users">用户管理</TabsTrigger>
          <TabsTrigger value="import-export">导入导出</TabsTrigger>
        </TabsList>

        <TabsContent value="browser" className="flex-1 min-h-0 mt-4">
          <MysqlDatabaseBrowser connectionId={connId} />
        </TabsContent>

        <TabsContent value="sql" className="flex-1 min-h-0 mt-4">
          <MysqlSqlConsole connectionId={connId} />
        </TabsContent>

        <TabsContent value="users" className="flex-1 min-h-0 mt-4">
          <MysqlUserManager connectionId={connId} />
        </TabsContent>

        <TabsContent value="import-export" className="flex-1 min-h-0 mt-4">
          <MysqlImportExport connectionId={connId} />
        </TabsContent>
      </Tabs>

      {/* 修改 root 密码对话框 */}
      <Dialog open={rootPwdOpen} onOpenChange={setRootPwdOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改 MySQL root 密码</DialogTitle>
            <DialogDescription>
              修改后面板连接密码将自动同步更新
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">新密码</label>
              <input
                type="password"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={rootPwdNew}
                onChange={(e) => setRootPwdNew(e.target.value)}
                placeholder="输入新密码"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">确认密码</label>
              <input
                type="password"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={rootPwdConfirm}
                onChange={(e) => setRootPwdConfirm(e.target.value)}
                placeholder="再次输入新密码"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRootPwdOpen(false)}>取消</Button>
            <Button onClick={handleChangeRootPassword} disabled={rootPwdLoading}>
              {rootPwdLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}