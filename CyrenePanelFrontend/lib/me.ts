"use client";

import { api } from "@/lib/api";

export interface MeProfile {
  username: string;
  [key: string]: unknown;
}

/**
 * /api/me 的共享取数入口。
 *
 * 侧边栏和各页面都要拿当前用户，挂载时机几乎同时，直接各调各的会重复请求。
 * 这里做在途去重 + 极短 TTL：并发调用共用同一个 Promise，短时间内的重复调用直接命中缓存。
 *
 * TTL 只有 5 秒，且这仅是客户端的展示/跳转判断——真正的鉴权在后端每个接口上，
 * 因此不存在因缓存导致越权的问题。
 */
const TTL_MS = 5000;

let inflight: Promise<MeProfile | null> | null = null;
let cached: { value: MeProfile | null; at: number } | null = null;

export async function fetchMe(force = false): Promise<MeProfile | null> {
  if (force) {
    cached = null;
    inflight = null;
  } else {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
    if (inflight) return inflight;
  }

  inflight = (async () => {
    try {
      const { data, error } = await api.api.me.get();
      const value = !error && data?.success && data.profile ? (data.profile as MeProfile) : null;
      cached = { value, at: Date.now() };
      return value;
    } catch {
      cached = { value: null, at: Date.now() };
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 退出登录等场景下主动失效，避免下次读到旧身份 */
export function clearMeCache() {
  cached = null;
  inflight = null;
}
