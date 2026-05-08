#!/usr/bin/env bash
# ============================================================
#  CyrenePanel 一键安装/更新脚本
#  默认从 GitHub Release 拉取最新版本并注册 systemd 服务
#
#  用法:
#    sudo bash setup_cn.sh
#    curl -fsSL https://raw.githubusercontent.com/ChuxinNeko/CyrenePanel/main/scripts/setup_cn.sh | sudo bash
#
#  可选环境变量:
#    CYRENE_REPO=ChuxinNeko/CyrenePanel
#    CYRENE_VERSION=1.0.50          # 指定版本；留空则使用 latest release
#    CYRENE_HOME=/opt/CyrenePanel
#    BACKEND_PORT=5677
#    FRONTEND_PORT=3000
# ============================================================

set -Eeuo pipefail

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
BLUE='\033[34m'
CYAN='\033[36m'
BOLD='\033[1m'
NC='\033[0m'

CYRENE_REPO="${CYRENE_REPO:-ChuxinNeko/CyrenePanel}"
CYRENE_HOME="${CYRENE_HOME:-/opt/CyrenePanel}"
CYRENE_USER="${CYRENE_USER:-cyrene}"
BACKEND_PORT="${BACKEND_PORT:-5677}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
TMP_DIR="${TMPDIR:-/tmp}/cyrene-install.$$"
RUNTIME_PATH="/usr/local/bin:/usr/bin:/bin"

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }
step()    { echo -e "\n${CYAN}${BOLD}>>> $*${NC}"; }

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_root() {
  if [ "${EUID}" -ne 0 ]; then
    error "请使用 root 权限运行：sudo bash setup_cn.sh"
    exit 1
  fi
}

detect_os() {
  if [ "$(uname -s)" != "Linux" ]; then
    error "当前安装脚本仅支持 Linux + systemd。"
    exit 1
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    error "未检测到 systemd，无法注册系统服务。"
    exit 1
  fi

  if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-linux}"
    OS_NAME="${PRETTY_NAME:-Linux}"
  else
    OS_ID="linux"
    OS_NAME="Linux"
  fi

  case "$OS_ID" in
    ubuntu|debian)
      PKG_MANAGER="apt"
      ;;
    centos|rhel|almalinux|rocky)
      PKG_MANAGER="yum"
      ;;
    fedora)
      PKG_MANAGER="dnf"
      ;;
    *)
      if command -v apt-get >/dev/null 2>&1; then
        PKG_MANAGER="apt"
      elif command -v dnf >/dev/null 2>&1; then
        PKG_MANAGER="dnf"
      elif command -v yum >/dev/null 2>&1; then
        PKG_MANAGER="yum"
      else
        error "无法识别包管理器，请先安装 curl、zip、unzip、ca-certificates。"
        exit 1
      fi
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)
      SYSTEM_ARCH="x64"
      ;;
    aarch64|arm64)
      SYSTEM_ARCH="arm64"
      ;;
    *)
      error "不支持的系统架构：$(uname -m)。当前 Release 仅提供 linux-x64 / linux-arm64。"
      exit 1
      ;;
  esac

  SYSTEM_OS="linux"
  info "系统：$OS_NAME"
  info "架构：$SYSTEM_OS-$SYSTEM_ARCH"
}

install_packages() {
  step "检查并安装系统依赖"
  local packages=(curl ca-certificates zip unzip)

  case "$PKG_MANAGER" in
    apt)
      apt-get update -y
      DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
      ;;
    dnf)
      dnf install -y "${packages[@]}"
      ;;
    yum)
      yum install -y "${packages[@]}"
      ;;
  esac

  for cmd in curl zip unzip systemctl; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      error "依赖检查失败：未找到 $cmd"
      exit 1
    fi
  done

  success "系统依赖已就绪"
}

install_nodejs() {
  step "Check Node.js"

  if PATH="$RUNTIME_PATH" command -v node >/dev/null 2>&1; then
    NODE_BIN="$(PATH="$RUNTIME_PATH" command -v node)"
    success "Node.js is ready: $($NODE_BIN -v)"
    return
  fi

  info "Node.js not found in deployment PATH; installing Node.js 22"

  case "$PKG_MANAGER" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
      ;;
    dnf)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      dnf install -y nodejs
      ;;
    yum)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      yum install -y nodejs
      ;;
    *)
      error "Unable to install Node.js 22 for the detected package manager"
      exit 1
      ;;
  esac

  if ! PATH="$RUNTIME_PATH" command -v node >/dev/null 2>&1; then
    error "Node.js 22 installation failed: node command not found"
    exit 1
  fi

  NODE_BIN="$(PATH="$RUNTIME_PATH" command -v node)"
  success "Node.js installed: $($NODE_BIN -v)"
}

