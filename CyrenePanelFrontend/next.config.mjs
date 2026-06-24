const backendUrl =
  process.env.CYRENE_BACKEND_URL ||
  process.env.BACKEND_URL ||
  `http://127.0.0.1:${process.env.BACKEND_PORT || "5677"}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
