#!/bin/bash
# ============================================================
#  CyrenePanel 一键部署脚本
#  用法: sudo su -c "wget -qO- https://raw.githubusercontent.com/ChuxinNeko/CyrenePanel/main/scripts/setup_cn.sh | bash"
#  或:   sudo bash setup_cn.sh
# ============================================================

set -e

# ── 颜色定义 ──────────────────────────────────────────────────
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
BLUE='\033[34m'
CYAN='\033[36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ── 基本配置 ──────────────────────────────────────────────────
CYRENE_HOME="/opt/CyrenePanel"
REPO_URL="https://github.com/ChuxinNeko/CyrenePanel.git"
BACKEND_PORT=5677
FRONTEND_PORT=3000
BACKEND_USER="cyrene"

# ── 工具函数 ──────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; }
step()    { echo -e "\n${CYAN}${BOLD}>>> $*${NC}"; }

# ── Banner ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║                                                   ║"
echo "  ║            🌊 CyrenePanel 一键部署脚本            ║"
echo "  ║                                                   ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── 检查 root 权限 ──────────────────────────────────────────
step "检查系统环境"

if [ "$EUID" -ne 0 ]; then
    error "请使用 root 权限运行此脚本"
    echo "  用法: sudo bash $0"
    exit 1
fi
success "已获取 root 权限"

# ── 检测操作系统 ──────────────────────────────────────────────
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
else
    error "无法检测操作系统类型"
    exit 1
fi

info "操作系统: $PRETTY_NAME"

case "$OS" in
    ubuntu|debian)
        PKG_MANAGER="apt"
        ;;
    centos|rhel|almalinux|rocky|fedora)
        PKG_MANAGER="yum"
        ;;
    *)
        warn "未经测试的操作系统: $OS，将尝试使用 apt"
        PKG_MANAGER="apt"
        ;;
esac

# ── 安装系统依赖 ──────────────────────────────────────────────
step "安装系统依赖"

if [ "$PKG_MANAGER" = "apt" ]; then
    apt-get update -y >/dev/null 2>&1
    apt-get install -y curl git build-essential >/dev/null 2>&1
elif [ "$PKG_MANAGER" = "yum" ]; then
    yum install -y curl git gcc gcc-c++ make >/dev/null 2>&1
fi
success "系统依赖安装完成"

# ── 安装 Bun ──────────────────────────────────────────────────
step "安装 Bun"

BUN_GLOBAL_PATH="/usr/local/bin/bun"

if command -v bun &>/dev/null; then
    BUN_VER=$(bun --version)
    info "Bun 已安装: v$BUN_VER"
    BUN_BIN_PATH=$(which bun)
else
    info "正在安装 Bun..."
    curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
    
    # 将 bun 复制到全局路径，确保所有用户可用
    BUN_SRC="$HOME/.bun/bin/bun"
    if [ -f "$BUN_SRC" ]; then
        cp "$BUN_SRC" "$BUN_GLOBAL_PATH"
        chmod +x "$BUN_GLOBAL_PATH"
        success "Bun 安装完成: v$(bun --version)"
        BUN_BIN_PATH="$BUN_GLOBAL_PATH"
    else
        error "Bun 安装失败"
        exit 1
    fi
fi

# 确保 BUN_BIN_PATH 变量可用
if [ -z "$BUN_BIN_PATH" ]; then
    BUN_BIN_PATH=$(which bun 2>/dev/null || echo "$BUN_GLOBAL_PATH")
fi

# ── 克隆项目 ──────────────────────────────────────────────────
step "克隆 CyrenePanel 项目"

