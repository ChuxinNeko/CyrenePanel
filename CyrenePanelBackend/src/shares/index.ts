import { Elysia, t } from "elysia";
import { createHash, randomBytes } from "crypto";
import { basename } from "path";
import { existsSync, readFileSync, statSync } from "fs";
import { lookup } from "mime-types";
import { hashSync, compareSync } from "bcryptjs";
import {
  dbDeleteFileShare,
  dbGetFileShare,
  dbGetNode,
  dbIncFileShareDownload,
  dbInsertFileShare,
  dbListFileShares,
  type FileShareRow,
} from "../db";
import { logger } from "../logger/index";
import { auditLog, getRequestIp } from "../audit/index";
import { fetchNode } from "../nodes/index";
import { resolveRequestProfile } from "../node-auth/request-profile";
import {
  contentDispositionAttachment,
  contentDispositionInline,
  MAX_DOWNLOAD_BYTES,
  MAX_RAW_FULL_BYTES,
  MAX_RAW_RANGE_BYTES,
  parseByteRange,
  resolveAccessiblePath,
} from "../files/index";

// ── 类型与常量 ───────────────────────────────────────────────────────

type ShareAccess =
  | { ok: true; share: FileShareRow }
  | { ok: false; status: number; message: string; needShareCode?: boolean };

const EXPIRE_PRESETS_MS: Record<string, number | null> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  never: null,
};

// ── 纯函数：访问校验 / 序列化 ────────────────────────────────────────

function hashShareCode(code: string): string {
  return hashSync(code, 10);
}

function verifyShareCode(code: string, hash: string | null): boolean {
  if (!hash) return false;
  try {
    return compareSync(code, hash);
  } catch {
    return false;
  }
}

function isExpired(share: FileShareRow): boolean {
  return share.expiresAt != null && share.expiresAt <= Date.now();
}

function fixedShareSession(share: FileShareRow): string {
  return createHash("sha256")
    .update(`${share.id}\0${share.shareCodeHash || ""}`)
    .digest("hex");
}

function publicShareView(share: FileShareRow) {
  return {
    id: share.id,
    fileName: share.fileName,
    fileSize: share.fileSize,
    mimeType: share.mimeType,
    hasShareCode: share.hasShareCode === 1,
    allowDirectLink: share.allowDirectLink === 1,
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
    downloadCount: share.downloadCount,
    expired: isExpired(share),
  };
}

function manageShareView(share: FileShareRow) {
  return {
    ...publicShareView(share),
    filePath: share.filePath,
    nodeId: share.nodeId,
    createdBy: share.createdBy,
  };
}

function resolveExpireAt(input: {
  expirePreset?: string;
  expiresAt?: number | null;
}): number | null | { error: string } {
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now()) {
      return { error: "过期时间必须晚于当前时间" };
    }
    return input.expiresAt;
  }
  const preset = input.expirePreset || "7d";
  if (!(preset in EXPIRE_PRESETS_MS)) {
    return { error: "无效的过期预设" };
  }
  const delta = EXPIRE_PRESETS_MS[preset];
  return delta == null ? null : Date.now() + delta;
}

function extractShareCode(request: Request, bodyCode?: string): string | null {
  if (bodyCode?.trim()) return bodyCode.trim();
  const header = request.headers.get("x-share-code");
  if (header?.trim()) return header.trim();
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("code");
    if (q?.trim()) return q.trim();
  } catch {
    // ignore
  }
  return null;
}

function extractShareSession(request: Request): string | null {
  try {
    return new URL(request.url).searchParams.get("session");
  } catch {
    return null;
  }
}

