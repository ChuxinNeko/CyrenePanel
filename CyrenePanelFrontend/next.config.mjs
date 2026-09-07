import os from "node:os";

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
