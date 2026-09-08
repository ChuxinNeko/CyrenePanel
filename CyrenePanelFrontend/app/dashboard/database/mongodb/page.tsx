"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MongoConnectionManager } from "@/components/mongodb/connection-manager";
import { MongoDataBrowser } from "@/components/mongodb/data-browser";
import { MongoStatusPanel } from "@/components/mongodb/status-panel";
import { mongoGet, type MongoConnection } from "@/lib/mongo-api";

/** 与文件管理/Docker 一致的铺满式工作区外壳 */
const PAGE_SHELL_CLASS = "flex h-[calc(100vh-7rem)] w-full min-w-0 flex-col gap-4";

export default function MongoDbPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<MongoConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showConnManager, setShowConnManager] = useState(false);
  const [tab, setTab] = useState("browser");

  const fetchConnections = useCallback(async () => {
    try {
      const res = await mongoGet<{ success: boolean; connections?: MongoConnection[] }>(
        "/api/mongodb/connections",
      );
      if (res.success && res.connections) {
        setConnections(res.connections);
        setSelectedId((prev) => prev || res.connections![0]?.id || "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  if (loading) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  // 没有连接时先引导创建
  if (showConnManager || connections.length === 0) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              connections.length > 0 ? setShowConnManager(false) : router.push("/dashboard/database")
            }
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Button>
          <h1 className="text-xl font-bold">MongoDB 连接管理</h1>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1">
          <MongoConnectionManager
            onConnectionsChange={() => {
              fetchConnections();
              if (connections.length > 0) setShowConnManager(false);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL_CLASS}>
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/database")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Button>
          <h1 className="text-xl font-bold">MongoDB 管理</h1>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-52">
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

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="browser">数据浏览</TabsTrigger>
          <TabsTrigger value="status">运行状态</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-hidden px-1 pt-4">
          <TabsContent value="browser" className="mt-0 h-full">
            <MongoDataBrowser connectionId={selectedId} />
          </TabsContent>
          <TabsContent value="status" className="mt-0 h-full">
            <MongoStatusPanel connectionId={selectedId} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
