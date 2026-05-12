"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, X, Cpu, MemoryStick, RefreshCw } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
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

async function apiPost<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
  });
  return res.json();
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  memoryBytes: number;
  user: string;
  command: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Hover 浮窗：显示 Top 5 进程 ─────────────────────────────────

interface ProcessHoverProps {
  nodeId: string;
  children: React.ReactNode;
  onOpenFullDialog: () => void;
}

export function ProcessHoverCard({ nodeId, children, onOpenFullDialog }: ProcessHoverProps) {
  const [visible, setVisible] = useState(false);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint =
        nodeId === "__main__"
          ? "/api/system/processes"
          : `/api/nodes/${nodeId}/system/processes`;
      const data = await apiGet<{ success: boolean; processes?: ProcessInfo[] }>(endpoint);
      if (data.success && data.processes) {
        setProcesses(data.processes.slice(0, 5));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (leaveTimeout.current) {
      clearTimeout(leaveTimeout.current);
      leaveTimeout.current = null;
    }
    const target = e.currentTarget as HTMLElement;
    hoverTimeout.current = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      setPosition({ x: rect.left, y: rect.bottom + 4 });
      setVisible(true);
      fetchProcesses();
    }, 400);
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
      hoverTimeout.current = null;
    }
    leaveTimeout.current = setTimeout(() => {
      setVisible(false);
    }, 200);
  };

  const handlePopoverEnter = () => {
    if (leaveTimeout.current) {
      clearTimeout(leaveTimeout.current);
      leaveTimeout.current = null;
    }
  };

  const handlePopoverLeave = () => {
    leaveTimeout.current = setTimeout(() => {
      setVisible(false);
    }, 200);
  };

  return (
    <>
      <div
        ref={containerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {visible && (
        <div
          className="fixed z-50 w-72 rounded-lg border bg-popover p-3 shadow-lg text-popover-foreground"
          style={{ left: position.x, top: position.y }}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handlePopoverLeave}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">资源占用 Top 5</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {loading ? "加载中..." : "实时"}
            </Badge>
          </div>
          {loading && processes.length === 0 ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : processes.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">暂无数据</p>
          ) : (
            <div className="space-y-1.5">
              {processes.map((proc) => (
                <div
                  key={proc.pid}
                  className="flex items-center justify-between gap-2 text-xs rounded px-1.5 py-1 hover:bg-muted/50"
                >
                  <span className="truncate flex-1 font-mono" title={proc.name}>{proc.name}</span>
                  <span className="shrink-0 text-blue-500 font-medium w-12 text-right">
                    {proc.cpu}%
                  </span>
                  <span className="shrink-0 text-violet-500 font-medium w-14 text-right">
                    {formatBytes(proc.memoryBytes)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 h-7 text-xs"
            onClick={() => {
              setVisible(false);
              onOpenFullDialog();
            }}
          >
            查看更多
          </Button>
        </div>
      )}
    </>
  );
}

// ── 完整进程列表弹窗 ─────────────────────────────────────────────

interface ProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: { id: string; name: string; online: boolean }[];
  initialNodeId: string;
}

export function ProcessListDialog({
  open,
  onOpenChange,
  nodes,
  initialNodeId,
}: ProcessDialogProps) {
  const [selectedNode, setSelectedNode] = useState(initialNodeId);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [killing, setKilling] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"cpu" | "memory">("cpu");

  useEffect(() => {
    if (open) {
      setSelectedNode(initialNodeId);
    }
  }, [open, initialNodeId]);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint =
        selectedNode === "__main__"
          ? "/api/system/processes"
          : `/api/nodes/${selectedNode}/system/processes`;
      const data = await apiGet<{ success: boolean; processes?: ProcessInfo[] }>(endpoint);
      if (data.success && data.processes) {
        setProcesses(data.processes);
      } else {
        setProcesses([]);
      }
    } catch {
      setProcesses([]);
    } finally {
      setLoading(false);
    }
  }, [selectedNode]);

  useEffect(() => {
    if (open) {
      fetchProcesses();
    }
  }, [open, fetchProcesses]);

  const [killConfirm, setKillConfirm] = useState<{ pid: number; name: string } | null>(null);

  const handleKill = async (pid: number) => {
    setKillConfirm(null);
    setKilling(pid);
    try {
      const endpoint =
        selectedNode === "__main__"
          ? `/api/system/processes/${pid}/kill`
          : `/api/nodes/${selectedNode}/system/processes/${pid}/kill`;
      const data = await apiPost<{ success: boolean; message?: string }>(endpoint);
      if (data.success) {
        toast.success(`进程 ${pid} 已终止`);
        await fetchProcesses();
      } else {
        toast.error(data.message || "终止失败");
      }
    } catch {
      toast.error("请求失败");
    } finally {
      setKilling(null);
    }
  };

  const sorted = [...processes].sort((a, b) =>
    sortBy === "cpu" ? b.cpu - a.cpu : b.memoryBytes - a.memoryBytes
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            进程管理
          </DialogTitle>
          <DialogDescription>
            查看节点进程资源占用，支持终止进程。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={selectedNode}
            onChange={(e) => setSelectedNode(e.target.value)}
            className="h-7 rounded border bg-background px-2 text-xs"
          >
            {nodes
              .filter((n) => n.online)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>

          <div className="flex items-center gap-1 ml-auto">
            <Button
              variant={sortBy === "cpu" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setSortBy("cpu")}
            >
              <Cpu className="h-3 w-3 mr-1" />
              CPU
            </Button>
            <Button
              variant={sortBy === "memory" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setSortBy("memory")}
            >
              <MemoryStick className="h-3 w-3 mr-1" />
              内存
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={fetchProcesses}
              disabled={loading}
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && processes.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">暂无进程数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">PID</TableHead>
                  <TableHead>进程名</TableHead>
                  <TableHead className="w-[70px] text-right">CPU %</TableHead>
                  <TableHead className="w-[80px] text-right">内存</TableHead>
                  <TableHead className="w-[80px] text-right">内存 %</TableHead>
                  <TableHead className="w-[70px]">用户</TableHead>
                  <TableHead className="w-[60px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((proc) => (
                  <TableRow key={proc.pid}>
                    <TableCell className="font-mono text-xs">{proc.pid}</TableCell>
                    <TableCell className="max-w-[180px]">
                      <div className="truncate text-xs font-medium" title={proc.name}>
                        {proc.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      <span className={proc.cpu >= 50 ? "text-destructive font-semibold" : ""}>
                        {proc.cpu}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      {formatBytes(proc.memoryBytes)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      <span className={proc.memory >= 50 ? "text-destructive font-semibold" : ""}>
                        {proc.memory}%
                      </span>
                    </TableCell>
                    <TableCell className="text-xs truncate max-w-[60px]" title={proc.user}>
                      {proc.user}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => setKillConfirm({ pid: proc.pid, name: proc.name })}
                        disabled={killing === proc.pid}
                        title="终止进程"
                      >
                        {killing === proc.pid ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* 终止进程确认对话框 */}
        {killConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
            <div className="w-72 rounded-lg border bg-popover p-4 shadow-lg text-popover-foreground space-y-3 overflow-hidden">
              <div className="font-medium text-sm">确认终止进程</div>
              <p className="text-xs text-muted-foreground">
                强制终止进程可能会导致不可挽回的后果，确认终止进程？
              </p>
              <p className="text-xs font-mono truncate" title={killConfirm.name}>
                PID: {killConfirm.pid} — {killConfirm.name}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setKillConfirm(null)}>
                  取消
                </Button>
                <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => handleKill(killConfirm.pid)}>
                  确认终止
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}