"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Activity, Cpu, ListTree, MemoryStick, Network, Terminal as TerminalIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildBackendWsUrl, useBackendPort } from "@/hooks/use-backend-port";
import { dockerGet, type DockerContainerStat } from "@/lib/docker-api";

import "@xterm/xterm/css/xterm.css";

interface ContainerRef {
  id: string;
  name: string;
  state: string;
}

export function ContainerDetailDialog({
  container,
  prefix,
  onClose,
}: {
  container: ContainerRef | null;
  prefix: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("stats");

  // 换容器时回到默认页签，避免停留在上一个容器的终端
  useEffect(() => {
    if (container) setTab("stats");
  }, [container?.id]);

  return (
    <Dialog open={!!container} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[85vh] w-[95vw] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2">
            {container?.name}
            <Badge variant={container?.state === "running" ? "default" : "outline"}>
              {container?.state}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-3 w-fit">
            <TabsTrigger value="stats" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              资源占用
            </TabsTrigger>
            <TabsTrigger value="processes" className="gap-1.5">
              <ListTree className="h-3.5 w-3.5" />
              进程
            </TabsTrigger>
            <TabsTrigger value="terminal" className="gap-1.5">
              <TerminalIcon className="h-3.5 w-3.5" />
              终端
            </TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 p-5">
            <TabsContent value="stats" className="mt-0 h-full">
              {container && <StatsPane container={container} prefix={prefix} />}
            </TabsContent>
            <TabsContent value="processes" className="mt-0 h-full">
              {container && <ProcessPane container={container} prefix={prefix} />}
            </TabsContent>
            <TabsContent value="terminal" className="mt-0 h-full">
              {container && tab === "terminal" && <TerminalPane container={container} />}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── 资源占用 ─────────────────────────────────────────────────────────

function StatsPane({ container, prefix }: { container: ContainerRef; prefix: string }) {
  const [stat, setStat] = useState<DockerContainerStat | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await dockerGet<{ success: boolean; stats?: DockerContainerStat[] }>(
      `${prefix}/stats`,
    );
    if (data.success && data.stats) {
      // docker stats 返回短 ID，容器列表里可能是长 ID，两边互相前缀匹配
      const found = data.stats.find(
        (s) => container.id.startsWith(s.id) || s.id.startsWith(container.id) || s.name === container.name,
      );
      setStat(found ?? null);
    }
    setLoading(false);
  }, [prefix, container.id, container.name]);

  useEffect(() => {
    load();
    if (container.state !== "running") return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load, container.state]);

  if (container.state !== "running") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        容器未运行，无资源数据
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (!stat) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        未获取到该容器的资源数据
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          icon={<Cpu className="h-4 w-4" />}
          label="CPU"
          value={`${stat.cpuPercent.toFixed(2)}%`}
          percent={Math.min(stat.cpuPercent, 100)}
        />
        <MetricCard
          icon={<MemoryStick className="h-4 w-4" />}
          label="内存"
          value={`${stat.memPercent.toFixed(2)}%`}
          hint={`${stat.memUsage} / ${stat.memLimit}`}
          percent={Math.min(stat.memPercent, 100)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <InfoBlock
          icon={<Network className="h-4 w-4" />}
          label="网络 I/O"
          rows={[
            ["接收", stat.netInput],
            ["发送", stat.netOutput],
          ]}
        />
        <InfoBlock
          icon={<Activity className="h-4 w-4" />}
          label="磁盘 I/O"
          rows={[
            ["读取", stat.blockRead],
            ["写入", stat.blockWrite],
            ["进程数", String(stat.pids)],
          ]}
        />
      </div>

      <p className="text-xs text-muted-foreground">每 3 秒自动刷新</p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  percent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  percent: number;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="text-lg font-semibold">{value}</span>
      </div>
      <Progress value={percent} className="h-1.5" />
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function InfoBlock({
  icon,
  label,
  rows,
}: {
  icon: React.ReactNode;
  label: string;
  rows: [string, string][];
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono text-xs">{v || "-"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 进程列表 ─────────────────────────────────────────────────────────

function ProcessPane({ container, prefix }: { container: ContainerRef; prefix: string }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [processes, setProcesses] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await dockerGet<{
        success: boolean;
        headers?: string[];
        processes?: string[][];
        message?: string;
      }>(`${prefix}/containers/${encodeURIComponent(container.id)}/top`);
      if (data.success) {
        setHeaders(data.headers || []);
        setProcesses(data.processes || []);
        setError("");
      } else {
        setError(data.message || "获取进程列表失败");
      }
      setLoading(false);
    })();
  }, [prefix, container.id]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中...</div>;
  }
  if (error) {
    return <div className="text-sm text-muted-foreground">{error}</div>;
  }

  return (
    <ScrollArea className="h-full rounded-lg border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 border-b bg-muted/50">
          <tr>
            {headers.map((h) => (
              <th key={h} className="p-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {processes.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="p-2 font-mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

// ── 容器终端 ─────────────────────────────────────────────────────────

const SHELLS = ["sh", "bash", "ash"];

function TerminalPane({ container }: { container: ContainerRef }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [shell, setShell] = useState("sh");
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const backendPort = useBackendPort();

  useEffect(() => {
    // 端口还没探测出来时不要连，否则会拼出错误的 WebSocket 地址
    if (!hostRef.current || container.state !== "running" || backendPort === null) return;

    let disposed = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let fit: import("@xterm/addon-fit").FitAddon | null = null;
    let onResize: (() => void) | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !hostRef.current) return;

      term = new Terminal({
        fontSize: 13,
        fontFamily: "Menlo, Consolas, monospace",
        cursorBlink: true,
        theme: { background: "#0b0f19" },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();

      let url: string;
      try {
        url = await buildBackendWsUrl(
          `/api/docker/exec?container=${encodeURIComponent(container.name)}&shell=${shell}`,
          "docker-exec",
          backendPort,
        );
      } catch (e: any) {
        term?.write(`\r\n\x1b[31m${e?.message || "获取终端票据失败"}\x1b[0m\r\n`);
        setStatus("closed");
        return;
      }

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setStatus("open");

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "output") term?.write(payload.data);
          else if (payload.type === "error") {
            term?.write(`\r\n\x1b[31m${payload.message}\x1b[0m\r\n`);
            toast.error(payload.message);
          } else if (payload.type === "exit") {
            term?.write(`\r\n\x1b[33m会话已结束（退出码 ${payload.code}）\x1b[0m\r\n`);
            setStatus("closed");
          }
        } catch {
          // 忽略非 JSON 消息
        }
      };

      ws.onclose = () => setStatus("closed");
      ws.onerror = () => setStatus("closed");

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      onResize = () => {
        fit?.fit();
        if (term && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };
      window.addEventListener("resize", onResize);
      // 首次连上后同步一次尺寸，否则服务端仍是默认 80x30
      setTimeout(() => onResize?.(), 300);
    })();

    return () => {
      disposed = true;
      if (onResize) window.removeEventListener("resize", onResize);
      wsRef.current?.close();
      wsRef.current = null;
      term?.dispose();
    };
  }, [container.name, container.state, shell, backendPort]);

  if (container.state !== "running") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        容器未运行，无法进入终端
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {SHELLS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={shell === s ? "default" : "outline"}
              onClick={() => setShell(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <Badge variant={status === "open" ? "default" : "outline"}>
          {status === "open" ? "已连接" : status === "connecting" ? "连接中" : "已断开"}
        </Badge>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-[#0b0f19] p-2" />
      <p className="text-xs text-muted-foreground">
        若提示 shell 不存在，可切换到其它 shell（Alpine 镜像通常只有 sh/ash）
      </p>
    </div>
  );
}
