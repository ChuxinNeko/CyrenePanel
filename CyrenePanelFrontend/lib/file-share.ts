/**
 * 文件分享：API 与 URL 拼装
 *
 * - 管理端：创建 / 列表 / 撤销（需登录）
 * - 公开端：元信息 / 解锁 / 预览 raw / base64 下载
 * - 直链：勾选后返回 /api/public/shares/:id/direct（流式 attachment）
 */

import { API_BASE } from "@/lib/api-base";

export type ExpirePreset = "1h" | "24h" | "7d" | "30d" | "never";

export interface PublicShareInfo {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  hasShareCode: boolean;
  allowDirectLink: boolean;
  expiresAt: number | null;
  createdAt: number;
  downloadCount: number;
  expired: boolean;
}

export interface ManagedShareInfo extends PublicShareInfo {
  filePath: string;
  nodeId: string | null;
  createdBy: string;
}

export interface CreateShareResult {
  success: boolean;
  message?: string;
  share?: ManagedShareInfo;
  pagePath?: string;
  directPath?: string | null;
  /** 前端拼好的完整 URL */
  pageUrl?: string;
  directUrl?: string | null;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/** 相对路径 → 当前前端 origin 下的绝对 URL（经 next rewrite 代理，不暴露后端主机） */
export function toPublicUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const base = API_BASE || origin;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  // API_BASE 为空时用前端同源；非空时用配置的 API 前缀
  if (!API_BASE) {
    return `${origin}${normalized}`;
  }
  // 页面路径走前端 origin；/api 路径走 API_BASE
  if (normalized.startsWith("/api/")) {
    return `${API_BASE}${normalized}`;
  }
  return `${origin}${normalized}`;
}

export async function createFileShare(input: {
  path: string;
  nodeId?: string | null;
  shareCode?: string;
  expirePreset?: ExpirePreset;
  expiresAt?: number | null;
  allowDirectLink?: boolean;
}): Promise<CreateShareResult> {
  const res = await fetch(`${API_BASE}/api/files/shares`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      path: input.path,
      nodeId: input.nodeId ?? null,
      shareCode: input.shareCode || undefined,
      expirePreset: input.expirePreset || "7d",
      expiresAt: input.expiresAt ?? undefined,
      allowDirectLink: !!input.allowDirectLink,
    }),
  });
  const data = (await res.json()) as CreateShareResult;
  if (!data.success) return data;

  const pageUrl = data.pagePath ? toPublicUrl(data.pagePath) : undefined;
  const directUrl = data.directPath ? toPublicUrl(data.directPath) : null;
  return { ...data, pageUrl, directUrl };
}

export async function fetchPublicShare(
  id: string,
): Promise<{ success: boolean; share?: PublicShareInfo; message?: string }> {
  const res = await fetch(`${API_BASE}/api/public/shares/${encodeURIComponent(id)}`);
  return res.json();
}

export async function unlockPublicShare(
  id: string,
  shareCode?: string,
): Promise<{
  success: boolean;
  session?: string;
  share?: PublicShareInfo;
  message?: string;
  needShareCode?: boolean;
}> {
  const res = await fetch(
    `${API_BASE}/api/public/shares/${encodeURIComponent(id)}/unlock`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareCode: shareCode || "" }),
    },
  );
  return res.json();
}

/** 预览 URL：媒体标签 src 使用（带 session / code query） */
export function buildShareRawUrl(options: {
  id: string;
  session?: string | null;
  shareCode?: string | null;
}): string {
  const params = new URLSearchParams();
  if (options.session) params.set("session", options.session);
  if (options.shareCode) params.set("code", options.shareCode);
  const qs = params.toString();
  return `${API_BASE}/api/public/shares/${encodeURIComponent(options.id)}/raw${qs ? `?${qs}` : ""}`;
}

/** 前端 Blob 下载：拉 base64 → Blob → a[download]，不暴露磁盘路径 */
export async function downloadShareAsBlob(options: {
  id: string;
  session?: string | null;
  shareCode?: string | null;
  signal?: AbortSignal;
}): Promise<{ fileName: string; mimeType: string; size: number }> {
  const params = new URLSearchParams();
  if (options.session) params.set("session", options.session);
  if (options.shareCode) params.set("code", options.shareCode);
  const qs = params.toString();
  const res = await fetch(
    `${API_BASE}/api/public/shares/${encodeURIComponent(options.id)}/download${qs ? `?${qs}` : ""}`,
    { signal: options.signal },
  );
  const data = (await res.json()) as {
    success?: boolean;
    data?: string;
    mimeType?: string;
    fileName?: string;
    size?: number;
    message?: string;
  };
  if (!data.success || !data.data) {
    throw new Error(data.message || "下载失败");
  }

  const binary = atob(data.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const mimeType = data.mimeType || "application/octet-stream";
  const fileName = data.fileName || "download";
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }

  return {
    fileName,
    mimeType,
    size: data.size ?? bytes.length,
  };
}

export function formatShareBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}

export function formatShareTime(ts: number | null | undefined): string {
  if (ts == null) return "永久有效";
  return new Date(ts).toLocaleString("zh-CN");
}