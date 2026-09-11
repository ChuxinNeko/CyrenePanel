/** 网站访问统计的共享类型与展示辅助，对应后端 src/sites/stats.ts */

import type { ServerTimezone } from "./audit";

export interface AccessMetrics {
  bytes: number;
  requests: number;
  ips: number;
  uv: number;
  pv: number;
}

export interface DayRange {
  key: string;
  label: string;
  from: number;
  to: number;
}

export interface SiteStatRow {
  name: string;
  domain: string;
  logPath: string | null;
  /** 日志不存在或读不动，前端要提示而不是显示 0 */
  readable: boolean;
  metrics: Record<string, AccessMetrics>;
}

export interface OverviewResponse {
  success?: boolean;
  message?: string;
  generatedAt?: number;
  timezone?: ServerTimezone | null;
  ranges?: DayRange[];
  totals?: Record<string, AccessMetrics>;
  sites?: SiteStatRow[];
  truncated?: boolean;
  available?: boolean;
}

export interface IpLocation {
  country: string;
  province: string;
  city: string;
  isp: string;
  latitude: number | null;
  longitude: number | null;
}

export interface RequestEntry {
  timestamp: number;
  ip: string;
  method: string;
  path: string;
  status: number;
  bytes: number;
  userAgent: string;
  referer: string;
  location: IpLocation | null;
  locationText: string;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
  label: string;
  country: string;
  requests: number;
  ips: number;
}

export interface RequestsResponse {
  success?: boolean;
  message?: string;
  site?: { name: string; domain: string; logPath: string | null };
  timezone?: ServerTimezone | null;
  range?: DayRange;
  ranges?: DayRange[];
  metrics?: AccessMetrics;
  total?: number;
  page?: number;
  pageSize?: number;
  entries?: RequestEntry[];
  geo?: GeoPoint[];
  geoCoverage?: { lookedUp: number; totalIps: number };
  topPaths?: { path: string; count: number }[];
  truncated?: boolean;
}

export const EMPTY_METRICS: AccessMetrics = {
  bytes: 0,
  requests: 0,
  ips: 0,
  uv: 0,
  pv: 0,
};

/** 流量给两位小数：面板上看的是「今天用了多少」，个位字节没有意义 */
export function formatTraffic(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

/** 五个指标的口径写在这里，UI 上当提示显示——不然数字对不上会让人怀疑统计错了 */
export const METRIC_CARDS = [
  {
    key: "bytes" as const,
    label: "流量",
    hint: "响应体累计大小（不含响应头）",
    format: formatTraffic,
  },
  {
    key: "requests" as const,
    label: "请求数",
    hint: "访问日志里的全部请求行",
    format: formatCount,
  },
  {
    key: "ips" as const,
    label: "IP",
    hint: "去重后的来源 IP 数",
    format: formatCount,
  },
  {
    key: "uv" as const,
    label: "UV",
    hint: "按 IP + User-Agent 去重的访客数",
    format: formatCount,
  },
  {
    key: "pv" as const,
    label: "PV",
    hint: "页面浏览：排除静态资源、且状态码小于 400 的请求",
    format: formatCount,
  },
];

/** 与昨日比的涨跌，用来在卡片上标一个箭头 */
export function deltaRatio(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

export function statusTone(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning-fg";
  if (status >= 300) return "text-muted-foreground";
  return "text-success-fg";
}