if [ -d "$CYRENE_HOME" ]; then
    warn "检测到已有安装目录: $CYRENE_HOME"
    # 如果是管道执行（非交互），默认覆盖安装
    if [ -t 0 ]; then
        read -p "是否覆盖安装? (y/N): " OVERWRITE
    else
        OVERWRITE="y"
        info "非交互模式，自动覆盖安装"
    fi
    if [ "$OVERWRITE" = "y" ] || [ "$OVERWRITE" = "Y" ]; then
        info "正在停止已有服务..."
        systemctl stop cyrene-backend cyrene-frontend 2>/dev/null || true
        info "正在备份旧数据..."
        BACKUP_DIR="${CYRENE_HOME}.bak.$(date +%Y%m%d%H%M%S)"
        cp -r "$CYRENE_HOME" "$BACKUP_DIR"
        success "旧数据已备份到: $BACKUP_DIR"
        rm -rf "$CYRENE_HOME"
    else
        info "正在更新现有安装..."
        cd "$CYRENE_HOME"
        git pull origin main >/dev/null 2>&1 || true
        success "代码更新完成"
    fi
fi

if [ ! -d "$CYRENE_HOME" ]; then
    info "正在克隆仓库..."
    git clone "$REPO_URL" "$CYRENE_HOME" 2>/dev/null
    success "项目克隆完成"
fi

cd "$CYRENE_HOME"

# ── 创建专用用户 ──────────────────────────────────────────────
step "创建运行用户"

if ! id "$BACKEND_USER" &>/dev/null; then
    useradd -r -s /bin/false -d "$CYRENE_HOME" "$BACKEND_USER" 2>/dev/null
    success "用户 $BACKEND_USER 创建完成"
else
    info "用户 $BACKEND_USER 已存在"
fi

chown -R "$BACKEND_USER":"$BACKEND_USER" "$CYRENE_HOME"

# ── 安装后端依赖 ──────────────────────────────────────────────
step "安装后端依赖"

cd "$CYRENE_HOME/CyrenePanelBackend"
su -s /bin/bash -c "PATH=$BUN_BIN_PATH:/usr/local/bin:/usr/bin:/bin bun install" "$BACKEND_USER"
success "后端依赖安装完成"

# ── 构建前端 ──────────────────────────────────────────────────
step "构建前端"

cd "$CYRENE_HOME/CyrenePanelFrontend"

# 需要临时创建 tsconfig 路径别名，让构建能正常找到后端类型
# 修改 .env 配置
cat > .env.production <<EOF
NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}
EOF

info "正在安装前端依赖..."
su -s /bin/bash -c "PATH=$BUN_BIN_PATH:/usr/local/bin:/usr/bin:/bin bun install" "$BACKEND_USER"

info "正在构建前端..."
su -s /bin/bash -c "PATH=$BUN_BIN_PATH:/usr/local/bin:/usr/bin:/bin bun run build" "$BACKEND_USER"
success "前端构建完成"

# ── 设置权限 ──────────────────────────────────────────────────
step "设置文件权限"

chown -R "$BACKEND_USER":"$BACKEND_USER" "$CYRENE_HOME"

# 确保 cyrene 用户可以访问日志目录
mkdir -p "$CYRENE_HOME/CyrenePanelBackend/logs"
chmod 755 "$CYRENE_HOME/CyrenePanelBackend/logs"
success "权限设置完成"

# ── 创建 systemd 服务: 后端 ──────────────────────────────────
step "创建系统服务"

BUN_BIN="$BUN_BIN_PATH"
# 确保 bun 二进制文件路径正确
if [ ! -f "$BUN_BIN" ]; then
    BUN_BIN=$(which bun 2>/dev/null || echo "$BUN_GLOBAL_PATH")
fi
info "Bun 路径: $BUN_BIN"

cat > /etc/systemd/system/cyrene-backend.service <<EOF
[Unit]
Description=CyrenePanel Backend Server
After=network.target

[Service]
Type=simple
User=$BACKEND_USER
Group=$BACKEND_USER
WorkingDirectory=$CYRENE_HOME/CyrenePanelBackend
Environment=NODE_ENV=production
Environment=BUN_INSTALL=/usr/local
Environment=PATH=$BUN_BIN:/usr/local/bin:/usr/bin:/bin
ExecStart=$BUN_BIN run src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$CYRENE_HOME/CyrenePanelBackend/data $CYRENE_HOME/CyrenePanelBackend/logs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# ── 创建 systemd 服务: 前端 ──────────────────────────────────
cat > /etc/systemd/system/cyrene-frontend.service <<EOF
[Unit]
Description=CyrenePanel Frontend Server
After=network.target cyrene-backend.service
Wants=cyrene-backend.service

