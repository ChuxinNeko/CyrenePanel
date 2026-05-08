"use client";

import { type DragEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpDown,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Edit3,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FilePlus,
  FileText,
  Film,
  FolderOpen,
  FolderPlus,
  Home,
  Info,
  Music,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Save,
  Scissors,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NodeFileTransferDialog } from "@/components/node-file-transfer-dialog";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
  extension: string;
  mimeType: string | false;
  mode?: string;
  permissions?: string;
}

interface FileReadResult {
  success: boolean;
  content?: string;
  size?: number;
  modified?: number;
  extension?: string;
  message?: string;
}

interface NodeInfo {
  id: string;
  name: string;
  address: string;
  apiKey: string;
  isMain: number;
  createdAt: number;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
  loaded: boolean;
}

type ToastState = { message: string; type: "success" | "error" };
type SortField = "name" | "size" | "modified" | "type";
type ClipboardState = { mode: "copy" | "move"; paths: string[] } | null;
type ContextMenuState = { x: number; y: number; entry: FileEntry | null } | null;
type UploadStatus = "uploading" | "success" | "error";
type UploadTask = {
  id: string;
  name: string;
  size: number;
  uploaded: number;
  status: UploadStatus;
  message?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5676";
const UPLOAD_CHUNK_SIZE = 1024 * 1024;
const ARCHIVE_EXTENSIONS = [".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz"];
const TEXT_EXTENSIONS = new Set([
  ".txt", ".log", ".md", ".json", ".yml", ".yaml", ".xml", ".toml",
  ".ini", ".conf", ".cfg", ".env", ".sh", ".bash", ".zsh", ".fish",
  ".py", ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".less",
  ".html", ".htm", ".vue", ".svelte", ".go", ".rs", ".rb", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".sql", ".graphql",
  ".csv", ".tsv", ".properties", ".gitignore", ".dockerignore",
  ".dockerfile", ".makefile", ".editorconfig", ".prettierrc", ".eslintrc",
  ".babelrc", ".lock", ".diff", ".patch", "",
]);

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

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("读取文件分片失败"));
    reader.readAsDataURL(blob);
  });
}

function getNodeApiPrefix(nodeId: string | null): string {
  return nodeId ? `/api/nodes/${nodeId}` : "/api";
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
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

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function joinPath(dir: string, name: string): string {
  const cleanDir = dir.replace(/\/+$/, "");
  return cleanDir ? `${cleanDir}/${name}` : name;
}

function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
}

function getArchiveExtension(path: string): string {
  const lower = path.toLowerCase();
  return ARCHIVE_EXTENSIONS.find((ext) => lower.endsWith(ext)) || "";
}

function isArchive(entry: FileEntry): boolean {
  return !entry.isDirectory && !!getArchiveExtension(entry.name || entry.path);
}

function canEdit(entry: FileEntry): boolean {
  return !entry.isDirectory && TEXT_EXTENSIONS.has(entry.extension.toLowerCase());
}

function getMonacoLanguage(ext: string): string {
  const map: Record<string, string> = {
    ".js": "javascript", ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript",
    ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".c": "c",
    ".cpp": "cpp", ".cs": "csharp", ".php": "php", ".rb": "ruby", ".sh": "shell",
    ".vue": "html", ".svelte": "html", ".json": "json", ".yml": "yaml",
    ".yaml": "yaml", ".xml": "xml", ".toml": "ini", ".ini": "ini", ".conf": "ini",
    ".cfg": "ini", ".css": "css", ".scss": "scss", ".less": "less", ".html": "html",
    ".htm": "html", ".md": "markdown", ".txt": "plaintext", ".log": "plaintext",
    ".csv": "plaintext", ".sql": "sql", ".graphql": "graphql", ".dockerfile": "dockerfile",
    ".lua": "lua", ".r": "r", ".swift": "swift", ".kt": "kotlin", ".dart": "dart",
    ".zig": "zig",
  };
  return map[ext] || "plaintext";
}

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

