/**
 * 网站访问统计。
 *
 * 数据全部来自 nginx 访问日志，没有埋点也没有额外的采集进程——
 * 日志本来就在写，再起一套采集只会多一份不一致的真相。
 *
 * 代价是统计窗口受日志留存限制：只统计最近三天（今日/昨日/前日），
 * 更久的数据要么已经被轮转走，要么解析成本不划算。
 */

import { existsSync, statSync } from "fs";
import {
  aggregate,
  emptyMetrics,
  parseAccessLog,
  readAccessLog,
  recentDayRanges,
  type AccessMetrics,
  type AccessRecord,
  type DayRange,
} from "./access-log";
import { formatLocation, lookupIpLocations, type IpLocation } from "../security/ip-location";

export interface SiteLogTarget {
  name: string;
  domain: string;
  logPath: string | null;
}

interface CachedLog {
  /** 文件大小 + mtime，变了就重读 */
  signature: string;
  at: number;
  records: AccessRecord[];
  truncated: boolean;
}

const CACHE_TTL_MS = 30_000;
/** 单个日志最多留多少条记录在内存里，超了只留最新的 */
const MAX_RECORDS = 300_000;
/** 画地图时最多解析多少个来源 IP 的归属地 */
const MAX_GEO_IPS = 150;

const logCache = new Map<string, CachedLog>();

function signatureOf(path: string): string {
  try {
    const stats = statSync(path);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return "missing";
  }
}

/**
 * 读并解析一个站点的访问日志，结果按文件缓存。
 * 只保留最近三天：统计和下钻都不看更早的数据，留着白占内存。
 */
function loadRecords(path: string, oldest: number): { records: AccessRecord[]; truncated: boolean } {
  const signature = signatureOf(path);
  const cached = logCache.get(path);
  if (cached && cached.signature === signature && Date.now() - cached.at < CACHE_TTL_MS) {
    return { records: cached.records, truncated: cached.truncated };
  }

  const read = readAccessLog(path);
  let records = parseAccessLog(read.content).filter((r) => r.timestamp >= oldest);
  records.sort((a, b) => a.timestamp - b.timestamp);

  let truncated = read.truncated;
  if (records.length > MAX_RECORDS) {
    records = records.slice(-MAX_RECORDS);
    truncated = true;
  }

  logCache.set(path, { signature, at: Date.now(), records, truncated });
  // 站点被删掉后缓存不该无限留着
  if (logCache.size > 64) {
    for (const key of logCache.keys()) {
      if (key !== path) logCache.delete(key);
      if (logCache.size <= 32) break;
    }
  }
  return { records, truncated };
}

export interface SiteStatRow {
  name: string;
  domain: string;
  logPath: string | null;
  /** 日志不存在或读不动时为 false，前端据此提示而不是显示 0 */
  readable: boolean;
  metrics: Record<string, AccessMetrics>;
}

export interface OverviewResult {
  ranges: DayRange[];
  totals: Record<string, AccessMetrics>;
  sites: SiteStatRow[];
  /** 有日志因为体积被截断，统计只覆盖尾部 */
  truncated: boolean;
  /** 一个能读的日志都没有 */
  available: boolean;
}

export function buildOverview(targets: SiteLogTarget[], now = new Date()): OverviewResult {
  const ranges = recentDayRanges(now);
  const oldest = ranges[ranges.length - 1].from;

  // 多个站点可能共用一个日志文件，按路径解析一次，汇总时也只算一次
  const byPath = new Map<string, { records: AccessRecord[]; truncated: boolean }>();
  const sites: SiteStatRow[] = [];
  let truncated = false;

  for (const target of targets) {
    const readable = !!target.logPath && existsSync(target.logPath);
    if (!readable || !target.logPath) {
      sites.push({ ...target, readable: false, metrics: {} });
      continue;
    }
    let loaded = byPath.get(target.logPath);
    if (!loaded) {
      try {
        loaded = loadRecords(target.logPath, oldest);
      } catch {
        sites.push({ ...target, readable: false, metrics: {} });
        continue;
      }
      byPath.set(target.logPath, loaded);
    }
    truncated = truncated || loaded.truncated;
    sites.push({
      ...target,
      readable: true,
      metrics: aggregate(loaded.records, ranges),
    });
  }

  const totals: Record<string, AccessMetrics> = {};
  for (const range of ranges) totals[range.key] = emptyMetrics();
  // 汇总遍历唯一日志，避免共用日志的站点把流量算两遍
  const merged = [...byPath.values()].flatMap((entry) => entry.records);
  Object.assign(totals, aggregate(merged, ranges));

  return { ranges, totals, sites, truncated, available: byPath.size > 0 };
}

