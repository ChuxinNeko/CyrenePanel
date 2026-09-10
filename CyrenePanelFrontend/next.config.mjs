import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * 仓库外层（父目录）可能也存在 lockfile，Next 会据此把工作区根推断到上一级，
 * 于是 Turbopack 和 Tailwind 的自动源扫描都会去爬整个父目录。这里钉死到前端目录。
 */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const backendUrl =
  process.env.CYRENE_BACKEND_URL ||
  process.env.BACKEND_URL ||
  `http://127.0.0.1:${process.env.BACKEND_PORT || "5677"}`;

/**
 * 开发模式下 Next 会校验跨域请求的来源，面板通常是用服务器 IP 直接访问的，
 * 不声明就会刷 "Cross origin request detected" 告警。
 * 这里自动带上本机所有非回环 IPv4，额外的域名可以用 CYRENE_DEV_ORIGINS（逗号分隔）补充。
 */
function resolveDevOrigins() {
  const origins = new Set(["localhost", "127.0.0.1"]);

  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if ((net.family === "IPv4" || net.family === 4) && !net.internal) {
        origins.add(net.address);
      }
    }
  }

  for (const item of (process.env.CYRENE_DEV_ORIGINS || "").split(",")) {
    const value = item.trim();
    if (value) origins.add(value);
  }

  return [...origins];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  turbopack: { root: projectRoot },
  allowedDevOrigins: resolveDevOrigins(),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl.replace(/\/+$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig
