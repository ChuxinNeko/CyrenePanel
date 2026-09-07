/**
 * Docker 镜像仓库加速地址处理
 *
 * 从 docker/index.ts 抽出，供 images / compose / store 等模块共用。
 */

import { getConfig } from "../db";

/**
 * 把镜像名改写为加速仓库地址。
 * overrideEnabled 用于让调用方（如手动拉取）覆盖全局开关。
 */
export function getMirrorImage(image: string, overrideEnabled?: boolean): string {
  const mirrorUrl = getConfig("docker_mirror_url");
  const globalEnabled = getConfig("docker_mirror_enabled") === "true";
  const mirrorEnabled = overrideEnabled !== undefined ? overrideEnabled : globalEnabled;
  if (!mirrorEnabled || !mirrorUrl) return image;
  const host = mirrorUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const cleanImage = image.replace(/^docker\.io\//, "");
  return `${host}/${cleanImage}`;
}

/**
 * 将 compose YAML 中的 image: 行替换为加速地址。
 * 简单正则替换，不解析 YAML——足以覆盖常见写法。
 */
export function rewriteComposeImages(content: string): string {
  const mirrorUrl = getConfig("docker_mirror_url");
  const globalEnabled = getConfig("docker_mirror_enabled") === "true";
  if (!globalEnabled || !mirrorUrl) return content;

  const host = mirrorUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  return content.replace(
    /^(\s*image:\s*["']?)([^"'\s#]+)/gm,
    (_match, prefix: string, image: string) => {
      const cleanImage = image.replace(/^docker\.io\//, "");
      return `${prefix}${host}/${cleanImage}`;
    },
  );
}