export interface RequestQuery {
  range: string;
  page: number;
  pageSize: number;
  keyword: string;
  /** 2 / 3 / 4 / 5 表示按状态码首位筛，空表示不限 */
  statusClass: string;
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

export interface RequestsResult {
  range: DayRange;
  ranges: DayRange[];
  metrics: AccessMetrics;
  total: number;
  page: number;
  pageSize: number;
  entries: RequestEntry[];
  geo: GeoPoint[];
  /** 归属地只查了请求最多的这些 IP，地图上的点因此可能少于实际来源数 */
  geoCoverage: { lookedUp: number; totalIps: number };
  topPaths: { path: string; count: number }[];
  truncated: boolean;
}

export async function buildSiteRequests(
  target: SiteLogTarget,
  query: RequestQuery,
  now = new Date(),
): Promise<RequestsResult> {
  const ranges = recentDayRanges(now);
  const oldest = ranges[ranges.length - 1].from;
  const selected =
    ranges.find((r) => r.key === query.range) ??
    ({ key: "recent", label: "近三天", from: oldest, to: Date.now() + 86_400_000 } as DayRange);

  const loaded =
    target.logPath && existsSync(target.logPath)
      ? loadRecords(target.logPath, oldest)
      : { records: [], truncated: false };

  const inRange = loaded.records.filter(
    (r) => r.timestamp >= selected.from && r.timestamp < selected.to,
  );

  const keyword = query.keyword.trim().toLowerCase();
  const filtered = inRange.filter((r) => {
    if (query.statusClass && String(r.status)[0] !== query.statusClass) return false;
    if (!keyword) return true;
    return (
      r.ip.toLowerCase().includes(keyword) ||
      r.path.toLowerCase().includes(keyword) ||
      r.userAgent.toLowerCase().includes(keyword)
    );
  });

  // 指标按筛选前的整个时间段算，翻页和搜索不该改变「这个站今天多少流量」
  const metrics = aggregate(inRange, [selected])[selected.key] ?? emptyMetrics();

  const pageCount = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(Math.max(query.page, 1), pageCount);
  // 列表按新→旧看
  const ordered = [...filtered].reverse();
  const rows = ordered.slice((page - 1) * query.pageSize, page * query.pageSize);

  // 地图取请求数最多的来源 IP：全查一遍在爆破场景下能有上千个，太慢
  const ipCounts = new Map<string, number>();
  for (const record of inRange) {
    ipCounts.set(record.ip, (ipCounts.get(record.ip) ?? 0) + 1);
  }
  const geoIps = [...ipCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_GEO_IPS)
    .map(([ip]) => ip);

  const locations = await lookupIpLocations([...rows.map((r) => r.ip), ...geoIps]);

  // 同城的点合到一起，否则一个机房几十个 IP 会在地图上糊成一坨
  const points = new Map<string, GeoPoint>();
  for (const ip of geoIps) {
    const location = locations[ip];
    if (!location || location.latitude === null || location.longitude === null) continue;
    const key = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
    const point = points.get(key) ?? {
      latitude: location.latitude,
      longitude: location.longitude,
      label: formatLocation(location) || ip,
      country: location.country,
      requests: 0,
      ips: 0,
    };
    point.requests += ipCounts.get(ip) ?? 0;
    point.ips += 1;
    points.set(key, point);
  }

  const pathCounts = new Map<string, number>();
  for (const record of inRange) {
    const clean = record.path.split("?")[0];
    pathCounts.set(clean, (pathCounts.get(clean) ?? 0) + 1);
  }

  return {
    range: selected,
    ranges,
    metrics,
    total: filtered.length,
    page,
    pageSize: query.pageSize,
    entries: rows.map((record) => ({
      ...record,
      location: locations[record.ip] ?? null,
      locationText: formatLocation(locations[record.ip] ?? null),
    })),
    geo: [...points.values()].sort((a, b) => b.requests - a.requests),
    geoCoverage: { lookedUp: geoIps.length, totalIps: ipCounts.size },
    topPaths: [...pathCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({ path, count })),
    truncated: loaded.truncated,
  };
}
