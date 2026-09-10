"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronRight, FolderOpen, Home, RefreshCw } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

/** 主节点的哨兵值：Select 不接受空字符串，路由拼接时要区分对待 */
export const MAIN_NODE = "__main__";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
  extension: string;
}

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * 目录选择器。创建实例和编辑实例都用它挑工作目录，
 * 所以按 nodeId 决定去主节点还是某个子节点的文件接口取目录。
 */
export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  nodeId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传 MAIN_NODE 或不传表示主节点 */
  nodeId?: string;
  onSelect: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [root, setRoot] = useState("");
  const [fetching, setFetching] = useState(false);

  const fetchDir = async (next: string) => {
    setFetching(true);
    try {
      const prefix =
        nodeId && nodeId !== MAIN_NODE ? `/api/nodes/${nodeId}` : "/api";
      const res = await fetch(
        `${API_BASE}${prefix}/files?path=${encodeURIComponent(next)}`,
        { headers: authHeaders() }
      );
      const data = (await res.json()) as {
        success?: boolean;
        entries?: FileEntry[];
        root?: string;
      };
      if (data.success && data.entries) {
        setEntries(data.entries);
        if (data.root) setRoot(data.root);
      }
    } catch {
      // 拉取失败保持上一次的列表，不清空
    } finally {
      setFetching(false);
    }
  };

  // 每次打开都从根目录重新开始，避免残留上一次的位置
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setPath("");
      setEntries([]);
      fetchDir("");
    }
    onOpenChange(next);
  };

  const navigate = (next: string) => {
    setPath(next);
    fetchDir(next);
  };

  /** 把浏览器里的相对路径拼回系统绝对路径 */
  const confirm = () => {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const selected = normalizedRoot
      ? path
        ? `${normalizedRoot}/${path}`
        : normalizedRoot
      : path || "/";
    onSelect(selected);
    onOpenChange(false);
  };

  const directories = entries.filter((entry) => entry.isDirectory);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[500px] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>选择工作目录</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {root ? `${root}${path ? `/${path}` : ""}` : path || "根目录"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-md border bg-surface-inset px-2 py-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => navigate("")}
            aria-label="回到根目录"
          >
            <Home className="size-3.5" />
          </Button>
          {path &&
            path.split("/").map((part, i, arr) => {
              const subPath = arr.slice(0, i + 1).join("/");
              const isLast = i === arr.length - 1;
              return (
                <div key={subPath} className="flex shrink-0 items-center gap-0.5">
                  <ChevronRight className="size-3 text-mute" />
                  <Button
                    variant={isLast ? "secondary" : "ghost"}
                    size="xs"
                    className="font-mono"
                    onClick={() => navigate(subPath)}
                  >
                    {part}
                  </Button>
                </div>
              );
            })}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={() => fetchDir(path)}
            disabled={fetching}
            aria-label="刷新目录"
          >
            <RefreshCw className={`size-3.5 ${fetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {fetching ? (
            <div className="flex items-center justify-center py-12 text-sm text-mute">
              <RefreshCw className="mr-2 size-4 animate-spin" />
              加载中…
            </div>
          ) : directories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-mute">
              <FolderOpen className="mb-2 size-7 opacity-40" />
              <p className="text-sm">没有子目录</p>
            </div>
          ) : (
            <div className="divide-y">
              {directories.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                  onClick={() => navigate(entry.path)}
                >
                  <FolderOpen className="size-4 shrink-0 text-mute" />
                  <span className="truncate font-mono text-xs">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={confirm}>选择此目录</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
