import { Elysia, t } from "elysia";
import { logger } from "../logger/index";
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  renameSync,
  existsSync,
} from "fs";
import { join, extname, basename, dirname, relative, resolve, sep } from "path";
import { lookup } from "mime-types";

// Windows 使用虚拟根目录（空字符串），支持多盘符切换
const IS_WINDOWS = process.platform === "win32";
const FILE_ROOT = process.env.FILE_ROOT || (IS_WINDOWS ? "" : "/");

// Windows 盘符虚拟根目录：列出所有可用盘符
function listDrives(): FileEntry[] {
  const drives: FileEntry[] = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const mount = `${letter}:\\`;
    try {
      if (!existsSync(mount)) continue;
      const stats = statSync(mount);
      drives.push({
        name: `${letter}:`,
        path: `${letter}:`,
        isDirectory: true,
        size: 0,
        modified: stats.mtimeMs,
        extension: "",
        mimeType: false,
      });
    } catch {
      // 跳过不可访问的盘符
    }
  }
  return drives;
}

/** 安全路径解析：防止路径穿越，支持 Windows 多盘符 */
function safePath(requestedPath: string): string | null {
  if (!FILE_ROOT) {
    // Windows 虚拟根目录模式
    const normalizedPath = requestedPath.replace(/\//g, "\\");

    // 空路径 = 虚拟根目录本身
    if (!normalizedPath || normalizedPath === "" || normalizedPath === "\\") {
      return "";
    }

    const driveMatch = normalizedPath.match(/^([A-Za-z]):\\?$/);
    if (driveMatch) {
      const driveRoot = `${driveMatch[1].toUpperCase()}:\\`;
      if (existsSync(driveRoot)) return driveRoot;
      return null;
    }

    // 子路径，如 D:\some\dir
    const driveMatch2 = normalizedPath.match(/^([A-Za-z]):\\/);
    if (driveMatch2) {
      const driveRoot = `${driveMatch2[1].toUpperCase()}:\\`;
      const resolvedPath = resolve(driveRoot, normalizedPath.slice(3));
      if (resolvedPath.startsWith(driveRoot) || resolvedPath === driveRoot.slice(0, -1)) {
        return resolvedPath;
      }
    }
    return null;
  }

  // 标准路径模式（Linux 或自定义 FILE_ROOT）
  const resolved = resolve(FILE_ROOT, requestedPath.replace(/^\/+/, ""));
  const rootWithSep = FILE_ROOT.endsWith(sep) ? FILE_ROOT : FILE_ROOT + sep;
  if (resolved === resolve(FILE_ROOT) || resolved.startsWith(rootWithSep)) {
    return resolved;
  }
  if (FILE_ROOT === "/" && resolved.startsWith("/")) {
    return resolved;
  }
  return null;
}

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
  extension: string;
  mimeType: string | false;
}

const TEXT_EXTENSIONS = new Set([
  ".txt", ".log", ".md", ".json", ".yml", ".yaml", ".xml", ".toml",
  ".ini", ".conf", ".cfg", ".env", ".sh", ".bash", ".zsh", ".fish",
  ".py", ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".less",
  ".html", ".htm", ".vue", ".svelte", ".go", ".rs", ".rb", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".sql", ".graphql",
  ".csv", ".tsv", ".properties", ".gitignore", ".dockerignore",
  ".dockerfile", ".makefile", ".editorconfig", ".prettierrc",
  ".eslintrc", ".babelrc", ".lock", ".diff", ".patch",
]);

const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (ext === "") {
    try {
      const buf = readFileSync(filePath);
      const sample = buf.slice(0, 512);
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** 为目录内的文件条目计算前端可用的相对路径 */
function computeEntryPath(dirPath: string, fullPath: string): string {
  if (!FILE_ROOT && IS_WINDOWS) {
    // Windows 虚拟根模式：以盘符根目录为基准（如 D:\），生成子路径
    const driveRoot = dirPath.match(/^([A-Za-z]:\\)/)?.[1] || dirPath;
    const rel = relative(driveRoot, fullPath).replace(/\\/g, "/");
    return rel ? `${driveRoot.slice(0, 2)}/${rel}` : `${driveRoot.slice(0, 2)}`;
  }
  return relative(FILE_ROOT, fullPath).replace(/\\/g, "/");
}

function listDirectory(dirPath: string): FileEntry[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const result: FileEntry[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    try {
      const stats = statSync(fullPath);
      const ext = entry.isDirectory() ? "" : extname(entry.name).toLowerCase();
      result.push({
        name: entry.name,
        path: computeEntryPath(dirPath, fullPath),
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : stats.size,
        modified: stats.mtimeMs,
        extension: ext,
        mimeType: entry.isDirectory() ? false : (lookup(entry.name) || false),
      });
    } catch {
      continue;
    }
  }

  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN", { sensitivity: "base" });
  });

  return result;
}

/** 判断当前请求路径是否为虚拟根目录 */
function isVirtualRoot(requestedPath: string): boolean {
  return !FILE_ROOT && (!requestedPath || requestedPath === "" || requestedPath === "/");
}

