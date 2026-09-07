"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Icon } from "@iconify/react";
import { Loader2, Store, Plus } from "lucide-react";
import { DeployGameDialog, type GameApp, type NodeItem } from "@/components/deploy-game-dialog";
import { API_BASE } from "@/lib/api-base";
import { useTasks } from "@/lib/task-store";

// ── API 辅助 ─────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
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

// ── 页面主组件 ───────────────────────────────────────────────────────

export default function AppStorePage() {
  const router = useRouter();
  const { tasks, startDeployTask } = useTasks();
  const [games, setGames] = useState<GameApp[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedApp, setSelectedApp] = useState<GameApp | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployTaskId, setDeployTaskId] = useState<string | null>(null);
  const activeDeployTask = useMemo(
    () => tasks.find((task) => task.id === deployTaskId) || null,
    [deployTaskId, tasks],
  );
  const deploying = activeDeployTask?.status === "running";

  const loadData = async () => {
    try {
      const [gamesRes, nodesRes] = await Promise.all([
        apiGet<{ success: boolean; games: GameApp[] }>("/api/appstore/games"),
        apiGet<{ success: boolean; nodes: NodeItem[] }>("/api/nodes"),
      ]);

      if (gamesRes.success) setGames(gamesRes.games);
      if (nodesRes.success) setNodes(nodesRes.nodes);
    } catch (err) {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDeployClick = (app: GameApp) => {
    setSelectedApp(app);
    setDeployOpen(true);
  };

  const handleDeploySubmit = async (config: { name: string; cwd: string; nodeId: string }) => {
    if (!selectedApp) return;

    const app = selectedApp;
    const taskId = startDeployTask({
      title: `部署 ${app.name}`,
      icon: app.icon,
      url: `${API_BASE}/api/appstore/deploy-stream`,
      headers: authHeaders(),
      body: JSON.stringify({
        gameId: app.id,
        name: config.name,
        cwd: config.cwd,
        nodeId: config.nodeId,
      }),
      targetUrl: "/dashboard/instances",
      onDone: () => {
        toast.success(`${app.name} 部署成功`);
        setDeployOpen(false);
        router.push("/dashboard/instances");
      },
    });
    setDeployTaskId(taskId);
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
      <div className="flex items-center gap-2">
        <Store className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">应用广场</h1>
      </div>

      <p className="text-muted-foreground">
        在这里一键部署各类游戏服务端。服务端文件会自动从中国大陆优化的镜像源拉取，部署完成后将作为进程实例运行。
      </p>

      {loading ? (
        <div className="py-20 flex justify-center items-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {games.map((app) => (
            <Card key={app.id} className="flex flex-col">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-muted shrink-0">
                  <Icon icon={app.icon} className="w-8 h-8" />
                </div>
                <Badge variant="secondary">{app.type.startsWith("minecraft") ? "我的世界" : "游戏"}</Badge>
              </CardHeader>
              <CardContent className="flex-1">
                <CardTitle className="mb-2 text-lg">{app.name}</CardTitle>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {app.description}
                </p>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={() => handleDeployClick(app)}
                  disabled={deploying}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  部署
                </Button>
              </CardFooter>
            </Card>
          ))}
          {games.length === 0 && (
            <div className="col-span-full py-10 text-center text-muted-foreground">
              暂无可用的游戏模板
            </div>
          )}
        </div>
      )}

      <DeployGameDialog
        app={selectedApp}
        open={deployOpen}
        onOpenChange={setDeployOpen}
        onDeploy={handleDeploySubmit}
        deploying={deploying}
        deployLog={activeDeployTask?.logs || []}
        nodes={nodes}
      />
    </div>
  );
}
