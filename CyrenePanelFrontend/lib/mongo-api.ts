"use client";

import { API_BASE } from "@/lib/api-base";

/** MongoDB 管理的共享类型与请求封装 */

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function mongoGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return res.json();
}

export async function mongoPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

export async function mongoPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

export async function mongoDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", headers: authHeaders() });
  return res.json();
}

export interface ApiResult {
  success: boolean;
  message?: string;
}

export interface MongoConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authDb: string;
  hasUri: boolean;
  hasPassword: boolean;
  createdAt: number;
}

export interface MongoDatabase {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
  system: boolean;
}

export interface MongoCollection {
  name: string;
  type: string;
  count: number;
  size: number;
  storageSize: number;
  totalIndexSize: number;
  indexCount: number;
  avgObjSize: number;
}

export interface MongoIndex {
  name: string;
  keys: Record<string, unknown>;
  unique: boolean;
  sparse: boolean;
  background: boolean;
  expireAfterSeconds?: number;
}

export interface MongoStatus {
  version: string;
  host: string;
  process: string;
  uptime: number;
  replicaSet: string;
  isPrimary: boolean;
  connectionsCurrent: number;
  connectionsAvailable: number;
  connectionsTotalCreated: number;
  opInsert: number;
  opQuery: number;
  opUpdate: number;
  opDelete: number;
  opGetmore: number;
  opCommand: number;
  memResident: number;
  memVirtual: number;
  networkBytesIn: number;
  networkBytesOut: number;
  networkRequests: number;
}

export interface MongoOperation {
  opid: string;
  active: boolean;
  op: string;
  ns: string;
  secsRunning: number;
  client: string;
  desc: string;
  command: string;
}

export interface MongoBackup {
  file: string;
  database: string;
  format: string;
  size: number;
  createdAt: string;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  if (!seconds) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

/** 从 EJSON 文档里取出可展示的 _id 字符串 */
export function extractId(doc: unknown): string {
  const id = (doc as { _id?: unknown } | null | undefined)?._id;
  if (id === undefined || id === null) return "";
  // ObjectId 在 EJSON 里序列化为 {"$oid": "..."}
  if (typeof id === "object" && id !== null && "$oid" in id) {
    return String((id as { $oid: unknown }).$oid);
  }
  return String(id);
}
