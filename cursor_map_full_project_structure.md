# Map full project structure
_Exported on 2026/5/11 at GMT+8 11:15:45 from Cursor (3.2.21)_

---

**User**

You are exploring the CyrenePanel project at d:\CyrenePanel.

IMPORTANT: I need you to be EXTREMELY thorough. Map the entire project structure, including:

1. List ALL top-level directories and files
2. For each major directory (like CyrenePanelBackend/, CyrenePanelFrontend/, scripts/, etc.), list ALL subdirectories and important files
3. Identify the purpose of each directory and key file
4. Look at package.json, tsconfig.json, next.config, etc. to understand tech stack
5. For the backend, identify the route structure, middleware, services, database layer
6. For the frontend, identify pages, components, API calls
7. For scripts, identify what each script does

Focus on:
- d:\CyrenePanel\CyrenePanelBackend\src\ (all subdirectories and their purposes)
- d:\CyrenePanel\CyrenePanelFrontend\app\ (all pages and components)
- d:\CyrenePanel\scripts\ (all scripts)
- Any config files at the root

Return a DETAILED structured report of:
- Full directory tree (with indentation showing hierarchy)
- For each directory, a 1-line description of its purpose
- For each key file, a 1-line description of what it does
- Tech stack summary (frameworks, databases, key dependencies)

Do NOT truncate or summarize too much - every directory and important file should be listed. This will be used to create a comprehensive README.

---

**Cursor**

I'll begin by mapping the top-level structure, then dive into each major directory. Let me start with multiple parallel reads.



I'll now dive into the backend source files to understand each module's purpose, then the frontend components and scripts.



I'll continue reading the remaining backend source files, then the frontend and scripts.



I need to read the frontend source files now to complete the mapping. Let me read the key frontend files in parallel.



I'll continue reading the remaining files to complete the full project mapping. Let me read the scripts, remaining frontend components, and configuration files.



# CyrenePanel 项目完整结构映射报告

## 一、技术栈总结

| 层级 | 技术 | 版本/说明 |
|------|------|-----------|
| **后端框架** | Elysia (Bun) | TypeScript, 端口 5677 |
| **前端框架** | Next.js 16 + React 19 | Turbopack 开发模式 |
| **UI 组件库** | shadcn/ui + Radix UI | 22 个 UI 组件 |
| **样式** | Tailwind CSS v4 | tw-animate-css 动画 |
| **数据库** | SQLite (Bun:sqlite) | WAL 模式, 文件: data/cyrene.db |
| **终端** | xterm.js v6 + bun-pty | WebSocket PTY |
| **代码编辑器** | Monaco Editor | @monaco-editor/react |
| **认证** | JWT + bcryptjs | @elysiajs/jwt |
| **API 客户端** | Eden Treaty | 前后端类型安全通信 |
| **部署** | Docker + systemd | 支持一键安装脚本 |
| **CI/CD** | GitHub Actions | .github/workflows/build.yml |

**后端依赖**: @elysiajs/cors, @elysiajs/jwt, @rasla/logify, bun-pty, mime-types
**前端依赖**: @iconify/react, lucide-react, js-yaml, sonner, clsx, class-variance-authority

---

## 二、完整目录树

