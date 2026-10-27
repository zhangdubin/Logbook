#!/usr/bin/env bash
#
# deploy/upgrade.sh —— 升级已安装的实例
#
#   从 GitHub Release 拉新版本，替换程序文件，保留数据库 / 上传图片 / .env，
#   重装依赖并重启服务。升级前会自动备份旧版本到 backups/。
#
#   用法：
#     sudo bash upgrade.sh                        升到最新版本
#     sudo bash upgrade.sh --version 1.1.0        升到指定版本
#     sudo bash upgrade.sh --dir /opt/cuoti-analytics
#
#   环境变量：
#     REPO          仓库，默认 zhangdubin/Logbook
#     VERSION       版本，默认 latest
#     INSTALL_DIR   安装目录，默认 /opt/cuoti-analytics
#     SERVICE_NAME  服务名，默认 cuoti-analytics
#     GITHUB_TOKEN  私有仓库才需要
#
set -euo pipefail

REPO="${REPO:-zhangdubin/Logbook}"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/cuoti-analytics}"
SERVICE_NAME="${SERVICE_NAME:-cuoti-analytics}"
GH_API="https://api.github.com"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
step() { echo "${BOLD}▸ $*${OFF}"; }
ok()   { echo "  ${GREEN}✓${OFF} $*"; }
warn() { echo "  ${YELLOW}!${OFF} $*"; }
fail() { echo "  ${RED}✗${OFF} $*" >&2; exit 1; }
info() { echo "  ${DIM}$*${OFF}"; }

[ "$(id -u)" -eq 0 ] || [ "${ALLOW_NON_ROOT:-0}" = "1" ] \
  || fail "请用 root 运行"
[ -d "$INSTALL_DIR" ] || fail "安装目录不存在：$INSTALL_DIR（先跑 install.sh）"

echo
echo "${BOLD}错题本 · 升级${OFF}"
echo "  目录：$INSTALL_DIR   仓库：$REPO"
echo

fetch_release_json() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$1"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "$1"
  fi
}

# --------------------------- 1. 目标版本 ------------------------------------
step "查询目标版本"

