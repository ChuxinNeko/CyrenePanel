import {
  Activity,
  Box,
  Container,
  FileText,
  Globe2,
  KeyRound,
  LogIn,
  Network,
  Server,
  ShieldAlert,
  User,
  type LucideIcon,
} from "lucide-react";

export interface AuditLogItem {
  id: string;
  timestamp: number;
  username: string;
  category: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  success: boolean;
  nodeId: string;
  nodeName: string;
}

export interface AuditStats {
  total: number;
  failed: number;
  byCategory: Record<string, number>;
  usernames: string[];
  earliest: number | null;
  latest: number | null;
}

/** 与后端 AuditCategory 一一对应 */
export const AUDIT_CATEGORY_META: Record<string, { label: string; icon: LucideIcon }> = {
  auth: { label: "认证", icon: LogIn },
  user: { label: "用户", icon: User },
  file: { label: "文件", icon: FileText },
  certificate: { label: "证书", icon: KeyRound },
  node: { label: "节点", icon: Network },
  instance: { label: "实例", icon: Box },
  service: { label: "服务", icon: Activity },
  site: { label: "网站", icon: Globe2 },
  docker: { label: "Docker", icon: Container },
  system: { label: "系统", icon: Server },
};

export function categoryMeta(category: string) {
  return (
    AUDIT_CATEGORY_META[category] ?? {
      label: category || "其他",
      icon: ShieldAlert,
    }
  );
}

/** 时间范围预设。value 是相对现在的毫秒数，null 表示不限 */
export const TIME_RANGES = [
  { value: "1h", label: "最近 1 小时", ms: 3_600_000 },
  { value: "24h", label: "最近 24 小时", ms: 86_400_000 },
  { value: "7d", label: "最近 7 天", ms: 7 * 86_400_000 },
  { value: "30d", label: "最近 30 天", ms: 30 * 86_400_000 },
  { value: "all", label: "全部时间", ms: null },
] as const;

export type TimeRangeValue = (typeof TIME_RANGES)[number]["value"];

export function rangeToFrom(range: TimeRangeValue, now: number): number | undefined {
  const preset = TIME_RANGES.find((r) => r.value === range);
  if (!preset || preset.ms === null) return undefined;
  return now - preset.ms;
}

export function formatAbsoluteTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatRelativeTime(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatAbsoluteTime(timestamp).slice(0, 16);
}

export function displayUsername(username: string): string {
  if (!username) return "(匿名)";
  if (username === "__api_node__") return "主节点代理";
  return username;
}

/** 把时间跨度渲染成「3 天」这类粗粒度描述 */
export function formatSpan(earliest: number | null, latest: number | null): string {
  if (earliest === null || latest === null) return "—";
  const diff = Math.max(0, latest - earliest);
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时`;
  return `${Math.floor(diff / 86_400_000)} 天`;
}

/**
 * 导出为 CSV。字段里可能含逗号、引号和换行，按 RFC4180 用双引号包裹并转义。
 * 前导 = + - @ 会被 Excel 当公式执行，补一个单引号前缀挡掉。
 */
export function logsToCsv(logs: AuditLogItem[]): string {
  const headers = [
    "时间",
    "用户",
    "分类",
    "操作",
    "对象",
    "详情",
    "节点",
    "来源IP",
    "结果",
  ];

  const escape = (value: string): string => {
    const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${guarded.replace(/"/g, '""')}"`;
  };

  const rows = logs.map((log) =>
    [
      formatAbsoluteTime(log.timestamp),
      displayUsername(log.username),
      categoryMeta(log.category).label,
      log.action,
      log.target,
      log.detail,
      log.nodeName,
      log.ip,
      log.success ? "成功" : "失败",
    ]
      .map((cell) => escape(String(cell ?? "")))
      .join(",")
  );

  // BOM 让 Excel 正确识别 UTF-8 中文
  return `﻿${headers.map(escape).join(",")}\n${rows.join("\n")}`;
}
