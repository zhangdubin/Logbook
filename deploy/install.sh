#!/usr/bin/env bash
#
# deploy/install.sh —— 云服务器一键安装
#
#   从 GitHub Release 拉取「生产环境部署版本」并安装成 systemd 服务。
#
#   用法：
#     curl -fsSL https://raw.githubusercontent.com/zhangdubin/Logbook/main/deploy/install.sh | sudo bash
#
#   或指定参数：
#     sudo bash install.sh --repo zhangdubin/Logbook --version 1.0.0 --dir /opt/cuoti-analytics
#
#   环境变量（优先级低于命令行参数）：
#     REPO          仓库，默认 zhangdubin/Logbook
#     VERSION       版本，默认取最新 Release
#     INSTALL_DIR   安装目录，默认 /opt/cuoti-analytics
#     SERVICE_USER  运行服务的系统用户，默认 cuoti
#     PORT          服务端口，默认 5181
#     GITHUB_TOKEN  私有仓库才需要（用于下载 Release 附件）
#     SKIP_NGINX    设为 1 则不配置 nginx
#     SKIP_SYSTEMD  设为 1 则不注册 systemd 服务（前台运行）
#
set -euo pipefail

# ------------------------------- 参数 ----------------------------------------
REPO="${REPO:-zhangdubin/Logbook}"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/cuoti-analytics}"
SERVICE_USER="${SERVICE_USER:-cuoti}"
SERVICE_NAME="cuoti-analytics"
PORT="${PORT:-5181}"
NODE_MAJOR_MIN=20

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --user) SERVICE_USER="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    --skip-systemd) SKIP_SYSTEMD=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

# ------------------------------- 输出 ----------------------------------------
BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
step()  { echo "${BOLD}▸ $*${OFF}"; }
ok()    { echo "  ${GREEN}✓${OFF} $*"; }
warn()  { echo "  ${YELLOW}!${OFF} $*"; }
fail()  { echo "  ${RED}✗${OFF} $*" >&2; exit 1; }
info()  { echo "  ${DIM}$*${OFF}"; }

[ "$(id -u)" -eq 0 ] || [ "${ALLOW_NON_ROOT:-0}" = "1" ] \
  || fail "请用 root 运行（sudo bash install.sh）"

echo
echo "${BOLD}错题本 · 学情智能分析系统 —— 生产环境安装${OFF}"
echo "  仓库：$REPO    版本：$VERSION    目录：$INSTALL_DIR"
echo

# --------------------------- 1. 检查运行环境 --------------------------------
step "检查运行环境"

command -v curl >/dev/null 2>&1 || fail "缺少 curl，请先安装：apt-get install -y curl / yum install -y curl"
command -v tar  >/dev/null 2>&1 || fail "缺少 tar"

if ! command -v node >/dev/null 2>&1; then
  warn "未检测到 Node.js，开始安装 Node.js ${NODE_MAJOR_MIN}+"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates gnupg >/dev/null
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR_MIN}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq && apt-get install -y -qq nodejs >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q curl ca-certificates >/dev/null
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR_MIN}.x | bash - >/dev/null
    dnf install -y -q nodejs >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q curl ca-certificates >/dev/null
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR_MIN}.x | bash - >/dev/null
    yum install -y -q nodejs >/dev/null
  else
    fail "无法自动安装 Node.js，请手动安装 Node.js ${NODE_MAJOR_MIN}+ 后重试"
  fi
  ok "Node.js 已安装：$(node -v)"
fi

NODE_V="$(node -v)"
NODE_MAJOR="$(echo "$NODE_V" | sed 's/^v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge "$NODE_MAJOR_MIN" ] || fail "Node.js 版本过低（当前 $NODE_V），需要 ${NODE_MAJOR_MIN}+"
ok "Node.js $NODE_V"

command -v npm >/dev/null 2>&1 || fail "缺少 npm"
ok "npm $(npm -v)"

# --------------------------- 2. 解析版本与下载地址 ----------------------------
step "查询 GitHub Release"

GH_API="https://api.github.com"
GH_TOKEN_ARG=""
if [ -n "${GITHUB_TOKEN:-}" ]; then
  GH_TOKEN_ARG="-H \"Authorization: Bearer $GITHUB_TOKEN\""
fi

fetch_release_json() {
  # $1 = url
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$1"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "$1"
  fi
}