function resolveShareAccess(
  shareId: string,
  request: Request,
  bodyCode?: string,
): ShareAccess {
  const share = dbGetFileShare(shareId);
  if (!share) return { ok: false, status: 404, message: "分享不存在" };
  if (isExpired(share)) return { ok: false, status: 410, message: "分享已过期" };

  if (share.hasShareCode === 1) {
    const code = extractShareCode(request, bodyCode);
    if (code && share.shareCodeHash && verifyShareCode(code, share.shareCodeHash)) {
      return { ok: true, share };
    }

    // unlock 后下发的固定 session = sha256(shareId + shareCodeHash)
    const session = extractShareSession(request);
    const expectedSession = fixedShareSession(share);
    if (session && session === expectedSession) {
      return { ok: true, share };
    }

    return {
      ok: false,
      status: 403,
      message: code ? "分享码错误" : "需要分享码",
      needShareCode: true,
    };
  }

  return { ok: true, share };
}

function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: false, message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ── 读取分享文件（本机 / 子节点） ────────────────────────────────────

async function readShareFileLocal(share: FileShareRow): Promise<
  | { ok: true; realPath: string; size: number; mimeType: string; fileName: string }
  | { ok: false; status: number; message: string }
> {
  const realPath = resolveAccessiblePath(share.filePath);
  if (!realPath) return { ok: false, status: 403, message: "路径不允许" };
  if (!existsSync(realPath)) return { ok: false, status: 404, message: "源文件已不存在" };
  try {
    const stats = statSync(realPath);
    if (stats.isDirectory()) return { ok: false, status: 400, message: "不支持分享目录" };
    return {
      ok: true,
      realPath,
      size: stats.size,
      mimeType: String(lookup(realPath) || share.mimeType || "application/octet-stream"),
      fileName: share.fileName || basename(realPath),
    };
  } catch (e: any) {
    return { ok: false, status: 500, message: e?.message || "读取失败" };
  }
}

async function downloadShareAsBase64(share: FileShareRow): Promise<
  | { ok: true; data: string; mimeType: string; fileName: string; size: number }
  | { ok: false; status: number; message: string }
> {
  if (share.nodeId) {
    const node = dbGetNode(share.nodeId);
    if (!node) return { ok: false, status: 404, message: "节点不存在" };
    try {
      const res = await fetchNode(
        node,
        `/api/files/download?path=${encodeURIComponent(share.filePath)}`,
        {},
        60_000,
      );
      const data = (await res.json()) as any;
      if (!data?.success || !data.data) {
        return {
          ok: false,
          status: res.status >= 400 ? res.status : 502,
          message: data?.message || "子节点下载失败",
        };
      }
      return {
        ok: true,
        data: data.data,
        mimeType: data.mimeType || share.mimeType || "application/octet-stream",
        fileName: data.fileName || share.fileName,
        size: data.size ?? share.fileSize,
      };
    } catch (e: any) {
      return { ok: false, status: 502, message: e?.message || "子节点请求失败" };
    }
  }

  const local = await readShareFileLocal(share);
  if (!local.ok) return local;
  if (local.size > MAX_DOWNLOAD_BYTES) {
    return { ok: false, status: 413, message: "文件过大，暂不支持下载超过 100 MB 的文件" };
  }
  try {
    const buffer = readFileSync(local.realPath);
    return {
      ok: true,
      data: buffer.toString("base64"),
      mimeType: local.mimeType,
      fileName: local.fileName,
      size: local.size,
    };
  } catch (e: any) {
    return { ok: false, status: 500, message: e?.message || "读取失败" };
  }
}

