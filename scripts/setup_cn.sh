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
BACKEND_START_SINCE=""
ADMIN_USERNAME=""
ADMIN_PASSWORD=""

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

install_cyp_command() {
  step "安装 cyp 管理命令"

  mkdir -p /usr/local/bin

  cat > /usr/local/bin/cyp <<'CYP'
#!/usr/bin/env bash
set -Eeuo pipefail

CYRENE_HOME="${CYRENE_HOME:-__CYRENE_HOME__}"
CYRENE_USER="${CYRENE_USER:-__CYRENE_USER__}"
BACKEND_PORT="${BACKEND_PORT:-__BACKEND_PORT__}"
FRONTEND_PORT="${FRONTEND_PORT:-__FRONTEND_PORT__}"
RUNTIME_PATH="${RUNTIME_PATH:-/usr/local/bin:/usr/bin:/bin}"

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
BOLD='\033[1m'
NC='\033[0m'

success() { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
error() { echo -e "${RED}$*${NC}" >&2; }

db_path() {
  echo "$CYRENE_HOME/backend/data/cyrene.db"
}

require_root() {
  if [ "${EUID}" -ne 0 ]; then
    error "请使用 root 权限运行：sudo cyp"
    exit 1
  fi
}

require_bun() {
  if ! PATH="$RUNTIME_PATH" command -v bun >/dev/null 2>&1; then
    error "未找到 bun，请先重新运行 CyrenePanel 安装脚本。"
    exit 1
  fi
}

require_db() {
  local db
  db="$(db_path)"
  if [ ! -f "$db" ]; then
    error "未找到数据库：$db"
    exit 1
  fi
}

run_bun() {
  PATH="$RUNTIME_PATH" CYP_DB="$(db_path)" bun -e "$1"
}

list_users() {
  require_bun
  require_db
  run_bun 'import { Database } from "bun:sqlite"; const db = new Database(process.env.CYP_DB); const rows = db.query("SELECT id, username, role, createdAt FROM users ORDER BY id").all(); if (rows.length === 0) { console.log("暂无用户"); process.exit(0); } for (const row of rows) console.log(`${row.id}\t${row.username}\t${row.role}`);'
}

first_admin() {
  require_bun
  require_db
  run_bun 'import { Database } from "bun:sqlite"; const db = new Database(process.env.CYP_DB); const row = db.query("SELECT username FROM users WHERE role = ? ORDER BY id LIMIT 1").get("admin"); if (row) console.log(row.username);'
}

restart_panel() {
  require_root
  systemctl restart cyrene-backend
  systemctl restart cyrene-frontend
  success "面板已重启。"
}

restart_backend() {
  systemctl restart cyrene-backend
}

change_username() {
  require_root
  require_bun
  require_db

  echo "当前用户："
  list_users
  echo ""

  local old_username new_username input_username
  old_username="$(first_admin || true)"
  read -r -p "当前管理员用户名 [${old_username:-admin}]: " input_username
  old_username="${input_username:-${old_username:-admin}}"
  read -r -p "新的管理员用户名: " new_username

  if [ -z "$new_username" ]; then
    error "用户名不能为空。"
    exit 1
  fi

  if [ "$old_username" = "$new_username" ]; then
    warn "用户名未变化。"
    return
  fi

  PATH="$RUNTIME_PATH" CYP_DB="$(db_path)" CYP_OLD_USERNAME="$old_username" CYP_NEW_USERNAME="$new_username" bun -e 'import { Database } from "bun:sqlite"; const db = new Database(process.env.CYP_DB); db.exec("PRAGMA busy_timeout = 5000"); const oldName = process.env.CYP_OLD_USERNAME; const newName = process.env.CYP_NEW_USERNAME; const exists = db.query("SELECT id FROM users WHERE username = ?").get(newName); if (exists) { console.error(`用户名已存在：${newName}`); process.exit(2); } const result = db.query("UPDATE users SET username = ? WHERE username = ? AND role = ?").run(newName, oldName, "admin"); if (result.changes === 0) { console.error(`未找到管理员用户：${oldName}`); process.exit(3); }'

  restart_backend
  success "管理员用户名已修改为：$new_username"
}

change_password() {
  require_root
  require_bun
  require_db

  echo "当前用户："
  list_users
  echo ""

  local username input_username password1 password2
  username="$(first_admin || true)"
  read -r -p "要修改密码的管理员用户名 [${username:-admin}]: " input_username
  username="${input_username:-${username:-admin}}"

  read -r -s -p "新的管理员密码: " password1
  echo ""
  read -r -s -p "再次输入新密码: " password2
  echo ""

  if [ -z "$password1" ]; then
    error "密码不能为空。"
    exit 1
  fi

  if [ "$password1" != "$password2" ]; then
    error "两次输入的密码不一致。"
    exit 1
  fi

  PATH="$RUNTIME_PATH" CYP_DB="$(db_path)" CYP_USERNAME="$username" CYP_PASSWORD="$password1" bun -e 'import { Database } from "bun:sqlite"; const db = new Database(process.env.CYP_DB); db.exec("PRAGMA busy_timeout = 5000"); const hash = await Bun.password.hash(process.env.CYP_PASSWORD, { algorithm: "bcrypt", cost: 10 }); const result = db.query("UPDATE users SET password = ? WHERE username = ? AND role = ?").run(hash, process.env.CYP_USERNAME, "admin"); if (result.changes === 0) { console.error(`未找到管理员用户：${process.env.CYP_USERNAME}`); process.exit(3); }'

  restart_backend
  success "管理员密码已修改。"
}

show_status() {
  systemctl --no-pager status cyrene-backend cyrene-frontend || true
}

show_info() {
  local public_ip
  public_ip="$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "服务器IP")"
  echo -e "安装目录: ${CYRENE_HOME}"
  echo -e "前端地址: http://${public_ip}:${FRONTEND_PORT}"
  echo -e "后端地址: http://127.0.0.1:${BACKEND_PORT}"
  echo -e "数据库:   $(db_path)"
}

show_logs() {
  journalctl -u cyrene-backend -u cyrene-frontend -f
}

menu() {
  while true; do
    echo ""
    echo -e "${CYAN}${BOLD}CyrenePanel 管理菜单${NC}"
    echo "  1. 重启面板"
    echo "  2. 修改管理员用户名"
    echo "  3. 修改管理员密码"
    echo "  4. 查看面板状态"
    echo "  5. 查看访问信息"
    echo "  6. 查看实时日志"
    echo "  0. 退出"
    echo ""
    read -r -p "请输入选项: " choice

    case "$choice" in
      1) restart_panel ;;
      2) change_username ;;
      3) change_password ;;
      4) show_status ;;
      5) show_info ;;
      6) show_logs ;;
      0) exit 0 ;;
      *) warn "无效选项，请重新输入。" ;;
    esac
  done
}

