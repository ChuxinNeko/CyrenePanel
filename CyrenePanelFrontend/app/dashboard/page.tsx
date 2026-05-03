"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Server,
  Clock,
  RefreshCw,
  User,
  Monitor,
  Zap,
} from "lucide-react";

interface SystemInfo {
  hostname: string;
  platform: string;
  osVersion: string;
  architecture: string;
  uptime: string;
  uptimeSeconds: number;
  serverUptime: string;
  runtimeVersion: string;
  panelVersion: string;
  cpu: { cores: number; model: string; usage: number };
  memory: {
    total: number;
    used: number;
    free: number;
    totalFormatted: string;
    usedFormatted: string;
    freeFormatted: string;
    percentage: number;
  };
  disks: Array<{
    filesystem: string;
    mount: string;
    total: number;
    used: number;
    free: number;
    percentage: number;
    totalFormatted: string;
    usedFormatted: string;
    freeFormatted: string;
  }>;
  nodeCount: number;
  onlineNodeCount: number;
}

function getProgressColor(pct: number) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-yellow-500";
  return "bg-emerald-500";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        {sub && (
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ username: string } | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSystem = useCallback(async () => {
    try {
      const { data, error } = await api.api.system.get();
      if (!error && data?.success) {
        setSystem(data.system as SystemInfo);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await api.api.me.get();
        if (error || !data?.success) {
          router.push("/login");
          return;
        }
        setProfile(data.profile as { username: string });
        await fetchSystem();
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchSystem]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchSystem();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 mb-1" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">概览</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            欢迎回来，{profile?.username}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            刷新
          </Button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Server}
          label="在线节点"
          value={system?.onlineNodeCount ?? 0}
          sub={`共 ${system?.nodeCount ?? 0} 个节点`}
          color="text-green-500"
        />
        <StatCard
          icon={Cpu}
          label="CPU 使用率"
          value={`${system?.cpu.usage ?? 0}%`}
          sub={`${system?.cpu.cores ?? 0} 核 · ${system?.cpu.model ?? "未知"}`}
          color="text-blue-500"
        />
        <StatCard
          icon={MemoryStick}
          label="内存使用"
          value={system?.memory.usedFormatted ?? "—"}
          sub={`共 ${system?.memory.totalFormatted ?? "—"}`}
          color="text-yellow-500"
        />
        <StatCard
          icon={HardDrive}
          label="磁盘使用"
          value={system?.disks.length ? formatBytes(system.disks.reduce((sum, d) => sum + d.used, 0)) : "—"}
          sub={`共 ${system?.disks.length ? formatBytes(system.disks.reduce((sum, d) => sum + d.total, 0)) : "—"} · ${system?.disks.length ?? 0} 个分区`}
          color="text-purple-500"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Resource usage */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4" />
              资源使用
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {system && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Cpu className="h-3.5 w-3.5 text-blue-500" />
                      CPU
                    </span>
                    <span className="font-medium">{system.cpu.usage}%</span>
                  </div>
                  <Progress
                    value={system.cpu.usage}
                    indicatorClassName={getProgressColor(system.cpu.usage)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <MemoryStick className="h-3.5 w-3.5 text-yellow-500" />
                      内存
                    </span>
                    <span className="font-medium">
                      {system.memory.usedFormatted} / {system.memory.totalFormatted} ({system.memory.percentage}%)
                    </span>
                  </div>
                  <Progress
                    value={system.memory.percentage}
                    indicatorClassName={getProgressColor(system.memory.percentage)}
                  />
                </div>
                {system.disks.map((disk) => (
                  <div key={disk.mount} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <HardDrive className="h-3.5 w-3.5 text-purple-500" />
                        <span className="font-mono text-xs">{disk.filesystem}</span>
                        <span className="text-muted-foreground">{disk.mount}</span>
                      </span>
                      <span className="font-medium">
                        {disk.usedFormatted} / {disk.totalFormatted} ({disk.percentage}%)
                      </span>
                    </div>
                    <Progress
                      value={disk.percentage}
                      indicatorClassName={getProgressColor(disk.percentage)}
                    />
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* User & System info */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                用户信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">用户名</span>
                <span className="font-medium">{profile?.username}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">面板版本</span>
                <span className="font-medium">{system?.panelVersion}</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="w-full mt-2"
                onClick={() => {
                  localStorage.removeItem("token");
                  router.push("/login");
                }}
              >
                退出登录
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Monitor className="h-4 w-4" />
                系统信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">主机名</span>
                <span className="font-medium font-mono">{system?.hostname}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">系统</span>
                <span className="font-medium">
                  {system?.platform} {system?.architecture}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">内核</span>
                <span className="font-medium font-mono text-xs">{system?.osVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">运行时</span>
                <span className="font-medium">{system?.runtimeVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">系统运行时间</span>
                <span className="font-medium">{system?.uptime}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">服务运行时间</span>
                <span className="font-medium">{system?.serverUptime}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}