async function streamShareRaw(
  share: FileShareRow,
  request: Request,
  options?: { asAttachment?: boolean },
): Promise<Response> {
  const asAttachment = !!options?.asAttachment;

  if (share.nodeId) {
    const node = dbGetNode(share.nodeId);
    if (!node) return jsonError(404, "节点不存在");
    const headers: Record<string, string> = {};
    const range = request.headers.get("range");
    // 直链下载不转发 Range，避免部分下载被记为完整下载
    if (range && !asAttachment) headers.Range = range;

    try {
      const res = await fetchNode(
        node,
        `/api/files/raw?path=${encodeURIComponent(share.filePath)}`,
        { headers },
        5 * 60 * 1000,
      );
      const passHeaders = new Headers();
      for (const key of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
        "x-content-type-options",
      ]) {
        const value = res.headers.get(key);
        if (value) passHeaders.set(key, value);
      }
      passHeaders.set(
        "Content-Disposition",
        asAttachment
          ? contentDispositionAttachment(share.fileName)
          : contentDispositionInline(share.fileName),
      );
      return new Response(res.body, { status: res.status, headers: passHeaders });
    } catch (e: any) {
      logger.err(`分享文件子节点 raw 失败: ${e.message}`);
      return jsonError(502, e?.message || "子节点请求失败");
    }
  }

  const local = await readShareFileLocal(share);
  if (!local.ok) return jsonError(local.status, local.message);

  const { realPath, size, mimeType, fileName } = local;
  const range = asAttachment
    ? null
    : parseByteRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  if (!asAttachment) {
    if (!range && size > MAX_RAW_FULL_BYTES) {
      return jsonError(
        413,
        `文件过大（${(size / 1024 / 1024).toFixed(1)} MB），预览请使用 Range 或下载`,
      );
    }
    if (size > MAX_RAW_RANGE_BYTES) {
      return jsonError(413, "文件超过 2 GB，暂不支持在线预览");
    }
  }

  const commonHeaders: Record<string, string> = {
    "Content-Type": mimeType,
    "Accept-Ranges": asAttachment ? "none" : "bytes",
    "Cache-Control": "private, max-age=60",
    "Content-Disposition": asAttachment
      ? contentDispositionAttachment(fileName)
      : contentDispositionInline(fileName),
    "X-Content-Type-Options": "nosniff",
  };

  if (range) {
    const { start, end } = range;
    const length = end - start + 1;
    const file = Bun.file(realPath);
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Length": String(length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    });
  }

  return new Response(Bun.file(realPath), {
    status: 200,
    headers: {
      ...commonHeaders,
      "Content-Length": String(size),
    },
  });
}

async function resolveCreateMeta(options: {
  path: string;
  nodeId?: string | null;
}): Promise<
  | { ok: true; fileName: string; fileSize: number; mimeType: string }
  | { ok: false; message: string }
> {
  const { path: filePath, nodeId } = options;

  if (nodeId) {
    const node = dbGetNode(nodeId);
    if (!node) return { ok: false, message: "节点不存在" };
    try {
      const res = await fetchNode(
        node,
        `/api/files/raw?path=${encodeURIComponent(filePath)}`,
        { headers: { Range: "bytes=0-0" } },
        15_000,
      );
      if (!(res.ok || res.status === 206)) {
        const text = await res.text().catch(() => "");
        let message = "无法读取子节点文件";
        try {
          const j = JSON.parse(text);
          if (j?.message) message = j.message;
        } catch {
          // ignore
        }
        return { ok: false, message };
      }
      await res.arrayBuffer().catch(() => undefined);
      let fileSize = 0;
      const contentRange = res.headers.get("content-range");
      if (contentRange) {
        const total = contentRange.split("/")[1];
        if (total && total !== "*") fileSize = Number(total) || 0;
      }
      const mimeType =
        res.headers.get("content-type") ||
        String(lookup(filePath) || "application/octet-stream");
      return {
        ok: true,
        fileName: basename(filePath),
        fileSize,
        mimeType,
      };
    } catch (e: any) {
      return { ok: false, message: e?.message || "子节点请求失败" };
    }
  }

  const realPath = resolveAccessiblePath(filePath);
  if (!realPath) return { ok: false, message: "路径不允许" };
  if (!existsSync(realPath)) return { ok: false, message: "文件不存在" };
  try {
    const stats = statSync(realPath);
    if (stats.isDirectory()) return { ok: false, message: "不支持分享目录" };
    return {
      ok: true,
      fileName: basename(realPath),
      fileSize: stats.size,
      mimeType: String(lookup(realPath) || "application/octet-stream"),
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || "读取失败" };
  }
}

