"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { API_BASE } from "@/lib/api-base";
import { MysqlConnectionManager } from "@/components/mysql/connection-manager";
import { MysqlDatabaseBrowser } from "@/components/mysql/database-browser";
import { MysqlSqlConsole } from "@/components/mysql/sql-console";
import { MysqlUserManager } from "@/components/mysql/user-manager";
import { MysqlImportExport } from "@/components/mysql/import-export-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── API helpers ──────────────────────────────────────────────────────

async function apiGet<T = any>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────

interface MysqlConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  createdAt: number;
}

// ── Page ─────────────────────────────────────────────────────────────

export default function MysqlManagePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<MysqlConnection[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("browser");
  const [showConnManager, setShowConnManager] = useState(false);

  const fetchConnections = useCallback(async () => {
    try {
      const data = await apiGet<{ success: boolean; connections: MysqlConnection[] }>(
        "/api/mysql/connections"
      );
      if (data.success) {
        setConnections(data.connections);
        if (!selectedConnId && data.connections.length > 0) {
          setSelectedConnId(data.connections[0].id);
        }
      }
    } catch {
      toast.error("获取连接列表失败");
    } finally {
      setLoading(false);
    }
  }, [selectedConnId]);

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
      fetchConnections();
    };
    checkAuth();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (showConnManager || connections.length === 0) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          {connections.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowConnManager(false)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              返回
            </Button>
          )}
          <h1 className="text-2xl font-bold">MySQL 连接管理</h1>
        </div>
        <MysqlConnectionManager
          onConnectionsChange={() => {
            fetchConnections();
            if (connections.length > 0) setShowConnManager(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/database")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="text-xl font-bold">MySQL 管理</h1>
          <Select value={selectedConnId} onValueChange={setSelectedConnId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="选择连接" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowConnManager(true)}>
          管理连接
        </Button>
      </div>

      {/* 主内容区 */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0">
          <TabsTrigger value="browser">数据库浏览</TabsTrigger>
          <TabsTrigger value="sql">SQL 控制台</TabsTrigger>
          <TabsTrigger value="users">用户管理</TabsTrigger>
          <TabsTrigger value="import-export">导入导出</TabsTrigger>
        </TabsList>

        <TabsContent value="browser" className="flex-1 min-h-0 mt-4">
          <MysqlDatabaseBrowser connectionId={selectedConnId} />
        </TabsContent>

        <TabsContent value="sql" className="flex-1 min-h-0 mt-4">
          <MysqlSqlConsole connectionId={selectedConnId} />
        </TabsContent>

        <TabsContent value="users" className="flex-1 min-h-0 mt-4">
          <MysqlUserManager connectionId={selectedConnId} />
        </TabsContent>

        <TabsContent value="import-export" className="flex-1 min-h-0 mt-4">
          <MysqlImportExport connectionId={selectedConnId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}