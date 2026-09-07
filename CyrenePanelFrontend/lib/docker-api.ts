"use client";

import { API_BASE } from "@/lib/api-base";

/**
 * Docker 管理相关的共享类型与请求封装。
 *
 * 所有请求都带一个 prefix：主节点是 "/api/docker"，
 * 远程节点是 "/api/nodes/{id}/docker"（由主节点透传）。
 * 各管理组件只接收 prefix，不关心节点选择逻辑。
 */

export const MAIN_NODE = "__main__";

export function dockerPrefix(nodeId: string): string {
  return nodeId === MAIN_NODE ? "/api/docker" : `/api/nodes/${nodeId}/docker`;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function dockerGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return res.json();
}

export async function dockerPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

export async function dockerDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

/** 后端统一的响应形状 */
export interface ApiResult {
  success: boolean;
  message?: string;
}

// ── 镜像 ─────────────────────────────────────────────────────────────

export interface DockerImageItem {
  id: string;
  repository: string;
  tag: string;
  reference: string;
  size: number;
  sizeText: string;
  created: string;
  dangling: boolean;
  usedBy: number;
}

export interface DockerImageDetail {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  created: string;
  size: number;
  architecture: string;
  os: string;
  author: string;
  dockerVersion: string;
  env: string[];
  cmd: string[];
  entrypoint: string[];
  workingDir: string;
  exposedPorts: string[];
  volumes: string[];
  labels: Record<string, string>;
  layers: string[];
}

// ── 网络 ─────────────────────────────────────────────────────────────

export interface DockerNetworkItem {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
  ipv6: boolean;
  created: string;
  subnets: { subnet: string; gateway: string }[];
  containerCount: number;
  builtin: boolean;
}

export interface DockerNetworkDetail extends Omit<DockerNetworkItem, "subnets" | "containerCount" | "builtin"> {
  ipam: { Driver?: string; Config?: { Subnet?: string; Gateway?: string }[] };
  options: Record<string, string>;
  labels: Record<string, string>;
  containers: { id: string; name: string; ipv4: string; ipv6: string; mac: string }[];
}

// ── 存储卷 ───────────────────────────────────────────────────────────

export interface DockerVolumeItem {
  name: string;
  driver: string;
  mountpoint: string;
  created: string;
  scope: string;
  usedBy: string[];
  labels: Record<string, string>;
}

// ── 系统 ─────────────────────────────────────────────────────────────

export interface DockerVersionInfo {
  clientVersion: string;
  clientApiVersion: string;
  clientGoVersion: string;
  clientPlatform: string;
  serverVersion: string;
  serverApiVersion: string;
  serverMinApiVersion: string;
  serverGoVersion: string;
  serverOs: string;
  serverArch: string;
  serverKernel: string;
  buildTime: string;
  composeVersion: string;
  components: { name: string; version: string }[];
}

export interface DockerDiskItem {
  type: string;
  totalCount: number;
  active: number;
  size: number;
  sizeText: string;
  reclaimableText: string;
  reclaimable: number;
}

export interface DockerDaemonStatus {
  active: boolean;
  activeState: string;
  enabled: boolean;
  enabledState: string;
  since: string;
}

export interface DockerContainerStat {
  id: string;
  name: string;
  cpuPercent: number;
  memPercent: number;
  memUsage: string;
  memLimit: string;
  netInput: string;
  netOutput: string;
  blockRead: string;
  blockWrite: string;
  pids: number;
}

// ── 展示辅助 ─────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** docker 返回的时间形如 "2026-09-06 14:52:15 +0000 UTC"，Date 解析不了，这里做兼容 */
export function formatDockerTime(value: string): string {
  if (!value) return "-";
  const normalized = value.replace(/\s*[A-Z]{2,4}$/, "").trim();
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** 相对时间，如「3 天前」 */
export function formatRelative(value: string): string {
  if (!value) return "-";
  const normalized = value.replace(/\s*[A-Z]{2,4}$/, "").trim();
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatDockerTime(value);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}
