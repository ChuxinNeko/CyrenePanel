/**
 * 从 @iconify-json/vscode-icons 抽取 lib/file-icon-map.ts 里实际用到的图标，
 * 生成 lib/file-icon-data.json（已提交进仓库，运行时直接 addCollection 注入）。
 *
 *   bun run build:file-icons
 *
 * 这样既拿到 VS Code 那套真实文件类型图标，又不依赖 api.iconify.design，
 * 也不会把整个 1500+ 图标的集合打进前端产物。
 */

import { readFileSync, writeFileSync } from "node:fs";

import { collectIconNames, ICON_PREFIX } from "../lib/file-icon-map";

const SOURCE = "node_modules/@iconify-json/vscode-icons/icons.json";
const TARGET = "lib/file-icon-data.json";

interface IconifyCollection {
  prefix: string;
  icons: Record<string, { body: string; width?: number; height?: number }>;
  aliases?: Record<string, { parent: string; [key: string]: unknown }>;
  width?: number;
  height?: number;
}

const source: IconifyCollection = JSON.parse(readFileSync(SOURCE, "utf-8"));

if (source.prefix !== ICON_PREFIX) {
  throw new Error(`图标集前缀不匹配：期望 ${ICON_PREFIX}，实际 ${source.prefix}`);
}

const wanted = collectIconNames();
const icons: IconifyCollection["icons"] = {};
const missing: string[] = [];

for (const name of wanted) {
  // 少量图标是别名，需要回溯到 parent 才能拿到 body
  const alias = source.aliases?.[name];
  const resolved = source.icons[name] ?? (alias ? source.icons[alias.parent] : undefined);

  if (!resolved) {
    missing.push(name);
    continue;
  }
  icons[name] = resolved;
}

if (missing.length > 0) {
  console.error(`✗ 以下图标在 ${ICON_PREFIX} 中不存在，请修正 lib/file-icon-map.ts：`);
  for (const name of missing) console.error(`    ${name}`);
  process.exit(1);
}

const output = {
  prefix: source.prefix,
  width: source.width ?? 32,
  height: source.height ?? 32,
  icons,
};

const serialized = `${JSON.stringify(output)}\n`;
writeFileSync(TARGET, serialized, "utf-8");

const sizeKb = (Buffer.byteLength(serialized) / 1024).toFixed(1);
console.log(`✓ 已写入 ${TARGET}：${Object.keys(icons).length} 个图标，${sizeKb} KB`);