[Service]
Type=simple
User=$BACKEND_USER
Group=$BACKEND_USER
WorkingDirectory=$CYRENE_HOME/CyrenePanelFrontend
Environment=NODE_ENV=production
Environment=PORT=$FRONTEND_PORT
Environment=HOSTNAME=0.0.0.0
Environment=BUN_INSTALL=/usr/local
Environment=PATH=$BUN_BIN:/usr/local/bin:/usr/bin:/bin
ExecStart=$BUN_BIN run next start -p $FRONTEND_PORT -H 0.0.0.0
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$CYRENE_HOME/CyrenePanelFrontend/.next
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# ── 启动服务 ──────────────────────────────────────────────────
step "启动服务"

systemctl daemon-reload
systemctl enable cyrene-backend cyrene-frontend >/dev/null 2>&1
systemctl start cyrene-backend
sleep 2
systemctl start cyrene-frontend

# ── 等待服务启动 ──────────────────────────────────────────────
info "等待服务启动..."
for i in $(seq 1 15); do
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${BACKEND_PORT}" >/dev/null 2>&1; then
        success "后端服务启动成功"
        break
    fi
    if [ "$i" -eq 15 ]; then
        warn "后端服务启动超时，请手动检查"
    fi
    sleep 1
done

for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1; then
        success "前端服务启动成功"
        break
    fi
    if [ "$i" -eq 30 ]; then
        warn "前端服务启动超时，请手动检查"
    fi
    sleep 1
done

# ── 输出部署信息 ──────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║                                                   ║"
echo "  ║          ✅ CyrenePanel 部署完成！                 ║"
echo "  ║                                                   ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# 获取公网 IP
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo "你的服务器IP")

echo -e "  ${BOLD}前端访问地址:${NC}  http://${PUBLIC_IP}:${FRONTEND_PORT}"
echo -e "  ${BOLD}后端 API 地址:${NC} http://${PUBLIC_IP}:${BACKEND_PORT}"
echo ""
echo -e "  ${BOLD}安装目录:${NC}      $CYRENE_HOME"
echo -e "  ${BOLD}默认账号:${NC}      admin"
echo -e "  ${BOLD}初始密码:${NC}      请查看日志获取首次启动生成的密码"
echo ""
echo -e "  ${BOLD}常用命令:${NC}"
echo -e "    查看后端日志:  ${CYAN}journalctl -u cyrene-backend -f${NC}"
echo -e "    查看前端日志:  ${CYAN}journalctl -u cyrene-frontend -f${NC}"
echo -e "    重启后端:      ${CYAN}systemctl restart cyrene-backend${NC}"
echo -e "    重启前端:      ${CYAN}systemctl restart cyrene-frontend${NC}"
echo -e "    停止所有:      ${CYAN}systemctl stop cyrene-backend cyrene-frontend${NC}"
echo -e "    查看状态:      ${CYAN}systemctl status cyrene-backend cyrene-frontend${NC}"
echo -e "    更新项目:      ${CYAN}cd $CYRENE_HOME && git pull && cd CyrenePanelBackend && bun install && cd ../CyrenePanelFrontend && bun install && bun run build${NC}"
echo ""

# 显示初始密码
if [ -f "$CYRENE_HOME/CyrenePanelBackend/data/cyrene.db" ]; then
    info "正在获取初始密码信息..."
    echo -e "  ${YELLOW}提示: 首次启动时，管理员密码已自动生成并打印在后端日志中${NC}"
    echo -e "  ${YELLOW}请使用以下命令查看:${NC}"
    echo -e "  ${CYAN}journalctl -u cyrene-backend --no-pager | grep '初始密码'${NC}"
    echo ""
fi

echo -e "  ${YELLOW}提示: 如需修改前端连接的后端地址，请编辑:${NC}"
echo -e "  ${CYAN}$CYRENE_HOME/CyrenePanelFrontend/.env.production${NC}"
echo -e "  ${YELLOW}然后重新构建前端: cd $CYRENE_HOME/CyrenePanelFrontend && bun run build && systemctl restart cyrene-frontend${NC}"
echo ""