```
d:\CyrenePanel\
│
├── .gitignore                          # Git 忽略规则（node_modules, .next, dist, .env 等）
├── README.md                           # 项目说明文档（中文）
│
├── .claude/                            # Claude AI IDE 本地设置
│   └── settings.local.json             # 本地 Claude 配置
│
├── .github/workflows/                  # GitHub Actions CI/CD
│   └── build.yml                       # 构建工作流
│
├── CyrenePanelBackend/                 # ─── 后端服务 (Elysia + Bun) ───
│   ├── .gitignore                      # 后端 Git 忽略规则
│   ├── package.json                    # 依赖声明 (version 1.0.67)
│   ├── tsconfig.json                   # TypeScript 配置 (target ES2021)
│   ├── config.json.bak                 # 旧 JSON 配置迁移后的备份
│   ├── README.md                       # 后端说明
│   │
│   ├── .cyrene-check-backend/          # 后端检查工具
│   │   └── index.js                    # 检查脚本入口
│   │
│   └── src/                            # 后端源码
│       ├── index.ts                    # 主入口：初始化 admin 账号、API Key，注册所有路由模块，启动 Elysia 服务器
│       ├── db.ts                       # 数据库层：SQLite 建表、CRUD 辅助函数、JSON→SQLite 迁移
│       ├── memory.ts                   # 内存信息工具：读取 /proc/meminfo 获取准确可用内存
│       ├── version.ts                  # 版本号读取：从 CYRENE_VERSION 环境变量或 package.json
│       │
│       ├── account/                    # 认证模块
│       │   └── index.ts                # POST /api/login, GET /api/me, POST /api/auth/key (API Key 换 JWT)
│       │
│       ├── audit/                      # 审计日志模块
│       │   └── index.ts                # 审计日志写入、查询、节点聚合（本地+远程子节点）
│       │
│       ├── certificates/               # SSL/TLS 证书管理
│       │   └── index.ts                # 证书 CRUD、ACME 自动申请（acme.sh/certbot）、部署到 Nginx、续签
│       │
│       ├── docker/                     # Docker 容器管理
│       │   ├── index.ts                # Docker CLI 封装：容器/镜像 CRUD、日志、流式部署、Compose 部署
│       │   └── store.ts                # 应用商店数据：15+ 预置应用 (Nginx, MySQL, Redis, WordPress 等)
│       │
│       ├── environments/               # 开发环境管理
│       │   └── index.ts                # 17 种环境检测器 (Node.js, Python, Go, Rust, Java, Docker, Nginx...)
│       │
│       ├── files/                      # 文件管理
│       │   └── index.ts                # 文件浏览、读写、上传下载、压缩解压、权限修改 (chmod)
│       │
│       ├── instances/                  # 进程实例管理
│       │   ├── index.ts                # 实例 CRUD API + 子节点代理
│       │   ├── store.ts                # 实例存储层：内存运行时状态 + SQLite 持久化
│       │   ├── manager.ts              # 进程管理器：启动/停止/重启/自动重启
│       │   └── ws.ts                   # 实例终端 WebSocket：实时日志推送 + stdin 写入
│       │
│       ├── logger/                     # 日志工具
│       │   └── index.ts                # 分级日志 (DEBUG/INFO/WARN/ERR)、颜色输出、HTTP 状态徽章
│       │
│       ├── nodes/                      # 分布式节点管理
│       │   └── index.ts                # 节点 CRUD、在线检测、系统指标采集(CPU/内存/网络/磁盘IO)、文件/Docker/环境代理
│       │
│       ├── self-check/                 # 环境自检
│       │   └── index.ts                # 检查 tar/zip/unzip/PowerShell 等系统工具，自动安装缺失依赖
│       │
│       ├── services/                   # 系统服务管理
│       │   └── index.ts                # Linux systemd + Windows 服务管理：列表、启停、创建、日志
│       │
│       ├── settings/                   # 面板设置
│       │   └── index.ts                # 面板名称、日志级别、Docker 镜像仓库、页脚代码、API Key 管理
│       │
│       ├── sites/                      # Nginx 网站管理
│       │   └── index.ts                # 站点 CRUD、配置编辑、启用/禁用、重定向、反向代理、日志查看
│       │
│       ├── system/                     # 系统信息
│       │   └── index.ts                # GET /api/system (系统信息)、版本检查、自动更新提交
│       │
│       ├── terminal/                   # Web 终端
│       │   └── index.ts                # WebSocket PTY 终端：支持 Windows/Linux，resize，输入输出流
│       │
│       └── users/                      # 用户管理
│           └── index.ts                # 用户 CRUD、修改密码（本人+管理员）、权限控制
│
├── CyrenePanelFrontend/                # ─── 前端 (Next.js 16 + React 19) ───
│   ├── .gitignore                      # 前端 Git 忽略
│   ├── .prettierrc                     # Prettier 格式化配置
│   ├── .prettierignore                 # Prettier 忽略规则
│   ├── package.json                    # 依赖声明 (version 0.0.1)
│   ├── tsconfig.json                   # TS 配置：路径别名 @/* 和 @backend/*
│   ├── next.config.mjs                 # Next.js 配置：API 代理到后端
│   ├── postcss.config.mjs              # PostCSS 配置 (Tailwind CSS)
│   ├── components.json                 # shadcn/ui 组件配置
│   ├── eslint.config.mjs               # ESLint 配置
│   ├── global.d.ts                     # 全局类型声明
│   ├── test-eden.ts                    # Eden Treaty 测试文件
│   ├── README.md                       # 前端说明
│   │
│   ├── public/                         # 静态资源
│   │   └── .gitkeep                    # 占位文件
│   │
│   ├── app/                            # Next.js App Router 页面
│   │   ├── layout.tsx                  # 根布局：字体加载、ThemeProvider、Toaster
│   │   ├── page.tsx                    # 根页面：重定向到 /login
│   │   ├── globals.css                 # 全局样式 + Tailwind CSS
│   │   ├── favicon.ico                 # 网站图标
│   │   │
│   │   ├── login/                      # 登录页
│   │   │   └── page.tsx                # 登录表单、面板名称显示、页脚代码、主题切换
│   │   │
│   │   └── dashboard/                  # 仪表盘主区域
│   │       ├── layout.tsx              # 仪表盘布局：TaskProvider + PanelNameProvider + DashboardContent
│   │       ├── page.tsx                # 主仪表盘：系统概览、节点状态、CPU/内存/网络/磁盘图表、审计日志
│   │       ├── docker/page.tsx         # Docker 管理页
│   │       ├── environments/page.tsx   # 环境管理页
│   │       ├── files/page.tsx          # 文件管理页
│   │       ├── instances/              # 实例管理
│   │       │   ├── page.tsx            # 实例列表页
│   │       │   └── [id]/page.tsx       # 实例详情页（动态路由）
│   │       ├── nodes/page.tsx          # 节点管理页
│   │       ├── services/page.tsx       # 服务管理页
│   │       ├── settings/page.tsx       # 系统设置页
│   │       ├── sites/page.tsx          # 网站管理页
│   │       ├── terminal/page.tsx       # Web 终端页
│   │       └── users/page.tsx          # 用户管理页
│   │
│   ├── components/                     # React 组件
│   │   ├── .gitkeep                    # 占位文件
│   │   ├── add-container-dialog.tsx    # 添加 Docker 容器对话框（命令、端口、环境变量、卷挂载）
│   │   ├── app-detail-dialog.tsx       # 应用详情对话框
│   │   ├── app-sidebar.tsx             # 侧边导航栏（概览/实例/文件/节点/Docker/服务/网站/环境/终端/用户/设置）
│   │   ├── compose-deploy-dialog.tsx   # Docker Compose 部署对话框（YAML 编辑器 + 流式部署）
│   │   ├── dashboard-content.tsx       # 仪表盘内容包装器（SidebarProvide+ Header + Footer）
│   │   ├── dashboard-footer.tsx        # 仪表盘页脚（版权信息 + 自定义 HTML）
│   │   ├── deploy-app-dialog.tsx       # 应用商店部署对话框（拉取镜像、流式进度）
│   │   ├── environment-self-check-dialog.tsx  # 环境自检对话框
│   │   ├── node-file-transfer-dialog.tsx      # 节点文件传输对话框
│   │   ├── site-certificate-panel.tsx         # 站点 SSL 证书面板（ACME 申请/部署/续签）
│   │   ├── task-center.tsx             # 任务中心（后台任务进度、成功/失败状态、日志查看）
│   │   ├── task-log-terminal.tsx       # 任务日志终端（实时输出显示）
│   │   ├── theme-provider.tsx          # 主题提供者（next-themes + 快捷键 D 切换）
│   │   ├── theme-toggle.tsx            # 主题切换按钮（日/夜模式）
│   │   ├── xterm-terminal.tsx          # xterm.js 终端组件（WebSocket 连接、自适应大小）
│   │   └── ui/                         # shadcn/ui 基础组件 (22 个)
│   │       ├── badge.tsx               # 徽章
│   │       ├── button.tsx              # 按钮
│   │       ├── card.tsx                # 卡片
│   │       ├── checkbox.tsx            # 复选框
│   │       ├── collapsible.tsx         # 折叠面板
│   │       ├── dialog.tsx              # 对话框
│   │       ├── dropdown-menu.tsx       # 下拉菜单
│   │       ├── input.tsx               # 输入框
│   │       ├── label.tsx               # 标签
│   │       ├── progress.tsx            # 进度条
│   │       ├── scroll-area.tsx         # 滚动区域
│   │       ├── select.tsx              # 选择器
│   │       ├── separator.tsx           # 分割线
│   │       ├── sheet.tsx               # 侧边面板
│   │       ├── sidebar.tsx             # 侧边栏
│   │       ├── skeleton.tsx            # 骨架屏
│   │       ├── sonner.tsx              # Toast 通知
│   │       ├── switch.tsx              # 开关
│   │       ├── table.tsx               # 表格
│   │       ├── tabs.tsx                # 选项卡
│   │       ├── textarea.tsx            # 文本域
│   │       └── tooltip.tsx             # 工具提示
│   │
│   ├── hooks/                          # 自定义 React Hooks
│   │   ├── .gitkeep                    # 占位文件
│   │   └── use-mobile.ts              # 移动端检测 Hook
│   │
│   └── lib/                            # 工具库
│       ├── .gitkeep                    # 占位文件
│       ├── api-base.ts                 # API 基础地址 + WebSocket URL 构建
│       ├── api.ts                      # Eden Treaty 客户端（自动附加 JWT Token）
│       ├── panel-name-context.tsx       # 面板名称上下文（跨组件共享面板标题）
│       ├── task-store.tsx              # 后台任务状态管理（SSE 流式进度）
│       └── utils.ts                    # cn() 工具函数 (clsx + tailwind-merge)
│
└── scripts/                            # ─── 部署脚本 ───
    ├── setup_cn.sh                     # 一键安装脚本 (1213 行)：检测系统、安装 Bun/Node.js、下载 Release、注册 systemd
    └── uninstall.sh                    # 卸载脚本 (136 行)：停止服务、删除文件、清理用户和 systemd 配置
```

