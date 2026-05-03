"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FolderOpen,
  FileText,
  File,
  ChevronRight,
  ArrowLeft,
  RefreshCw,
  FolderPlus,
  Trash2,
  Edit3,
  Download,
  Save,
  Home,
  Search,
  AlertCircle,
  CheckCircle,
  FileCode,
  FileImage,
  FileArchive,
  Film,
  Music,
  X, // 1. 修复：添加缺失的 X 图标导入
} from "lucide-react";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
  extension: string;
  mimeType: string | false;
}

interface FileReadResult {
  success: boolean;
  content?: string;
  path?: string;
  size?: number;
  modified?: number;
  extension?: string;
  message?: string;
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getMonacoLanguage(ext: string): string {
  const map: Record<string, string> = {
    ".js": "javascript", ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
    ".py": "python", ".go": "go", ".rs": "rust", ".java": "java",
    ".c": "c", ".cpp": "cpp", ".cs": "csharp", ".php": "php", ".rb": "ruby",
    ".sh": "shell", ".vue": "html", ".svelte": "html",
    ".json": "json", ".yml": "yaml", ".yaml": "yaml", ".xml": "xml",
    ".toml": "ini", ".ini": "ini", ".conf": "ini", ".cfg": "ini",
    ".css": "css", ".scss": "scss", ".less": "less",
    ".html": "html", ".htm": "html",
    ".md": "markdown", ".txt": "plaintext", ".log": "plaintext", ".csv": "plaintext",
    ".sql": "sql", ".graphql": "graphql",
    ".dockerfile": "dockerfile", ".lua": "lua", ".r": "r", ".swift": "swift",
    ".kt": "kotlin", ".dart": "dart", ".zig": "zig",
  };
  return map[ext] || "plaintext";
}

function getFileIcon(entry: FileEntry) {
  if (entry.isDirectory) return <FolderOpen className="h-4 w-4 text-yellow-500" />;
  const ext = entry.extension;
  const codeExts = [".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".cs", ".php", ".rb", ".sh", ".vue", ".svelte"];
  const imgExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp"];
  const archiveExts = [".zip", ".tar", ".gz", ".bz2", ".7z", ".rar"];
  const videoExts = [".mp4", ".webm", ".avi", ".mov", ".mkv"];
  const audioExts = [".mp3", ".wav", ".ogg", ".flac", ".aac"];

  if (codeExts.includes(ext)) return <FileCode className="h-4 w-4 text-green-500" />;
  if (imgExts.includes(ext)) return <FileImage className="h-4 w-4 text-purple-500" />;
  if (archiveExts.includes(ext)) return <FileArchive className="h-4 w-4 text-orange-500" />;
  if (videoExts.includes(ext)) return <Film className="h-4 w-4 text-pink-500" />;
  if (audioExts.includes(ext)) return <Music className="h-4 w-4 text-cyan-500" />;
  if ([".md", ".txt", ".log", ".csv"].includes(ext)) return <FileText className="h-4 w-4 text-blue-500" />;
  if ([".json", ".yml", ".yaml", ".xml", ".toml", ".ini", ".conf", ".cfg"].includes(ext))
    return <FileCode className="h-4 w-4 text-amber-500" />;
  if ([".css", ".scss", ".less", ".html", ".htm"].includes(ext))
    return <FileCode className="h-4 w-4 text-blue-400" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function Breadcrumb({ path, root, onNavigate }: { path: string; root: string; onNavigate: (p: string) => void }) {
  const parts = path ? path.split("/").filter(Boolean) : [];
  const rootLabel = root
    ? root.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean).pop() || "/"
    : "/";
  return (
    <div className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto">
      <button
        onClick={() => onNavigate("")}
        className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted shrink-0 transition-colors"
        title={root || "根目录"}
      >
        <Home className="h-3.5 w-3.5" />
        <span className="font-medium">{rootLabel}</span>
      </button>
      {parts.map((part, i) => {
        const subPath = parts.slice(0, i + 1).join("/");
        return (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              onClick={() => onNavigate(subPath)}
              className={`px-2 py-1 rounded-md hover:bg-muted transition-colors truncate max-w-48 ${
                i === parts.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"
              }`}
            >
              {part}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in fade-in-0 slide-in-from-bottom-4 ${
        type === "success"
          ? "bg-emerald-600 text-white"
          : "bg-red-600 text-white"
      }`}
    >
      {type === "success" ? (
        <CheckCircle className="h-4 w-4" />
      ) : (
        <AlertCircle className="h-4 w-4" />
      )}
      {message}
    </div>
  );
}

export default function FilesPage() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  // 2. 修复：定义 Monaco 编辑器实例的引用
  const editorInstanceRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [fetching, setFetching] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ extension: string; size: number } | null>(null);

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
  }, []);

  const fetchDir = useCallback(async (path: string) => {
    setFetching(true);
    try {
      const data = await fileFetch<{
        success: boolean;
        entries?: FileEntry[];
        root?: string;
        message?: string;
      }>(`/api/files?path=${encodeURIComponent(path)}`);
      if (data.success && data.entries) {
        setEntries(data.entries);
        if (data.root) setRootPath(data.root);
      } else {
        showToast(data.message || "读取目录失败", "error");
      }
    } catch {
      showToast("网络错误", "error");
    } finally {
      setFetching(false);
    }
  }, [showToast]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setOpenFile(null);
    setFileContent("");
    setOriginalContent("");
    fetchDir(path);
  }, [fetchDir]);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fileFetch<{ success: boolean; profile?: unknown }>(
          "/api/me"
        );
        if (!res.success) {
          router.push("/login");
          return;
        }
        await fetchDir("");
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchDir]);

  const handleOpenDir = (entry: FileEntry) => {
    navigateTo(entry.path);
  };

  const handleOpenFile = async (entry: { path: string }) => {
    setFileLoading(true);
    setOpenFile(entry.path);
    try {
      const data = await fileFetch<FileReadResult>(
        `/api/files/read?path=${encodeURIComponent(entry.path)}`
      );
      if (data.success && data.content !== undefined) {
        setFileContent(data.content);
        setOriginalContent(data.content);
        setFileMeta({ extension: data.extension || "", size: data.size || 0 });
      } else {
        showToast(data.message || "无法读取文件", "error");
        setOpenFile(null);
      }
    } catch {
      showToast("读取文件失败", "error");
      setOpenFile(null);
    } finally {
      setFileLoading(false);
    }
  };

  const handleSave = async () => {
    if (!openFile) return;
    setSaving(true);
    try {
      const data = await fileFetch<{ success: boolean; message?: string }>(
        "/api/files/write",
        {
          method: "PUT",
          body: JSON.stringify({ path: openFile, content: fileContent }),
        }
      );
      if (data.success) {
        setOriginalContent(fileContent);
        showToast("保存成功", "success");
      } else {
        showToast(data.message || "保存失败", "error");
      }
    } catch {
      showToast("保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleCloseFile = () => {
    if (fileContent !== originalContent) {
      if (!confirm("文件已修改但未保存，确定关闭？")) return;
    }
    setOpenFile(null);
    setFileContent("");
    setOriginalContent("");
    setFileMeta(null);
  };

  const handleCreateDir = async () => {
    if (!mkdirName.trim()) return;
    const dirPath = currentPath ? `${currentPath}/${mkdirName}` : mkdirName;
    try {
      const data = await fileFetch<{ success: boolean; message?: string }>(
        "/api/files/mkdir",
        {
          method: "POST",
          body: JSON.stringify({ path: dirPath }),
        }
      );
      if (data.success) {
        showToast("目录已创建", "success");
        setMkdirOpen(false);
        setMkdirName("");
        fetchDir(currentPath);
      } else {
        showToast(data.message || "创建失败", "error");
      }
    } catch {
      showToast("创建失败", "error");
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    const parentDir = renameTarget.path.includes("/")
      ? renameTarget.path.substring(0, renameTarget.path.lastIndexOf("/"))
      : "";
    const newPath = parentDir ? `${parentDir}/${renameName}` : renameName;
    try {
      const data = await fileFetch<{ success: boolean; message?: string }>(
        "/api/files/rename",
        {
          method: "PATCH",
          body: JSON.stringify({ from: renameTarget.path, to: newPath }),
        }
      );
      if (data.success) {
        showToast("重命名成功", "success");
        setRenameTarget(null);
        setRenameName("");
        fetchDir(currentPath);
      } else {
        showToast(data.message || "重命名失败", "error");
      }
    } catch {
      showToast("重命名失败", "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const data = await fileFetch<{ success: boolean; message?: string }>(
        "/api/files",
        {
          method: "DELETE",
          body: JSON.stringify({ path: deleteTarget.path }),
        }
      );
      if (data.success) {
        showToast("删除成功", "success");
        setDeleteTarget(null);
        if (openFile === deleteTarget.path) {
          setOpenFile(null);
          setFileContent("");
          setOriginalContent("");
        }
        fetchDir(currentPath);
      } else {
        showToast(data.message || "删除失败", "error");
      }
    } catch {
      showToast("删除失败", "error");
    }
  };

  const handleDownload = async (entry: FileEntry) => {
    try {
      const data = await fileFetch<{
        success: boolean;
        data?: string;
        mimeType?: string;
        fileName?: string;
        message?: string;
      }>(`/api/files/download?path=${encodeURIComponent(entry.path)}`);
      if (data.success && data.data) {
        const byteChars = atob(data.data);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: data.mimeType || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = data.fileName || entry.name;
        a.click();
        URL.revokeObjectURL(url);
        showToast("下载成功", "success");
      } else {
        showToast(data.message || "下载失败", "error");
      }
    } catch {
      showToast("下载失败", "error");
    }
  };

  const filteredEntries = searchTerm
    ? entries.filter((e) => e.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : entries;

  const isModified = fileContent !== originalContent;

  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto w-full p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto w-full h-[calc(100vh-7rem)] flex flex-col p-4">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">文件管理</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateTo(currentPath)}
            disabled={fetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${fetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      <Card className="shrink-0">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (currentPath) {
                  const parent = currentPath.includes("/")
                    ? currentPath.substring(0, currentPath.lastIndexOf("/"))
                    : "";
                  navigateTo(parent);
                }
              }}
              disabled={!currentPath}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              上级
            </Button>
            <div className="flex-1 min-w-0 overflow-hidden">
              <Breadcrumb path={currentPath} root={rootPath} onNavigate={navigateTo} />
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMkdirOpen(true)}
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                新建文件夹
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex flex-col min-h-0 w-full">
          <Card className="flex-1 min-h-0 flex flex-col">
            <CardContent className="py-3 px-4 flex flex-col min-h-0 gap-3 flex-1">
              <div className="relative shrink-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索文件..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8"
                />
              </div>

              <div className="flex-1 overflow-auto space-y-0.5">
                {fetching ? (
                  <div className="space-y-1">
                    {[...Array(6)].map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))}
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <FolderOpen className="h-10 w-10 mb-2 opacity-30" />
                    <p className="text-sm">
                      {searchTerm ? "没有匹配的文件" : "此目录为空"}
                    </p>
                  </div>
                ) : (
                  filteredEntries.map((entry) => (
                    <div
                      key={entry.path}
                      className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-muted/80 ${
                        openFile === entry.path ? "bg-muted" : ""
                      }`}
                      onClick={() => {
                        if (entry.isDirectory) handleOpenDir(entry);
                        else handleOpenFile(entry);
                      }}
                    >
                      <div className="shrink-0">{getFileIcon(entry)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {entry.name}
                        </div>
                      </div>
                      {!entry.isDirectory && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatBytes(entry.size)}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                        {formatDate(entry.modified)}
                      </span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {!entry.isDirectory && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="下载"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(entry);
                            }}
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="重命名"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameTarget(entry);
                            setRenameName(entry.name);
                          }}
                        >
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="删除"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(entry);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2 shrink-0">
                <span>{entries.length} 项</span>
                <span>
                  {entries.filter((e) => e.isDirectory).length} 个文件夹, {entries.filter((e) => !e.isDirectory).length} 个文件
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 3. 修复：这里原本多出一个闭合 div 标签，已移除 */}

      <Dialog open={!!openFile} onOpenChange={(v) => { if (!v) handleCloseFile(); }}>
        <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>编辑文件 - {openFile ? openFile.split("/").pop() : ""}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-blue-500 shrink-0" />
              <span className="text-sm font-medium truncate">{openFile ? openFile.split("/").pop() : ""}</span>
              {isModified && (
                <span className="text-xs text-amber-500 shrink-0">● 未保存</span>
              )}
              {fileMeta && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatBytes(fileMeta.size)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={!isModified || saving}
              >
                <Save className={`h-4 w-4 mr-2 ${saving ? "animate-pulse" : ""}`} />
                保存
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-0 px-1 py-1 border-b shrink-0 bg-muted/30">
            <div className="relative group">
              <button className="px-3 py-1 text-xs font-medium rounded-sm hover:bg-muted transition-colors">
                文件
              </button>
              <div className="absolute left-0 top-full mt-0.5 z-50 min-w-44 rounded-md border bg-popover p-1 shadow-md opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                  onClick={() => openFile && handleOpenFile({ path: openFile })}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  重新加载
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                  onClick={handleSave}
                  disabled={!isModified || saving}
                >
                  <Save className="h-3.5 w-3.5" />
                  保存
                  <span className="ml-auto text-muted-foreground">Ctrl+S</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                  onClick={handleCloseFile}
                >
                  <X className="h-3.5 w-3.5" />
                  关闭
                </button>
              </div>
            </div>
            <div className="relative group">
              <button className="px-3 py-1 text-xs font-medium rounded-sm hover:bg-muted transition-colors">
                编辑
              </button>
              <div className="absolute left-0 top-full mt-0.5 z-50 min-w-44 rounded-md border bg-popover p-1 shadow-md opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                  onClick={() => editorInstanceRef.current?.trigger('menu', 'undo')}
                >
                  撤销
                  <span className="ml-auto text-muted-foreground">Ctrl+Z</span>
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                  onClick={() => editorInstanceRef.current?.trigger('menu', 'redo')}
                >
                  重做
                  <span className="ml-auto text-muted-foreground">Ctrl+Y</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                  onClick={() => editorInstanceRef.current?.trigger('menu', 'editor.action.clipboardCopyAction')}
                >
                  复制
                  <span className="ml-auto text-muted-foreground">Ctrl+C</span>
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                  onClick={() => editorInstanceRef.current?.trigger('menu', 'editor.action.clipboardPasteAction')}
                >
                  粘贴
                  <span className="ml-auto text-muted-foreground">Ctrl+V</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                  onClick={() => editorInstanceRef.current?.trigger('menu', 'actions.find')}
                >
                  查找
                  <span className="ml-auto text-muted-foreground">Ctrl+F</span>
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            {fileLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                  <span className="text-sm">加载中...</span>
                </div>
              </div>
            ) : (
              <Editor
                height="100%"
                language={getMonacoLanguage(fileMeta?.extension || "")}
                value={fileContent}
                onChange={(value) => setFileContent(value || "")}
                theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                options={{
                  minimap: { enabled: true },
                  fontSize: 14,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  automaticLayout: true,
                  tabSize: 2,
                  padding: { top: 8, bottom: 8 },
                }}
                onMount={(editor, monaco) => {
                  editorInstanceRef.current = editor;
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                    handleSave();
                  });
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="文件夹名称"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateDir();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMkdirOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateDir} disabled={!mkdirName.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={() => setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="新名称"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button onClick={handleRename} disabled={!renameName.trim()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            确定要删除 <span className="font-medium text-foreground">{deleteTarget?.name}</span> 吗？
            {deleteTarget?.isDirectory && (
              <span className="text-destructive block mt-1">
                目录将连同其所有内容一起删除，此操作不可撤销。
              </span>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}