function Breadcrumb({ path, root, onNavigate }: { path: string; root: string; onNavigate: (path: string) => void }) {
  const parts = path ? path.split("/").filter(Boolean) : [];
  const rootLabel = root ? root.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean).pop() || "/" : "/";
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
      <button
        onClick={() => onNavigate("")}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors hover:bg-muted"
        title={root || "根目录"}
      >
        <Home className="h-3.5 w-3.5" />
        {rootLabel}
      </button>
      {parts.map((part, index) => {
        const subPath = parts.slice(0, index + 1).join("/");
        return (
          <div key={subPath} className="flex shrink-0 items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              onClick={() => onNavigate(subPath)}
              className={`max-w-48 truncate rounded-md px-2 py-1 transition-colors hover:bg-muted ${index === parts.length - 1 ? "font-medium" : "text-muted-foreground"}`}
            >
              {part}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3000);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"}`}>
      {toast.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {toast.message}
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  expandedPaths,
  activePath,
  onToggle,
  onFileClick,
  onDirClick,
  onLoadChildren,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  activePath: string | null;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
  onDirClick?: (path: string) => void;
  onLoadChildren: (path: string) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const isExpanded = expandedPaths.has(node.path);
  const isActive = activePath === node.path;

  useEffect(() => {
    if (isActive) nodeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isActive]);

  if (!node.isDirectory) {
    const extension = node.name.includes(".") ? `.${node.name.split(".").pop()}` : "";
    const entry: FileEntry = { name: node.name, path: node.path, isDirectory: false, size: 0, modified: 0, extension, mimeType: false };
    return (
      <div
        ref={nodeRef}
        className={`flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors hover:bg-muted/80 ${isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        title={node.path}
        onClick={() => onFileClick(node.path)}
      >
        {getFileIcon(entry)}
        <span className="truncate">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        ref={nodeRef}
        className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors hover:bg-muted/80 ${isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => {
          if (onDirClick) {
            onDirClick(node.path);
          } else {
            if (!node.loaded) onLoadChildren(node.path);
            onToggle(node.path);
          }
        }}
      >
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${isExpanded ? "" : "-rotate-90"}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!node.loaded) onLoadChildren(node.path);
            onToggle(node.path);
          }}
        />
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-yellow-500" />
        <span className="truncate">{node.name}</span>
      </div>
      {isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              activePath={activePath}
              onToggle={onToggle}
              onFileClick={onFileClick}
              onDirClick={onDirClick}
              onLoadChildren={onLoadChildren}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const editorInstanceRef = useRef<any>(null);
  const isFirstLoad = useRef(true);
  const fileListScrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const pendingScrollRestoreRef = useRef<{ path: string; top: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<ClipboardState>(null);

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ extension: string; size: number } | null>(null);
  const [treeSidebarOpen, setTreeSidebarOpen] = useState(true);
  const [treeRoot, setTreeRoot] = useState<TreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<"file" | "folder">("folder");
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveName, setArchiveName] = useState("");
  const [chmodTarget, setChmodTarget] = useState<FileEntry | null>(null);
  const [chmodMode, setChmodMode] = useState("755");
  const [chmodRecursive, setChmodRecursive] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [propertyEntries, setPropertyEntries] = useState<FileEntry[] | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(searchParams.get("node"));
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);

  const prefix = getNodeApiPrefix(selectedNodeId);
  const showToast = useCallback((message: string, type: "success" | "error") => setToast({ message, type }), []);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.has(entry.path)),
    [entries, selectedPaths],
  );
  const singleSelection = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const totalSelectedSize = selectedEntries.reduce((sum, entry) => sum + entry.size, 0);

  const visibleEntries = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = term ? entries.filter((entry) => entry.name.toLowerCase().includes(term)) : entries;
    return [...filtered].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      let result = 0;
      if (sortField === "name") result = a.name.localeCompare(b.name, "zh-CN", { sensitivity: "base" });
      if (sortField === "size") result = a.size - b.size;
      if (sortField === "modified") result = a.modified - b.modified;
      if (sortField === "type") result = (a.extension || "folder").localeCompare(b.extension || "folder");
      return sortAsc ? result : -result;
    });
  }, [entries, searchTerm, sortAsc, sortField]);

  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((entry) => selectedPaths.has(entry.path));
  const isWindowsNode = rootPath === "" || /^[A-Za-z]:/.test(currentPath) || entries.some((entry) => /^[A-Za-z]:/.test(entry.path));
  const tableColumnCount = isWindowsNode ? 6 : 7;

  const initTreeRoot = useCallback(async () => {
    const data = await fileFetch<{ success: boolean; entries?: FileEntry[] }>(`${prefix}/files?path=`);
    if (!data.success || !data.entries) return;
    setTreeRoot({
      name: "/",
      path: "",
      isDirectory: true,
      loaded: true,
      children: data.entries.map((entry) => ({ name: entry.name, path: entry.path, isDirectory: entry.isDirectory, loaded: false })),
    });
    setExpandedPaths(new Set([""]));
  }, [prefix]);

  const loadTreeChildren = useCallback(async (dirPath: string) => {
    const data = await fileFetch<{ success: boolean; entries?: FileEntry[] }>(`${prefix}/files?path=${encodeURIComponent(dirPath)}`);
    if (!data.success || !data.entries) return;
    const children = data.entries.map((entry) => ({ name: entry.name, path: entry.path, isDirectory: entry.isDirectory, loaded: false }));
    setTreeRoot((prev) => {
      if (!prev) return prev;
      const update = (node: TreeNode): TreeNode => {
        if (node.path === dirPath) return { ...node, children, loaded: true };
        return node.children ? { ...node, children: node.children.map(update) } : node;
      };
      return update(prev);
    });
  }, [prefix]);

  const expandTreeToPath = useCallback(async (filePath: string, isFile = true) => {
    const parts = filePath.split("/").filter(Boolean);
    let current = "";
    const dirs: string[] = [""];
    const limit = isFile ? parts.length - 1 : parts.length;
    for (let i = 0; i < limit; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      dirs.push(current);
    }
    setExpandedPaths((prev) => new Set([...prev, ...dirs]));
    for (const dir of dirs) await loadTreeChildren(dir);
  }, [loadTreeChildren]);

  const fetchDir = useCallback(async (path: string) => {
    setFetching(true);
    try {
      const data = await fileFetch<{ success: boolean; entries?: FileEntry[]; root?: string; message?: string }>(
        `${getNodeApiPrefix(selectedNodeId)}/files?path=${encodeURIComponent(path)}`,
      );
      if (data.success && data.entries) {
        setEntries(data.entries);
        setRootPath(data.root ?? "");
        setSelectedPaths(new Set());
      } else {
        showToast(data.message || "读取目录失败", "error");
      }
    } catch {
      showToast("网络错误", "error");
    } finally {
      setFetching(false);
    }
  }, [selectedNodeId, showToast]);

  const fetchNodes = useCallback(async () => {
    try {
      const data = await fileFetch<{ success: boolean; nodes?: NodeInfo[] }>("/api/nodes");
      if (data.success && data.nodes) setNodes(data.nodes);
    } catch {
      // 节点列表不影响主节点文件管理。
    }
  }, []);

  const updateUploadTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setUploadTasks((prev) => prev.map((task) => (task.id === id ? { ...task, ...patch } : task)));
  }, []);

  const uploadSingleFile = useCallback(async (file: File) => {
    const id = `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
    const targetPath = joinPath(currentPath, file.name);
    setUploadTasks((prev) => [
      ...prev,
      { id, name: file.name, size: file.size, uploaded: 0, status: "uploading" },
    ]);

    try {
      const status = await fileFetch<{ success: boolean; uploaded?: number; message?: string }>(
        `${prefix}/files/upload/status?path=${encodeURIComponent(targetPath)}&totalSize=${file.size}`,
      );
      if (!status.success) throw new Error(status.message || "无法获取上传进度");

      let offset = Math.min(status.uploaded || 0, file.size);
      updateUploadTask(id, { uploaded: offset });

      if (file.size === 0) {
        const result = await fileFetch<{ success: boolean; message?: string }>(
          `${prefix}/files/upload/chunk`,
          {
            method: "POST",
            body: JSON.stringify({ path: targetPath, offset: 0, totalSize: 0, chunk: "" }),
          },
        );
        if (!result.success) throw new Error(result.message || "上传失败");
      }

      while (offset < file.size) {
        const end = Math.min(offset + UPLOAD_CHUNK_SIZE, file.size);
        const chunk = await readBlobAsBase64(file.slice(offset, end));
        const result = await fileFetch<{ success: boolean; uploaded?: number; complete?: boolean; resumable?: boolean; message?: string }>(
          `${prefix}/files/upload/chunk`,
          {
            method: "POST",
            body: JSON.stringify({ path: targetPath, offset, totalSize: file.size, chunk }),
          },
        );

        if (!result.success) {
          if (result.resumable && typeof result.uploaded === "number" && result.uploaded !== offset) {
            offset = Math.min(result.uploaded, file.size);
            updateUploadTask(id, { uploaded: offset });
            continue;
          }
          throw new Error(result.message || "上传失败");
        }

        offset = Math.min(result.uploaded ?? end, file.size);
        updateUploadTask(id, { uploaded: offset });
      }

      updateUploadTask(id, { uploaded: file.size, status: "success", message: "上传完成" });
      return true;
    } catch (error: any) {
      updateUploadTask(id, { status: "error", message: error?.message || "上传失败" });
      return false;
    }
  }, [currentPath, prefix, updateUploadTask]);

  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) => file.size >= 0);
    if (files.length === 0) return;

    let successCount = 0;
    for (const file of files) {
      if (await uploadSingleFile(file)) successCount += 1;
    }

    if (successCount > 0) {
      showToast(`已上传 ${successCount}/${files.length} 个文件`, "success");
      fetchDir(currentPath);
      if (treeRoot) loadTreeChildren(currentPath);
    } else {
      showToast("上传失败", "error");
    }
  }, [currentPath, fetchDir, loadTreeChildren, showToast, treeRoot, uploadSingleFile]);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (event.dataTransfer.items?.length) setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) uploadFiles(event.dataTransfer.files);
  }, [uploadFiles]);



  const navigateTo = useCallback((path: string) => {
    if (fileListScrollRef.current) {
      scrollPositionsRef.current[currentPath] = fileListScrollRef.current.scrollTop;
    }
    pendingScrollRestoreRef.current = {
      path,
      top: scrollPositionsRef.current[path] ?? 0,
    };
    setCurrentPath(path);
    setOpenFile(null);
    setFileContent("");
    setOriginalContent("");
    setFileMeta(null);
    fetchDir(path);
    expandTreeToPath(path, false);
  }, [currentPath, fetchDir, expandTreeToPath]);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fileFetch<{ success: boolean; profile?: unknown }>("/api/me");
        if (!res.success) {
          router.push("/login");
          return;
        }
        await Promise.all([fetchDir(""), fetchNodes(), initTreeRoot()]);
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
        isFirstLoad.current = false;
      }
    };
    init();
  }, [fetchDir, fetchNodes, initTreeRoot, router]);

  useEffect(() => {
    if (isFirstLoad.current) return;
    pendingScrollRestoreRef.current = { path: "", top: 0 };
    fetchDir("");
    initTreeRoot();
  }, [fetchDir, initTreeRoot, selectedNodeId]);

  useEffect(() => {
    const pending = pendingScrollRestoreRef.current;
    if (!pending || pending.path !== currentPath || fetching) return;
    const frame = window.requestAnimationFrame(() => {
      if (fileListScrollRef.current) {
        fileListScrollRef.current.scrollTop = pending.top;
      }
      pendingScrollRestoreRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentPath, entries, fetching]);



  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);



  const handleOpenFile = useCallback(async (entryOrPath: FileEntry | string) => {
    const filePath = typeof entryOrPath === "string" ? entryOrPath : entryOrPath.path;
    if (!treeRoot) await initTreeRoot();
    await expandTreeToPath(filePath, true);
    setFileLoading(true);
    setOpenFile(filePath);
    try {
      const data = await fileFetch<FileReadResult>(`${prefix}/files/read?path=${encodeURIComponent(filePath)}`);
      if (data.success && data.content !== undefined) {
        setFileContent(data.content);
        setOriginalContent(data.content);
        setFileMeta({ extension: data.extension || "", size: data.size || 0 });
      } else {
        setOpenFile(null);
        showToast(data.message || "无法读取文件", "error");
      }
    } catch {
      setOpenFile(null);
      showToast("读取文件失败", "error");
    } finally {
      setFileLoading(false);
    }
  }, [expandTreeToPath, initTreeRoot, prefix, showToast, treeRoot]);

  const handleSave = useCallback(async () => {
    if (!openFile) return;
    setSaving(true);
    try {
      const data = await fileFetch<{ success: boolean; message?: string }>(`${prefix}/files/write`, {
        method: "PUT",
        body: JSON.stringify({ path: openFile, content: fileContent }),
      });
      if (data.success) {
        setOriginalContent(fileContent);
        showToast("保存成功", "success");
        fetchDir(currentPath);
      } else {
        showToast(data.message || "保存失败", "error");
      }
    } catch {
      showToast("保存失败", "error");
    } finally {
      setSaving(false);
    }
  }, [currentPath, fetchDir, fileContent, openFile, prefix, showToast]);

  const closeFile = () => {
    if (fileContent !== originalContent && !window.confirm("文件已修改但未保存，确定关闭？")) return;
    setOpenFile(null);
    setFileContent("");
    setOriginalContent("");
    setFileMeta(null);
  };

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleEntries.forEach((entry) => next.delete(entry.path));
      else visibleEntries.forEach((entry) => next.add(entry.path));
      return next;
    });
  };

  const setSort = (field: SortField) => {
    if (sortField === field) setSortAsc((value) => !value);
    else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const runJsonAction = async (url: string, method: string, body: unknown, successMessage: string) => {
    const data = await fileFetch<{ success: boolean; message?: string; conflict?: boolean; conflicts?: string[] }>(url, {
      method,
      body: JSON.stringify(body),
    });
    if (!data.success) {
      showToast(data.message || successMessage.replace("成功", "失败"), "error");
      return false;
    }
    showToast(successMessage, "success");
    fetchDir(currentPath);
    return true;
  };

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    const path = joinPath(currentPath, name);
    const ok = createKind === "folder"
      ? await runJsonAction(`${prefix}/files/mkdir`, "POST", { path }, "目录已创建")
      : await runJsonAction(`${prefix}/files/write`, "PUT", { path, content: "" }, "文件已创建");
    if (ok) {
      setCreateOpen(false);
      setCreateName("");
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    const to = joinPath(parentPath(renameTarget.path), renameName.trim());
    const ok = await runJsonAction(`${prefix}/files/rename`, "PATCH", { from: renameTarget.path, to }, "重命名成功");
    if (ok) {
      setRenameTarget(null);
      setRenameName("");
    }
  };

  const handleDeleteSelected = async () => {
    const paths = selectedEntries.map((entry) => entry.path);
    if (paths.length === 0) return;
    const ok = paths.length === 1
      ? await runJsonAction(`${prefix}/files`, "DELETE", { path: paths[0] }, "删除成功")
      : await runJsonAction(`${prefix}/files/batch`, "DELETE", { paths }, "删除成功");
    if (ok) setDeleteOpen(false);
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.paths.length === 0) return;
    const endpoint = clipboard.mode === "copy" ? "copy" : "move";
    const existingNames = new Set(entries.map((entry) => entry.name.toLowerCase()));
    const conflicts = clipboard.paths
      .map(baseName)
      .filter((name) => existingNames.has(name.toLowerCase()));
    let overwrite = false;
    if (conflicts.length > 0) {
      overwrite = window.confirm(
        `目标目录已存在同名项目: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? "..." : ""}\n是否覆盖原文件？`,
      );
      if (!overwrite) return;
    }
    const ok = await runJsonAction(`${prefix}/files/${endpoint}`, "POST", {
      paths: clipboard.paths,
      targetDir: currentPath,
      overwrite,
    }, clipboard.mode === "copy" ? "粘贴成功" : "移动成功");
    if (ok && clipboard.mode === "move") setClipboard(null);
  };

  const handleCompress = async () => {
    if (!archiveName.trim() || selectedEntries.length === 0) return;
    const targetPath = joinPath(currentPath, archiveName.trim());
    const ok = await runJsonAction(`${prefix}/files/compress`, "POST", {
      paths: selectedEntries.map((entry) => entry.path),
      targetPath,
    }, "压缩成功");
    if (ok) setArchiveOpen(false);
  };

  const handleExtract = async (entry: FileEntry) => {
    const extractBody = { path: entry.path, targetDir: currentPath, overwrite: false };
    const data = await fileFetch<{ success: boolean; message?: string; conflict?: boolean; conflicts?: string[] }>(
      `${prefix}/files/extract`,
      {
        method: "POST",
        body: JSON.stringify(extractBody),
      },
    );
    if (data.success) {
      showToast("解压成功", "success");
      fetchDir(currentPath);
      return;
    }
    if (data.conflict) {
      const conflicts = data.conflicts || [];
      const overwrite = window.confirm(
        `目标目录已存在同名项目: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? "..." : ""}\n是否覆盖原文件？`,
      );
      if (!overwrite) return;
      await runJsonAction(`${prefix}/files/extract`, "POST", { ...extractBody, overwrite: true }, "解压成功");
      return;
    }
    showToast(data.message || "解压失败", "error");
  };

  const handleChmod = async () => {
    if (!chmodTarget) return;
    const ok = await runJsonAction(`${prefix}/files/chmod`, "PATCH", {
      path: chmodTarget.path,
      mode: chmodMode.trim(),
      recursive: chmodRecursive,
    }, "权限已更新");
    if (ok) setChmodTarget(null);
  };

  const handleDownload = async (entry: FileEntry) => {
    if (entry.isDirectory) return;
    try {
      const data = await fileFetch<{ success: boolean; data?: string; mimeType?: string; fileName?: string; message?: string }>(
        `${prefix}/files/download?path=${encodeURIComponent(entry.path)}`,
      );
      if (!data.success || !data.data) {
        showToast(data.message || "下载失败", "error");
        return;
      }
      const bytes = Uint8Array.from(atob(data.data), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: data.mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.fileName || entry.name;
      link.click();
      URL.revokeObjectURL(url);
      showToast("下载成功", "success");
    } catch {
      showToast("下载失败", "error");
    }
  };

  const openArchiveDialog = () => {
    if (selectedEntries.length === 0) return;
    const base = selectedEntries.length === 1 ? selectedEntries[0].name.replace(getArchiveExtension(selectedEntries[0].name), "") : "archive";
    const defaultExt = rootPath === "" || /^[A-Za-z]:/.test(currentPath) ? ".zip" : ".tar.gz";
    setArchiveName(`${base}${defaultExt}`);
    setArchiveOpen(true);
  };

  const openProperties = (items = selectedEntries) => {
    setPropertyEntries(items);
    setContextMenu(null);
  };

  const openContextMenu = (event: MouseEvent, entry: FileEntry | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry && !selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
    } else if (!entry) {
      setSelectedPaths(new Set());
    }
    setContextMenu({ x: event.clientX, y: event.clientY, entry });
  };

  const prepareCreate = (kind: "file" | "folder") => {
    setCreateKind(kind);
    setCreateOpen(true);
    setContextMenu(null);
  };

  const prepareRename = (entry: FileEntry | null) => {
    if (!entry) return;
    setRenameTarget(entry);
    setRenameName(entry.name);
    setContextMenu(null);
  };

  const prepareChmod = (entry: FileEntry | null) => {
    if (!entry) return;
    setChmodTarget(entry);
    setChmodMode(entry.mode || "755");
    setChmodRecursive(entry.isDirectory);
    setContextMenu(null);
  };

  const mainActionEntry = singleSelection;
  const contextActionEntry = contextMenu?.entry && selectedPaths.has(contextMenu.entry.path)
    ? singleSelection || contextMenu.entry
    : contextMenu?.entry || singleSelection;
  const propertyItems = propertyEntries || [];
  const propertySingle = propertyItems.length === 1 ? propertyItems[0] : null;
  const propertyTotalSize = propertyItems.reduce((sum, entry) => sum + entry.size, 0);
  const currentNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) : null;

  if (loading) {
    return (
      <div className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-7xl flex-col gap-4 p-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">文件管理</h1>
          <p className="text-sm text-muted-foreground">
            {currentNode ? `${currentNode.name} · ${currentNode.address}` : "主节点"} · {entries.length} 项
          </p>
        </div>

      </div>

      <Card className="flex flex-row min-h-0 flex-1 overflow-hidden p-0 gap-0">
        {treeSidebarOpen && (
          <div className="hidden w-64 shrink-0 flex-col border-r bg-muted/10 md:flex">
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2.5 text-sm font-medium">
              <div className="flex items-center gap-1.5">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <span>文件导航</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {treeRoot ? (
                <FileTreeNode
                  node={treeRoot}
                  depth={0}
                  expandedPaths={expandedPaths}
                  activePath={currentPath}
                  onToggle={(path) => setExpandedPaths((prev) => {
                    const next = new Set(prev);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })}
                  onFileClick={(path) => handleOpenFile(path)}
                  onDirClick={(path) => navigateTo(path)}
                  onLoadChildren={loadTreeChildren}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  加载中...
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          {/* Header row: Nav + Search + Node Select */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5 bg-muted/10">
            <div className="flex items-center gap-1.5 overflow-hidden">
              <Button
                variant="ghost"
                size="icon"
                className="hidden h-8 w-8 md:flex shrink-0 text-muted-foreground"
                title={treeSidebarOpen ? "隐藏文件树" : "显示文件树"}
                onClick={() => setTreeSidebarOpen((value) => !value)}
              >
                {treeSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                onClick={() => currentPath && navigateTo(parentPath(currentPath))}
                disabled={!currentPath}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1 border-l pl-3 ml-1 border-border">
                <Breadcrumb path={currentPath} root={rootPath} onNavigate={navigateTo} />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="relative w-64 max-w-sm hidden sm:block">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input 
                  value={searchTerm} 
                  onChange={(event) => setSearchTerm(event.target.value)} 
                  placeholder="搜索文件..." 
                  className="h-8 pl-8 bg-background border-muted rounded-full text-xs shadow-sm focus-visible:ring-1" 
                />
              </div>
              <div className="h-4 w-px bg-border mx-1 hidden sm:block"></div>
              <select
                value={selectedNodeId || ""}
                onChange={(event) => {
                  setSelectedNodeId(event.target.value || null);
                  setCurrentPath("");
                  setClipboard(null);
                  setTreeRoot(null);
                  setExpandedPaths(new Set());
                }}
                className="h-8 max-w-32 truncate rounded-full border border-input bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring shadow-sm"
              >
                <option value="">主节点</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => { fetchDir(currentPath); if(treeRoot) loadTreeChildren(currentPath); }} disabled={fetching}>
                <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Contextual Action Bar */}
          <div className={`flex shrink-0 items-center gap-2 px-4 py-2 transition-colors duration-300 ${selectedEntries.length > 0 ? "bg-primary/5 border-b border-primary/10" : "bg-background border-b"}`}>
            {selectedEntries.length > 0 ? (
              <div className="flex flex-1 items-center justify-between animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="rounded-sm px-1.5 font-mono text-xs shadow-sm">
                    {selectedEntries.length} 
                  </Badge>
                  <span className="text-sm font-medium text-foreground">项已选择</span>
                  <span className="text-xs text-muted-foreground ml-2 hidden sm:inline-block">({formatBytes(totalSelectedSize)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" className="h-8 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => setClipboard({ mode: "copy", paths: selectedEntries.map((entry) => entry.path) })}>
                    <Copy className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">复制</span>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => setClipboard({ mode: "move", paths: selectedEntries.map((entry) => entry.path) })}>
                    <Scissors className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">剪切</span>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-primary hover:bg-primary/10 hover:text-primary" onClick={openArchiveDialog}>
                    <Archive className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">压缩</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-primary hover:bg-primary/10 hover:text-primary"
                    disabled={!mainActionEntry || !isArchive(mainActionEntry)}
                    onClick={() => mainActionEntry && handleExtract(mainActionEntry)}
                  >
                    <FileArchive className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">解压</span>
                  </Button>
                  {!isWindowsNode && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-primary hover:bg-primary/10 hover:text-primary"
                      disabled={!mainActionEntry}
                      onClick={() => {
                        if (!mainActionEntry) return;
                        setChmodTarget(mainActionEntry);
                        setChmodMode(mainActionEntry.mode || "755");
                        setChmodRecursive(mainActionEntry.isDirectory);
                      }}
                    >
                      <ShieldCheck className="h-4 w-4 sm:mr-1.5" />
                      <span className="hidden sm:inline">权限</span>
                    </Button>
                  )}
                  <div className="h-4 w-px bg-primary/20 mx-1"></div>
                  <Button size="sm" variant="ghost" className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">删除</span>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 ml-1" onClick={() => setSelectedPaths(new Set())}>
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-between animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files) uploadFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full" onClick={() => uploadInputRef.current?.click()}>
                    <UploadCloud className="h-4 w-4" />
                    上传
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full shadow-sm bg-background hover:bg-muted" onClick={() => setTransferDialogOpen(true)}>
                    <ArrowLeftRight className="h-4 w-4 text-primary" />
                    节点互传
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" className="h-8 gap-1.5 rounded-full px-4 shadow-sm bg-primary text-primary-foreground hover:bg-primary/90">
                        <FilePlus className="h-4 w-4" />
                        新建 <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-40">
                      <DropdownMenuItem onClick={() => { setCreateKind("file"); setCreateOpen(true); }}>
                        <FileText className="mr-2 h-4 w-4 text-blue-500" />
                        新建文件
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setCreateKind("folder"); setCreateOpen(true); }}>
                        <FolderPlus className="mr-2 h-4 w-4 text-yellow-500" />
                        新建文件夹
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="h-4 w-px bg-border mx-1 hidden sm:block"></div>

                  <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground" disabled={!clipboard} onClick={handlePaste}>
                    <ClipboardPaste className="h-4 w-4" />
                    粘贴
                    {clipboard && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1 font-mono text-[10px]">
                        {clipboard.paths.length}
                      </Badge>
                    )}
                  </Button>
                </div>
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {clipboard && (
                    <span className="flex items-center gap-1 bg-muted/50 rounded-full px-2 py-0.5">
                      <span className="text-[10px]">
                        剪贴板: {clipboard.mode === "copy" ? "复制" : "剪切"} {clipboard.paths.length} 项
                      </span>
                      <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 rounded-full hover:bg-muted" onClick={() => setClipboard(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          <CardContent
            className="relative flex min-h-0 flex-1 flex-col p-0"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {dragActive && (
              <div className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-primary shadow-sm backdrop-blur-sm">
                <UploadCloud className="mb-3 h-10 w-10" />
                <div className="text-base font-medium">释放文件上传到当前目录</div>
                <div className="mt-1 text-xs text-primary/80">{currentPath || "/"}</div>
              </div>
            )}
            <div
              ref={fileListScrollRef}
              className="min-h-0 flex-1 overflow-auto"
              onContextMenu={(event) => openContextMenu(event, null)}
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-popover">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allVisibleSelected} onChange={toggleSelectAllVisible} aria-label="选择全部" />
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center gap-1" onClick={() => setSort("name")}>
                        名称 <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="hidden w-32 md:table-cell">
                      <button className="flex items-center gap-1" onClick={() => setSort("type")}>
                        类型 <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="hidden w-28 text-right sm:table-cell">
                      <button className="ml-auto flex items-center gap-1" onClick={() => setSort("size")}>
                        大小 <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="hidden w-44 lg:table-cell">
                      <button className="flex items-center gap-1" onClick={() => setSort("modified")}>
                        修改时间 <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    {!isWindowsNode && <TableHead className="hidden w-32 xl:table-cell">权限</TableHead>}
                    <TableHead className="w-44 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fetching ? (
                    Array.from({ length: 8 }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={tableColumnCount}><Skeleton className="h-7 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : visibleEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tableColumnCount}>
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                          <FolderOpen className="mb-2 h-10 w-10 opacity-30" />
                          <span>{searchTerm ? "没有匹配的文件" : "此目录为空"}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleEntries.map((entry) => {
                      const selected = selectedPaths.has(entry.path);
                      return (
                        <TableRow
                          key={entry.path}
                          data-state={selected ? "selected" : undefined}
                          className="cursor-pointer group"
                          onDoubleClick={() => !entry.isDirectory && handleOpenFile(entry)}
                          onClick={() => {
                            if (entry.isDirectory) navigateTo(entry.path);
                            else setSelectedPaths(new Set([entry.path]));
                          }}
                          onContextMenu={(event) => openContextMenu(event, entry)}
                        >
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            <Checkbox checked={selected} onChange={() => toggleSelect(entry.path)} aria-label={`选择 ${entry.name}`} />
                          </TableCell>
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-2">
                              {getFileIcon(entry)}
                              <span className="truncate font-medium">{entry.name}</span>
                              {isArchive(entry) && <Badge variant="outline">压缩包</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            {entry.isDirectory ? "文件夹" : entry.extension || "文件"}
                          </TableCell>
                          <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                            {entry.isDirectory ? "-" : formatBytes(entry.size)}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground lg:table-cell">
                            {formatDate(entry.modified)}
                          </TableCell>
                          {!isWindowsNode && (
                            <TableCell className="hidden font-mono text-xs text-muted-foreground xl:table-cell">
                              {entry.mode || entry.permissions || "-"}
                            </TableCell>
                          )}
                          <TableCell>
                            <div className={`flex justify-end gap-1 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                              {entry.isDirectory ? (
                                <Button variant="ghost" size="icon-sm" title="打开" onClick={(event) => { event.stopPropagation(); navigateTo(entry.path); }}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              ) : (
                                <>
                                  <Button variant="ghost" size="icon-sm" title="编辑" disabled={!canEdit(entry)} onClick={(event) => { event.stopPropagation(); handleOpenFile(entry); }}>
                                    <Edit3 className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon-sm" title="下载" onClick={(event) => { event.stopPropagation(); handleDownload(entry); }}>
                                    <Download className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                              <Button variant="ghost" size="icon-sm" title="重命名" onClick={(event) => { event.stopPropagation(); setRenameTarget(entry); setRenameName(entry.name); }}>
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon-sm" title="删除" className="text-destructive hover:text-destructive" onClick={(event) => { event.stopPropagation(); setSelectedPaths(new Set([entry.path])); setDeleteOpen(true); }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {uploadTasks.length > 0 && (
              <div className="max-h-44 shrink-0 overflow-auto border-t bg-muted/20 px-4 py-2">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>上传队列</span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setUploadTasks((prev) => prev.filter((task) => task.status === "uploading"))}>
                    清除完成项
                  </Button>
                </div>
                <div className="space-y-2">
                  {uploadTasks.map((task) => {
                    const progress = task.size > 0 ? Math.min(100, Math.round((task.uploaded / task.size) * 100)) : 100;
                    return (
                      <div key={task.id} className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="truncate font-medium">{task.name}</span>
                          <span className={task.status === "error" ? "text-destructive" : task.status === "success" ? "text-emerald-600" : "text-muted-foreground"}>
                            {task.status === "error" ? task.message || "失败" : task.status === "success" ? "完成" : `${progress}%`}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full transition-all ${task.status === "error" ? "bg-destructive" : task.status === "success" ? "bg-emerald-500" : "bg-primary"}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {formatBytes(task.uploaded)} / {formatBytes(task.size)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex shrink-0 items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>{entries.filter((entry) => entry.isDirectory).length} 个文件夹 · {entries.filter((entry) => !entry.isDirectory).length} 个文件</span>
              <span>排序：{sortField} {sortAsc ? "升序" : "降序"}</span>
            </div>
          </CardContent>
        </div>
      </Card>

      {contextMenu && (
        <div
          className="fixed z-50 w-56 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 240)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 420)),
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextActionEntry && (
            <>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                disabled={!contextActionEntry.isDirectory && !canEdit(contextActionEntry)}
                onClick={() => {
                  setContextMenu(null);
                  if (contextActionEntry.isDirectory) navigateTo(contextActionEntry.path);
                  else handleOpenFile(contextActionEntry);
                }}
              >
                <Eye className="h-4 w-4" />
                {contextActionEntry.isDirectory ? "打开" : "编辑"}
              </button>
              {!contextActionEntry.isDirectory && (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => {
                    setContextMenu(null);
                    handleDownload(contextActionEntry);
                  }}
                >
                  <Download className="h-4 w-4" />
                  下载
                </button>
              )}
              <div className="my-1 h-px bg-border" />
            </>
          )}

          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={selectedEntries.length === 0}
            onClick={() => {
              setClipboard({ mode: "copy", paths: selectedEntries.map((entry) => entry.path) });
              setContextMenu(null);
            }}
          >
            <Copy className="h-4 w-4" />
            复制
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={selectedEntries.length === 0}
            onClick={() => {
              setClipboard({ mode: "move", paths: selectedEntries.map((entry) => entry.path) });
              setContextMenu(null);
            }}
          >
            <Scissors className="h-4 w-4" />
            剪切
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={!clipboard}
            onClick={() => {
              setContextMenu(null);
              handlePaste();
            }}
          >
            <ClipboardPaste className="h-4 w-4" />
            粘贴
          </button>

          <div className="my-1 h-px bg-border" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => prepareCreate("file")}
          >
            <FilePlus className="h-4 w-4" />
            新建文件
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => prepareCreate("folder")}
          >
            <FolderPlus className="h-4 w-4" />
            新建文件夹
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={selectedEntries.length === 0}
            onClick={() => {
              setContextMenu(null);
              openArchiveDialog();
            }}
          >
            <Archive className="h-4 w-4" />
            压缩
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={!contextActionEntry || !isArchive(contextActionEntry)}
            onClick={() => {
              if (!contextActionEntry) return;
              setContextMenu(null);
              handleExtract(contextActionEntry);
            }}
          >
            <FileArchive className="h-4 w-4" />
            解压
          </button>

          <div className="my-1 h-px bg-border" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={!contextActionEntry || selectedEntries.length !== 1}
            onClick={() => prepareRename(contextActionEntry || null)}
          >
            <Edit3 className="h-4 w-4" />
            重命名
          </button>
          {!isWindowsNode && (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              disabled={!contextActionEntry || selectedEntries.length !== 1}
              onClick={() => prepareChmod(contextActionEntry || null)}
            >
              <ShieldCheck className="h-4 w-4" />
              权限
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => openProperties(selectedEntries.length > 0 ? selectedEntries : [])}
          >
            <Info className="h-4 w-4" />
            属性
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
            disabled={selectedEntries.length === 0}
            onClick={() => {
              setDeleteOpen(true);
              setContextMenu(null);
            }}
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
        </div>
      )}

      <Dialog open={!!openFile} onOpenChange={(open) => { if (!open) closeFile(); }}>
        <DialogContent showCloseButton={false} className="flex h-[85vh] w-[95vw] flex-col gap-0 p-0 sm:max-w-[95vw]">
          <DialogHeader className="sr-only">
            <DialogTitle>编辑文件 - {openFile ? openFile.split("/").pop() : ""}</DialogTitle>
          </DialogHeader>
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-blue-500" />
              <span className="truncate text-sm font-medium">{openFile ? openFile.split("/").pop() : ""}</span>
              {fileContent !== originalContent && <Badge variant="outline">未保存</Badge>}
              {fileMeta && <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(fileMeta.size)}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" title={treeSidebarOpen ? "隐藏文件树" : "显示文件树"} onClick={() => setTreeSidebarOpen((value) => !value)}>
                {treeSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" title="保存" disabled={fileContent === originalContent || saving} onClick={handleSave}>
                <Save className={`h-4 w-4 ${saving ? "animate-pulse" : ""}`} />
              </Button>
              <Button variant="ghost" size="icon" title="关闭" onClick={closeFile}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            {treeSidebarOpen && treeRoot && (
              <div className="flex w-64 shrink-0 flex-col border-r bg-muted/10">
                <div className="border-b p-2 text-xs font-medium text-muted-foreground">文件浏览器</div>
                <div className="flex-1 overflow-auto p-1">
                  <FileTreeNode
                    node={treeRoot}
                    depth={0}
                    expandedPaths={expandedPaths}
                    activePath={openFile}
                    onToggle={(path) => setExpandedPaths((prev) => {
                      const next = new Set(prev);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })}
                    onFileClick={handleOpenFile}
                    onLoadChildren={loadTreeChildren}
                  />
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1">
              {fileLoading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                  加载中...
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
                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => handleSave());
                  }}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createKind === "folder" ? "新建文件夹" : "新建文件"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Button variant={createKind === "file" ? "default" : "outline"} size="sm" onClick={() => setCreateKind("file")}>文件</Button>
              <Button variant={createKind === "folder" ? "default" : "outline"} size="sm" onClick={() => setCreateKind("folder")}>文件夹</Button>
            </div>
            <Input placeholder={createKind === "folder" ? "文件夹名称" : "文件名，例如 app.conf"} value={createName} onChange={(event) => setCreateName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleCreate(); }} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!createName.trim()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={() => setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>重命名</DialogTitle></DialogHeader>
          <Input value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleRename(); }} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button onClick={handleRename} disabled={!renameName.trim()}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            将删除 <span className="font-medium text-foreground">{selectedEntries.length}</span> 个项目。目录会连同其中内容一起删除，此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDeleteSelected}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>压缩选中项目</DialogTitle></DialogHeader>
          <Input value={archiveName} onChange={(event) => setArchiveName(event.target.value)} placeholder="archive.zip 或 archive.tar.gz" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>取消</Button>
            <Button onClick={handleCompress} disabled={!archiveName.trim()}>压缩</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!chmodTarget} onOpenChange={() => setChmodTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>权限设置</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Input value={chmodMode} onChange={(event) => setChmodMode(event.target.value)} placeholder="755" />
            {chmodTarget?.isDirectory && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={chmodRecursive} onChange={(event) => setChmodRecursive(event.currentTarget.checked)} />
                递归应用到目录内容
              </label>
            )}
            <p className="text-xs text-muted-foreground">仅 Linux/Unix 节点支持 chmod。Windows 节点会返回不支持提示。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChmodTarget(null)}>取消</Button>
            <Button onClick={handleChmod} disabled={!/^[0-7]{3,4}$/.test(chmodMode.trim())}>应用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={propertyEntries !== null} onOpenChange={() => setPropertyEntries(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>属性</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              {propertySingle ? getFileIcon(propertySingle) : <FolderOpen className="h-5 w-5 text-yellow-500" />}
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {propertySingle?.name || (propertyItems.length > 0 ? `${propertyItems.length} 个项目` : "当前目录")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {propertyItems.length > 0 ? formatBytes(propertyTotalSize) : currentPath || "/"}
                </div>
              </div>
            </div>
            <dl className="space-y-2">
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">路径</dt>
                <dd className="truncate font-mono text-xs">{propertySingle?.path || currentPath || "/"}</dd>
              </div>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">类型</dt>
                <dd>{propertySingle ? (propertySingle.isDirectory ? "文件夹" : propertySingle.mimeType || propertySingle.extension || "文件") : propertyItems.length > 0 ? "多选" : "目录"}</dd>
              </div>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">大小</dt>
                <dd>{propertyItems.length === 0 || propertySingle?.isDirectory ? "-" : formatBytes(propertyTotalSize)}</dd>
              </div>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">权限</dt>
                <dd className="font-mono text-xs">{propertySingle?.mode || propertySingle?.permissions || "-"}</dd>
              </div>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
                <dt className="text-muted-foreground">修改时间</dt>
                <dd>{propertySingle ? formatDate(propertySingle.modified) : "-"}</dd>
              </div>
            </dl>
          </div>
          <DialogFooter>
            <Button onClick={() => setPropertyEntries(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      
      <NodeFileTransferDialog 
        open={transferDialogOpen} 
        onOpenChange={setTransferDialogOpen} 
        nodes={nodes} 
      />
    </div>
  );
}
