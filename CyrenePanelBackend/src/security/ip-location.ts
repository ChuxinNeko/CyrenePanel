/**
 * IP 归属地查询。
 *
 * 在服务端做而不是让浏览器直连，有三个原因：
 * 1. SSH 日志里同一个 IP 会重复几十上百次，缓存能把请求量压到唯一 IP 数
 * 2. 第三方接口未必开 CORS
 * 3. 面板前端不该把用户的浏览器暴露给第三方服务
 */

import { logger } from "../logger/index";

const API_BASE = (
  process.env.CYRENE_IP_LOCATION_API || "https://music.nekofun.top/ip-location"
).replace(/\/+$/, "");

export interface IpLocation {
  country: string;
  province: string;
  city: string;
  isp: string;
  /** 画请求地图要用。接口给的是字符串，这里转成数字；取不到就是 null */
  latitude: number | null;
  longitude: number | null;
}

interface CacheEntry {
  value: IpLocation | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
/** 归属地基本不变，缓存久一点；查不到的也缓存，避免对同一个坏 IP 反复重试 */
const TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 5000;

/** 同时在飞的请求数上限，避免一次刷出几十个并发把对端打挂 */
const CONCURRENCY = 6;

function isPrivateIp(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^127\./.test(ip) ||
    ip === "::1" ||
    /^f[cd][0-9a-f]{2}:/i.test(ip)
  );
}

async function fetchLocation(ip: string): Promise<IpLocation | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_BASE}/query?ip=${encodeURIComponent(ip)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      location?: Record<string, unknown>;
    };
    if (!data?.success || !data.location) return null;
    const text = (key: string) => {
      const value = data.location?.[key];
      return typeof value === "string" ? value : "";
    };
    const coord = (key: string) => {
      const value = Number(data.location?.[key]);
      return Number.isFinite(value) ? value : null;
    };
    return {
      country: text("country"),
      province: text("province"),
      city: text("city"),
      isp: text("isp"),
      latitude: coord("latitude"),
      longitude: coord("longitude"),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readCache(ip: string): CacheEntry | undefined {
  const hit = cache.get(ip);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(ip);
    return undefined;
  }
  return hit;
}

function writeCache(ip: string, value: IpLocation | null): void {
  // 简单的容量控制：超了就丢掉最早写入的一批
  if (cache.size >= CACHE_MAX) {
    const drop = Math.ceil(CACHE_MAX * 0.2);
    let i = 0;
    for (const key of cache.keys()) {
      cache.delete(key);
      if (++i >= drop) break;
    }
  }
  cache.set(ip, {
    value,
    expiresAt: Date.now() + (value ? TTL_MS : NEGATIVE_TTL_MS),
  });
}

/** 批量查询，返回 ip → 归属地。查不到的键存在但值为 null */
export async function lookupIpLocations(
  ips: string[],
): Promise<Record<string, IpLocation | null>> {
  const unique = [...new Set(ips.filter(Boolean))];
  const result: Record<string, IpLocation | null> = {};
  const pending: string[] = [];

  for (const ip of unique) {
    if (isPrivateIp(ip)) {
      result[ip] = {
        country: "局域网",
        province: "",
        city: "",
        isp: "",
        latitude: null,
        longitude: null,
      };
      continue;
    }
    const hit = readCache(ip);
    if (hit) result[ip] = hit.value;
    else pending.push(ip);
  }

  if (pending.length === 0) return result;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
    while (cursor < pending.length) {
      const ip = pending[cursor++];
      const value = await fetchLocation(ip);
      writeCache(ip, value);
      result[ip] = value;
    }
  });

  try {
    await Promise.all(workers);
  } catch (e: any) {
    logger.warn(`IP 归属地批量查询异常: ${e.message}`);
  }

  return result;
}

/** 把归属地拼成一行可读文本 */
export function formatLocation(location: IpLocation | null): string {
  if (!location) return "";
  const parts = [location.country, location.province, location.city]
    .map((p) => p.trim())
    .filter(Boolean);
  // 接口对部分 IP 会把 country 和 province 填成同一个值，去重
  const deduped = parts.filter((p, i) => parts.indexOf(p) === i);
  return deduped.join(" ");
}
