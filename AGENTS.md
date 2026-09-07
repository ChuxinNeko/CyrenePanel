# AGENTS.md

CyrenePanel — Bun + Next.js 服务器管理面板（对标宝塔 / 1Panel）。

## 常用命令

### 后端 (CyrenePanelBackend, Elysia + Bun)

```bash
bun install
bun run dev          # 开发模式（--watch 热重载），端口 5677
bunx tsc --noEmit    # 类型检查（注意：instances/mysql/system 模块存在预存类型错误，与 sites/certificates 无关）
```

### 前端 (CyrenePanelFrontend, Next.js 16 + React 19)

```bash
bun install
bun run dev          # 开发模式（turbopack），端口 3000
bun run typecheck    # tsc --noEmit
bun run build        # 生产构建
bun run lint         # eslint（现有组件普遍存在 no-explicit-any / set-state-in-effect 预存告警，保持风格一致即可）
```

## 架构要点

- **网站管理**：站点信息从 Nginx conf 文件派生（无数据库表）；类型元数据以 base64 JSON 注释 `# CyreneSiteMeta:` 存于 conf 头部。站点类型：`static` / `php` / `runtime`（node/java/python/go，systemd 托管 `cyrene-site-<name>.service`）/ `proxy`。
- **Nginx 布局检测**：`src/sites/nginx-layout.ts` 由 sites 与 certificates 共享。宝塔编译安装环境下 vhost 目录必须从 `nginx.conf` 的 include 指令解析（可能是 `/www/server/panel/vhost/nginx`），不要硬编码 `/www/server/nginx/conf/vhost`。
- **远程节点**：`/api/nodes/:id/*` 由主节点透传到子节点，sites 相关新路由天然兼容远程节点。
- **认证**：JWT Bearer；API 返回 `{ success, message }` 风格。
- **管理块标记**：Nginx conf 中用成对注释标记面板管理的配置块：`# CyrenePanelProxyStart/End`（用户反代）、`# CyrenePanelAppProxyStart/End`（运行环境自动反代）、`# CyrenePanelRedirectStart/End`。
- **文件类型图标**：文件管理用 vscode-icons 图标集，映射表在 `lib/file-icon-map.ts`（唯一真源），图标数据是提交进仓库的离线子集 `lib/file-icon-data.json`。**改完映射表必须重跑 `bun run build:file-icons`**——否则新图标不在本地集合里，`@iconify/react` 会静默回落到 api.iconify.design 联网拉取，内网环境下就会显示空白。脚本会校验图标名是否真实存在，写错直接报错退出。