export const fileRoutes = new Elysia()
  .resolve(async ({ jwt, request }: any) => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { profile: null };
    const profile = await jwt.verify(token);
    return { profile };
  })

  // 列出目录内容
  .get("/api/files", ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const requestedPath = (query.path as string) || "";

    // Windows 虚拟根目录：返回盘符列表
    if (isVirtualRoot(requestedPath)) {
      return {
        success: true,
        path: "",
        root: "",
        entries: listDrives(),
      };
    }

    const realPath = safePath(requestedPath);
    if (!realPath) return { success: false, message: "路径不允许" };
    if (!existsSync(realPath)) return { success: false, message: "路径不存在" };

    try {
      const stat = statSync(realPath);
      if (!stat.isDirectory()) return { success: false, message: "不是目录" };

      const entries = listDirectory(realPath);
      return {
        success: true,
        path: requestedPath,
        root: FILE_ROOT || "",
        entries,
      };
    } catch (e: any) {
      logger.err(`文件列表失败: ${e.message}`);
      return { success: false, message: `读取失败: ${e.message}` };
    }
  })

  // 读取文件内容（文本文件）
  .get("/api/files/read", ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const requestedPath = query.path as string;
    if (!requestedPath) return { success: false, message: "缺少 path 参数" };

    const realPath = safePath(requestedPath);
    if (!realPath) return { success: false, message: "路径不允许" };
    if (!existsSync(realPath)) return { success: false, message: "文件不存在" };

    try {
      const stats = statSync(realPath);
      if (stats.isDirectory()) return { success: false, message: "是目录而非文件" };
      if (!isTextFile(realPath)) return { success: false, message: "不支持的文件类型（二进制文件）" };
      if (stats.size > MAX_TEXT_FILE_SIZE) return { success: false, message: `文件过大（${(stats.size / 1024 / 1024).toFixed(1)} MB），最大支持 10 MB` };

      const content = readFileSync(realPath, "utf-8");
      return {
        success: true,
        content,
        path: requestedPath,
        size: stats.size,
        modified: stats.mtimeMs,
        extension: extname(realPath).toLowerCase(),
      };
    } catch (e: any) {
      logger.err(`文件读取失败: ${e.message}`);
      return { success: false, message: `读取失败: ${e.message}` };
    }
  })

  // 保存/写入文件内容
  .put("/api/files/write", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { path: requestedPath, content } = body;
    if (!requestedPath) return { success: false, message: "缺少 path" };

    const realPath = safePath(requestedPath);
    if (!realPath) return { success: false, message: "路径不允许" };

    try {
      const parentDir = dirname(realPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      writeFileSync(realPath, content, "utf-8");
      logger.info(`文件已保存: ${requestedPath}`);
      return { success: true, message: "保存成功" };
    } catch (e: any) {
      logger.err(`文件写入失败: ${e.message}`);
      return { success: false, message: `写入失败: ${e.message}` };
    }
  })

  // 创建目录
  .post("/api/files/mkdir", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { path: requestedPath } = body;
    if (!requestedPath) return { success: false, message: "缺少 path" };

    const realPath = safePath(requestedPath);
    if (!realPath) return { success: false, message: "路径不允许" };

    try {
      if (existsSync(realPath)) return { success: false, message: "路径已存在" };
      mkdirSync(realPath, { recursive: true });
      logger.info(`目录已创建: ${requestedPath}`);
      return { success: true, message: "创建成功" };
    } catch (e: any) {
      logger.err(`目录创建失败: ${e.message}`);
      return { success: false, message: `创建失败: ${e.message}` };
    }
  })

  // 删除文件或目录
  .delete("/api/files", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { path: requestedPath } = body;
    if (!requestedPath) return { success: false, message: "缺少 path" };

    const realPath = safePath(requestedPath);
    if (!realPath) return { success: false, message: "路径不允许" };
    if (!existsSync(realPath)) return { success: false, message: "路径不存在" };

    try {
      const stats = statSync(realPath);
      if (stats.isDirectory()) {
        const { rmSync } = require("fs");
        rmSync(realPath, { recursive: true, force: true });
      } else {
        unlinkSync(realPath);
      }
      logger.info(`已删除: ${requestedPath}`);
      return { success: true, message: "删除成功" };
    } catch (e: any) {
      logger.err(`删除失败: ${e.message}`);
      return { success: false, message: `删除失败: ${e.message}` };
    }
  })

  // 重命名
  .patch("/api/files/rename", async ({ body, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { from, to } = body;
    if (!from || !to) return { success: false, message: "缺少 from/to 参数" };

    const fromPath = safePath(from);
    const toPath = safePath(to);
    if (!fromPath || !toPath) return { success: false, message: "路径不允许" };
    if (!existsSync(fromPath)) return { success: false, message: "源路径不存在" };
    if (existsSync(toPath)) return { success: false, message: "目标路径已存在" };

    try {
      renameSync(fromPath, toPath);
      logger.info(`重命名: ${from} -> ${to}`);
      return { success: true, message: "重命名成功" };
    } catch (e: any) {
      logger.err(`重命名失败: ${e.message}`);
      return { success: false, message: `重命名失败: ${e.message}` };
    }
  })

  // 下载文件（返回 base64 内容，避免 Elysia 不支持 Stream 的限制）
  .get("/api/files/download", ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const requestedPath = query.path as string;
    if (!requestedPath) return { success: false, message: "缺少 path 参数" };

    const realPath = safePath(requestedPath);
    if (!realPath) return { success: false, message: "路径不允许" };
    if (!existsSync(realPath)) return { success: false, message: "文件不存在" };

    try {
      const stats = statSync(realPath);
      if (stats.isDirectory()) return { success: false, message: "是目录而非文件" };

      if (stats.size > 100 * 1024 * 1024) {
        return { success: false, message: "文件过大，暂不支持下载超过 100 MB 的文件" };
      }

      const buffer = readFileSync(realPath);
      const base64 = buffer.toString("base64");
      const mimeType = lookup(realPath) || "application/octet-stream";

      return {
        success: true,
        data: base64,
        mimeType,
        fileName: basename(realPath),
        size: stats.size,
      };
    } catch (e: any) {
      logger.err(`下载失败: ${e.message}`);
      return { success: false, message: `下载失败: ${e.message}` };
    }
  });