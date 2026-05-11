import { Elysia, t } from "elysia";
import { logger } from "../logger/index";
import { auditLog, getRequestIp } from "../audit/index";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  renameSync,
  existsSync,
  rmSync,
  openSync,
  closeSync,
  writeSync,
  ftruncateSync,
} from "fs";
import { join, extname, basename, dirname, relative, resolve, sep } from "path";
import { execFileSync } from "child_process";
import { lookup } from "mime-types";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

// 节点互传产生的临时压缩包：通过 useTempDir 写入系统 temp，
// 通过这个集合放行后续 download / extract / delete 的 safePath 检查。
const TRANSFER_TEMP_DIR = join(tmpdir(), "cyrene-transfer");
const transferTempPaths = new Set<string>();

// 启动时清理上次运行残留的临时压缩包
try {
  if (existsSync(TRANSFER_TEMP_DIR)) {
    rmSync(TRANSFER_TEMP_DIR, { recursive: true, force: true });
  }
} catch {
  // ignore
}

function isTransferTempPath(realPath: string): boolean {
  if (!realPath) return false;
  return transferTempPaths.has(realPath);
}

function resolveAccessiblePath(requestedPath: string): string | null {
  // 1. transfer 临时目录优先：直接绝对路径匹配
  const direct = resolve(requestedPath);
  if (isTransferTempPath(direct)) return direct;
  // 2. 兜底走标准 safePath 检查
  return safePath(requestedPath);
}

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
      const mode = stats.mode & 0o777;
      drives.push({
        name: `${letter}:`,
        path: `${letter}:`,
        isDirectory: true,
        size: 0,
        modified: stats.mtimeMs,
        extension: "",
        mimeType: false,
        mode: mode.toString(8).padStart(3, "0"),
        permissions: modeToPermissions(stats.mode, true),
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
  mode?: string;
  permissions?: string;
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

function modeToPermissions(mode: number, isDirectory: boolean): string {
  const flags = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  const chars = ["r", "w", "x", "r", "w", "x", "r", "w", "x"];
  return `${isDirectory ? "d" : "-"}${flags
    .map((flag, index) => (mode & flag ? chars[index] : "-"))
    .join("")}`;
}

function entryFromStats(
  name: string,
  entryPath: string,
  fullPath: string,
  isDirectory: boolean,
): FileEntry {
  const stats = statSync(fullPath);
  const mode = stats.mode & 0o777;
  return {
    name,
    path: entryPath,
    isDirectory,
    size: isDirectory ? 0 : stats.size,
    modified: stats.mtimeMs,
    extension: isDirectory ? "" : extname(name).toLowerCase(),
    mimeType: isDirectory ? false : (lookup(name) || false),
    mode: mode.toString(8).padStart(3, "0"),
    permissions: modeToPermissions(stats.mode, isDirectory),
  };
}

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
      result.push(
        entryFromStats(
          entry.name,
          computeEntryPath(dirPath, fullPath),
          fullPath,
          entry.isDirectory(),
        ),
      );
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

function requestParentPath(requestedPath: string): string {
  const normalized = requestedPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function joinRequestPath(dirPath: string, name: string): string {
  const cleanDir = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return cleanDir ? `${cleanDir}/${name}` : name;
}

function ensureSafeFilePath(requestedPath: string): string {
  const realPath = safePath(requestedPath);
  if (!realPath) throw new Error("路径不允许");
  if (!existsSync(realPath)) throw new Error("路径不存在");
  return realPath;
}

function ensureSafeUploadTarget(requestedPath: string): string {
  if (!requestedPath || requestedPath.endsWith("/") || requestedPath.endsWith("\\")) {
    throw new Error("缺少文件名");
  }
  const realPath = safePath(requestedPath);
  if (!realPath) throw new Error("路径不允许");
  const parentDir = dirname(realPath);
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
  if (!statSync(parentDir).isDirectory()) throw new Error("目标目录无效");
  if (existsSync(realPath) && statSync(realPath).isDirectory()) throw new Error("目标是目录而非文件");
  return realPath;
}

function decodeBase64Chunk(data: string): Buffer {
  if (typeof data !== "string") throw new Error("分片内容无效");
  const commaIndex = data.indexOf(",");
  const raw = commaIndex >= 0 ? data.slice(commaIndex + 1) : data;
  return Buffer.from(raw, "base64");
}

function getUploadStatus(requestedPath: string, totalSize?: number) {
  const realPath = ensureSafeUploadTarget(requestedPath);
  const uploaded = existsSync(realPath) ? statSync(realPath).size : 0;
  return {
    success: true,
    uploaded: typeof totalSize === "number" && totalSize >= 0 ? Math.min(uploaded, totalSize) : uploaded,
    exists: existsSync(realPath),
  };
}

function writeUploadChunk(requestedPath: string, offset: number, totalSize: number, chunkBase64: string) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset 无效");
  if (!Number.isSafeInteger(totalSize) || totalSize < 0) throw new Error("totalSize 无效");

  const realPath = ensureSafeUploadTarget(requestedPath);
  const chunk = decodeBase64Chunk(chunkBase64);
  if (offset + chunk.length > totalSize) throw new Error("分片超过文件总大小");

  const currentSize = existsSync(realPath) ? statSync(realPath).size : 0;
  if (currentSize !== offset) {
    return {
      success: false,
      resumable: true,
      uploaded: Math.min(currentSize, totalSize),
      message: "上传偏移不匹配，已返回当前进度",
    };
  }

  const fd = openSync(realPath, "a");
  try {
    writeSync(fd, chunk, 0, chunk.length);
  } finally {
    closeSync(fd);
  }

  const uploaded = statSync(realPath).size;
  if (uploaded === totalSize) {
    const truncateFd = openSync(realPath, "r+");
    try {
      ftruncateSync(truncateFd, totalSize);
    } finally {
      closeSync(truncateFd);
    }
  }
  return {
    success: true,
    uploaded,
    complete: uploaded >= totalSize,
    message: uploaded >= totalSize ? "上传完成" : "分片已上传",
  };
}

function removePath(realPath: string) {
  const stats = statSync(realPath);
  if (stats.isDirectory()) rmSync(realPath, { recursive: true, force: true });
  else unlinkSync(realPath);
}

function uniqueDestination(targetPath: string): string {
  if (!existsSync(targetPath)) return targetPath;
  const folder = dirname(targetPath);
  const ext = extname(targetPath);
  const stem = basename(targetPath, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = join(folder, `${stem} - copy${i === 1 ? "" : ` ${i}`}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("无法生成不冲突的目标名称");
}

function copyPath(sourcePath: string, targetDir: string, overwrite = false) {
  const stats = statSync(sourcePath);
  let destination = join(targetDir, basename(sourcePath));
  if (resolve(sourcePath) === resolve(destination)) {
    if (overwrite) return;
    destination = uniqueDestination(destination);
  }
  if (existsSync(destination)) {
    if (overwrite) removePath(destination);
    else destination = uniqueDestination(destination);
  }

  if (stats.isDirectory()) {
    cpSync(sourcePath, destination, { recursive: true, errorOnExist: false });
  } else {
    copyFileSync(sourcePath, destination);
  }
}

function movePath(sourcePath: string, targetDir: string, overwrite = false) {
  let destination = join(targetDir, basename(sourcePath));
  if (resolve(sourcePath) === resolve(destination)) return;
  const stats = statSync(sourcePath);
  if (stats.isDirectory()) {
    const sourceWithSep = sourcePath.endsWith(sep) ? sourcePath : sourcePath + sep;
    const destinationWithSep = destination.endsWith(sep) ? destination : destination + sep;
    if (destinationWithSep.startsWith(sourceWithSep)) {
      throw new Error("不能将目录移动到自身内部");
    }
  }
  if (existsSync(destination)) {
    if (overwrite) removePath(destination);
    else destination = uniqueDestination(destination);
  }

  try {
    renameSync(sourcePath, destination);
  } catch (e: any) {
    if (e?.code !== "EXDEV") throw e;
    copyPath(sourcePath, targetDir, overwrite);
    removePath(sourcePath);
  }
}

function applyModeRecursive(realPath: string, mode: number) {
  chmodSync(realPath, mode);
  const stats = statSync(realPath);
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(realPath, { withFileTypes: true })) {
    applyModeRecursive(join(realPath, entry.name), mode);
  }
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function archiveKind(filePath: string): "zip" | "tar" | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (
    lower.endsWith(".tar") ||
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".tar.bz2") ||
    lower.endsWith(".tbz2") ||
    lower.endsWith(".tar.xz") ||
    lower.endsWith(".txz")
  ) {
    return "tar";
  }
  return null;
}

function archiveListCommand(filePath: string): { command: string; args: string[] } {
  const kind = archiveKind(filePath);
  if (kind === "zip") {
    if (IS_WINDOWS) {
      const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead(${quotePowerShellLiteral(filePath)}).Entries | ForEach-Object { $_.FullName }`;
      return { command: "powershell.exe", args: ["-NoProfile", "-Command", script] };
    }
    return { command: "unzip", args: ["-Z1", filePath] };
  }
  if (kind === "tar") return { command: "tar", args: ["-tf", filePath] };
  throw new Error("仅支持 zip、tar、tar.gz、tgz、tar.bz2、tar.xz");
}

function archiveTopLevelNames(filePath: string): string[] {
  const { command, args } = archiveListCommand(filePath);
  const output = execFileSync(command, args, { encoding: "utf-8", timeout: 30000, windowsHide: true });
  const names = new Set<string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const normalized = rawLine.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!normalized) continue;
    const topLevel = normalized.split("/").filter(Boolean)[0];
    if (topLevel) names.add(topLevel);
  }
  return [...names];
}

