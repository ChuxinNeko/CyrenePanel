#!/bin/bash
# ============================================================
#  CyrenePanel 卸载脚本
#  用法: sudo bash uninstall.sh
# ============================================================

set -e

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
BLUE='\033[34m'
CYAN='\033[36m'
NC='\033[0m'
BOLD='\033[1m'

CYRENE_HOME="/opt/CyrenePanel"
BACKEND_USER="cyrene"

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; }

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║                                                   ║"
echo "  ║          🗑️  CyrenePanel 卸载脚本                 ║"
echo "  ║                                                   ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
    error "请使用 root 权限运行此脚本"
    echo "  用法: sudo bash $0"
    exit 1
fi

echo -e "  ${RED}${BOLD}警告: 此操作将完全卸载 CyrenePanel！${NC}"
echo -e "  ${YELLOW}安装目录: $CYRENE_HOME 将被删除${NC}"
echo -e "  ${YELLOW}服务 cyrene-backend 和 cyrene-frontend 将被移除${NC}"
echo -e "  ${YELLOW}用户 $BACKEND_USER 将被删除${NC}"
echo ""

if [ -t 0 ]; then
    read -p "确认卸载? (y/N): " CONFIRM
else
    CONFIRM="y"
    info "非交互模式，自动确认卸载"
fi

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo -e "${YELLOW}已取消卸载${NC}"
    exit 0
fi

# 停止服务
info "停止服务..."
systemctl stop cyrene-backend 2>/dev/null || true
systemctl stop cyrene-frontend 2>/dev/null || true
systemctl stop cyrene-updater.path cyrene-updater.service 2>/dev/null || true

# 禁用服务
info "禁用服务..."
systemctl disable cyrene-backend 2>/dev/null || true
systemctl disable cyrene-frontend 2>/dev/null || true
systemctl disable cyrene-updater.path 2>/dev/null || true

# 删除 systemd 服务文件
info "删除服务配置..."
rm -f /etc/systemd/system/cyrene-backend.service
rm -f /etc/systemd/system/cyrene-frontend.service
rm -f /etc/systemd/system/cyrene-updater.service
rm -f /etc/systemd/system/cyrene-updater.path
systemctl daemon-reload

# 删除 polkit 规则
if [ -f /etc/polkit-1/rules.d/49-cyrene.rules ]; then
    info "删除 polkit 规则..."
    rm -f /etc/polkit-1/rules.d/49-cyrene.rules
    systemctl reload polkit 2>/dev/null || true
fi

# 删除 sudoers 配置
if [ -f /etc/sudoers.d/cyrene ]; then
    info "删除 sudoers 配置..."
    rm -f /etc/sudoers.d/cyrene
fi

# 删除安装目录
if [ -d "$CYRENE_HOME" ]; then
    info "删除安装目录..."
    rm -rf "$CYRENE_HOME"
    success "安装目录已删除"
fi

# 删除备份文件
BACKUP_DIR="/opt"
for bak in $(ls -d ${BACKUP_DIR}/CyrenePanel.bak.* 2>/dev/null || true); do
    if [ -d "$bak" ]; then
        info "删除备份: $bak"
        rm -rf "$bak"
    fi
done

# 删除 CLI 工具
if [ -f /usr/local/bin/cyp ]; then
    info "删除 CLI 管理工具..."
    rm -f /usr/local/bin/cyp
fi

if [ -f /usr/local/bin/cyp-update-apply ]; then
    info "删除更新助手..."
    rm -f /usr/local/bin/cyp-update-apply
fi

# 删除用户
if id "$BACKEND_USER" &>/dev/null; then
    info "删除用户 $BACKEND_USER..."
    userdel "$BACKEND_USER" 2>/dev/null || true
    success "用户 $BACKEND_USER 已删除"
fi

echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║                                                   ║"
echo "  ║          ✅ CyrenePanel 已完全卸载！               ║"
echo "  ║                                                   ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "  ${YELLOW}提示: Bun 与 Node.js 未被移除（系统级共享依赖），如需卸载请手动处理${NC}"
echo ""