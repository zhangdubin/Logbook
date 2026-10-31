#!/usr/bin/env bash
# =============================================================================
# install-offline.sh —— 离线一键安装（全程不联网）
# =============================================================================
# 用法：
#   sudo bash install-offline.sh --dir /opt/cuoti-analytics --port 5181 --ocr
#   sudo bash install-offline.sh --bundle ./cuoti-analytics-offline-v1.1.15.tar.gz \
#        --dir /opt/cuoti-analytics --port 5181
#
# 这个脚本**一个字都不联网**：
#   - 不用 curl / wget
#   - 不在服务器上 docker build（基础镜像、npm、pip 全都预构建好了）
#   - 镜像从包里的 images/*.tar 用 docker load 导入
#
# 它做什么：
#   1) 校验 docker / docker compose 在不在
#   2) 解包到目标目录（已经解开就跳过）
#   3) docker load 导入镜像
#   4) 生成 .env（不覆盖已有的）
#   5) docker compose up -d
#   6) 等健康检查通过
#
# 环境变量：
#   INSTALL_DIR  默认 /opt/cuoti-analytics
#   HOST_PORT    默认 5181
#   WITH_OCR     默认 1（带本地 OCR 侧车）
# =============================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/cuoti-analytics}"
HOST_PORT="${HOST_PORT:-5181}"
WITH_OCR="${WITH_OCR:-1}"
BUNDLE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ----------------------------- 输出 -----------------------------
if [ -t 1 ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else
  R=""; G=""; Y=""; B=""; N=""
fi
info() { echo "${B}[离线安装]${N} $*"; }
ok()   { echo "  ${G}✓${N} $*"; }
warn() { echo "  ${Y}!${N} $*"; }
die()  { echo "  ${R}✗ $*${N}" >&2; exit 1; }

usage() {
  sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)     INSTALL_DIR="$2"; shift 2 ;;
    --port)    HOST_PORT="$2"; shift 2 ;;
    --ocr)     WITH_OCR=1; shift ;;
    --no-ocr)  WITH_OCR=0; shift ;;
    --bundle)  BUNDLE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) die "未知参数：$1（用 --help 看用法）" ;;
  esac
done

info "离线安装开始（全程不联网）"

# ------------------------- 1. 环境检查 -------------------------
command -v docker >/dev/null 2>&1 || die "没找到 docker，请先安装 Docker"
docker compose version >/dev/null 2>&1 || die "没找到 docker compose（需要 Docker Compose v2，不是老的 docker-compose）"
docker info >/dev/null 2>&1 || die "docker 服务没起来，请先 systemctl start docker"
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') / compose $(docker compose version --short 2>/dev/null || echo '?')"

# ------------------------- 2. 解包 -------------------------
if [ -n "$BUNDLE" ]; then
  [ -f "$BUNDLE" ] || die "找不到离线包：$BUNDLE"
  info "解包到 ${INSTALL_DIR}"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$BUNDLE" -C "$INSTALL_DIR" --strip-components=1
  ok "解包完成"
fi

# 区分两个目录：
#   SRC_DIR  —— 离线包**所在**的位置（镜像 images/*.tar.gz 在这儿）
#   INSTALL_DIR —— 程序要**装到**的位置（compose 从这儿读）
# 一开始它们可能是同一个，也可能是「包里跑一次装到别处」。
SRC_DIR="$SCRIPT_DIR"
if [ ! -f "$SRC_DIR/docker-compose.offline.yml" ] && [ -f "$INSTALL_DIR/docker-compose.offline.yml" ]; then
  SRC_DIR="$INSTALL_DIR"
fi
[ -f "$SRC_DIR/docker-compose.offline.yml" ] || die "找不到 docker-compose.offline.yml —— 离线包不完整？"

