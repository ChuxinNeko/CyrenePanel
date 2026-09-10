"use client";

import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

/**
 * 状态卡各环形进度条的悬停详情。
 * 布局参考宝塔：基础信息在上，可展开的扩展段在下。
 */

// ── 通用小件 ─────────────────────────────────────────────────────────

export function DetailTitle({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-2">{children}</p>;
}

/** 一行键值。value 用等宽，便于数字对齐 */
export function DetailRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 truncate text-right font-mono text-xs font-medium tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}

/** 两列紧凑网格，用于 CPU 时间分布这类成对的小数值 */
function DetailGrid({ entries }: { entries: Array<[string, string]> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">{k}</span>
          <span className="font-mono text-xs tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Section({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/sec border-t pt-2">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <span>{label}</span>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/sec:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// ── top5 进程 ────────────────────────────────────────────────────────

interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  memoryBytes: number;
  user: string;
}

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * 取进程要在服务端 spawn 一次 ps，所以不跟 5 秒轮询走，
 * 只在这个段被展开时拉一次。
 */
function TopProcesses({ sortBy }: { sortBy: "cpu" | "memory" }) {
  const [rows, setRows] = useState<ProcessInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/system/top-processes`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setRows(sortBy === "cpu" ? d.byCpu : d.byMemory);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [sortBy]);

  if (failed) return <p className="text-xs text-mute">进程信息获取失败</p>;
  if (!rows) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-mute">
        <Loader2 className="size-3 animate-spin" />
        加载中…
      </p>
    );
  }
  if (rows.length === 0) return <p className="text-xs text-mute">无数据</p>;

  return (
    <div className="space-y-0.5">
      {rows.map((p) => (
        <div key={p.pid} className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-xs" title={p.name}>
            {p.name}
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {sortBy === "cpu" ? `${p.cpu}%` : `${p.memory}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Collapsible 关闭时内容不挂载，展开才会真正发起请求 */
function TopProcessSection({
  label,
  sortBy,
}: {
  label: string;
  sortBy: "cpu" | "memory";
}) {
  return (
    <Section label={label}>
      <TopProcesses sortBy={sortBy} />
    </Section>
  );
}

// ── 四种详情 ─────────────────────────────────────────────────────────

export interface LoadDetailData {
  one: number;
  five: number;
  fifteen: number;
  runningProcesses: number;
  totalProcesses: number;
}

export interface CpuTimesData {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
  guest: number;
  guestNice: number;
}

export function LoadDetailCard({
  load,
  times,
  fullTimesSupported,
}: {
  load: LoadDetailData;
  times: CpuTimesData | null;
  fullTimesSupported: boolean;
}) {
  return (
    <div className="space-y-2">
      <DetailTitle>基础信息</DetailTitle>
      <DetailRow
        label="最近 1/5/15 分钟平均负载"
        value={`${load.one} / ${load.five} / ${load.fifteen}`}
      />
      <DetailRow
        label="活动进程数 / 总进程数"
        value={`${load.runningProcesses} / ${load.totalProcesses}`}
      />

      {times && (
        <Section label="更多负载信息" defaultOpen>
          <DetailGrid
            entries={[
              ["user", `${times.user}`],
              ["nice", `${times.nice}`],
              ["system", `${times.system}`],
              ["idle", `${times.idle}`],
              ["iowait", `${times.iowait}`],
              ["irq", `${times.irq}`],
              ["softirq", `${times.softirq}`],
              ["steal", `${times.steal}`],
              ["guest", `${times.guest}`],
              ["guest_nice", `${times.guestNice}`],
            ]}
          />
          {!fullTimesSupported && (
            <p className="mt-1.5 text-[11px] text-mute">
              当前系统只能提供 user / system / idle / irq，其余项无对应指标
            </p>
          )}
        </Section>
      )}

      <TopProcessSection label="CPU 占用率 top5 的进程" sortBy="cpu" />
    </div>
  );
}

export function CpuDetailCard({
  model,
  physicalCount,
  physicalCores,
  logicalCores,
  coreUsage,
}: {
  model: string;
  physicalCount: number;
  physicalCores: number;
  logicalCores: number;
  coreUsage: number[];
}) {
  return (
    <div className="space-y-2">
      <DetailTitle>基础信息</DetailTitle>
      <p className="text-xs leading-relaxed break-words">
        {model} * {physicalCount}
      </p>
      <p className="text-xs text-muted-foreground">
        {physicalCount} 个物理 CPU，{physicalCores} 个物理核心，{logicalCores} 个逻辑核心
      </p>

      {coreUsage.length > 0 && (
        <Section label="核心使用率">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {coreUsage.map((usage, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-8 shrink-0 font-mono text-[11px] text-mute">
                  #{i}
                </span>
                <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-chart-1/15">
                  <span
                    className="block h-full rounded-full bg-chart-1"
                    style={{ width: `${Math.min(100, Math.max(0, usage))}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums">
                  {usage}%
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <TopProcessSection label="CPU 占用率 top5 的进程" sortBy="cpu" />
    </div>
  );
}

export function MemoryDetailCard({
  free,
  used,
  total,
  shared,
  available,
  buffers,
  cached,
  detailSupported,
}: {
  free: string;
  used: string;
  total: string;
  shared: string;
  available: string;
  buffers: string;
  cached: string;
  detailSupported: boolean;
}) {
  return (
    <div className="space-y-2">
      <DetailTitle>内存信息</DetailTitle>
      <DetailRow label="空闲内存" value={free} />
      <DetailRow label="已用" value={used} />
      <DetailRow label="总内存" value={total} />
      {detailSupported && (
        <>
          <DetailRow label="共享" value={shared} />
          <DetailRow label="可分配内存" value={available} />
          <DetailRow label="buff / cache" value={`${buffers} / ${cached}`} />
        </>
      )}
      {!detailSupported && (
        <p className="text-[11px] text-mute">
          当前系统不提供共享内存与 buff/cache 指标
        </p>
      )}

      <TopProcessSection label="内存使用率 top5 的进程" sortBy="memory" />
    </div>
  );
}

export function DiskDetailCard({
  mount,
  filesystem,
  fstype,
  totalFormatted,
  freeFormatted,
  usedFormatted,
  percentage,
  inodes,
}: {
  mount: string;
  filesystem: string;
  fstype: string;
  totalFormatted: string;
  freeFormatted: string;
  usedFormatted: string;
  percentage: number;
  inodes: { total: number; used: number; free: number; percentage: number } | null;
}) {
  return (
    <div className="space-y-2">
      <DetailTitle>基础信息</DetailTitle>
      <DetailRow label="挂载点" value={mount} />
      <p className="text-xs text-muted-foreground">
        共 {totalFormatted}，可用 {freeFormatted}，已用 {usedFormatted}
      </p>
      <DetailRow label="文件系统" value={filesystem} />
      <DetailRow
        label="类型 / 系统占用"
        value={`${fstype || "—"} · ${percentage}%`}
      />

      {inodes ? (
        <Section label="Inode 信息" defaultOpen>
          <DetailRow label="总数" value={inodes.total.toLocaleString()} />
          <DetailRow label="已用" value={inodes.used.toLocaleString()} />
          <DetailRow label="可用" value={inodes.free.toLocaleString()} />
          <DetailRow label="使用率" value={`${inodes.percentage} %`} />
        </Section>
      ) : (
        <p className="border-t pt-2 text-[11px] text-mute">
          该文件系统不提供 inode 统计
        </p>
      )}
    </div>
  );
}
