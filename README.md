# CyrenePanel

一个轻量化的服务管理面板，支持 Docker 实例管理、节点部署、网站证书管理、compose 项目编排等功能。基于 Bun + Next.js 构建，部署后占用资源极少，适合个人 VPS 或小团队使用。

---

## 功能一览

- **实例管理** — 图形化操控 Docker 容器，支持容器启停、重启、日志查看、终端连接
- **Compose 编排** — 在线编辑 `docker-compose.yml`，一键部署完整应用栈
- **节点管理** — 分布式部署，可添加多个远程节点统一管理
- **环境管理** — 环境变量分组管理，方便不同场景切换配置
- **网站与证书** — 支持 Let's Encrypt 免费证书申请与自动续期
- **文件管理** — 浏览器内直接浏览、编辑、传输节点上的文件
- **终端** — 集成 WebTerminal，直接在浏览器里操作容器和节点
- **用户系统** — 多用户隔离，权限分级，API Key 供程序调用

---

## 快速部署

一行命令搞定所有安装步骤（支持 Ubuntu / Debian / CentOS / Fedora 等主流 Linux 发行版）：

```bash
curl -fsSL https://dockerhub.nekofun.top/panel/install.sh | sudo bash
```

也可以先把脚本下载到本地看个究竟再执行：

```bash
wget https://dockerhub.nekofun.top/panel/install.sh
sudo bash setup_cn.sh
```

部署脚本会自动完成以下事项：

1. 检测系统环境，安装必要依赖（curl、zip、unzip、ca-certificates）
2. 安装 Node.js 22 和 Bun 运行时
3. 下载最新 Release 包并解压到 `/opt/CyrenePanel`
4. 创建专用运行用户，配置文件权限
5. 注册 systemd 服务，开机自启
6. 安装前端生产依赖
7. 安装 `cyp` 管理命令和自动更新助手
8. 启动服务并输出初始账号信息

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CYRENE_VERSION` | 最新 release | 指定安装版本，如 `1.2.3` |
| `CYRENE_HOME` | `/opt/CyrenePanel` | 安装路径 |
| `BACKEND_PORT` | `5677` | 后端服务端口 |
| `FRONTEND_PORT` | `30198` | 前端服务端口 |
| `CYRENE_DOWNLOAD_SOURCE` | `github` | 下载源，`mirror` 使用 gh-proxy |
| `CYRENE_USER` | `cyrene` | 运行用户 |

示例：

```bash
sudo CYRENE_VERSION=1.2.3 FRONTEND_PORT=8080 bash setup_cn.sh
```

---

## 安装完成后

部署完成后，脚本会输出类似以下信息：

```
CyrenePanel 部署完成
  前端地址:    http://你的服务器IP:30198
  管理员账号:  admin
  初始密码:    xxxxxxxx
  API Key:    xxxxxxxx
```

登录后请**立即修改初始密码**。

---

## 常用管理命令

安装后系统会注册一个 `cyp` 命令（需要 root 权限），用于日常维护：

```bash
sudo cyp              # 打开交互式管理菜单
sudo cyp restart      # 重启前后端服务
sudo cyp start        # 启动服务
sudo cyp stop         # 停止服务
sudo cyp username     # 修改管理员用户名
sudo cyp password     # 修改管理员密码
sudo cyp apikey       # 重置 API Key
sudo cyp status       # 查看服务状态
sudo cyp info         # 查看访问信息
sudo cyp logs         # 查看实时日志
```

也可以直接用 systemd 管理服务：

```bash
systemctl status cyrene-backend cyrene-frontend
journalctl -u cyrene-backend -u cyrene-frontend -f
```

---

## 技术架构

| 层级 | 技术栈 |
|------|--------|
| 后端框架 | [Elysia](https://elysia.dev/) + Bun |
| 前端框架 | Next.js 16 + React 19 |
| UI 组件 | shadcn/ui + Radix UI |
| 数据库 | SQLite（Bun 内置） |
| 终端 | xterm.js + bun-pty |
| 编辑器 | Monaco Editor |
| 认证 | JWT + bcrypt |
| 部署方式 | Docker + systemd |

后端默认监听 `0.0.0.0:5677`，前端默认监听 `0.0.0.0:30198`，前端通过代理（`/api`）与后端通信，无需暴露后端端口。

---

## 目录结构

```
/opt/CyrenePanel/
├── backend/
│   ├── server           # 后端可执行文件（预编译）
│   ├── data/            # SQLite 数据库存放位置
│   │   └── cyrene.db
│   └── logs/            # 日志目录
└── frontend/
    ├── .env.production   # 前端环境变量
    └── node_modules/    # 生产依赖
```

---

## 二次开发

如果你想从源码启动开发环境：

### 后端

```bash
cd CyrenePanelBackend
bun install
bun run dev
```

后端会在 `http://localhost:5677` 启动，首次启动会自动创建管理员账号和 API Key（输出在终端）。

### 前端

```bash
cd CyrenePanelFrontend
bun install
bun run dev
```

前端会在 `http://localhost:3000` 启动，连接后端地址由环境变量 `CYRENE_BACKEND_URL` 控制（开发环境默认连接 `http://127.0.0.1:5677`）。

---

## 系统要求

- Linux（amd64 / arm64）
- systemd
- Docker（如果需要管理容器和编排）
- 至少 1GB 内存

---

## 获取帮助

- 提交 GitHub Issue：https://github.com/ChuxinNeko/CyrenePanel/issues