# --- 3. 导入镜像（从包所在目录，不是从安装目录！） ---
if [ -d "$SRC_DIR/images" ]; then
  for img in "$SRC_DIR"/images/*.tar.gz "$SRC_DIR"/images/*.tar; do
    [ -f "$img" ] || continue
    info "导入镜像 $(basename "$img")…"
    # docker load 能自动识别 gzip，但老版本 Docker 不一定认 —— 双保险
    if ! docker load -i "$img" >/dev/null 2>&1; then
      case "$img" in
        *.gz|*.tgz) gunzip -c "$img" | docker load >/dev/null || die "镜像导入失败：$img" ;;
        *) die "镜像导入失败：$img" ;;
      esac
    fi
    ok "已导入 $(basename "$img")"
  done
else
  warn "包里没有 images/ 目录 —— 跳过镜像导入（如果镜像是别处 load 过的可以忽略）"
fi

# --- 把程序文件拷到 INSTALL_DIR ---
if [ "$SRC_DIR" != "$INSTALL_DIR" ]; then
  info "拷贝程序文件到 ${INSTALL_DIR}"
  mkdir -p "$INSTALL_DIR"
  for item in docker-compose.offline.yml server dist src public index.html package.json package-lock.json \
              Dockerfile docker-compose.yml .env.example README.md; do
    [ -e "$SRC_DIR/$item" ] && cp -a "$SRC_DIR/$item" "$INSTALL_DIR/" || true
  done
  [ -d "$SRC_DIR/deploy" ] && cp -a "$SRC_DIR/deploy" "$INSTALL_DIR/" || true
fi
PKG_DIR="$INSTALL_DIR"

VERSION="$(node -e "console.log(require('$PKG_DIR/package.json').version)" 2>/dev/null || echo "1.1.15")"
info "版本 ${VERSION}"

docker image inspect "cuoti-analytics:${VERSION}" >/dev/null 2>&1 \
  || die "找不到镜像 cuoti-analytics:${VERSION}（images/*.tar 是否完整？）"

# ------------------------- 4. .env -------------------------
ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env 已存在，保留原值（不会覆盖你的密钥）"
else
  info "生成 .env"
  cat > "$ENV_FILE" <<ENVEOF
# 错题本 · 学情智能分析系统 —— 环境配置（离线安装自动生成）
# 改完执行：cd $INSTALL_DIR && docker compose -f docker-compose.offline.yml up -d --force-recreate

HOST_PORT=$HOST_PORT
VERSION=$VERSION

# 本地 OCR 侧车（--ocr 启动时自动填）
OCR_SERVICE_URL=http://cuoti-ocr:8868

# ---- 大模型（留空就走本地启发式引擎 + 本地 OCR，不联网也能用）----
AI_BASE_URL=https://api.minimax.chat/v1
AI_API_KEY=
AI_MODEL=MiniMax-M3.1-Flash
AI_TIMEOUT_MS=25000

# 首次启动灌演示数据会清空业务数据，生产环境保持 false
SEED_DEMO=false
# 登录页的「演示账号」面板会公开默认口令，生产环境保持 false
DEMO_MODE=false
ENVEOF
  chmod 600 "$ENV_FILE"
  ok ".env 已生成"
fi

# ------------------------- 5. 启动 -------------------------
cd "$INSTALL_DIR"
COMPOSE_FILE="docker-compose.offline.yml"
PROFILE=""
if [ "$WITH_OCR" = "1" ]; then
  PROFILE="--profile ocr"
  ok "带本地 OCR 侧车（识别率更高，图片不出本机）"
else
  warn "不带 OCR 侧车 —— 识别率会低一些"
fi

info "启动容器…"
# shellcheck disable=SC2086
docker compose -f "$COMPOSE_FILE" $PROFILE up -d --remove-orphans
ok "容器已启动"

# ------------------------- 6. 健康检查 -------------------------
info "等待健康检查…"
APP_URL="http://127.0.0.1:${HOST_PORT}"
READY=0
for i in $(seq 1 40); do
  if curl -fsS -m 3 "${APP_URL}/api/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done

if [ "$READY" = "1" ]; then
  ok "健康检查通过：${APP_URL}/api/health"
  V=$(curl -fsS -m 3 "${APP_URL}/api/version" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
  [ -n "$V" ] && ok "版本：$V"
else
  warn "健康检查还没通过，看看日志："
  echo "      cd $INSTALL_DIR && docker compose -f $COMPOSE_FILE logs --tail=50 app"
fi

echo
echo "${G}${B}安装完成${N}"
echo "  访问地址： ${B}${APP_URL}${N}"
echo "  登录账号： ${B}admin / admin123${N}  ← 首次登录后请立刻在「账号管理」里改密码"
echo "  配置文件： ${B}${ENV_FILE}${N}"
echo "  看日志　： cd ${INSTALL_DIR} && docker compose -f ${COMPOSE_FILE} logs -f app"
echo
echo "  升级到新版本：把新的离线包覆盖到 ${INSTALL_DIR}，然后"
echo "    cd ${INSTALL_DIR} && docker compose -f ${COMPOSE_FILE} up -d --force-recreate"