CURRENT="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || grep -m1 '"version"' "$INSTALL_DIR/package.json" | sed 's/.*"version": *"\([^"]*\)".*/\1/')"
ok "当前版本：${CURRENT:-未知}"

if [ "$VERSION" = "latest" ]; then
  RELEASE_JSON="$(fetch_release_json "$GH_API/repos/$REPO/releases/latest")" \
    || fail "取不到最新 Release"
  VERSION="$(echo "$RELEASE_JSON" | grep -m1 '"tag_name"' | sed 's/.*"tag_name": *"[^v]*\([^"]*\)".*/\1/')"
  TARGET_TAG="v${VERSION#v}"
else
  TARGET_TAG="v${VERSION#v}"
  RELEASE_JSON="$(fetch_release_json "$GH_API/repos/$REPO/releases/tags/$TARGET_TAG")" \
    || fail "找不到 Release $TARGET_TAG"
fi
ok "目标版本：$VERSION"

if [ "${CURRENT:-}" = "$VERSION" ]; then
  ok "已经是最新版本，无需升级"
  exit 0
fi

# --------------------------- 2. 下载 ----------------------------------------
step "下载更新包"

pick_asset() {
  # $1 = ERE 正则。`grep -E -- "$1"`：-- 用来结束选项解析，
  # 这样以 - 开头的模式（-deploy\.tar\.gz$）才不会被当成选项。
  echo "$RELEASE_JSON" | tr ',' '\n' | grep '"browser_download_url"' \
    | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/' \
    | grep -E -- "$1" | head -1
}
ASSET_URL="$(pick_asset '-deploy\.tar\.gz$')"
[ -n "$ASSET_URL" ] || ASSET_URL="$(pick_asset '\.tar\.gz$')"

# 下载源按优先级排列（附件 CDN 时快时慢，退到 API tarball 更稳）：
#   1) 部署版本附件 —— 含已构建好的 dist/，升级后不用重新构建前端
#   2) 源码包附件
#   3) API tarball —— 走 codeload，实测稳定 2~3 秒
CANDIDATES=()
[ -n "$ASSET_URL" ] && CANDIDATES+=("$ASSET_URL")
CANDIDATES+=("$GH_API/repos/$REPO/tarball/$TARGET_TAG")
[ ${#CANDIDATES[@]} -gt 0 ] || fail "Release $TARGET_TAG 里没有可用的下载来源"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

download() {
  local url="$1" out="$2"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fL --retry 4 --retry-delay 3 --retry-all-errors --connect-timeout 30 \
         --speed-time 60 --speed-limit 1024 --max-time 600 \
         -H "Authorization: Bearer $GITHUB_TOKEN" -o "$out" "$url"
  else
    curl -fL --retry 4 --retry-delay 3 --retry-all-errors --connect-timeout 30 \
         --speed-time 60 --speed-limit 1024 --max-time 600 -o "$out" "$url"
  fi
}

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

if curl -fsSL --max-time 15 -o "$TMP_DIR/pkg.sha256" "${DOWNLOADED_FROM}.sha256" 2>/dev/null; then
  EXPECT="$(awk '{print $1}' "$TMP_DIR/pkg.sha256" 2>/dev/null || true)"
  ACTUAL="$(sha256sum "$TMP_DIR/pkg.tar.gz" 2>/dev/null | awk '{print $1}' || true)"
  if [ -z "${EXPECT:-}" ] || [ -z "${ACTUAL:-}" ]; then
    warn "sha256 文件解析失败，跳过校验"
  elif [ "$EXPECT" != "$ACTUAL" ]; then
    fail "sha256 校验失败：期望 ${EXPECT}，实际 ${ACTUAL}"
  else
    ok "sha256 校验通过"
  fi
fi

tar -xzf "$TMP_DIR/pkg.tar.gz" -C "$TMP_DIR"
PKG_DIR="$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -n "$PKG_DIR" ] || fail "解压失败"

# --------------------------- 3. 备份 ----------------------------------------
step "备份当前版本"

BACKUP_DIR="$INSTALL_DIR/backups/${CURRENT:-unknown}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
for item in server dist src docs scripts deploy package.json package-lock.json \
            vite.config.ts tsconfig.json tsconfig.node.json index.html public \
            README.md .env.example .gitignore VERSION; do
  [ -e "$INSTALL_DIR/$item" ] && cp -a "$INSTALL_DIR/$item" "$BACKUP_DIR/" 2>/dev/null || true
done
# 数据库与 .env 只做快照，不参与升级替换
[ -f "$INSTALL_DIR/.env" ] && cp -a "$INSTALL_DIR/.env" "$BACKUP_DIR/.env" 2>/dev/null || true
if [ -d "$INSTALL_DIR/server/data" ]; then
  mkdir -p "$BACKUP_DIR/data-snapshot"
  cp -a "$INSTALL_DIR/server/data/." "$BACKUP_DIR/data-snapshot/" 2>/dev/null || true
fi
ok "已备份到 ${BACKUP_DIR#$INSTALL_DIR/}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  info "（--dry-run，到此为止）"
  exit 0
fi

# --------------------------- 4. 替换 ----------------------------------------
step "替换程序文件"

# 保留运行期数据与配置
[ -d "$INSTALL_DIR/server/data" ] && cp -a "$INSTALL_DIR/server/data" "$PKG_DIR/server/data.new" 2>/dev/null || true
[ -d "$PKG_DIR/server/data" ] && rm -rf "$PKG_DIR/server/data" && mv "$PKG_DIR/server/data.new" "$PKG_DIR/server/data" 2>/dev/null || true
[ -f "$INSTALL_DIR/.env" ] && cp -a "$INSTALL_DIR/.env" "$PKG_DIR/.env"
[ -d "$INSTALL_DIR/server/uploads" ] && cp -a "$INSTALL_DIR/server/uploads/." "$PKG_DIR/server/uploads/" 2>/dev/null || true

for item in server dist src docs scripts deploy public package.json package-lock.json \
            vite.config.ts tsconfig.json tsconfig.node.json index.html README.md \
            .env.example .gitignore VERSION; do
  rm -rf "${INSTALL_DIR:?}/$item"
  [ -e "$PKG_DIR/$item" ] && cp -a "$PKG_DIR/$item" "$INSTALL_DIR/"
done
ok "程序文件已替换（数据库 / 上传图片 / .env 保持不变）"

# --------------------------- 5. 依赖与重启 ---------------------------------
step "更新依赖并重启"
cd "$INSTALL_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi
if [ ! -d "$INSTALL_DIR/dist" ]; then
  warn "没有 dist/，现场构建前端"
  npm install --no-audit --no-fund
  npm run build
fi
ok "依赖已就绪"

if [ "$(id -u)" -eq 0 ] && command -v systemctl >/dev/null 2>&1; then
  systemctl restart "$SERVICE_NAME"
  sleep 3
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "服务已重启并运行中"
  else
    warn "服务未运行，查看日志：journalctl -u $SERVICE_NAME -n 50 --no-pager"
  fi
fi

# 端口：环境变量优先，其次从已安装的 .env 里读，最后退回默认 5181
CHECK_PORT="${PORT:-}"
if [ -z "$CHECK_PORT" ] && [ -f "$INSTALL_DIR/.env" ]; then
  CHECK_PORT="$(grep -E '^PORT=' "$INSTALL_DIR/.env" | tail -1 | cut -d= -f2 | tr -d '\"' | tr -d "'" || true)"
fi
CHECK_PORT="${CHECK_PORT:-5181}"
HEALTH="$(curl -fsS --max-time 10 "http://127.0.0.1:$CHECK_PORT/api/health" 2>/dev/null || true)"
if [ -n "$HEALTH" ]; then
  ok "健康检查：$HEALTH"
else
  warn "健康检查未通过"
fi

echo
echo "${GREEN}${BOLD}升级完成：${CURRENT:-?} → ${VERSION}${OFF}"
echo "  如需回退：把 backups/ 下的旧版本复制回去后 systemctl restart $SERVICE_NAME"
echo
