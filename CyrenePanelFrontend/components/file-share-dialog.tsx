"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createFileShare,
  type ExpirePreset,
  formatShareBytes,
} from "@/lib/file-share";

export interface ShareFileTarget {
  path: string;
  name: string;
  size: number;
  nodeId?: string | null;
}

interface FileShareDialogProps {
  target: ShareFileTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const EXPIRE_OPTIONS: { value: ExpirePreset; label: string }[] = [
  { value: "1h", label: "1 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "never", label: "永久" },
];

export function FileShareDialog({
  target,
  open,
  onOpenChange,
  onCreated,
}: FileShareDialogProps) {
  const [shareCode, setShareCode] = useState("");
  const [expirePreset, setExpirePreset] = useState<ExpirePreset>("7d");
  const [allowDirectLink, setAllowDirectLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultKind, setResultKind] = useState<"page" | "direct">("page");
  const [copied, setCopied] = useState(false);

  // 打开时重置表单
  useEffect(() => {
    if (!open) return;
    setShareCode("");
    setExpirePreset("7d");
    setAllowDirectLink(false);
    setSubmitting(false);
    setError(null);
    setResultUrl(null);
    setResultKind("page");
    setCopied(false);
  }, [open, target?.path]);

  const canSubmit = useMemo(() => {
    if (!target || submitting || resultUrl) return false;
    if (shareCode && (shareCode.length < 4 || shareCode.length > 64)) return false;
    if (allowDirectLink && shareCode.trim()) return false;
    return true;
  }, [target, submitting, resultUrl, shareCode, allowDirectLink]);

  const handleCreate = async () => {
    if (!target || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await createFileShare({
        path: target.path,
        nodeId: target.nodeId ?? null,
        shareCode: shareCode.trim() || undefined,
        expirePreset,
        allowDirectLink,
      });
      if (!data.success) {
        setError(data.message || "创建失败");
        return;
      }
      // 勾选直链 → 返回直链 URL；否则返回分享页
      if (allowDirectLink && data.directUrl) {
        setResultUrl(data.directUrl);
        setResultKind("direct");
      } else {
        setResultUrl(data.pageUrl || data.pagePath || "");
        setResultKind("page");
      }
      onCreated?.();
    } catch (e: any) {
      setError(e?.message || "网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!resultUrl) return;
    try {
      await navigator.clipboard.writeText(resultUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 降级：选中输入框
      const el = document.getElementById("share-result-url") as HTMLInputElement | null;
      el?.select();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            分享文件
          </DialogTitle>
        </DialogHeader>

        {target && (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <div className="truncate font-medium">{target.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {formatShareBytes(target.size)}
              </div>
            </div>

            {resultUrl ? (
              <div className="space-y-3">
                <Label>
                  {resultKind === "direct" ? "文件直链" : "分享页面链接"}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="share-result-url"
                    readOnly
                    value={resultUrl}
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button type="button" variant="outline" size="icon" onClick={handleCopy} title="复制">
                    {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {resultKind === "direct"
                    ? "访问直链将直接下载文件。未勾选直链时，对方会打开分享页预览后再下载。"
                    : "对方打开此页面可查看信息与预览；下载由前端发起，不会暴露后端地址。"}
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="share-code">分享码（可选）</Label>
                  <Input
                    id="share-code"
                    value={shareCode}
                    onChange={(e) => setShareCode(e.target.value)}
                    placeholder="留空则无需分享码"
                    disabled={allowDirectLink}
                    maxLength={64}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    4–64 位；与「生成直链」互斥
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="share-expire">过期时间</Label>
                  <select
                    id="share-expire"
                    value={expirePreset}
                    onChange={(e) => setExpirePreset(e.target.value as ExpirePreset)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  >
                    {EXPIRE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm">
                  <Checkbox
                    checked={allowDirectLink}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setAllowDirectLink(checked);
                      if (checked) setShareCode("");
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Link2 className="h-3.5 w-3.5" />
                      生成文件直链
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      勾选后返回可直接下载的 URL；不勾选则返回分享页面地址
                    </span>
                  </span>
                </label>

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {resultUrl ? (
            <Button onClick={() => onOpenChange(false)}>完成</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={!canSubmit}>
                {submitting ? "创建中…" : "创建分享"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}