// ── 路由 ─────────────────────────────────────────────────────────────

export const shareRoutes = new Elysia()
  .resolve(async ({ jwt, request }: any) => ({ profile: await resolveRequestProfile(jwt, request) }))

  // 创建分享（需登录）
  .post(
    "/api/files/shares",
    async ({ body, profile, request, server }: any) => {
      if (!profile) return { success: false, message: "未授权" };

      const filePath = String(body?.path || "").trim();
      if (!filePath) return { success: false, message: "缺少 path" };

      const nodeId = body?.nodeId ? String(body.nodeId) : null;
      if (nodeId && !dbGetNode(nodeId)) {
        return { success: false, message: "节点不存在" };
      }

      const expireResolved = resolveExpireAt({
        expirePreset: body?.expirePreset,
        expiresAt: body?.expiresAt ?? undefined,
      });
      if (expireResolved && typeof expireResolved === "object" && "error" in expireResolved) {
        return { success: false, message: expireResolved.error };
      }

      const shareCode =
        typeof body?.shareCode === "string" && body.shareCode.trim()
          ? body.shareCode.trim()
          : "";
      if (shareCode && (shareCode.length < 4 || shareCode.length > 64)) {
        return { success: false, message: "分享码长度应为 4–64 位" };
      }

      // 勾选直链时不允许再设分享码（直链靠 URL 秘密性；分享码走页面解锁）
      const allowDirectLink = !!body?.allowDirectLink;
      if (allowDirectLink && shareCode) {
        return { success: false, message: "直链模式不支持分享码，请取消勾选其一" };
      }

      const meta = await resolveCreateMeta({ path: filePath, nodeId });
      if (!meta.ok) return { success: false, message: meta.message };

      const id = randomBytes(12).toString("hex");
      const createdAt = Date.now();
      const hasShareCode = !!shareCode;
      const shareCodeHash = hasShareCode ? hashShareCode(shareCode) : null;

      dbInsertFileShare({
        id,
        filePath,
        fileName: meta.fileName,
        nodeId,
        fileSize: meta.fileSize,
        mimeType: meta.mimeType,
        shareCodeHash,
        hasShareCode,
        allowDirectLink,
        expiresAt: expireResolved as number | null,
        createdBy: profile.username,
        createdAt,
      });

      auditLog({
        username: profile.username,
        category: "file",
        action: "创建文件分享",
        target: filePath,
        detail: `id=${id}${hasShareCode ? " code" : ""}${allowDirectLink ? " direct" : ""}${nodeId ? ` node=${nodeId}` : ""}`,
        ip: getRequestIp(request, server),
      });

      const share = dbGetFileShare(id)!;
      // pagePath：分享页；directPath：仅勾选直链时返回（相对路径，前端拼 origin）
      return {
        success: true,
        share: manageShareView(share),
        pagePath: `/share/${id}`,
        directPath: allowDirectLink ? `/api/public/shares/${id}/direct` : null,
      };
    },
    {
      body: t.Object({
        path: t.String(),
        nodeId: t.Optional(t.Nullable(t.String())),
        shareCode: t.Optional(t.String()),
        expirePreset: t.Optional(t.String()),
        expiresAt: t.Optional(t.Nullable(t.Number())),
        allowDirectLink: t.Optional(t.Boolean()),
      }),
    },
  )

  // 我的分享列表
  .get("/api/files/shares", ({ profile, query }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const limit = query?.limit ? Number(query.limit) : 100;
    // admin 可看全部，普通用户只看自己的
    const createdBy = profile.role === "admin" && query?.all === "1"
      ? null
      : profile.username;
    const rows = dbListFileShares(createdBy, limit);
    return {
      success: true,
      shares: rows.map(manageShareView),
    };
  })

  // 撤销分享
  .delete("/api/files/shares/:id", ({ params, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const share = dbGetFileShare(params.id);
    if (!share) return { success: false, message: "分享不存在" };
    if (profile.role !== "admin" && share.createdBy !== profile.username) {
      return { success: false, message: "无权限" };
    }
    dbDeleteFileShare(params.id);
    auditLog({
      username: profile.username,
      category: "file",
      action: "撤销文件分享",
      target: share.filePath,
      detail: `id=${share.id}`,
      ip: getRequestIp(request, server),
    });
    return { success: true, message: "已撤销" };
  })

  // ── 公开：元信息 ──────────────────────────────────────────────────
  .get("/api/public/shares/:id", ({ params }: any) => {
    const share = dbGetFileShare(params.id);
    if (!share) return { success: false, message: "分享不存在" };
    return {
      success: true,
      share: publicShareView(share),
    };
  })

  // 公开：校验分享码，返回 session（用于后续 raw/download）
  .post(
    "/api/public/shares/:id/unlock",
    ({ params, body }: any) => {
      const share = dbGetFileShare(params.id);
      if (!share) return { success: false, message: "分享不存在" };
      if (isExpired(share)) return { success: false, message: "分享已过期" };
      if (share.hasShareCode !== 1) {
        return {
          success: true,
          session: fixedShareSession(share),
          share: publicShareView(share),
        };
      }
      const code = typeof body?.shareCode === "string" ? body.shareCode.trim() : "";
      if (!code || !verifyShareCode(code, share.shareCodeHash)) {
        return { success: false, message: "分享码错误", needShareCode: true };
      }
      return {
        success: true,
        session: fixedShareSession(share),
        share: publicShareView(share),
      };
    },
    {
      body: t.Object({
        shareCode: t.Optional(t.String()),
      }),
    },
  )

  // 公开：下载（JSON base64 → 前端 blob，不暴露后端磁盘路径）
  .get("/api/public/shares/:id/download", async ({ params, request, server }: any) => {
    const access = resolveShareAccess(params.id, request);
    if (!access.ok) {
      return {
        success: false,
        message: access.message,
        needShareCode: access.needShareCode,
      };
    }

    const result = await downloadShareAsBase64(access.share);
    if (!result.ok) {
      return { success: false, message: result.message };
    }

    dbIncFileShareDownload(access.share.id);
    auditLog({
      username: `share:${access.share.id}`,
      category: "file",
      action: "分享下载",
      target: access.share.filePath,
      detail: `${(result.size / 1024).toFixed(1)} KB`,
      ip: getRequestIp(request, server),
    });

    return {
      success: true,
      data: result.data,
      mimeType: result.mimeType,
      fileName: result.fileName,
      size: result.size,
    };
  })

  // 公开：预览流（支持 Range；需 session 或 code）
  .get("/api/public/shares/:id/raw", async ({ params, request }: any) => {
    const access = resolveShareAccess(params.id, request);
    if (!access.ok) {
      return jsonError(access.status, access.message, {
        needShareCode: access.needShareCode,
      });
    }
    return streamShareRaw(access.share, request);
  })

  // 公开：直链下载（attachment 流；仅 allowDirectLink=1 且无分享码）
  .get("/api/public/shares/:id/direct", async ({ params, request, server }: any) => {
    const share = dbGetFileShare(params.id);
    if (!share) return jsonError(404, "分享不存在");
    if (isExpired(share)) return jsonError(410, "分享已过期");
    if (share.allowDirectLink !== 1) {
      return jsonError(403, "该分享未开启直链");
    }
    if (share.hasShareCode === 1) {
      return jsonError(403, "带分享码的链接不支持直链下载");
    }

    const response = await streamShareRaw(share, request, { asAttachment: true });
    if (response.ok || response.status === 206) {
      dbIncFileShareDownload(share.id);
      auditLog({
        username: `share:${share.id}`,
        category: "file",
        action: "分享直链下载",
        target: share.filePath,
        detail: `${(share.fileSize / 1024).toFixed(1)} KB`,
        ip: getRequestIp(request, server),
      });
    }
    return response;
  });