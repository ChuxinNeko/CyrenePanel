import { API_BASE } from "@/lib/api-base";
import type { FileKind } from "@/lib/file-kind";

/**
 * 媒体预览 URL 构建
 *
 * 策略：
 * 1. 优先用 /files/raw?path=&token= 直链（浏览器原生 Range，视频可 seek）
 * 2. 失败时由调用方回退到 base64 download（旧节点兼容）
 *
 * 不在此模块创建 blob URL：raw 直链可被 video 原生缓存与 Range，
 * blob 全量下载会破坏 seek 与性能。
 */

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function getNodeApiPrefix(nodeId: string | null | undefined): string {
  return nodeId ? `/api/nodes/${nodeId}` : "/api";
}

/** 构建 raw 预览 URL（含 token，供 media 标签 src 使用） */
export function buildFileRawUrl(options: {
  path: string;
  nodeId?: string | null;
  token?: string | null;
}): string | null {
  const token = options.token ?? getAuthToken();
  if (!token) return null;

  const prefix = getNodeApiPrefix(options.nodeId ?? null);
  const params = new URLSearchParams({
    path: options.path,
    token,
  });
  return `${API_BASE}${prefix}/files/raw?${params.toString()}`;
}

export interface RawProbeResult {
  ok: boolean;
  status: number;
  mimeType?: string;
  size?: number;
  acceptsRange?: boolean;
  message?: string;
}

/**
 * 轻量探测 raw 是否可用（HEAD 优先，不支持时 GET Range 0-0）
 * 用于：旧节点无 raw 时提前回退，避免 media 卡死
 */
export async function probeFileRaw(options: {
  path: string;
  nodeId?: string | null;
  signal?: AbortSignal;
}): Promise<RawProbeResult> {
  const token = getAuthToken();
  if (!token) return { ok: false, status: 401, message: "未登录" };

  const prefix = getNodeApiPrefix(options.nodeId ?? null);
  const url = `${API_BASE}${prefix}/files/raw?path=${encodeURIComponent(options.path)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Range: "bytes=0-0",
  };

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: options.signal,
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "无权限" };
    }
    if (res.status === 404) {
      return { ok: false, status: 404, message: "文件不存在" };
    }
    // 旧节点可能返回 404 JSON 或非 2xx/206
    if (!(res.ok || res.status === 206)) {
      let message = `无法预览（HTTP ${res.status}）`;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          const data = await res.json();
          if (data?.message) message = data.message;
        } catch {
          // ignore
        }
      } else {
        // 消费掉 body，避免连接悬挂
        await res.arrayBuffer().catch(() => undefined);
      }
      return { ok: false, status: res.status, message };
    }

    const contentRange = res.headers.get("content-range");
    let size: number | undefined;
    if (contentRange) {
      const total = contentRange.split("/")[1];
      if (total && total !== "*") size = Number(total);
    }
    const contentLength = res.headers.get("content-length");
    if (size == null && contentLength) size = Number(contentLength);

    // 丢弃 1 字节 body
    await res.arrayBuffer().catch(() => undefined);

    return {
      ok: true,
      status: res.status,
      mimeType: res.headers.get("content-type") || undefined,
      size: Number.isFinite(size) ? size : undefined,
      acceptsRange: res.status === 206 || !!contentRange,
    };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { ok: false, status: 0, message: "已取消" };
    }
    return { ok: false, status: 0, message: e?.message || "网络错误" };
  }
}

/**
 * 兼容回退：用 base64 download 生成 blob URL
 * 仅小文件使用；调用方负责 revoke
 */
export async function loadPreviewBlobUrl(options: {
  path: string;
  nodeId?: string | null;
  signal?: AbortSignal;
}): Promise<{ url: string; mimeType: string; size: number; fileName: string }> {
  const token = getAuthToken();
  if (!token) throw new Error("未登录");

  const prefix = getNodeApiPrefix(options.nodeId ?? null);
  const res = await fetch(
    `${API_BASE}${prefix}/files/download?path=${encodeURIComponent(options.path)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: options.signal,
    },
  );
  const data = await res.json() as {
    success?: boolean;
    data?: string;
    mimeType?: string;
    fileName?: string;
    size?: number;
    message?: string;
  };

  if (!data.success || !data.data) {
    throw new Error(data.message || "加载失败");
  }

  const binary = atob(data.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const mimeType = data.mimeType || "application/octet-stream";
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);

  return {
    url,
    mimeType,
    size: data.size ?? bytes.length,
    fileName: data.fileName || options.path.split("/").pop() || "file",
  };
}

export function revokeObjectUrl(url: string | null | undefined) {
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function kindSupportsNativeRange(kind: FileKind): boolean {
  return kind === "video" || kind === "audio";
}