function findArchiveConflicts(filePath: string, targetDir: string): string[] {
  return archiveTopLevelNames(filePath).filter((name) => existsSync(join(targetDir, name)));
}

function runArchiveCommand(command: string, args: string[], cwd?: string) {
  execFileSync(command, args, { encoding: "utf-8", timeout: 120000, windowsHide: true, cwd });
}

function tarCreateArgs(archivePath: string): string[] {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return ["-czf", archivePath];
  if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2")) return ["-cjf", archivePath];
  if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) return ["-cJf", archivePath];
  return ["-cf", archivePath];
}

function createTarArchive(sourcePaths: string[], targetPath: string) {
  const baseDir = dirname(sourcePaths[0]);
  const names = sourcePaths.map((sourcePath) => {
    if (dirname(sourcePath) !== baseDir) throw new Error("多选压缩需要源文件位于同一目录");
    return basename(sourcePath);
  });
  runArchiveCommand("tar", [...tarCreateArgs(targetPath), "-C", baseDir, ...names]);
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

  // 查询上传进度，用于断点续传
  .get("/api/files/upload/status", ({ query, profile }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const requestedPath = query.path as string;
    if (!requestedPath) return { success: false, message: "缺少 path 参数" };
    const totalSize = query.totalSize !== undefined ? Number(query.totalSize) : undefined;

    try {
      return getUploadStatus(requestedPath, totalSize);
    } catch (e: any) {
      logger.err(`上传进度查询失败: ${e.message}`);
      return { success: false, message: `查询失败: ${e.message}` };
    }
  })

  // 分片上传文件；客户端按 offset 顺序发送，服务端返回当前已写入字节数
  .post("/api/files/upload/chunk", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { path: requestedPath, offset, totalSize, chunk } = body || {};
    if (!requestedPath) return { success: false, message: "缺少 path" };
    if (typeof chunk !== "string") return { success: false, message: "缺少 chunk" };

    try {
      const result = writeUploadChunk(requestedPath, Number(offset), Number(totalSize), chunk);
      if (result.success && result.complete) {
        logger.info(`文件上传完成: ${requestedPath}`);
        auditLog({
          username: profile.username,
          category: "file",
          action: "上传文件",
          target: requestedPath,
          ip: getRequestIp(request, server),
        });
      }
      return result;
    } catch (e: any) {
      logger.err(`文件上传失败: ${e.message}`);
      return { success: false, message: `上传失败: ${e.message}` };
    }
  })

  // 读取文件内容（文本文件）
  .get("/api/files/read", ({ query, profile, request, server }: any) => {
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
      auditLog({
        username: profile.username,
        category: "file",
        action: "查看文件",
        target: requestedPath,
        ip: getRequestIp(request, server),
      });
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
  .put("/api/files/write", async ({ body, profile, request, server }: any) => {
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
      auditLog({
        username: profile.username,
        category: "file",
        action: "编辑文件",
        target: requestedPath,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "保存成功" };
    } catch (e: any) {
      logger.err(`文件写入失败: ${e.message}`);
      return { success: false, message: `写入失败: ${e.message}` };
    }
  })

  // 创建目录
  .post("/api/files/mkdir", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { path: requestedPath } = body;
    if (!requestedPath) return { success: false, message: "缺少 path" };

    const realPath = safePath(requestedPath);
    if (!realPath) return { success: false, message: "路径不允许" };

    try {
      if (existsSync(realPath)) return { success: false, message: "路径已存在" };
      mkdirSync(realPath, { recursive: true });
      logger.info(`目录已创建: ${requestedPath}`);
      auditLog({
        username: profile.username,
        category: "file",
        action: "创建目录",
        target: requestedPath,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "创建成功" };
    } catch (e: any) {
      logger.err(`目录创建失败: ${e.message}`);
      return { success: false, message: `创建失败: ${e.message}` };
    }
  })

  // 删除文件或目录
  .delete("/api/files", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { path: requestedPath } = body;
    if (!requestedPath) return { success: false, message: "缺少 path" };

    const realPath = resolveAccessiblePath(requestedPath);
    if (!realPath) return { success: false, message: "路径不允许" };
    if (!existsSync(realPath)) return { success: false, message: "路径不存在" };

    try {
      const stats = statSync(realPath);
      if (stats.isDirectory()) {
        rmSync(realPath, { recursive: true, force: true });
      } else {
        unlinkSync(realPath);
      }
      // 清理 transfer 临时路径登记
      transferTempPaths.delete(realPath);
      logger.info(`已删除: ${requestedPath}`);
      auditLog({
        username: profile.username,
        category: "file",
        action: stats.isDirectory() ? "删除目录" : "删除文件",
        target: requestedPath,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "删除成功" };
    } catch (e: any) {
      logger.err(`删除失败: ${e.message}`);
      return { success: false, message: `删除失败: ${e.message}` };
    }
  })

  // 重命名
  .patch("/api/files/rename", async ({ body, profile, request, server }: any) => {
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
      auditLog({
        username: profile.username,
        category: "file",
        action: "重命名",
        target: from,
        detail: `→ ${to}`,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "重命名成功" };
    } catch (e: any) {
      logger.err(`重命名失败: ${e.message}`);
      return { success: false, message: `重命名失败: ${e.message}` };
    }
  })

  // 批量复制
  .post("/api/files/copy", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { paths, targetDir, overwrite } = body || {};
    if (!Array.isArray(paths) || paths.length === 0) return { success: false, message: "缺少 paths" };
    if (typeof targetDir !== "string") return { success: false, message: "缺少 targetDir" };

    try {
      const targetRealPath = safePath(targetDir);
      if (!targetRealPath) return { success: false, message: "目标路径不允许" };
      if (!existsSync(targetRealPath)) mkdirSync(targetRealPath, { recursive: true });
      if (!statSync(targetRealPath).isDirectory()) return { success: false, message: "目标不是目录" };

      for (const requestedPath of paths) {
        copyPath(ensureSafeFilePath(String(requestedPath)), targetRealPath, !!overwrite);
      }
      logger.info(`复制文件: ${paths.join(", ")} -> ${targetDir || "/"}`);
      auditLog({
        username: profile.username,
        category: "file",
        action: "复制文件",
        target: paths.length === 1 ? String(paths[0]) : `${paths.length} 项`,
        detail: `→ ${targetDir || "/"}`,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "复制成功" };
    } catch (e: any) {
      logger.err(`复制失败: ${e.message}`);
      return { success: false, message: `复制失败: ${e.message}` };
    }
  })

  // 批量移动
  .post("/api/files/move", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { paths, targetDir, overwrite } = body || {};
    if (!Array.isArray(paths) || paths.length === 0) return { success: false, message: "缺少 paths" };
    if (typeof targetDir !== "string") return { success: false, message: "缺少 targetDir" };

    try {
      const targetRealPath = safePath(targetDir);
      if (!targetRealPath) return { success: false, message: "目标路径不允许" };
      if (!existsSync(targetRealPath)) mkdirSync(targetRealPath, { recursive: true });
      if (!statSync(targetRealPath).isDirectory()) return { success: false, message: "目标不是目录" };

      for (const requestedPath of paths) {
        movePath(ensureSafeFilePath(String(requestedPath)), targetRealPath, !!overwrite);
      }
      logger.info(`移动文件: ${paths.join(", ")} -> ${targetDir || "/"}`);
      auditLog({
        username: profile.username,
        category: "file",
        action: "移动文件",
        target: paths.length === 1 ? String(paths[0]) : `${paths.length} 项`,
        detail: `→ ${targetDir || "/"}`,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "移动成功" };
    } catch (e: any) {
      logger.err(`移动失败: ${e.message}`);
      return { success: false, message: `移动失败: ${e.message}` };
    }
  })

  // 批量删除
  .delete("/api/files/batch", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { paths } = body || {};
    if (!Array.isArray(paths) || paths.length === 0) return { success: false, message: "缺少 paths" };

    try {
      for (const requestedPath of paths) {
        removePath(ensureSafeFilePath(String(requestedPath)));
      }
      logger.info(`批量删除: ${paths.join(", ")}`);
      auditLog({
        username: profile.username,
        category: "file",
        action: "批量删除",
        target: `${paths.length} 项`,
        detail: paths.slice(0, 3).map(String).join(", ") + (paths.length > 3 ? " ..." : ""),
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "删除成功" };
    } catch (e: any) {
      logger.err(`批量删除失败: ${e.message}`);
      return { success: false, message: `删除失败: ${e.message}` };
    }
  })

  // 修改 Linux/Unix 权限
  .patch("/api/files/chmod", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    if (IS_WINDOWS) return { success: false, message: "Windows 节点不支持 chmod 权限设置" };
    const { path: requestedPath, mode, recursive } = body || {};
    if (!requestedPath) return { success: false, message: "缺少 path" };
    if (typeof mode !== "string" || !/^[0-7]{3,4}$/.test(mode)) {
      return { success: false, message: "权限格式应为 755 或 0644" };
    }

    try {
      const realPath = ensureSafeFilePath(requestedPath);
      const parsedMode = parseInt(mode, 8);
      if (recursive) applyModeRecursive(realPath, parsedMode);
      else chmodSync(realPath, parsedMode);
      logger.info(`修改权限: ${requestedPath} -> ${mode}`);
      auditLog({
        username: profile.username,
        category: "file",
        action: "修改权限",
        target: requestedPath,
        detail: `mode=${mode}${recursive ? " (递归)" : ""}`,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "权限已更新" };
    } catch (e: any) {
      logger.err(`修改权限失败: ${e.message}`);
      return { success: false, message: `修改权限失败: ${e.message}` };
    }
  })

  // 压缩为 zip（Windows）或 tar.gz（Linux/Unix）
  .post("/api/files/compress", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { paths, targetPath, useTempDir } = body || {};
    if (!Array.isArray(paths) || paths.length === 0) return { success: false, message: "缺少 paths" };

    try {
      const sourcePaths = paths.map((path: unknown) => ensureSafeFilePath(String(path)));
      const firstParentRequest = requestParentPath(String(paths[0]));
      const defaultName = `${basename(sourcePaths[0])}${paths.length > 1 ? "-bundle" : ""}${IS_WINDOWS ? ".zip" : ".tar.gz"}`;

      // 节点互传场景：把临时压缩包写入 OS temp 目录，避免源目录只读、权限不足等问题。
      let targetRealPath: string;
      let requestedTarget: string;
      let isTempArchive = false;

      if (useTempDir) {
        if (!existsSync(TRANSFER_TEMP_DIR)) {
          mkdirSync(TRANSFER_TEMP_DIR, { recursive: true });
        }
        const uniquePrefix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
        const tempName = `${uniquePrefix}-${defaultName}`;
        targetRealPath = join(TRANSFER_TEMP_DIR, tempName);
        requestedTarget = targetRealPath;
        isTempArchive = true;
      } else {
        const requested = typeof targetPath === "string" && targetPath.trim()
          ? targetPath
          : joinRequestPath(firstParentRequest, defaultName);
        const resolved = safePath(requested);
        if (!resolved) return { success: false, message: "压缩包路径不允许" };
        targetRealPath = resolved;
        requestedTarget = requested;
        const targetDir = dirname(targetRealPath);
        if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      }
      if (existsSync(targetRealPath)) return { success: false, message: "压缩包已存在" };

      const kind = archiveKind(targetRealPath) || (IS_WINDOWS ? "zip" : "tar");
      if (kind === "zip") {
        if (!IS_WINDOWS) {
          const baseDir = dirname(sourcePaths[0]);
          const names = sourcePaths.map((sourcePath) => {
            if (dirname(sourcePath) !== baseDir) throw new Error("多选压缩需要源文件位于同一目录");
            return basename(sourcePath);
          });
          runArchiveCommand("zip", ["-r", targetRealPath, ...names], baseDir);
        } else {
          if (!targetRealPath.toLowerCase().endsWith(".zip")) {
            return { success: false, message: "Windows 的 zip 压缩包文件名必须以 .zip 结尾" };
          }
          const literalPaths = sourcePaths.map(quotePowerShellLiteral).join(",");
          const command = `Compress-Archive -LiteralPath @(${literalPaths}) -DestinationPath ${quotePowerShellLiteral(targetRealPath)} -Force`;
          runArchiveCommand("powershell.exe", ["-NoProfile", "-Command", command]);
        }
      } else if (kind === "tar") {
        createTarArchive(sourcePaths, targetRealPath);
      } else {
        return { success: false, message: "仅支持 zip、tar、tar.gz、tgz、tar.bz2、tar.xz" };
      }

      if (isTempArchive) transferTempPaths.add(targetRealPath);

      logger.info(`压缩文件: ${paths.join(", ")} -> ${requestedTarget}`);
      auditLog({
        username: profile.username,
        category: "file",
        action: "压缩文件",
        target: paths.length === 1 ? String(paths[0]) : `${paths.length} 项`,
        detail: `→ ${requestedTarget}`,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "压缩成功", path: requestedTarget };
    } catch (e: any) {
      logger.err(`压缩失败: ${e.message}`);
      return { success: false, message: `压缩失败: ${e.message}` };
    }
  })

  // 解压 zip/tar 包
  .post("/api/files/extract", async ({ body, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const { path: requestedPath, targetDir, overwrite } = body || {};
    if (!requestedPath) return { success: false, message: "缺少 path" };

    try {
      // archivePath 可能是节点互传产生的 OS temp 临时压缩包，放行这种情形
      const archiveReal = resolveAccessiblePath(requestedPath);
      if (!archiveReal) return { success: false, message: "路径不允许" };
      if (!existsSync(archiveReal)) return { success: false, message: "压缩包不存在" };
      if (statSync(archiveReal).isDirectory()) return { success: false, message: "目录不能解压" };
      const archivePath = archiveReal;

      const targetRequestPath = typeof targetDir === "string" && targetDir.trim()
        ? targetDir
        : requestParentPath(requestedPath);
      const targetRealPath = safePath(targetRequestPath);
      if (!targetRealPath) return { success: false, message: "目标路径不允许" };
      if (!existsSync(targetRealPath)) mkdirSync(targetRealPath, { recursive: true });
      if (!statSync(targetRealPath).isDirectory()) return { success: false, message: "目标不是目录" };

      const kind = archiveKind(archivePath);
      if (!overwrite) {
        const conflicts = findArchiveConflicts(archivePath, targetRealPath);
        if (conflicts.length > 0) {
          return {
            success: false,
            conflict: true,
            conflicts,
            message: `目标目录已存在同名文件: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? "..." : ""}`,
          };
        }
      }

      if (kind === "zip") {
        if (IS_WINDOWS) {
          const command = `Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(targetRealPath)}${overwrite ? " -Force" : ""}`;
          runArchiveCommand("powershell.exe", ["-NoProfile", "-Command", command]);
        } else {
          runArchiveCommand("unzip", [overwrite ? "-o" : "-n", archivePath, "-d", targetRealPath]);
        }
      } else if (kind === "tar") {
        runArchiveCommand("tar", ["-xf", archivePath, "-C", targetRealPath]);
      } else {
        return { success: false, message: "仅支持 zip、tar、tar.gz、tgz、tar.bz2、tar.xz" };
      }

      logger.info(`解压文件: ${requestedPath} -> ${targetRequestPath || "/"}`);
      auditLog({
        username: profile.username,
        category: "file",
        action: "解压文件",
        target: requestedPath,
        detail: `→ ${targetRequestPath || "/"}`,
        ip: getRequestIp(request, server),
      });
      return { success: true, message: "解压成功" };
    } catch (e: any) {
      logger.err(`解压失败: ${e.message}`);
      return { success: false, message: `解压失败: ${e.message}` };
    }
  })

  // 下载文件（返回 base64 内容，避免 Elysia 不支持 Stream 的限制）
  .get("/api/files/download", ({ query, profile, request, server }: any) => {
    if (!profile) return { success: false, message: "未授权" };
    const requestedPath = query.path as string;
    if (!requestedPath) return { success: false, message: "缺少 path 参数" };

    const realPath = resolveAccessiblePath(requestedPath);
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

      auditLog({
        username: profile.username,
        category: "file",
        action: "下载文件",
        target: requestedPath,
        detail: `${(stats.size / 1024).toFixed(1)} KB`,
        ip: getRequestIp(request, server),
      });

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
