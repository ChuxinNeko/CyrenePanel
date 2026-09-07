"use client";

import { Icon, addCollection } from "@iconify/react";

import iconData from "./file-icon-data.json";
import {
  DEFAULT_FILE_ICON,
  DEFAULT_FOLDER_ICON,
  DEFAULT_FOLDER_OPEN_ICON,
  ICON_BY_EXTENSION,
  ICON_BY_FILENAME,
  ICON_BY_FILENAME_PREFIX,
  ICON_BY_FOLDER,
  ICON_PREFIX,
} from "./file-icon-map";

// 子集由 scripts/build-file-icons.ts 生成并提交进仓库，
// 注入后 <Icon> 全部走本地数据，不会请求 api.iconify.design
addCollection(iconData as Parameters<typeof addCollection>[0]);

export interface FileIconInput {
  name?: string;
  path?: string;
  extension?: string;
  isDirectory?: boolean;
}

function baseNameOf(input: FileIconInput): string {
  const raw = input.name || input.path || "";
  return (raw.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "").toLowerCase();
}

function extensionOf(input: FileIconInput, fileName: string): string {
  if (input.extension) {
    const ext = input.extension.toLowerCase();
    return ext.startsWith(".") ? ext : `.${ext}`;
  }
  const dot = fileName.lastIndexOf(".");
  // dot <= 0 时是无扩展名文件或 .gitignore 这类纯点开头的文件
  return dot > 0 ? fileName.slice(dot) : "";
}

/** 匹配 next.config.mjs / .env.production 这类带任意后缀的文件 */
function matchByPrefix(fileName: string): string | null {
  for (const [prefix, icon] of Object.entries(ICON_BY_FILENAME_PREFIX)) {
    if (fileName === prefix) return icon;
    if (fileName.startsWith(`${prefix}.`)) return icon;
  }
  return null;
}

/** 解析出 vscode-icons 中的图标名（不含前缀） */
export function resolveFileIconName(input: FileIconInput, isOpen = false): string {
  const fileName = baseNameOf(input);

  if (input.isDirectory) {
    const folderIcon = ICON_BY_FOLDER[fileName];
    if (folderIcon) return folderIcon;
    return isOpen ? DEFAULT_FOLDER_OPEN_ICON : DEFAULT_FOLDER_ICON;
  }

  const exact = ICON_BY_FILENAME[fileName];
  if (exact) return exact;

  const byPrefix = matchByPrefix(fileName);
  if (byPrefix) return byPrefix;

  return ICON_BY_EXTENSION[extensionOf(input, fileName)] || DEFAULT_FILE_ICON;
}

export function FileTypeIcon({
  entry,
  isOpen = false,
  className = "h-4 w-4",
}: {
  entry: FileIconInput;
  isOpen?: boolean;
  className?: string;
}) {
  return (
    <Icon
      icon={`${ICON_PREFIX}:${resolveFileIconName(entry, isOpen)}`}
      className={`shrink-0 ${className}`}
    />
  );
}
