"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Download,
  Eye,
  File,
  FileImage,
  Film,
  Lock,
  Music,
  RefreshCw,
  Share2,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  canPreviewFile,
  checkPreviewSize,
  resolveFileKind,
  type FileKind,
} from "@/lib/file-kind";
import {
  buildShareRawUrl,
  downloadShareAsBlob,
  fetchPublicShare,
  formatShareBytes,
  formatShareTime,
  unlockPublicShare,
  type PublicShareInfo,
} from "@/lib/file-share";

type PageState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "need_code"; share: PublicShareInfo }
  | { phase: "ready"; share: PublicShareInfo; session: string | null };

const SESSION_KEY = (id: string) => `share_session_${id}`;

/** 列表行模型：当前单文件分享映射为 1 行，后续多文件可直接扩展 */
interface ShareListItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

function toListItems(share: PublicShareInfo): ShareListItem[] {
  return [
    {
      id: share.id,
      fileName: share.fileName,
      fileSize: share.fileSize,
      mimeType: share.mimeType,
    },
  ];
}

function KindIcon({ kind, className = "h-4 w-4" }: { kind: FileKind; className?: string }) {
  if (kind === "video") return <Film className={`${className} shrink-0 text-pink-500`} />;
  if (kind === "audio") return <Music className={`${className} shrink-0 text-cyan-500`} />;
  if (kind === "image") return <FileImage className={`${className} shrink-0 text-purple-500`} />;
  return <File className={`${className} shrink-0 text-muted-foreground`} />;
}

function kindLabel(kind: FileKind): string {
  if (kind === "image") return "图片";
  if (kind === "video") return "视频";
  if (kind === "audio") return "音频";
  if (kind === "text") return "文本";
  return "文件";
}

function SharePreviewBody({
  item,
  session,
  shareCode,
}: {
  item: ShareListItem;
  session: string | null;
  shareCode: string | null;
}) {
  const kind = resolveFileKind({
    name: item.fileName,
    mimeType: item.mimeType,
    size: item.fileSize,
  });
  const previewable = canPreviewFile({
    name: item.fileName,
    mimeType: item.mimeType,
    size: item.fileSize,
  });
  const sizeError =
    previewable && (kind === "image" || kind === "video" || kind === "audio")
      ? checkPreviewSize(kind, item.fileSize)
      : previewable
        ? null
        : "该类型不支持在线预览";

  const rawUrl = useMemo(
    () =>
      buildShareRawUrl({
        id: item.id,
        session,
        shareCode: session ? null : shareCode,
      }),
    [item.id, session, shareCode],
  );

  if (!previewable || sizeError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-16 text-center">
        <KindIcon kind={kind} className="h-8 w-8" />
        <p className="text-sm text-muted-foreground">
          {sizeError || "请下载后查看"}
        </p>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border bg-black/5 p-3 dark:bg-black/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={rawUrl}
          alt={item.fileName}
          className="max-h-[min(70vh,720px)] max-w-full object-contain"
        />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="overflow-hidden rounded-lg border bg-black">
        <video
          src={rawUrl}
          controls
          className="max-h-[min(70vh,720px)] w-full"
          preload="metadata"
        />
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="rounded-lg border bg-muted/20 px-4 py-10">
        <audio src={rawUrl} controls className="w-full" preload="metadata" />
      </div>
    );
  }

  return null;
}