install_bun() {
  step "检查 Bun 运行环境"
  if PATH="$RUNTIME_PATH" command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(PATH="$RUNTIME_PATH" command -v bun)"
    success "Bun 已安装：$($BUN_BIN --version)"
    return
  fi

  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
    install -m 0755 "$BUN_BIN" /usr/local/bin/bun
    BUN_BIN="/usr/local/bin/bun"
    success "Bun is ready: $($BUN_BIN --version)"
    return
  fi

  info "正在安装 Bun（用于运行 Next.js 前端服务）..."
  curl -fsSL https://bun.sh/install | bash

  if [ -x "$HOME/.bun/bin/bun" ]; then
    install -m 0755 "$HOME/.bun/bin/bun" /usr/local/bin/bun
  fi

  if ! PATH="$RUNTIME_PATH" command -v bun >/dev/null 2>&1; then
    error "Bun 安装失败"
    exit 1
  fi

  BUN_BIN="$(PATH="$RUNTIME_PATH" command -v bun)"
  success "Bun 安装完成：$($BUN_BIN --version)"
}

resolve_release() {
  step "解析 GitHub Release"
  mkdir -p "$TMP_DIR"

  if [ -n "${CYRENE_VERSION:-}" ]; then
    RELEASE_VERSION="${CYRENE_VERSION#v}"
    RELEASE_TAG="v${RELEASE_VERSION}"
  else
    local api_url="https://api.github.com/repos/${CYRENE_REPO}/releases/latest"
    local release_json="$TMP_DIR/latest-release.json"
    curl -fsSL "$api_url" -o "$release_json"
    RELEASE_TAG="$(grep -m1 '"tag_name"' "$release_json" | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
    RELEASE_VERSION="${RELEASE_TAG#v}"
  fi

  if [ -z "${RELEASE_VERSION:-}" ] || [ "$RELEASE_VERSION" = "$RELEASE_TAG" ]; then
    warn "Release tag 未使用 v 前缀，将按原始版本号继续：${RELEASE_TAG:-unknown}"
  fi

  ASSET_NAME="CyrenePanel${RELEASE_VERSION}-${SYSTEM_OS}-${SYSTEM_ARCH}.zip"
  DOWNLOAD_URL="https://github.com/${CYRENE_REPO}/releases/download/${RELEASE_TAG}/${ASSET_NAME}"

  info "Release：$RELEASE_TAG"
  info "安装包：$ASSET_NAME"
}

download_release() {
  step "下载 Release 安装包"
  PACKAGE_PATH="$TMP_DIR/$ASSET_NAME"
  curl -fL --retry 3 --retry-delay 2 "$DOWNLOAD_URL" -o "$PACKAGE_PATH"
  unzip -t "$PACKAGE_PATH" >/dev/null
  success "安装包下载并校验完成"
}

stop_services() {
  systemctl stop cyrene-frontend 2>/dev/null || true
  systemctl stop cyrene-backend 2>/dev/null || true
}

backup_existing_install() {
  if [ ! -d "$CYRENE_HOME" ]; then
    return
  fi

  step "备份已有安装"
  stop_services
  BACKUP_DIR="${CYRENE_HOME}.bak.$(date +%Y%m%d%H%M%S)"
  cp -a "$CYRENE_HOME" "$BACKUP_DIR"
  success "已备份到：$BACKUP_DIR"
}

extract_release() {
  step "部署文件"
  local extract_dir="$TMP_DIR/extract"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  unzip -q "$PACKAGE_PATH" -d "$extract_dir"

  local package_root="$extract_dir/CyrenePanel${RELEASE_VERSION}-${SYSTEM_OS}-${SYSTEM_ARCH}"
  if [ ! -d "$package_root" ]; then
    package_root="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  fi

  if [ ! -d "$package_root/backend" ] || [ ! -d "$package_root/frontend" ]; then
    error "安装包结构不正确：缺少 backend 或 frontend 目录"
    exit 1
  fi

  local old_data=""
  if [ -d "$CYRENE_HOME/backend/data" ]; then
    old_data="$TMP_DIR/data"
    cp -a "$CYRENE_HOME/backend/data" "$old_data"
  elif [ -d "$CYRENE_HOME/CyrenePanelBackend/data" ]; then
    old_data="$TMP_DIR/data"
    cp -a "$CYRENE_HOME/CyrenePanelBackend/data" "$old_data"
  fi

  rm -rf "$CYRENE_HOME"
  mkdir -p "$CYRENE_HOME"
  cp -a "$package_root/." "$CYRENE_HOME/"

  mkdir -p "$CYRENE_HOME/backend/data" "$CYRENE_HOME/backend/logs"
  if [ -n "$old_data" ]; then
    rm -rf "$CYRENE_HOME/backend/data"
    cp -a "$old_data" "$CYRENE_HOME/backend/data"
  fi

  chmod +x "$CYRENE_HOME/backend/server" 2>/dev/null || true
  success "文件已部署到：$CYRENE_HOME"
}

