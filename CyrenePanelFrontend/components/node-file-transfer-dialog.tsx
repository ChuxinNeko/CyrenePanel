"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowRight, 
  ArrowLeft, 
  RefreshCw, 
  FolderOpen, 
  File, 
  ChevronRight, 
  Home,
  Loader2,
  FileCode,
  FileImage,
  FileArchive,
  Film,
  Music,
  FileText,
  X
} from "lucide-react";

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  isMain: number;
}

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
  extension: string;
}

const ARCHIVE_EXTENSIONS = [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz"];

function getFileIcon(entry: FileEntry) {
  if (entry.isDirectory) return <FolderOpen className="h-4 w-4 text-yellow-500" />;
  const ext = entry.extension.toLowerCase();
  const codeExts = [".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".cs", ".php", ".rb", ".sh", ".vue", ".svelte"];
  const imgExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp"];
  const videoExts = [".mp4", ".webm", ".avi", ".mov", ".mkv"];
  const audioExts = [".mp3", ".wav", ".ogg", ".flac", ".aac"];
  if (codeExts.includes(ext)) return <FileCode className="h-4 w-4 text-green-500" />;
  if (imgExts.includes(ext)) return <FileImage className="h-4 w-4 text-purple-500" />;
  if (ARCHIVE_EXTENSIONS.some((archiveExt) => entry.name.toLowerCase().endsWith(archiveExt))) return <FileArchive className="h-4 w-4 text-orange-500" />;
  if (videoExts.includes(ext)) return <Film className="h-4 w-4 text-pink-500" />;
  if (audioExts.includes(ext)) return <Music className="h-4 w-4 text-cyan-500" />;
  if ([".md", ".txt", ".log", ".csv"].includes(ext)) return <FileText className="h-4 w-4 text-blue-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5676";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function fileFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${url}`, { ...init, headers });
  return res.json();
}

function getNodeApiPrefix(nodeId: string | null): string {
  return nodeId ? `/api/nodes/${nodeId}` : "/api";
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function joinPath(dir: string, name: string): string {
  const cleanDir = dir.replace(/\/+$/, "");
  return cleanDir ? `${cleanDir}/${name}` : name;
}

export function NodeFileTransferDialog({
  open,
  onOpenChange,
  nodes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: NodeInfo[];
}) {
  const allNodes = [{ id: "", name: "主节点", address: "local", isMain: 1 }, ...nodes];

  // Left Browser State
  const [leftNodeId, setLeftNodeId] = useState<string>("");
  const [leftPath, setLeftPath] = useState<string>("");
  const [leftRoot, setLeftRoot] = useState<string>("");
  const [leftEntries, setLeftEntries] = useState<FileEntry[]>([]);
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set());
  const [leftLoading, setLeftLoading] = useState(false);

  // Right Browser State
  const [rightNodeId, setRightNodeId] = useState<string>("");
  const [rightPath, setRightPath] = useState<string>("");
  const [rightRoot, setRightRoot] = useState<string>("");
  const [rightEntries, setRightEntries] = useState<FileEntry[]>([]);
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());
  const [rightLoading, setRightLoading] = useState(false);

  const [transferring, setTransferring] = useState(false);
  const [progressText, setProgressText] = useState("");

  const fetchDir = useCallback(async (nodeId: string, path: string, isLeft: boolean) => {
    const setLoading = isLeft ? setLeftLoading : setRightLoading;
    const setEntries = isLeft ? setLeftEntries : setRightEntries;
    const setRoot = isLeft ? setLeftRoot : setRightRoot;
    const setSelected = isLeft ? setLeftSelected : setRightSelected;
    
    setLoading(true);
    try {
      const data = await fileFetch<{ success: boolean; entries?: FileEntry[]; root?: string }>(
        `${getNodeApiPrefix(nodeId)}/files?path=${encodeURIComponent(path)}`
      );
      if (data.success && data.entries) {
        setEntries(data.entries);
        setRoot(data.root ?? "");
        setSelected(new Set());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchDir(leftNodeId, leftPath, true);
    }
  }, [open, leftNodeId, leftPath, fetchDir]);

  useEffect(() => {
    if (open) {
      fetchDir(rightNodeId, rightPath, false);
    }
  }, [open, rightNodeId, rightPath, fetchDir]);

  const handleTransfer = async (direction: "ltr" | "rtl") => {
    const sourceNodeId = direction === "ltr" ? leftNodeId : rightNodeId;
    const sourcePath = direction === "ltr" ? leftPath : rightPath;
    const sourceSelected = direction === "ltr" ? leftSelected : rightSelected;
    const sourceEntries = direction === "ltr" ? leftEntries : rightEntries;
    
    const targetNodeId = direction === "ltr" ? rightNodeId : leftNodeId;
    const targetPath = direction === "ltr" ? rightPath : leftPath;

    if (sourceSelected.size === 0) return;
    setTransferring(true);

    try {
      // If same node, just use copy API
      if (sourceNodeId === targetNodeId) {
        setProgressText("正在节点内复制...");
        const paths = Array.from(sourceSelected);
        await fileFetch(`${getNodeApiPrefix(sourceNodeId)}/files/copy`, {
          method: "POST",
          body: JSON.stringify({ paths, targetDir: targetPath, overwrite: false })
        });
      } else {
        // Cross-node transfer (Frontend Proxy)
        const selectedItems = sourceEntries.filter(e => sourceSelected.has(e.path));
        
        for (let i = 0; i < selectedItems.length; i++) {
          const item = selectedItems[i];
          setProgressText(`处理中 (${i+1}/${selectedItems.length}): ${item.name}`);
          
          let downloadPath = item.path;
          let isFolder = item.isDirectory;
          let tempArchive = "";

          // 1. If folder, compress first
          if (isFolder) {
            setProgressText(`压缩文件夹: ${item.name}...`);
            tempArchive = joinPath(sourcePath, `${item.name}-transfer-${Date.now()}.tar.gz`);
            const compRes = await fileFetch<{success: boolean}>(`${getNodeApiPrefix(sourceNodeId)}/files/compress`, {
              method: "POST",
              body: JSON.stringify({ paths: [item.path], targetPath: tempArchive })
            });
            if (!compRes.success) throw new Error(`无法压缩文件夹 ${item.name}`);
            downloadPath = tempArchive;
          }

          // 2. Download from Source
          setProgressText(`下载: ${item.name}...`);
          const dlRes = await fileFetch<{success: boolean; data?: string; size?: number; fileName?: string}>(
            `${getNodeApiPrefix(sourceNodeId)}/files/download?path=${encodeURIComponent(downloadPath)}`
          );
          
          if (!dlRes.success || !dlRes.data) {
            throw new Error(`下载失败 (可能超过100MB限制): ${item.name}`);
          }

          // 3. Upload to Target
          setProgressText(`上传: ${item.name}...`);
          const targetFilePath = joinPath(targetPath, isFolder ? tempArchive.split('/').pop()! : item.name);
          const totalSize = dlRes.size || 0;
          
          // Using chunk upload to bypass normal write limit, but since we have it in base64 memory, we can just send it as one chunk if small, or split it.
          // For simplicity, we send the whole base64 as one chunk.
          const ulRes = await fileFetch<{success: boolean}>(`${getNodeApiPrefix(targetNodeId)}/files/upload/chunk`, {
            method: "POST",
            body: JSON.stringify({
              path: targetFilePath,
              offset: 0,
              totalSize: totalSize,
              chunk: dlRes.data
            })
          });

          if (!ulRes.success) throw new Error(`上传失败: ${item.name}`);

          // 4. If folder, extract on Target and clean up
          if (isFolder) {
            setProgressText(`解压文件夹: ${item.name}...`);
            await fileFetch(`${getNodeApiPrefix(targetNodeId)}/files/extract`, {
              method: "POST",
              body: JSON.stringify({ path: targetFilePath, targetDir: targetPath, overwrite: false })
            });
            // Delete temp archive on target
            await fileFetch(`${getNodeApiPrefix(targetNodeId)}/files`, {
              method: "DELETE",
              body: JSON.stringify({ path: targetFilePath })
            });
            // Delete temp archive on source
            await fileFetch(`${getNodeApiPrefix(sourceNodeId)}/files`, {
              method: "DELETE",
              body: JSON.stringify({ path: tempArchive })
            });
          }
        }
      }

      setProgressText("传输完成！");
      setTimeout(() => setProgressText(""), 2000);
      
      // Refresh target browser
      if (direction === "ltr") {
        fetchDir(rightNodeId, rightPath, false);
      } else {
        fetchDir(leftNodeId, leftPath, true);
      }
      
      // Clear selection
      if (direction === "ltr") setLeftSelected(new Set());
      else setRightSelected(new Set());
      
    } catch (e: any) {
      alert(`传输中断: ${e.message}`);
      setProgressText("传输失败");
    } finally {
      setTransferring(false);
    }
  };

  const renderBrowser = (
    isLeft: boolean,
    nodeId: string,
    setNodeId: (id: string) => void,
    path: string,
    setPath: (p: string) => void,
    root: string,
    entries: FileEntry[],
    selected: Set<string>,
    setSelected: (s: Set<string>) => void,
    loading: boolean
  ) => {
    return (
      <div className="flex flex-col h-full border rounded-lg bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 p-2 border-b bg-muted/20">
          <select
            value={nodeId}
            onChange={(e) => {
              setNodeId(e.target.value);
              setPath("");
            }}
            disabled={transferring}
            className="h-8 max-w-[120px] rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring shadow-sm"
          >
            {allNodes.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
          
          <div className="h-4 w-px bg-border mx-1"></div>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => setPath(parentPath(path))}
            disabled={!path || transferring}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          
          <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto text-xs px-2 bg-background border rounded-md h-8">
            <button onClick={() => setPath("")} className="hover:text-primary shrink-0">
              <Home className="h-3 w-3" />
            </button>
            {path.split("/").filter(Boolean).map((part, i, arr) => {
              const subPath = arr.slice(0, i + 1).join("/");
              return (
                <div key={subPath} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <button onClick={() => setPath(subPath)} className="hover:text-primary max-w-[80px] truncate">
                    {part}
                  </button>
                </div>
              );
            })}
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => fetchDir(nodeId, path, isLeft)}
            disabled={loading || transferring}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* File List */}
        <ScrollArea className="flex-1 p-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
              <span className="text-xs">加载中...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <FolderOpen className="h-10 w-10 opacity-30 mb-2" />
              <span className="text-xs">此目录为空</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {entries.map((entry) => {
                const isSelected = selected.has(entry.path);
                return (
                  <div
                    key={entry.path}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer group hover:bg-muted/50 ${isSelected ? "bg-primary/10" : ""}`}
                    onClick={() => {
                      if (entry.isDirectory) {
                        setPath(entry.path);
                      } else {
                        const next = new Set(selected);
                        if (next.has(entry.path)) next.delete(entry.path);
                        else next.add(entry.path);
                        setSelected(next);
                      }
                    }}
                  >
                    <div onClick={(e) => {
                      e.stopPropagation();
                      const next = new Set(selected);
                      if (next.has(entry.path)) next.delete(entry.path);
                      else next.add(entry.path);
                      setSelected(next);
                    }}>
                      <Checkbox checked={isSelected} readOnly className="h-3.5 w-3.5" />
                    </div>
                    {getFileIcon(entry)}
                    <span className="truncate flex-1 text-xs">{entry.name}</span>
                    <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      {!entry.isDirectory ? formatBytes(entry.size) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        
        {/* Footer */}
        <div className="p-2 border-t bg-muted/10 flex justify-between items-center text-xs text-muted-foreground">
          <span>已选 {selected.size} 项</span>
          <span>共 {entries.length} 项</span>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-[85vh] w-[95vw] sm:max-w-[1200px] flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>文件互传</DialogTitle>
          <DialogDescription>在不同的节点间传输文件</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <ArrowRight className="h-4 w-4 shrink-0 text-blue-500" />
            <span className="truncate text-sm font-medium">文件互传</span>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => !transferring && onOpenChange(false)} disabled={transferring}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-1 min-h-0 p-4 gap-4 bg-muted/10">
          <div className="flex-1 min-w-0">
            {renderBrowser(
              true, leftNodeId, setLeftNodeId, leftPath, setLeftPath, leftRoot, leftEntries, leftSelected, setLeftSelected, leftLoading
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-4 shrink-0 w-24">
            <div className="flex flex-col items-center text-center gap-1">
              <span className="text-xs text-muted-foreground font-medium mb-1">传输操作</span>
              <Button 
                variant="outline" 
                size="icon" 
                className="rounded-full shadow-sm"
                disabled={leftSelected.size === 0 || transferring}
                onClick={() => handleTransfer("ltr")}
                title="传输到右侧节点"
              >
                <ArrowRight className="h-4 w-4 text-blue-500" />
              </Button>
              <Button 
                variant="outline" 
                size="icon" 
                className="rounded-full shadow-sm"
                disabled={rightSelected.size === 0 || transferring}
                onClick={() => handleTransfer("rtl")}
                title="传输到左侧节点"
              >
                <ArrowLeft className="h-4 w-4 text-emerald-500" />
              </Button>
            </div>
            
            {transferring && (
              <div className="flex flex-col items-center gap-2 mt-4 animate-in fade-in">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-[10px] text-muted-foreground text-center break-all w-full">{progressText}</span>
              </div>
            )}
            
            {!transferring && progressText && (
              <div className="text-[10px] text-emerald-500 text-center animate-in fade-in">
                {progressText}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {renderBrowser(
              false, rightNodeId, setRightNodeId, rightPath, setRightPath, rightRoot, rightEntries, rightSelected, setRightSelected, rightLoading
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