usage() {
  cat <<USAGE
用法:
  cyp                打开管理菜单
  cyp restart        重启面板
  cyp username       修改管理员用户名
  cyp password       修改管理员密码
  cyp status         查看服务状态
  cyp info           查看访问信息
  cyp logs           查看实时日志
USAGE
}

case "${1:-menu}" in
  menu|"") menu ;;
  restart) restart_panel ;;
  username) change_username ;;
  password) change_password ;;
  status) show_status ;;
  info) show_info ;;
  logs) show_logs ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
CYP

  sed -i \
    -e "s#__CYRENE_HOME__#${CYRENE_HOME}#g" \
    -e "s#__CYRENE_USER__#${CYRENE_USER}#g" \
    -e "s#__BACKEND_PORT__#${BACKEND_PORT}#g" \
    -e "s#__FRONTEND_PORT__#${FRONTEND_PORT}#g" \
    /usr/local/bin/cyp

  chmod 0755 /usr/local/bin/cyp
  success "cyp 管理命令已安装：cyp"
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
  BACKEND_START_SINCE="$(date '+%Y-%m-%d %H:%M:%S')"
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

capture_admin_credentials() {
  ADMIN_USERNAME=""
  ADMIN_PASSWORD=""

  if [ -z "$BACKEND_START_SINCE" ] || ! command -v journalctl >/dev/null 2>&1; then
    return
  fi

  local backend_logs
  backend_logs="$(journalctl -u cyrene-backend --since "$BACKEND_START_SINCE" -n 200 --no-pager 2>/dev/null || true)"

  ADMIN_PASSWORD="$(
    printf '%s\n' "$backend_logs" \
      | sed -nE 's/.*初始密码[：:][[:space:]]*([^[:space:]]+).*/\1/p' \
      | tail -n1
  )"

  if [ -n "$ADMIN_PASSWORD" ]; then
    ADMIN_USERNAME="$(
      printf '%s\n' "$backend_logs" \
        | sed -nE 's/.*默认账号[：:][[:space:]]*([^[:space:]]+).*/\1/p' \
        | tail -n1
    )"
    ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  fi
}

print_summary() {
  local public_ip
  public_ip="$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "服务器IP")"
  capture_admin_credentials

  echo ""
  echo -e "${GREEN}${BOLD}CyrenePanel 部署完成${NC}"
  echo -e "  版本:        ${RELEASE_VERSION}"
  echo -e "  安装目录:    ${CYRENE_HOME}"
  echo -e "  前端地址:    http://${public_ip}:${FRONTEND_PORT}"
  echo -e "  API proxy:    http://${public_ip}:${FRONTEND_PORT}/api -> http://127.0.0.1:${BACKEND_PORT}/api"
  echo ""
  echo -e "  管理员账号:"
  if [ -n "$ADMIN_PASSWORD" ]; then
    echo -e "    用户名: ${CYAN}${ADMIN_USERNAME}${NC}"
    echo -e "    密码:   ${YELLOW}${ADMIN_PASSWORD}${NC}"
    echo -e "    请登录后立即修改初始密码。"
  else
    echo -e "    已存在管理员账号，本次部署未重新生成初始密码。"
    echo -e "    如需找回或重置，请查看后端日志或在面板内修改用户密码。"
  fi
  echo ""
  echo -e "  常用命令:"
  echo -e "    查看后端日志: ${CYAN}journalctl -u cyrene-backend -f${NC}"
  echo -e "    查看前端日志: ${CYAN}journalctl -u cyrene-frontend -f${NC}"
  echo -e "    重启服务:     ${CYAN}systemctl restart cyrene-backend cyrene-frontend${NC}"
  echo -e "    查看状态:     ${CYAN}systemctl status cyrene-backend cyrene-frontend${NC}"
  echo -e "    管理菜单:     ${CYAN}cyp${NC}"
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
  install_cyp_command
  start_services
  print_summary
}

main "$@"