---

## 三、后端 API 路由结构

| 路由前缀 | 模块 | 主要端点 |
|---------|------|---------|
| `/api/login` | account | POST 登录 |
| `/api/me` | account | GET 当前用户信息 |
| `/api/auth/key` | account | POST API Key 换取 JWT |
| `/api/users` | users | GET 列表, POST 创建 |
| `/api/users/:id/password` | users | PATCH 修改密码 |
| `/api/users/:id` | users | DELETE 删除用户 |
| `/api/settings` | settings | GET/PUT 面板设置 |
| `/api/settings/footer` | settings | GET/PUT 页脚代码 |
| `/api/public/footer` | settings | GET 公开页脚（无需登录） |
| `/api/system` | system | GET 系统信息+指标 |
| `/api/system/version` | system | GET 版本号 |
| `/api/system/update` | system | GET 检查更新, POST 应用更新 |
| `/api/instances` | instances | GET 列表, POST 创建 |
| `/api/instances/:id` | instances | GET 详情, PUT 更新, DELETE 删除 |
| `/api/instances/:id/start\|stop\|restart` | instances | POST 启动/停止/重启 |
| `/api/instances/:id/terminal` | instances | WebSocket 终端 |
| `/api/files` | files | GET 列表, DELETE 删除 |
| `/api/files/read\|write\|download` | files | GET/PUT 文件读写下载 |
| `/api/files/mkdir\|rename\|copy\|move` | files | POST/PATCH 目录和文件操作 |
| `/api/files/compress\|extract` | files | POST 压缩/解压 |
| `/api/files/upload/chunk\|status` | files | POST/GET 分片上传 |
| `/api/files/chmod` | files | PATCH 修改权限 |
| `/api/nodes` | nodes | GET 列表, POST 添加 |
| `/api/nodes/:id` | nodes | PATCH 编辑, DELETE 删除 |
| `/api/nodes/overview` | nodes | GET 节点状态总览 |
| `/api/nodes/:id/files/*` | nodes | 子节点文件代理 |
| `/api/nodes/:id/docker/*` | nodes | 子节点 Docker 代理 |
| `/api/nodes/:id/services/*` | nodes | 子节点服务代理 |
| `/api/nodes/:id/environments/*` | nodes | 子节点环境代理 |
| `/api/docker/info` | docker | GET Docker 系统信息 |
| `/api/docker/containers` | docker | GET 列表, DELETE 删除 |
| `/api/docker/containers/:id/*` | docker | GET 详情/日志, POST 启停重启 |
| `/api/docker/images` | docker | GET 列表, DELETE 删除 |
| `/api/docker/store` | docker | GET 应用商店列表 |
| `/api/docker/store/deploy*` | docker | POST 部署应用（含 SSE 流式） |
| `/api/docker/compose/deploy-stream` | docker | POST Compose 流式部署 |
| `/api/docker/settings` | docker | GET/PUT Docker 镜像仓库设置 |
| `/api/sites` | sites | GET 列表, POST 创建 |
| `/api/sites/:name` | sites | DELETE 删除 |
| `/api/sites/:name/settings` | sites | GET 站点设置+日志 |
| `/api/sites/:name/root\|config` | sites | PUT 修改根目录/配置 |
| `/api/sites/:name/redirect\|proxy` | sites | PUT 重定向/反向代理 |
| `/api/sites/:name/:action` | sites | POST enable/disable/test/reload/diagnose |
| `/api/sites/:name/certificate` | certificates | GET 站点证书状态 |
| `/api/sites/:name/certificate/deploy` | certificates | POST 部署证书到站点 |
| `/api/sites/:name/certificate/request-stream` | certificates | POST SSE 流式申请证书 |
| `/api/certificates` | certificates | GET 列表, POST 上传 |
| `/api/certificates/:id` | certificates | DELETE 删除 |
| `/api/certificates/:id/renew-stream` | certificates | POST SSE 流式续签 |
| `/api/certificates/acme/*` | certificates | GET 环境检测, POST 安装 acme.sh |
| `/api/services` | services | GET 列表, POST 创建 |
| `/api/services/logs/:name` | services | GET 日志 |
| `/api/services/:name/:action` | services | POST start/stop/restart/enable/disable |
| `/api/environments` | environments | GET 环境扫描列表 |
| `/api/environments/:id` | environments | GET 环境详情 |
| `/api/environments/:id/install\|update\|remove` | environments | POST 安装/更新/卸载 |
| `/api/environments/:id/:action/stream` | environments | POST SSE 流式操作 |
| `/api/self-check/environment` | self-check | GET 环境依赖检测 |
| `/api/self-check/environment/install` | self-check | POST 安装缺失依赖 |
| `/api/terminal` | terminal | WebSocket PTY 终端 |
| `/api/audit/logs` | audit | GET 本地审计日志 |
| `/api/audit/aggregate` | audit | GET 汇总日志（本地+所有子节点） |
| `/api/key` | nodes | GET 获取主节点 API Key |
| `/api/key/regenerate` | nodes | POST 重新生成 API Key |

