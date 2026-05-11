"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Power, RotateCw, Server, AppWindow, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "@/lib/api-base";

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

type RestartTarget = "panel" | "server";

export function RestartButton() {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [target, setTarget] = useState<RestartTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSelect = (t: RestartTarget) => {
    setTarget(t);
    setOpen(false);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/system/restart/${target}`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` }));
      if (data?.success) {
        toast.success(data.message || (target === "panel" ? "面板重启中..." : "服务器重启中..."), {
          duration: 8000,
        });
        setConfirmOpen(false);
        setTarget(null);
      } else {
        toast.error(data?.message || "请求失败");
      }
    } catch (e: any) {
      // 重启面板/服务器可能直接断开连接，这是预期行为
      toast.success(
        target === "panel"
          ? "面板正在重启，请稍后刷新页面"
          : "服务器正在重启，请等待恢复后重新连接",
        { duration: 10000 },
      );
      setConfirmOpen(false);
      setTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen(true)}
        title="重启"
      >
        <RotateCw className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-md"
          style={{ maxWidth: "min(calc(100% - 2rem), 28rem)" }}
        >
          <DialogHeader>
            <DialogTitle>重启</DialogTitle>
            <DialogDescription>
              请选择重启对象。该操作仅作用于当前主节点。
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => handleSelect("panel")}
              className="flex flex-col items-start gap-2 rounded-md border bg-background p-4 text-left transition hover:bg-accent hover:border-primary/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <AppWindow className="h-5 w-5" />
              </div>
              <div className="font-medium">重启面板</div>
              <p className="text-xs text-muted-foreground">
                仅重启 CyrenePanel 的前后端服务，约 5 秒恢复。
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleSelect("server")}
              className="flex flex-col items-start gap-2 rounded-md border bg-background p-4 text-left transition hover:bg-accent hover:border-destructive/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <Server className="h-5 w-5" />
              </div>
              <div className="font-medium">重启服务器</div>
              <p className="text-xs text-muted-foreground">
                重启整台主机操作系统，期间所有服务都会中断。
              </p>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <DialogContent
          className="sm:max-w-md"
          style={{ maxWidth: "min(calc(100% - 2rem), 28rem)" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Power className="h-5 w-5 text-destructive" />
              {target === "panel" ? "确认重启面板" : "确认重启服务器"}
            </DialogTitle>
            <DialogDescription>
              {target === "panel"
                ? "面板前后端将立即重启，期间页面会短暂无法访问。"
                : "服务器将整机重启，所有运行中的实例、Docker 容器、Web 服务都会中断，恢复需要 1-3 分钟。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button
              variant={target === "server" ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4 mr-1.5" />
              )}
              确认重启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