if [ "$VERSION" = "latest" ]; then
  RELEASE_JSON="$(fetch_release_json "$GH_API/repos/$REPO/releases/latest")" \
    || fail "取不到最新 Release，请检查仓库名是否正确，或用 --version 指定版本"
  VERSION="$(echo "$RELEASE_JSON" | grep -m1 '"tag_name"' | sed 's/.*"tag_name": *"[^v]*\([^"]*\)".*/\1/')"
  ok "最新版本：$VERSION"
else
  ok "指定版本：$VERSION"
fi

TAG="v${VERSION#v}"

# 找附件：优先「部署版本」，退回「源码包」
ASSET_NAME=""
ASSET_URL=""
if [ "$TAG" != "v$(curl -fsSL -H "Accept: application/vnd.github+json" "$GH_API/repos/$REPO/releases/tags/$TAG" 2>/dev/null | grep -m1 '"tag_name"' | sed 's/.*"tag_name": *"[^v]*\([^"]*\)".*/\1/')" ]; then
  :
fi

RELEASE_JSON="$(fetch_release_json "$GH_API/repos/$REPO/releases/tags/$TAG")" \
  || fail "找不到 Release $TAG"

pick_asset() {
  # 从 Release 里挑附件：优先「部署版本」，其次「源码包」
  local kind="$1"
  local list
  list="$(echo "$RELEASE_JSON" \
    | tr ',' '\n' \
    | grep '"browser_download_url"' \
    | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')"
  [ -n "$list" ] || return 1
  if [ "$kind" = "deploy" ]; then
    echo "$list" | grep -- "-deploy\.tar\.gz$" | head -1
  else
    echo "$list" | grep -v -- "-deploy\.tar\.gz$" | grep "\.tar\.gz$" | head -1
  fi
}

# 下载 GitHub Release 附件。
# 注意：附件走 release-assets.githubusercontent.com，这个 CDN 时快时慢
# （实测同一条 800 KB 的下载，从 90 秒没下完到 52 秒下完都有），
# 所以给足重试次数，并设一个宽松的总上限，超了就换下一个下载源。
# --speed-time/--speed-limit：60 秒内速度低于 1 KB/s 就判定为卡死并重试。
download() {
  local url="$1" out="$2"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fL --retry 4 --retry-delay 3 --retry-all-errors \
         --connect-timeout 30 --speed-time 60 --speed-limit 1024 \
         --max-time 600 \
         -H "Authorization: Bearer $GITHUB_TOKEN" -o "$out" "$url"
  else
    curl -fL --retry 4 --retry-delay 3 --retry-all-errors \
         --connect-timeout 30 --speed-time 60 --speed-limit 1024 \
         --max-time 600 \
         -o "$out" "$url"
  fi
}

ASSET_URL="$(pick_asset deploy || true)"
SOURCE_ASSET_URL="$(pick_asset source || true)"

# 下载源按优先级排列：
#   1) 部署版本附件 —— 含已构建好的 dist/，服务器不需要装构建工具链
#   2) 源码包附件   —— 需要在服务器上现场构建
#   3) API tarball  —— 走 codeload，实测稳定在 2~3 秒
# 前两个走 release-assets.githubusercontent.com，这个 CDN 时快时慢
# （实测同一条 800 KB 的下载，从 90 秒没下完到 52 秒下完都有），
# 所以给它们设上限时间；不行就退到第三个。
if [ -n "$ASSET_URL" ]; then
  ok "使用部署版本附件（含已构建前端，服务器无需装构建工具链）"
  info "$ASSET_URL"
elif [ -n "$SOURCE_ASSET_URL" ]; then
  ASSET_URL="$SOURCE_ASSET_URL"
  ok "使用源码包附件（服务器上现场构建，需要 devDependencies）"
  info "$ASSET_URL"
fi

CANDIDATES=()
[ -n "$ASSET_URL" ] && CANDIDATES+=("$ASSET_URL")
[ -n "$SOURCE_ASSET_URL" ] && CANDIDATES+=("$SOURCE_ASSET_URL")
CANDIDATES+=("$GH_API/repos/$REPO/tarball/$TAG")
[ ${#CANDIDATES[@]} -gt 0 ] || fail "找不到可用的下载来源"

# --------------------------- 3. 创建运行用户 --------------------------------
step "准备运行环境"
if [ "$(id -u)" -ne 0 ]; then
  warn "非 root 运行，跳过创建系统用户"
elif ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --shell /usr/sbin/nologin --home-dir "$INSTALL_DIR" "$SERVICE_USER"
  else
    adduser -S -D -H -h "$INSTALL_DIR" "$SERVICE_USER"
  fi
  ok "已创建系统用户：$SERVICE_USER"
else
  ok "系统用户已存在：$SERVICE_USER"
fi

# --------------------------- 4. 下载并安装 ----------------------------------
step "下载并安装到 $INSTALL_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DOWNLOADED_FROM=""
for url in "${CANDIDATES[@]}"; do
  if download "$url" "$TMP_DIR/pkg.tar.gz"; then
    DOWNLOADED_FROM="$url"
    ok "下载完成（$(du -h "$TMP_DIR/pkg.tar.gz" | cut -f1)）"
    info "来源：$url"
    break
  fi
  warn "下载失败，换下一个来源：$url"
  rm -f "$TMP_DIR/pkg.tar.gz"
done
[ -n "$DOWNLOADED_FROM" ] || fail "所有下载来源都失败了"

# API tarball 解出来是 <repo>-<commit>/ 目录，附件解出来是 <name>/ 目录，
# 后面统一按「解压出来的第一个目录」处理，不用关心具体名字。

# 校验（有 sha256 就校验）。API tarball 没有对应的 sha256 文件，会跳过。
SHA_URL="${DOWNLOADED_FROM}.sha256"
if curl -fsSL --max-time 15 -o "$TMP_DIR/pkg.sha256" "$SHA_URL" 2>/dev/null; then
  EXPECT="$(awk '{print $1}' "$TMP_DIR/pkg.sha256" 2>/dev/null || true)"
  ACTUAL="$(sha256sum "$TMP_DIR/pkg.tar.gz" 2>/dev/null | awk '{print $1}' || true)"
  if [ -z "${EXPECT:-}" ] || [ -z "${ACTUAL:-}" ]; then
    warn "sha256 文件解析失败，跳过校验"
  elif [ "$EXPECT" != "$ACTUAL" ]; then
    fail "sha256 校验失败：期望 ${EXPECT}，实际 ${ACTUAL}"
  else
    ok "sha256 校验通过"
  fi
else
  warn "没有 sha256 校验文件，跳过校验"
fi

tar -xzf "$TMP_DIR/pkg.tar.gz" -C "$TMP_DIR"
PKG_DIR="$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -n "$PKG_DIR" ] || fail "解压失败"
info "解压到 $(basename "$PKG_DIR")"

# 保留已有数据与配置（升级时不能丢）
mkdir -p "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/server/data" ]; then
  info "保留已有数据库"
  cp -a "$INSTALL_DIR/server/data" "$PKG_DIR/server/data.new" 2>/dev/null || true
  rm -rf "$PKG_DIR/server/data"
  mv "$PKG_DIR/server/data.new" "$PKG_DIR/server/data" 2>/dev/null || true
fi
if [ -f "$INSTALL_DIR/.env" ]; then
  info "保留已有 .env"
  cp -a "$INSTALL_DIR/.env" "$PKG_DIR/.env"
fi
if [ -d "$INSTALL_DIR/server/uploads" ]; then
  info "保留已有上传文件"
  cp -a "$INSTALL_DIR/server/uploads/." "$PKG_DIR/server/uploads/" 2>/dev/null || true
fi

# 替换程序文件（保留 server/data、server/uploads、.env）
rm -rf "$INSTALL_DIR.new"
mkdir -p "$(dirname "$INSTALL_DIR")"
mv "$PKG_DIR" "$INSTALL_DIR.new"
if [ -d "$INSTALL_DIR" ]; then
  # 只保留需要留存的目录，其余整体替换
  rm -rf "$INSTALL_DIR/dist" "$INSTALL_DIR/src" "$INSTALL_DIR/docs" "$INSTALL_DIR/server" \
         "$INSTALL_DIR/public" "$INSTALL_DIR/scripts" "$INSTALL_DIR/deploy" "$INSTALL_DIR/ocr-service" \
         "$INSTALL_DIR/node_modules" "$INSTALL_DIR/package.json" "$INSTALL_DIR/package-lock.json" \
         "$INSTALL_DIR/vite.config.ts" "$INSTALL_DIR/tsconfig.json" "$INSTALL_DIR/tsconfig.node.json" \
         "$INSTALL_DIR/index.html" "$INSTALL_DIR/README.md" "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.gitignore"
  cp -a "$INSTALL_DIR.new/." "$INSTALL_DIR/"
  rm -rf "$INSTALL_DIR.new"
else
  mv "$INSTALL_DIR.new" "$INSTALL_DIR"
fi
ok "程序文件已就位"

cd "$INSTALL_DIR"

# --------------------------- 5. 安装依赖 ------------------------------------
step "安装依赖"

if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi
ok "生产依赖安装完成"

# 源码包需要现场构建前端；部署版本已自带 dist/，跳过
if [ ! -d "$INSTALL_DIR/dist" ]; then
  warn "没有 dist/，需要现场构建前端（安装 devDependencies）"
  npm install --no-audit --no-fund
  npm run build
  ok "前端构建完成"
else
  ok "已自带前端构建产物，跳过构建"
fi

# --------------------------- 6. 配置 ----------------------------------------
step "配置"

if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" <<EOF
# 生产环境配置（首次安装自动生成）
PORT=$PORT
NODE_ENV=production
# 管理后台初始账号，首次登录后请立即修改密码
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
# 本地 OCR 服务地址（可选，不填则关闭本地 OCR）
OCR_SERVICE_URL=http://127.0.0.1:8868
EOF
  ok "已生成 .env（请务必修改 ADMIN_PASSWORD）"
else
  ok ".env 已存在，保持不变"
fi

if [ "$(id -u)" -eq 0 ]; then
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
  chmod 600 "$INSTALL_DIR/.env" 2>/dev/null || true
fi

# 初始化数据库（幂等：已有数据不覆盖）
if [ ! -f "$INSTALL_DIR/server/data/cuoti.db" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    sudo -u "$SERVICE_USER" env NODE_ENV=production node server/seed.js >/dev/null 2>&1 || true
  else
    NODE_ENV=production node server/seed.js >/dev/null 2>&1 || true
  fi
  ok "数据库已初始化"
else
  ok "数据库已存在，跳过初始化"
fi

# --------------------------- 7. systemd -------------------------------------
if [ "$(id -u)" -eq 0 ] && [ "${SKIP_SYSTEMD:-0}" != "1" ] && command -v systemctl >/dev/null 2>&1; then
  step "注册 systemd 服务"

  sed -e "s#__INSTALL_DIR__#$INSTALL_DIR#g" \
      -e "s#__SERVICE_USER__#$SERVICE_USER#g" \
      -e "s#__PORT__#$PORT#g" \
      "$INSTALL_DIR/deploy/cuoti-analytics.service" > "/etc/systemd/system/$SERVICE_NAME.service"

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "服务已启动：systemctl status $SERVICE_NAME"
  else
    warn "服务未处于运行状态，查看日志：journalctl -u $SERVICE_NAME -n 50 --no-pager"
  fi
else
  step "跳过 systemd（前台运行）"
  info "cd $INSTALL_DIR && npm start"
  # 临时起一个做健康检查，验完停掉
  ( cd "$INSTALL_DIR" && PORT="$PORT" node --env-file-if-exists=.env server/index.js >/tmp/cuoti-install-check.log 2>&1 & echo $! > /tmp/cuoti-install.pid )
  sleep 3
fi

# --------------------------- 8. nginx --------------------------------------
if [ "$(id -u)" -eq 0 ] && [ "${SKIP_NGINX:-0}" != "1" ] && command -v nginx >/dev/null 2>&1; then
  step "配置 nginx 反向代理"
  DOMAIN="${DOMAIN:-_}"
  sed -e "s#__DOMAIN__#$DOMAIN#g" \
      -e "s#__PORT__#$PORT#g" \
      "$INSTALL_DIR/deploy/nginx.conf.example" > "/etc/nginx/conf.d/$SERVICE_NAME.conf"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx || systemctl restart nginx
    ok "nginx 已配置（域名 $DOMAIN）"
  else
    warn "nginx 配置校验失败，请检查 /etc/nginx/conf.d/$SERVICE_NAME.conf"
  fi
elif [ "${SKIP_NGINX:-0}" != "1" ] && [ "$(id -u)" -eq 0 ]; then
  info "未检测到 nginx，跳过（如需域名访问请自行配置反代到 127.0.0.1:$PORT）"
fi

# --------------------------- 9. 验收 ----------------------------------------
step "验收"
sleep 1
HEALTH="$(curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
if [ -n "$HEALTH" ]; then
  ok "健康检查通过：$HEALTH"
else
  warn "健康检查未通过，请查看日志：journalctl -u $SERVICE_NAME -n 50 --no-pager"
fi

# 跳过 systemd 时，验完把临时进程停掉
if [ -f /tmp/cuoti-install.pid ]; then
  kill "$(cat /tmp/cuoti-install.pid)" 2>/dev/null || true
  rm -f /tmp/cuoti-install.pid
fi

cat <<EOF

${GREEN}${BOLD}安装完成${OFF}

  服务地址   http://127.0.0.1:$PORT
  安装目录   $INSTALL_DIR
  运行用户   $SERVICE_USER
  版本       $VERSION

  常用命令：
    systemctl status $SERVICE_NAME          查看状态
    systemctl restart $SERVICE_NAME         重启
    journalctl -u $SERVICE_NAME -f           实时日志
    systemctl stop $SERVICE_NAME            停止

  ${YELLOW}首次登录请立即修改默认密码（admin/admin123）${OFF}
  ${YELLOW}配置在 $INSTALL_DIR/.env，改完执行 systemctl restart $SERVICE_NAME${OFF}

EOF