---

## 四、数据库表结构 (SQLite)

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `app_config` | 应用配置键值存储 | key, value |
| `instances` | 进程实例配置 | id, name, command, cwd, env, autoRestart, nodeId, nodeName |
| `users` | 用户账号 | id, username, password (bcrypt), role, createdAt |
| `nodes` | 子节点信息 | id, name, address, apiKey, isMain |
| `audit_logs` | 审计日志 | id, timestamp, username, category, action, target, detail, ip, success |

---

## 五、前端页面与组件对应关系

| 页面路由 | 主要功能 | 使用的关键组件 |
|---------|---------|--------------|
| `/login` | 用户登录 | Card, Input, Button, ThemeToggle |
| `/dashboard` | 系统概览仪表盘 | 资源图表、节点状态表、审计日志表、StatCard |
| `/dashboard/instances` | 实例管理 | AddContainerDialog, XtermTerminal |
| `/dashboard/instances/[id]` | 实例详情 | XtermTerminal, 日志实时显示 |
| `/dashboard/files` | 文件管理 | 文件浏览器、上传、编辑 |
| `/dashboard/nodes` | 节点管理 | 节点表格、NodeFileTransferDialog |
| `/dashboard/docker` | Docker 管理 | 容器表格、DeployAppDialog, ComposeDeployDialog |
| `/dashboard/services` | 服务管理 | 服务列表、启停操作 |
| `/dashboard/sites` | 网站管理 | 站点列表、SiteCertificatePanel |
| `/dashboard/environments` | 环境管理 | 环境检测、安装/更新 |
| `/dashboard/terminal` | Web 终端 | XtermTerminal (系统 Shell) |
| `/dashboard/users` | 用户管理 | 用户表格、创建/删除/修改密码 |
| `/dashboard/settings` | 系统设置 | 面板名称、日志级别、Docker 镜像仓库、页脚代码 |

---

## 六、关键设计特点

1. **分布式架构**：主节点可通过 API Key 管理多个子节点，文件、Docker、服务、环境等操作可代理到子节点
2. **数据库迁移**：自动从旧 JSON 配置文件迁移到 SQLite，迁移后备份原文件为 `.bak`
3. **首次启动初始化**：自动创建 admin 账号（随机密码）和 API Key
4. **流式部署**：Docker 应用商店和 Compose 部署使用 SSE (Server-Sent Events) 实时推送进度
5. **进程管理**：实例支持自动重启（崩溃后 3 秒）、WebSocket 实时日志推送
6. **SSL 证书自动化**：支持 acme.sh 和 certbot，HTTP/DNS 验证，自动部署到 Nginx 站点
7. **跨平台**：后端和前端均支持 Linux 和 Windows（文件管理、服务管理、终端有平台适配）
8. **审计日志**：所有敏感操作记录到 audit_logs 表，支持主节点汇总子节点日志
9. **任务中心**：前端全局任务管理器，后台异步执行长时间操作并显示进度

