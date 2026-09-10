/**
 * 实例管理总览页和详情页共用的类型与展示规则。
 * 这两处原本各自复制了一份 formatDuration 和状态映射，且行为并不一致
 * （总览的不足一分钟显示「< 1分」，详情页显示「0分」），这里统一。
 */

export interface Instance {
  id: string;
  name: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  autoRestart: boolean;
  createdAt: number;
  status: InstanceStatus;
  pid?: number;
  startedAt?: number;
  exitCode: number | null;
  logs: string[];
  nodeId: string;
  nodeName: string;
}

export type InstanceStatus = "running" | "stopped" | "error";

export interface StatusMeta {
  label: string;
  /** 状态点的填充色。颜色永远只是辅助，旁边始终有文字标签 */
  dot: string;
  /** 数值/强调文字的前景色 */
  text: string;
  /** 卡片右上角状态标签用的 Badge 变体 */
  badge: "success" | "secondary" | "destructive";
}

/**
 * 状态色全部走设计令牌。原来这两页写死了 emerald / zinc / red，
 * 既不跟随主题也违反规范「不引入第六个强调色」。
 */
export const INSTANCE_STATUS: Record<InstanceStatus, StatusMeta> = {
  running: {
    label: "运行中",
    dot: "bg-success",
    text: "text-success-fg",
    badge: "success",
  },
  stopped: {
    label: "已停止",
    dot: "bg-mute",
    text: "text-muted-foreground",
    badge: "secondary",
  },
  error: {
    label: "错误",
    dot: "bg-destructive",
    text: "text-destructive",
    badge: "destructive",
  },
};

export function statusMeta(status: string): StatusMeta {
  return (
    INSTANCE_STATUS[status as InstanceStatus] ?? {
      label: status || "未知",
      dot: "bg-mute",
      text: "text-muted-foreground",
      badge: "secondary",
    }
  );
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}时 ${m}分`;
  if (h > 0) return `${h}时 ${m}分`;
  if (m > 0) return `${m}分`;
  return "< 1分";
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 运行中显示已运行时长，停止后显示退出码，都没有就是一个短横。
 * now 由调用方传入（见 useNow）——渲染期直接读 Date.now() 不是纯函数。
 */
export function runtimeSummary(
  instance: {
    status: string;
    startedAt?: number;
    exitCode: number | null;
  },
  now: number
): string {
  if (instance.status === "running" && instance.startedAt) {
    return formatDuration(now - instance.startedAt);
  }
  if (instance.exitCode !== null && instance.exitCode !== undefined) {
    return `退出码 ${instance.exitCode}`;
  }
  return "—";
}