export default function PublicSharePage() {
  const params = useParams();
  const shareId = String(params?.id || "");

  const [state, setState] = useState<PageState>({ phase: "loading" });
  const [codeInput, setCodeInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  /** 对话框预览目标 */
  const [previewItem, setPreviewItem] = useState<ShareListItem | null>(null);

  const bootstrap = useCallback(async () => {
    if (!shareId) {
      setState({ phase: "error", message: "无效的分享链接" });
      return;
    }
    setState({ phase: "loading" });
    setUnlockError(null);
    setDownloadError(null);
    setPreviewItem(null);

    try {
      const meta = await fetchPublicShare(shareId);
      if (!meta.success || !meta.share) {
        setState({ phase: "error", message: meta.message || "分享不存在" });
        return;
      }
      if (meta.share.expired) {
        setState({ phase: "error", message: "分享已过期" });
        return;
      }

      const cached =
        typeof window !== "undefined"
          ? sessionStorage.getItem(SESSION_KEY(shareId))
          : null;

      if (meta.share.hasShareCode) {
        if (cached) {
          setState({ phase: "ready", share: meta.share, session: cached });
          setActiveCode(null);
          return;
        }
        setState({ phase: "need_code", share: meta.share });
        return;
      }

      const unlocked = await unlockPublicShare(shareId);
      if (unlocked.success) {
        if (unlocked.session && typeof window !== "undefined") {
          sessionStorage.setItem(SESSION_KEY(shareId), unlocked.session);
        }
        setState({
          phase: "ready",
          share: unlocked.share || meta.share,
          session: unlocked.session || null,
        });
        setActiveCode(null);
        return;
      }

      setState({ phase: "ready", share: meta.share, session: null });
    } catch (e: any) {
      setState({ phase: "error", message: e?.message || "加载失败" });
    }
  }, [shareId]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const handleUnlock = async () => {
    if (!shareId || !codeInput.trim()) {
      setUnlockError("请输入分享码");
      return;
    }
    setUnlocking(true);
    setUnlockError(null);
    try {
      const data = await unlockPublicShare(shareId, codeInput.trim());
      if (!data.success || !data.share) {
        setUnlockError(data.message || "分享码错误");
        return;
      }
      if (data.session && typeof window !== "undefined") {
        sessionStorage.setItem(SESSION_KEY(shareId), data.session);
      }
      setActiveCode(codeInput.trim());
      setState({
        phase: "ready",
        share: data.share,
        session: data.session || null,
      });
    } catch (e: any) {
      setUnlockError(e?.message || "校验失败");
    } finally {
      setUnlocking(false);
    }
  };

  const openPreview = (item: ShareListItem) => {
    const canPreview = canPreviewFile({
      name: item.fileName,
      mimeType: item.mimeType,
      size: item.fileSize,
    });
    if (!canPreview) return;
    setPreviewItem(item);
  };

  const handleDownload = async (item: ShareListItem) => {
    if (state.phase !== "ready") return;
    setDownloadingId(item.id);
    setDownloadError(null);
    try {
      await downloadShareAsBlob({
        id: item.id,
        session: state.session,
        shareCode: state.session ? null : activeCode,
      });
    } catch (e: any) {
      setDownloadError(e?.message || "下载失败");
    } finally {
      setDownloadingId(null);
    }
  };

  const share =
    state.phase === "ready" || state.phase === "need_code"
      ? state.share
      : null;

  const listItems = share ? toListItems(share) : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Share2 className="h-4 w-4 text-primary" />
          文件分享
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 py-8">
        {state.phase === "loading" && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              加载分享信息…
            </CardContent>
          </Card>
        )}

        {state.phase === "error" && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={bootstrap}>
                重试
              </Button>
            </CardContent>
          </Card>
        )}

        {state.phase === "need_code" && share && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4" />
                需要分享码
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <div className="text-xs text-muted-foreground">分享内容</div>
                <div className="mt-1 truncate font-medium">{share.fileName}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  共 {listItems.length} 个文件 · {formatShareBytes(share.fileSize)}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="public-share-code">分享码</Label>
                <Input
                  id="public-share-code"
                  type="password"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUnlock();
                  }}
                  placeholder="请输入分享码"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              {unlockError && (
                <p className="text-sm text-destructive">{unlockError}</p>
              )}
              <Button
                className="w-full"
                onClick={handleUnlock}
                disabled={unlocking || !codeInput.trim()}
              >
                {unlocking ? "验证中…" : "继续"}
              </Button>
            </CardContent>
          </Card>
        )}

        {state.phase === "ready" && share && (
          <Card className="overflow-hidden p-0 gap-0">
            <div className="border-b bg-muted/10 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h1 className="text-base font-semibold">分享文件</h1>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    共 {listItems.length} 个文件 · 过期 {formatShareTime(share.expiresAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">
                    创建于 {formatShareTime(share.createdAt)}
                  </Badge>
                  <Badge variant="secondary">下载 {share.downloadCount} 次</Badge>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead className="hidden w-28 sm:table-cell">类型</TableHead>
                    <TableHead className="w-28 text-right">大小</TableHead>
                    <TableHead className="w-36 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listItems.map((item) => {
                    const kind = resolveFileKind({
                      name: item.fileName,
                      mimeType: item.mimeType,
                      size: item.fileSize,
                    });
                    const canPreview = canPreviewFile({
                      name: item.fileName,
                      mimeType: item.mimeType,
                      size: item.fileSize,
                    });
                    const isDownloading = downloadingId === item.id;

                    return (
                      <TableRow key={item.id} className="group">
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2">
                            <KindIcon kind={kind} />
                            {canPreview ? (
                              <button
                                type="button"
                                className="truncate text-left font-medium text-primary hover:underline"
                                title="预览"
                                onClick={() => openPreview(item)}
                              >
                                {item.fileName}
                              </button>
                            ) : (
                              <span className="truncate font-medium">{item.fileName}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {kindLabel(kind)}
                          {item.mimeType ? (
                            <span className="mt-0.5 block truncate font-mono text-[11px] opacity-70">
                              {item.mimeType}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatShareBytes(item.fileSize)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="预览"
                              disabled={!canPreview}
                              onClick={() => openPreview(item)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="下载"
                              disabled={isDownloading}
                              onClick={() => handleDownload(item)}
                            >
                              {isDownloading ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {downloadError && (
              <div className="border-t px-4 py-2 text-sm text-destructive">
                {downloadError}
              </div>
            )}
          </Card>
        )}
      </main>

      <Dialog
        open={!!previewItem && state.phase === "ready"}
        onOpenChange={(open) => {
          if (!open) setPreviewItem(null);
        }}
      >
        <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col gap-3 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
              <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{previewItem?.fileName || "预览"}</span>
            </DialogTitle>
          </DialogHeader>
          {previewItem && state.phase === "ready" && (
            <div className="min-h-0 flex-1 overflow-auto">
              <SharePreviewBody
                item={previewItem}
                session={state.session}
                shareCode={activeCode}
              />
            </div>
          )}
          {previewItem && (
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreviewItem(null)}
              >
                关闭
              </Button>
              <Button
                type="button"
                className="gap-1.5"
                disabled={downloadingId === previewItem.id}
                onClick={() => handleDownload(previewItem)}
              >
                {downloadingId === previewItem.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                下载
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}