create_user_and_permissions() {
  step "设置运行用户和权限"
  if ! id "$CYRENE_USER" >/dev/null 2>&1; then
    useradd -r -s /usr/sbin/nologin -d "$CYRENE_HOME" "$CYRENE_USER" 2>/dev/null \
      || useradd -r -s /bin/false -d "$CYRENE_HOME" "$CYRENE_USER"
    success "已创建用户：$CYRENE_USER"
  else
    info "用户已存在：$CYRENE_USER"
  fi

  chown -R "$CYRENE_USER:$CYRENE_USER" "$CYRENE_HOME"
  chmod 755 "$CYRENE_HOME/backend/logs"
  success "权限设置完成"
}

install_frontend_dependencies() {
  step "安装前端生产依赖"
  cd "$CYRENE_HOME/frontend"

  cat > .env.production <<EOF
CYRENE_BACKEND_URL=http://127.0.0.1:${BACKEND_PORT}
EOF

  chown "$CYRENE_USER:$CYRENE_USER" .env.production
  if ! su -s /bin/bash -c "PATH=$RUNTIME_PATH command -v node >/dev/null && PATH=$RUNTIME_PATH command -v bun >/dev/null" "$CYRENE_USER"; then
    error "Node.js or Bun is not available for user $CYRENE_USER in PATH=$RUNTIME_PATH"
    exit 1
  fi

  su -s /bin/bash -c "PATH=$RUNTIME_PATH bun install --production" "$CYRENE_USER"
  success "前端生产依赖安装完成"
}

write_systemd_services() {
  step "注册 systemd 服务"
  cat > /etc/systemd/system/cyrene-backend.service <<EOF
[Unit]
Description=CyrenePanel Backend Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CYRENE_USER
Group=$CYRENE_USER
WorkingDirectory=$CYRENE_HOME/backend
Environment=NODE_ENV=production
Environment=PORT=$BACKEND_PORT
ExecStart=$CYRENE_HOME/backend/server
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$CYRENE_HOME/backend/data $CYRENE_HOME/backend/logs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/cyrene-frontend.service <<EOF
[Unit]
Description=CyrenePanel Frontend Server
After=network-online.target cyrene-backend.service
Wants=network-online.target cyrene-backend.service

[Service]
Type=simple
User=$CYRENE_USER
Group=$CYRENE_USER
WorkingDirectory=$CYRENE_HOME/frontend
Environment=NODE_ENV=production
Environment=PORT=$FRONTEND_PORT
Environment=HOSTNAME=0.0.0.0
Environment=CYRENE_BACKEND_URL=http://127.0.0.1:$BACKEND_PORT
Environment=PATH=$RUNTIME_PATH
ExecStart=$BUN_BIN run next start -p $FRONTEND_PORT -H 0.0.0.0
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$CYRENE_HOME/frontend/.next $CYRENE_HOME/frontend/node_modules
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable cyrene-backend cyrene-frontend >/dev/null
  success "systemd 服务已注册"
}

start_services() {
  step "启动服务"
  systemctl restart cyrene-backend
  sleep 2
  systemctl restart cyrene-frontend

  info "等待后端启动..."
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/system/version" >/dev/null 2>&1; then
      success "后端服务启动成功"
      break
    fi
    sleep 1
  done

  info "等待前端启动..."
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
      success "前端服务启动成功"
      break
    fi
    sleep 1
  done
}

print_summary() {
  local public_ip
  public_ip="$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "服务器IP")"

  echo ""
  echo -e "${GREEN}${BOLD}CyrenePanel 部署完成${NC}"
  echo -e "  版本:        ${RELEASE_VERSION}"
  echo -e "  安装目录:    ${CYRENE_HOME}"
  echo -e "  前端地址:    http://${public_ip}:${FRONTEND_PORT}"
  echo -e "  API proxy:    http://${public_ip}:${FRONTEND_PORT}/api -> http://127.0.0.1:${BACKEND_PORT}/api"
  echo ""
  echo -e "  常用命令:"
  echo -e "    查看后端日志: ${CYAN}journalctl -u cyrene-backend -f${NC}"
  echo -e "    查看前端日志: ${CYAN}journalctl -u cyrene-frontend -f${NC}"
  echo -e "    重启服务:     ${CYAN}systemctl restart cyrene-backend cyrene-frontend${NC}"
  echo -e "    查看状态:     ${CYAN}systemctl status cyrene-backend cyrene-frontend${NC}"
  echo ""
  echo -e "  首次启动会自动创建 admin 账号，初始密码请查看后端日志。"
}

main() {
  echo -e "${CYAN}${BOLD}CyrenePanel Release 一键部署脚本${NC}"
  require_root
  detect_os
  install_packages
  install_nodejs
  install_bun
  resolve_release
  download_release
  backup_existing_install
  extract_release
  create_user_and_permissions
  install_frontend_dependencies
  write_systemd_services
  start_services
  print_summary
}

main "$@"
