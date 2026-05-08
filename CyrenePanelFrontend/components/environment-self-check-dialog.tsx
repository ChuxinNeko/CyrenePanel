"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Loader2, PackageCheck, RefreshCw, Server, Wrench } from "lucide-react";

import { API_BASE } from "@/lib/api-base";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

interface NodeInfo {
  id: string;
  name: string;
  address: string;
}

interface EnvironmentCheckItem {
  id: string;
  name: string;
  description: string;
  command: string;
  required: boolean;
  status: "ok" | "missing" | "unsupported";
  installable: boolean;
}

interface EnvironmentCheckResult {
  success: boolean;
  platform?: string;
  packageManager?: { id: string; name: string } | null;
  checks?: EnvironmentCheckItem[];
  missing?: EnvironmentCheckItem[];
  allReady?: boolean;
  canInstall?: boolean;
  message?: string;
  installOutput?: string;
  result?: EnvironmentCheckResult;
}

interface TargetCheck {
  id: string;
  name: string;
  address?: string;
  isMain: boolean;
  loading: boolean;
  installing: boolean;
  error?: string;
  result?: EnvironmentCheckResult;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function selfCheckFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${url}`, { ...init, headers });
  return res.json();
}

function statusBadge(item: EnvironmentCheckItem) {
  if (item.status === "ok") return <Badge variant="secondary">正常</Badge>;
  if (item.installable) return <Badge variant="destructive">缺失</Badge>;
  return <Badge variant="outline">需手动处理</Badge>;
}

function emptyTarget(id: string, name: string, isMain: boolean, address?: string): TargetCheck {
  return { id, name, isMain, address, loading: true, installing: false };
}

export function EnvironmentSelfCheckDialog({
  autoCheck = true,
  trigger,
}: {
  autoCheck?: boolean;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [targets, setTargets] = useState<TargetCheck[]>([]);
  const [error, setError] = useState("");

  const allChecks = targets.flatMap((target) => target.result?.checks || []);
  const okCount = allChecks.filter((item) => item.status === "ok").length;
  const progress = allChecks.length > 0 ? Math.round((okCount / allChecks.length) * 100) : 0;
  const allReady = targets.length > 0 && targets.every((target) => target.result?.allReady);
  const missingTargets = targets.filter((target) => (target.result?.missing || []).length > 0);
  const installableTargets = useMemo(
    () => targets.filter((target) => target.result?.canInstall),
    [targets],
  );

  const updateTarget = (id: string, patch: Partial<TargetCheck>) => {
    setTargets((prev) => prev.map((target) => target.id === id ? { ...target, ...patch } : target));
  };

  const fetchTargetResult = async (target: TargetCheck): Promise<EnvironmentCheckResult> => {
    const url = target.isMain
      ? "/api/self-check/environment"
      : `/api/nodes/${target.id}/self-check/environment`;
    return selfCheckFetch<EnvironmentCheckResult>(url);
  };

  const runCheck = useCallback(async (showWhenReady = false) => {
    const token = getToken();
    if (!token) return;
    setChecking(true);
    setError("");
    setOpen(true);

    try {
      const nodesData = await selfCheckFetch<{ success: boolean; nodes?: NodeInfo[]; message?: string }>("/api/nodes");
      const nodes = nodesData.success ? nodesData.nodes || [] : [];
      const nextTargets = [
        emptyTarget("__main__", "主节点", true),
        ...nodes.map((node) => emptyTarget(node.id, node.name, false, node.address)),
      ];
      setTargets(nextTargets);

      const checkedTargets = await Promise.all(nextTargets.map(async (target) => {
        try {
          const data = await fetchTargetResult(target);
          if (!data.success) {
            return { ...target, loading: false, error: data.message || "环境自检失败" };
          }
          return { ...target, loading: false, result: data };
        } catch {
          return { ...target, loading: false, error: "无法连接环境自检接口" };
        }
      }));

      setTargets(checkedTargets);
      const ready = checkedTargets.every((target) => target.result?.allReady);
      setOpen(showWhenReady || !ready);
    } catch {
      setError("无法获取节点列表或环境自检失败");
      setOpen(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!autoCheck) return;
    runCheck(false);
  }, [autoCheck, runCheck]);

  const installTarget = async (target: TargetCheck) => {
    const ids = (target.result?.missing || [])
      .filter((item) => item.installable)
      .map((item) => item.id);
    if (ids.length === 0) return;

    updateTarget(target.id, { installing: true, error: "" });
    const url = target.isMain
      ? "/api/self-check/environment/install"
      : `/api/nodes/${target.id}/self-check/environment/install`;
    try {
      const data = await selfCheckFetch<EnvironmentCheckResult>(url, {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      if (!data.success) {
        updateTarget(target.id, {
          installing: false,
          error: data.message || "自动安装失败",
          result: data.result || target.result,
        });
        return;
      }
      updateTarget(target.id, { installing: false, result: data, error: "" });
    } catch {
      updateTarget(target.id, { installing: false, error: "自动安装请求失败" });
    }
  };

  const installMissing = async () => {
    if (installableTargets.length === 0) return;
    setInstalling(true);
    setError("");
    try {
      for (const target of installableTargets) {
        await installTarget(target);
      }
      await runCheck(true);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      {trigger && (
        <div onClick={() => runCheck(true)}>
          {trigger}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>面板环境自检</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {checking ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : allReady ? (
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                  )}
                  {checking ? "正在检查主节点与子节点环境" : allReady ? "所有节点环境正常" : `发现 ${missingTargets.length} 个节点存在缺失项`}
                </div>
                <Badge variant="outline">{targets.length || 1} 个节点</Badge>
              </div>
              <Progress value={checking ? 35 : progress} />
            </div>

            <div className="max-h-[52vh] space-y-3 overflow-auto pr-1">
              {targets.map((target) => {
                const checks = target.result?.checks || [];
                const missing = target.result?.missing || [];
                return (
                  <div key={target.id} className="rounded-lg border">
                    <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {target.name}{target.isMain ? "（主节点）" : ""}
                          </div>
                          {target.address && <div className="truncate text-xs text-muted-foreground">{target.address}</div>}
                        </div>
                      </div>
                      {target.loading || target.installing ? (
                        <Badge variant="outline">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {target.installing ? "安装中" : "检测中"}
                        </Badge>
                      ) : target.error ? (
                        <Badge variant="destructive">异常</Badge>
                      ) : target.result?.allReady ? (
                        <Badge variant="secondary">正常</Badge>
                      ) : (
                        <Badge variant="destructive">缺失 {missing.length} 项</Badge>
                      )}
                    </div>

                    <div className="space-y-2 p-3">
                      {target.error && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                          {target.error}
                        </div>
                      )}
                      {checks.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <PackageCheck className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{item.name}</span>
                              <span className="font-mono text-xs text-muted-foreground">{item.command}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                          </div>
                          {statusBadge(item)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {!checking && missingTargets.length > 0 && installableTargets.length === 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                当前缺失项无法自动安装。请手动安装缺失命令后重新检查。
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => runCheck(true)} disabled={checking || installing}>
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              重新检查
            </Button>
            {allReady ? (
              <Button onClick={() => setOpen(false)}>
                <CheckCircle className="h-4 w-4" />
                完成
              </Button>
            ) : (
              <Button onClick={installMissing} disabled={installableTargets.length === 0 || checking || installing}>
                {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                确定并自动安装
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
