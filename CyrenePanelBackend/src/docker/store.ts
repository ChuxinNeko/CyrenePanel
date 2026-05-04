// ── Docker 应用商店数据 ──────────────────────────────────────────

export interface StoreAppPort {
  container: number;
  host?: number;
  protocol: "tcp" | "udp";
  label?: string;
}

export interface StoreAppVolume {
  container: string;
  host?: string;
  label?: string;
}

export interface StoreAppEnv {
  name: string;
  value: string;
  label?: string;
  required?: boolean;
}

export interface StoreApp {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  image: string;
  defaultPorts: StoreAppPort[];
  defaultVolumes: StoreAppVolume[];
  defaultEnv: StoreAppEnv[];
  note?: string;
  restart?: string;
  networkMode?: string;
}

export const storeApps: StoreApp[] = [
  // ── Web 服务器 ──────────────────────────────────────────────
  {
    id: "nginx",
    name: "Nginx",
    description: "高性能 HTTP 和反向代理服务器",
    category: "Web 服务器",
    icon: "material-icon-theme:nginx",
    image: "nginx:latest",
    defaultPorts: [
      { container: 80, host: 8080, protocol: "tcp", label: "HTTP" },
      { container: 443, host: 8443, protocol: "tcp", label: "HTTPS" },
    ],
    defaultVolumes: [
      { container: "/usr/share/nginx/html", host: "", label: "网页文件" },
      { container: "/etc/nginx/conf.d", host: "", label: "配置目录" },
    ],
    defaultEnv: [],
  },
  {
    id: "nginx-proxy-manager",
    name: "Nginx Proxy Manager",
    description: "带 Web UI 的反向代理管理器，支持 SSL 证书自动申请",
    category: "Web 服务器",
    icon: "material-symbols:router",
    image: "jc21/nginx-proxy-manager:latest",
    defaultPorts: [
      { container: 80, host: 80, protocol: "tcp", label: "HTTP" },
      { container: 443, host: 443, protocol: "tcp", label: "HTTPS" },
      { container: 81, host: 81, protocol: "tcp", label: "管理界面" },
    ],
    defaultVolumes: [
      { container: "/data", host: "", label: "数据目录" },
      { container: "/etc/letsencrypt", host: "", label: "证书目录" },
    ],
    defaultEnv: [],
  },

  // ── 数据库 ──────────────────────────────────────────────────
  {
    id: "mysql",
    name: "MySQL",
    description: "世界上最流行的开源关系型数据库",
    category: "数据库",
    icon: "logos:mysql",
    image: "mysql:8.0",
    defaultPorts: [{ container: 3306, host: 3306, protocol: "tcp", label: "MySQL" }],
    defaultVolumes: [
      { container: "/var/lib/mysql", host: "", label: "数据目录" },
    ],
    defaultEnv: [
      { name: "MYSQL_ROOT_PASSWORD", value: "", label: "Root 密码", required: true },
      { name: "MYSQL_DATABASE", value: "", label: "默认数据库" },
      { name: "MYSQL_USER", value: "", label: "默认用户" },
      { name: "MYSQL_PASSWORD", value: "", label: "用户密码" },
    ],
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "功能强大的开源对象关系型数据库",
    category: "数据库",
    icon: "logos:postgresql",
    image: "postgres:16-alpine",
    defaultPorts: [{ container: 5432, host: 5432, protocol: "tcp", label: "PostgreSQL" }],
    defaultVolumes: [
      { container: "/var/lib/postgresql/data", host: "", label: "数据目录" },
    ],
    defaultEnv: [
      { name: "POSTGRES_PASSWORD", value: "", label: "超级用户密码", required: true },
      { name: "POSTGRES_USER", value: "postgres", label: "超级用户" },
      { name: "POSTGRES_DB", value: "postgres", label: "默认数据库" },
    ],
  },
  {
    id: "redis",
    name: "Redis",
    description: "高性能内存键值存储，常用于缓存和消息队列",
    category: "数据库",
    icon: "logos:redis",
    image: "redis:7-alpine",
    defaultPorts: [{ container: 6379, host: 6379, protocol: "tcp", label: "Redis" }],
    defaultVolumes: [
      { container: "/data", host: "", label: "数据目录" },
    ],
    defaultEnv: [],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    description: "面向文档的 NoSQL 数据库",
    category: "数据库",
    icon: "material-icon-theme:mongodb",
    image: "mongo:7",
    defaultPorts: [{ container: 27017, host: 27017, protocol: "tcp", label: "MongoDB" }],
    defaultVolumes: [
      { container: "/data/db", host: "", label: "数据目录" },
    ],
    defaultEnv: [
      { name: "MONGO_INITDB_ROOT_USERNAME", value: "", label: "Root 用户名" },
      { name: "MONGO_INITDB_ROOT_PASSWORD", value: "", label: "Root 密码" },
    ],
  },

  // ── 媒体服务 ────────────────────────────────────────────────
  {
    id: "plex",
    name: "Plex",
    description: "全功能媒体服务器，整理和串流你的电影、音乐和照片",
    category: "媒体服务",
    icon: "logos:plex",
    image: "linuxserver/plex:latest",
    defaultPorts: [{ container: 32400, host: 32400, protocol: "tcp", label: "Web UI" }],
    defaultVolumes: [
      { container: "/config", host: "", label: "配置目录" },
      { container: "/tv", host: "", label: "电视节目" },
      { container: "/movies", host: "", label: "电影" },
    ],
    defaultEnv: [
      { name: "PUID", value: "1000", label: "用户 ID" },
      { name: "PGID", value: "1000", label: "组 ID" },
      { name: "TZ", value: "Asia/Shanghai", label: "时区" },
    ],
  },
  {
    id: "jellyfin",
    name: "Jellyfin",
    description: "免费开源的媒体系统，Plex/Emby 的替代方案",
    category: "媒体服务",
    icon: "logos:jellyfin",
    image: "linuxserver/jellyfin:latest",
    defaultPorts: [{ container: 8096, host: 8096, protocol: "tcp", label: "Web UI" }],
    defaultVolumes: [
      { container: "/config", host: "", label: "配置目录" },
      { container: "/data/tvshows", host: "", label: "电视节目" },
      { container: "/data/movies", host: "", label: "电影" },
    ],
    defaultEnv: [
      { name: "PUID", value: "1000", label: "用户 ID" },
      { name: "PGID", value: "1000", label: "组 ID" },
      { name: "TZ", value: "Asia/Shanghai", label: "时区" },
    ],
  },

  // ── 文件与同步 ──────────────────────────────────────────────
  {
    id: "nextcloud",
    name: "Nextcloud",
    description: "自托管的文件同步与协作平台",
    category: "文件与同步",
    icon: "logos:nextcloud",
    image: "linuxserver/nextcloud:latest",
    defaultPorts: [{ container: 443, host: 8443, protocol: "tcp", label: "HTTPS" }],
    defaultVolumes: [
      { container: "/config", host: "", label: "配置目录" },
      { container: "/data", host: "", label: "数据目录" },
    ],
    defaultEnv: [
      { name: "PUID", value: "1000", label: "用户 ID" },
      { name: "PGID", value: "1000", label: "组 ID" },
      { name: "TZ", value: "Asia/Shanghai", label: "时区" },
    ],
  },
  {
    id: "syncthing",
    name: "Syncthing",
    description: "去中心化的文件同步工具",
    category: "文件与同步",
    icon: "logos:syncthing",
    image: "linuxserver/syncthing:latest",
    defaultPorts: [
      { container: 8384, host: 8384, protocol: "tcp", label: "Web UI" },
      { container: 22000, host: 22000, protocol: "tcp", label: "传输" },
      { container: 21027, host: 21027, protocol: "udp", label: "发现" },
    ],
    defaultVolumes: [
      { container: "/config", host: "", label: "配置目录" },
      { container: "/data1", host: "", label: "同步目录 1" },
    ],
    defaultEnv: [
      { name: "PUID", value: "1000", label: "用户 ID" },
      { name: "PGID", value: "1000", label: "组 ID" },
    ],
  },

  // ── 开发者工具 ──────────────────────────────────────────────
  {
    id: "gitea",
    name: "Gitea",
    description: "轻量级自托管 Git 服务，GitHub 的替代方案",
    category: "开发者工具",
    icon: "logos:gitea",
    image: "gitea/gitea:latest",
    defaultPorts: [
      { container: 3000, host: 3000, protocol: "tcp", label: "Web UI" },
      { container: 22, host: 2222, protocol: "tcp", label: "SSH" },
    ],
    defaultVolumes: [
      { container: "/data", host: "", label: "数据目录" },
    ],
    defaultEnv: [],
  },
  {
    id: "portainer",
    name: "Portainer",
    description: "强大的 Docker 容器管理 Web UI",
    category: "开发者工具",
    icon: "logos:portainer",
    image: "portainer/portainer-ce:latest",
    defaultPorts: [
      { container: 9000, host: 9000, protocol: "tcp", label: "Web UI" },
    ],
    defaultVolumes: [
      { container: "/var/run/docker.sock", host: "/var/run/docker.sock", label: "Docker Socket" },
      { container: "/data", host: "", label: "数据目录" },
    ],
    defaultEnv: [],
    restart: "always",
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description: "自托管的网站状态监控工具，支持多种通知方式",
    category: "开发者工具",
    icon: "logos:uptime-kuma",
    image: "louislam/uptime-kuma:latest",
    defaultPorts: [{ container: 3001, host: 3001, protocol: "tcp", label: "Web UI" }],
    defaultVolumes: [
      { container: "/app/data", host: "", label: "数据目录" },
    ],
    defaultEnv: [],
  },
  {
    id: "code-server",
    name: "VS Code Server",
    description: "在浏览器中运行 VS Code，随时随地写代码",
    category: "开发者工具",
    icon: "💻",
    image: "linuxserver/code-server:latest",
    defaultPorts: [{ container: 8443, host: 8443, protocol: "tcp", label: "Web UI" }],
    defaultVolumes: [
      { container: "/config", host: "", label: "配置目录" },
      { container: "/workspace", host: "", label: "工作区" },
    ],
    defaultEnv: [
      { name: "PUID", value: "1000", label: "用户 ID" },
      { name: "PGID", value: "1000", label: "组 ID" },
      { name: "PASSWORD", value: "", label: "访问密码" },
    ],
  },

  // ── 网络安全 ────────────────────────────────────────────────
  {
    id: "adguard-home",
    name: "AdGuard Home",
    description: "全网广告拦截与跟踪保护 DNS 服务器",
    category: "网络安全",
    icon: "simple-icons:adguard",
    image: "adguard/adguardhome:latest",
    defaultPorts: [
      { container: 53, host: 53, protocol: "tcp", label: "DNS TCP" },
      { container: 53, host: 53, protocol: "udp", label: "DNS UDP" },
      { container: 3000, host: 3000, protocol: "tcp", label: "Web UI" },
    ],
    defaultVolumes: [
      { container: "/opt/adguardhome/work", host: "", label: "工作目录" },
      { container: "/opt/adguardhome/conf", host: "", label: "配置目录" },
    ],
    defaultEnv: [],
  },

  // ── 密码管理 ────────────────────────────────────────────────
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    description: "轻量级 Bitwarden 兼容密码管理器服务端",
    category: "密码管理",
    icon: "logos:bitwarden-icon",
    image: "vaultwarden/server:latest",
    defaultPorts: [{ container: 80, host: 8088, protocol: "tcp", label: "Web UI" }],
    defaultVolumes: [
      { container: "/data", host: "", label: "数据目录" },
    ],
    defaultEnv: [],
  },

  // ── 内容管理 ────────────────────────────────────────────────
  {
    id: "wordpress",
    name: "WordPress",
    description: "世界上最流行的内容管理系统 (CMS)",
    category: "内容管理",
    icon: "logos:wordpress-icon",
    image: "wordpress:latest",
    defaultPorts: [{ container: 80, host: 8080, protocol: "tcp", label: "Web" }],
    defaultVolumes: [
      { container: "/var/www/html", host: "", label: "网站文件" },
    ],
    defaultEnv: [
      { name: "WORDPRESS_DB_HOST", value: "", label: "数据库主机", required: true },
      { name: "WORDPRESS_DB_USER", value: "", label: "数据库用户" },
      { name: "WORDPRESS_DB_PASSWORD", value: "", label: "数据库密码" },
      { name: "WORDPRESS_DB_NAME", value: "", label: "数据库名" },
    ],
  },

  // ── 智能家居 ────────────────────────────────────────────────
  {
    id: "home-assistant",
    name: "Home Assistant",
    description: "开源智能家居自动化平台",
    category: "智能家居",
    icon: "logos:homeassistant",
    image: "homeassistant/home-assistant:stable",
    defaultPorts: [{ container: 8123, host: 8123, protocol: "tcp", label: "Web UI" }],
    defaultVolumes: [
      { container: "/config", host: "", label: "配置目录" },
    ],
    defaultEnv: [
      { name: "TZ", value: "Asia/Shanghai", label: "时区" },
    ],
    restart: "always",
  },

  // ── 其他 ────────────────────────────────────────────────────
  {
    id: "alpine",
    name: "Alpine Linux",
    description: "最小化的 Linux 发行版，适合作为基础系统容器",
    category: "其他",
    icon: "logos:alpine",
    image: "alpine:latest",
    defaultPorts: [],
    defaultVolumes: [],
    defaultEnv: [],
    note: "此容器默认无持续运行进程，部署后可能需要配置",
  },
];