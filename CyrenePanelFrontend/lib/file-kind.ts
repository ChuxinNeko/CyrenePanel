/**
 * 文件打开模式判定（前端单源）
 * - text: Monaco 编辑
 * - image / video / audio: 预览
 * - binary: 仅下载
 */

export type FileKind = "text" | "image" | "video" | "audio" | "binary";

export const TEXT_EXTENSIONS = new Set([
  ".txt", ".log", ".md", ".json", ".yml", ".yaml", ".xml", ".toml",
  ".ini", ".conf", ".cfg", ".env", ".sh", ".bash", ".zsh", ".fish",
  ".py", ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".less",
  ".html", ".htm", ".vue", ".svelte", ".go", ".rs", ".rb", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".sql", ".graphql",
  ".csv", ".tsv", ".properties", ".gitignore", ".dockerignore",
  ".dockerfile", ".makefile", ".editorconfig", ".prettierrc", ".eslintrc",
  ".babelrc", ".lock", ".diff", ".patch", "",
]);

export const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif",
]);

export const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".webm", ".ogv", ".mov", ".m4v",
]);

export const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".wav", ".ogg", ".oga", ".flac", ".aac", ".m4a", ".opus",
]);

/** 预览体积上限：避免浏览器一次拉过大文件 */
export const PREVIEW_SIZE_LIMITS: Record<"image" | "video" | "audio", number> = {
  image: 30 * 1024 * 1024,
  // 视频走 Range，可放宽；仍给上限防止误点超大文件
  video: 500 * 1024 * 1024,
  audio: 80 * 1024 * 1024,
};

export interface FileKindInput {
  name?: string;
  path?: string;
  extension?: string;
  mimeType?: string | false | null;
  isDirectory?: boolean;
  size?: number;
}

function normalizeExt(input: FileKindInput): string {
  if (input.extension) {
    const ext = input.extension.toLowerCase();
    return ext.startsWith(".") ? ext : `.${ext}`;
  }
  const name = input.name || input.path || "";
  const base = name.replace(/\\/g, "/").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

function kindFromMime(mime: string): FileKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
    return "text";
  }
  return null;
}

export function resolveFileKind(input: FileKindInput): FileKind {
  if (input.isDirectory) return "binary";

  const mime = typeof input.mimeType === "string" ? input.mimeType.toLowerCase() : "";
  if (mime) {
    const fromMime = kindFromMime(mime);
    if (fromMime) return fromMime;
  }

  const ext = normalizeExt(input);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "binary";
}

export function canEditFile(input: FileKindInput): boolean {
  return !input.isDirectory && resolveFileKind(input) === "text";
}

export function canPreviewFile(input: FileKindInput): boolean {
  if (input.isDirectory) return false;
  const kind = resolveFileKind(input);
  return kind === "image" || kind === "video" || kind === "audio";
}

export function getPreviewSizeLimit(kind: FileKind): number | null {
  if (kind === "image" || kind === "video" || kind === "audio") {
    return PREVIEW_SIZE_LIMITS[kind];
  }
  return null;
}

/** 超限时返回错误文案；通过则返回 null */
export function checkPreviewSize(kind: FileKind, size: number): string | null {
  const limit = getPreviewSizeLimit(kind);
  if (limit == null) return "该类型不支持预览";
  if (size > limit) {
    const mb = (size / 1024 / 1024).toFixed(1);
    const limitMb = (limit / 1024 / 1024).toFixed(0);
    return `文件过大（${mb} MB），${kind} 预览上限 ${limitMb} MB，请下载查看`;
  }
  return null;
}

export function getMonacoLanguage(ext: string): string {
  const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
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
  return map[normalized] || "plaintext";
}