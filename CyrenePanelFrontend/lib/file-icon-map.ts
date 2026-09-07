/**
 * 文件/目录 → vscode-icons 图标名的映射（单源）
 *
 * 这份表同时被两处使用：
 * - 运行时 lib/file-icons.tsx 查表渲染
 * - 构建期 scripts/build-file-icons.ts 据此从 @iconify-json/vscode-icons
 *   抽取子集生成 lib/file-icon-data.json，因此只有这里出现过的图标才会被打包
 *
 * 新增映射后需要重新执行 `bun run build:file-icons`。
 */

export const ICON_PREFIX = "vscode-icons";

export const DEFAULT_FILE_ICON = "default-file";
export const DEFAULT_FOLDER_ICON = "default-folder";
export const DEFAULT_FOLDER_OPEN_ICON = "default-folder-opened";

/** 按完整文件名匹配（小写），优先级高于扩展名 */
export const ICON_BY_FILENAME: Record<string, string> = {
  "dockerfile": "file-type-docker",
  "docker-compose.yml": "file-type-docker",
  "docker-compose.yaml": "file-type-docker",
  "compose.yml": "file-type-docker",
  "compose.yaml": "file-type-docker",
  ".dockerignore": "file-type-docker",

  ".gitignore": "file-type-git",
  ".gitattributes": "file-type-git",
  ".gitmodules": "file-type-git",

  "package.json": "file-type-npm",
  "package-lock.json": "file-type-npm",
  ".npmrc": "file-type-npm",
  "bun.lock": "file-type-bun",
  "bun.lockb": "file-type-bun",
  "bunfig.toml": "file-type-bun",
  "yarn.lock": "file-type-yarn",
  "pnpm-lock.yaml": "file-type-pnpm",

  "tsconfig.json": "file-type-tsconfig",
  "jsconfig.json": "file-type-tsconfig",
  ".editorconfig": "file-type-editorconfig",
  "cmakelists.txt": "file-type-cmake",
  "makefile": "file-type-shell",
  "license": "file-type-license",
  "license.md": "file-type-license",
  "license.txt": "file-type-license",

  "nginx.conf": "file-type-nginx",
};

/** 按文件名前缀匹配（小写），用于 next.config.* 这类带任意后缀的配置文件 */
export const ICON_BY_FILENAME_PREFIX: Record<string, string> = {
  "next.config": "file-type-next",
  "vite.config": "file-type-vite",
  "tailwind.config": "file-type-tailwind",
  "postcss.config": "file-type-css",
  "eslint.config": "file-type-eslint",
  ".eslintrc": "file-type-eslint",
  ".prettierrc": "file-type-prettier",
  "prettier.config": "file-type-prettier",
  ".babelrc": "file-type-babel",
  "babel.config": "file-type-babel",
  ".env": "file-type-dotenv",
};

/** 按扩展名匹配（含前导点，小写） */
export const ICON_BY_EXTENSION: Record<string, string> = {
  // ── 前端 ──
  ".ts": "file-type-typescript",
  ".mts": "file-type-typescript",
  ".cts": "file-type-typescript",
  ".tsx": "file-type-reactts",
  ".js": "file-type-js",
  ".mjs": "file-type-js",
  ".cjs": "file-type-js",
  ".jsx": "file-type-reactjs",
  ".vue": "file-type-vue",
  ".svelte": "file-type-svelte",
  ".html": "file-type-html",
  ".htm": "file-type-html",
  ".css": "file-type-css",
  ".scss": "file-type-sass",
  ".sass": "file-type-sass",
  ".less": "file-type-less",
  ".styl": "file-type-stylus",

  // ── 后端 / 系统 ──
  ".py": "file-type-python",
  ".go": "file-type-go",
  ".rs": "file-type-rust",
  ".java": "file-type-java",
  ".c": "file-type-c",
  ".h": "file-type-cheader",
  ".cpp": "file-type-cpp",
  ".cc": "file-type-cpp",
  ".cxx": "file-type-cpp",
  ".hpp": "file-type-cppheader",
  ".cs": "file-type-csharp",
  ".php": "file-type-php",
  ".rb": "file-type-ruby",
  ".swift": "file-type-swift",
  ".kt": "file-type-kotlin",
  ".lua": "file-type-lua",
  ".pl": "file-type-perl",
  ".dart": "file-type-dartlang",
  ".zig": "file-type-zig",
  ".r": "file-type-r",
  ".sh": "file-type-shell",
  ".bash": "file-type-shell",
  ".zsh": "file-type-shell",
  ".fish": "file-type-shell",
  ".ps1": "file-type-powershell",

  // ── 数据 / 配置 ──
  ".json": "file-type-json",
  ".jsonc": "file-type-json",
  ".yml": "file-type-yaml",
  ".yaml": "file-type-yaml",
  ".toml": "file-type-toml",
  ".xml": "file-type-xml",
  ".ini": "file-type-ini",
  ".cfg": "file-type-config",
  ".conf": "file-type-config",
  ".properties": "file-type-config",
  ".sql": "file-type-sql",
  ".db": "file-type-sqlite",
  ".sqlite": "file-type-sqlite",
  ".sqlite3": "file-type-sqlite",
  ".service": "file-type-systemd",

  // ── 文档 ──
  ".md": "file-type-markdown",
  ".markdown": "file-type-markdown",
  ".txt": "file-type-text",
  ".csv": "file-type-text",
  ".tsv": "file-type-text",
  ".log": "file-type-log",
  ".pdf": "file-type-pdf2",

  // ── 媒体 ──
  ".png": "file-type-image",
  ".jpg": "file-type-image",
  ".jpeg": "file-type-image",
  ".gif": "file-type-image",
  ".webp": "file-type-image",
  ".bmp": "file-type-image",
  ".avif": "file-type-image",
  ".svg": "file-type-svg",
  ".ico": "file-type-favicon",
  ".mp4": "file-type-video",
  ".webm": "file-type-video",
  ".mov": "file-type-video",
  ".m4v": "file-type-video",
  ".ogv": "file-type-video",
  ".mp3": "file-type-audio",
  ".wav": "file-type-audio",
  ".flac": "file-type-audio",
  ".aac": "file-type-audio",
  ".m4a": "file-type-audio",
  ".ogg": "file-type-audio",
  ".oga": "file-type-audio",
  ".opus": "file-type-audio",
  ".ttf": "file-type-font",
  ".otf": "file-type-font",
  ".woff": "file-type-font",
  ".woff2": "file-type-font",

  // ── 压缩包 ──
  ".zip": "file-type-zip",
  ".tar": "file-type-zip",
  ".gz": "file-type-zip",
  ".tgz": "file-type-zip",
  ".bz2": "file-type-zip",
  ".xz": "file-type-zip",
  ".7z": "file-type-zip",
  ".rar": "file-type-zip",

  // ── 二进制 / 证书 ──
  ".exe": "file-type-binary",
  ".dll": "file-type-binary",
  ".so": "file-type-binary",
  ".bin": "file-type-binary",
  ".rpm": "file-type-binary",
  ".deb": "file-type-debian",
  ".crt": "file-type-cert",
  ".cer": "file-type-cert",
  ".pem": "file-type-cert",
  ".key": "file-type-key",
};

/** 按目录名匹配（小写） */
export const ICON_BY_FOLDER: Record<string, string> = {
  "node_modules": "folder-type-node",
  ".git": "folder-type-git",
  "src": "folder-type-src",
  "dist": "folder-type-dist",
  "build": "folder-type-dist",
  "out": "folder-type-dist",
  "public": "folder-type-public",
  "test": "folder-type-test",
  "tests": "folder-type-test",
  "__tests__": "folder-type-test",
  "config": "folder-type-config",
  "conf": "folder-type-config",
  "etc": "folder-type-config",
  "log": "folder-type-log",
  "logs": "folder-type-log",
  "img": "folder-type-images",
  "images": "folder-type-images",
  "video": "folder-type-video",
  "videos": "folder-type-video",
  "audio": "folder-type-audio",
  "music": "folder-type-audio",
  "docker": "folder-type-docker",
  "nginx": "folder-type-nginx",
  "tmp": "folder-type-temp",
  "temp": "folder-type-temp",
  "www": "folder-type-www",
  "wwwroot": "folder-type-www",
};

/** 需要打包进子集的全部图标名 */
export function collectIconNames(): string[] {
  return [
    ...new Set([
      DEFAULT_FILE_ICON,
      DEFAULT_FOLDER_ICON,
      DEFAULT_FOLDER_OPEN_ICON,
      ...Object.values(ICON_BY_FILENAME),
      ...Object.values(ICON_BY_FILENAME_PREFIX),
      ...Object.values(ICON_BY_EXTENSION),
      ...Object.values(ICON_BY_FOLDER),
    ]),
  ].sort();
}
