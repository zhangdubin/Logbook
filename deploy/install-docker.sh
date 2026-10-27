#!/usr/bin/env bash
#
# deploy/install-docker.sh —— Docker 一键部署
#
#   从 GitHub Release 拉取「生产环境部署版本」，构建镜像并用 docker compose 拉起来。
#
#   用法（最简）：
#     curl -fsSL https://raw.githubusercontent.com/zhangdubin/Logbook/main/deploy/install-docker.sh | sudo bash
#
#   或带参数：
#     sudo bash install-docker.sh --version 1.1.2 --dir /opt/cuoti --port 5181 --ocr
#
#   环境变量（优先级低于命令行参数）：
#     REPO          仓库，默认 zhangdubin/Logbook
#     VERSION       版本，默认取最新 Release
#     INSTALL_DIR   安装目录，默认 /opt/cuoti-analytics
#     PORT          对外端口，默认 5181
#     BIND_ADDR     端口绑定地址，默认 0.0.0.0；只想本机访问就设 127.0.0.1
#     IMAGE_TAG     镜像标签，默认取版本号
#     COMMIT        写进版本信息的短 hash，可选（服务器上没 git 也没关系）
#     GITHUB_TOKEN  私有仓库才需要
#     WITH_OCR      设为 1 则同时构建并启动本地 OCR 侧车
#     SKIP_COMPOSE  设为 1 则只构建镜像，不启动
#
set -euo pipefail

# ------------------------------- 参数 ----------------------------------------
REPO="${REPO:-zhangdubin/Logbook}"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/cuoti-analytics}"
PORT="${PORT:-5181}"
BIND_ADDR="${BIND_ADDR:-0.0.0.0}"
IMAGE_TAG="${IMAGE_TAG:-}"
COMMIT="${COMMIT:-}"
WITH_OCR="${WITH_OCR:-0}"
SKIP_COMPOSE="${SKIP_COMPOSE:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bind) BIND_ADDR="$2"; shift 2 ;;
    --ocr) WITH_OCR=1; shift ;;
    --skip-compose) SKIP_COMPOSE=1; shift ;;
    -h|--help) sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
  || fail "请用 root 运行（sudo bash install-docker.sh）"

echo
echo "${BOLD}错题本 · 学情智能分析系统 —— Docker 一键部署${OFF}"
echo

# ---------------------------- 0. 环境检查 -----------------------------------
step "检查环境"
command -v docker >/dev/null 2>&1 || fail "没有找到 docker，请先安装 Docker Engine（https://docs.docker.com/engine/install/）"
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '已安装')"

# docker compose 插件（v2）或 docker-compose（v1），两个都支持
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  fail "没有找到 docker compose，请安装 compose 插件（apt install docker-compose-plugin）"
fi
ok "compose 命令：${COMPOSE}"

docker info >/dev/null 2>&1 || fail "Docker 没在运行（systemctl start docker），或者当前用户不在 docker 组里"

# ---------------------------- 1. 解析版本 -----------------------------------
if [ "$VERSION" = "latest" ]; then
  step "查询最新版本"
  latest_json="$(curl -fsSL --retry 4 --retry-delay 2 --retry-all-errors --connect-timeout 20 \
    "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null || true)"
  VERSION="$(printf '%s' "$latest_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([0-9][0-9.]*\)".*/\1/p' | head -1)"
  [ -n "$VERSION" ] || fail "查不到最新版本，请用 --version 指定，例如 --version 1.1.2"
  ok "最新版本：${VERSION}"
fi
VERSION="${VERSION#v}"
[ -n "$IMAGE_TAG" ] || IMAGE_TAG="$VERSION"

# ---------------------------- 2. 下载发布包 ---------------------------------
step "下载生产环境部署版本 v${VERSION}"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# 三级回退：Release 附件 → API tarball → （都没成功就报错）
# 国内访问 github.com 的 Release 附件经常超时，所以每级都带重试。
download() {
  local url="$1" out="$2"
  curl -fsSL --retry 8 --retry-delay 3 --retry-all-errors \
    --connect-timeout 25 --max-time 900 -o "$out" "$url" 2>/dev/null
}

ASSET_URL="https://github.com/${REPO}/releases/download/v${VERSION}/cuoti-analytics-v${VERSION}-deploy.tar.gz"
TARBALL_URL="https://api.github.com/repos/${REPO}/tarball/v${VERSION}"
TARBALL="$TMP_DIR/cuoti.tar.gz"

if download "$ASSET_URL" "$TARBALL" && [ -s "$TARBALL" ]; then
  ok "已下载发布包 $(du -h "$TARBALL" | cut -f1)"
elif download "$TARBALL_URL" "$TARBALL" && [ -s "$TARBALL" ]; then
  warn "Release 附件下载失败，已回退到源码 tarball"
  ok "已下载源码包 $(du -h "$TARBALL" | cut -f1)"
else
  fail "下载失败。Release 附件与源码 tarball 都取不到，请检查网络或用 --version 指定其它版本"
fi

# ---------------------------- 3. 解压到安装目录 ------------------------------
step "解压到 ${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"
tar -xzf "$TARBALL" -C "$INSTALL_DIR"

SRC_DIR="$(find "$INSTALL_DIR" -maxdepth 1 -type d -name 'cuoti-analytics-*' | head -1)"
[ -n "$SRC_DIR" ] || fail "解压后没找到 cuoti-analytics-* 目录"
# 把内容挪到 INSTALL_DIR 根下
if [ "$SRC_DIR" != "$INSTALL_DIR" ]; then
  (cd "$SRC_DIR" && tar -cf - .) | (cd "$INSTALL_DIR" && tar -xf -)
  rm -rf "$SRC_DIR"
fi
ok "已安装到 ${INSTALL_DIR}"

# ---------------------------- 4. 生成 .env ----------------------------------
step "生成环境配置"
ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  # 已有配置就只更新端口，别覆盖用户改过的 AI 配置
  if grep -q '^PORT=' "$ENV_FILE"; then
    sed -i "s/^PORT=.*/PORT=${PORT}/" "$ENV_FILE"
  else
    printf '\nPORT=%s\n' "$PORT" >> "$ENV_FILE"
  fi
  ok "已保留原有 .env，只更新了端口"
else
  cat > "$ENV_FILE" <<EOF
# 错题本 · 学情智能分析系统 —— Docker 运行配置
# 由 install-docker.sh 生成，可直接编辑后 docker compose up -d 重建

# 容器内服务端口（宿主机映射用 HOST_PORT）
PORT=${PORT}

# AI 大模型配置（OpenAI 兼容接口，如 minimax / 通义 / deepseek）
# 留空则使用内置的本地启发式引擎
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=60000

# 本地 OCR 服务地址（启用了 --ocr 才需要）
OCR_SERVICE_URL=http://ocr:8868

# 演示模式：设为 true 时登录页会显示「演示账号」面板（会公开默认口令，生产别开）
DEMO_MODE=false
EOF
  ok "已生成 .env"
fi

# ---------------------------- 5. 写 compose 覆盖文件 ------------------------
step "写入 compose 覆盖配置"
cat > "$INSTALL_DIR/docker-compose.override.yml" <<EOF
# 由 install-docker.sh 生成：端口映射 + 镜像标签
services:
  app:
    image: cuoti-analytics:${IMAGE_TAG}
    ports:
      - "${BIND_ADDR}:${PORT}:5181"
EOF
ok "已写入 docker-compose.override.yml"

# ---------------------------- 6. 构建镜像 -----------------------------------
step "构建镜像 cuoti-analytics:${IMAGE_TAG}"
info "第一次构建要下载 node 基础镜像，大约 2~5 分钟"

BUILD_ARGS=(--build-arg "VERSION=${VERSION}")
[ -n "$COMMIT" ] && BUILD_ARGS+=(--build-arg "COMMIT=${COMMIT}")

cd "$INSTALL_DIR"
docker build "${BUILD_ARGS[@]}" -t "cuoti-analytics:${IMAGE_TAG}" . \
  || fail "镜像构建失败。如果报 the --chmod option requires BuildKit，说明 Docker 版本太老，请升级 Docker Engine"

ok "主应用镜像构建完成"

if [ "$WITH_OCR" = "1" ]; then
  step "构建本地 OCR 侧车镜像"
  docker build -f deploy/docker/ocr.Dockerfile -t "cuoti-analytics-ocr:${IMAGE_TAG}" . \
    || warn "OCR 侧车构建失败，主应用不受影响（拍照识别会退回默认引擎）"
  ok "OCR 侧车镜像构建完成"
fi

# ---------------------------- 7. 启动 ----------------------------------------
if [ "$SKIP_COMPOSE" = "1" ]; then
  warn "已跳过启动（--skip-compose）"
else
  step "启动服务"
  # 注意：不能用 `PROFILE_ARGS=()` 再 "${PROFILE_ARGS[@]}" ——
  # bash 4.3 及更早版本在 `set -u` 下展开空数组会报 unbound variable。
  if [ "$WITH_OCR" = "1" ]; then
    $COMPOSE --profile ocr -f docker-compose.yml -f docker-compose.override.yml up -d \
      || fail "启动失败，执行 $COMPOSE logs 查看详细日志"
  else
    $COMPOSE -f docker-compose.yml -f docker-compose.override.yml up -d \
      || fail "启动失败，执行 $COMPOSE logs 查看详细日志"
  fi
  ok "容器已启动"
fi

# ---------------------------- 8. 健康检查 -----------------------------------
step "健康检查"
HEALTHY=0
for i in $(seq 1 30); do
  if curl -fsSL --max-time 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
  sleep 2
done

if [ "$HEALTHY" = "1" ]; then
  ok "服务正常"
else
  warn "健康检查没通过，执行 $COMPOSE logs -f 查看日志"
fi

# ---------------------------- 9. 结果 ----------------------------------------
echo
echo "${BOLD}════════════════════════════════════════${OFF}"
if [ "$HEALTHY" = "1" ]; then
  echo "${GREEN}${BOLD}  ✓ 部署完成${OFF}"
else
  echo "${YELLOW}${BOLD}  ! 容器已启动，但健康检查未通过${OFF}"
fi
echo
echo "  ${BOLD}访问地址${OFF}   http://$( [ "$BIND_ADDR" = "0.0.0.0" ] && echo '<服务器IP>' || echo "$BIND_ADDR" ):${PORT}/login"
echo "  ${BOLD}版本${OFF}       ${VERSION}"
echo "  ${BOLD}安装目录${OFF}   ${INSTALL_DIR}"
echo
echo "  ${BOLD}首次登录${OFF}   admin / admin123${YELLOW}（请立即修改密码）${OFF}"
echo
echo "  ${BOLD}常用命令${OFF}"
echo "    cd ${INSTALL_DIR}"
echo "    ${COMPOSE} logs -f          查看日志"
echo "    ${COMPOSE} ps               查看容器状态"
echo "    ${COMPOSE} restart app      重启"
echo "    ${COMPOSE} down             停止（数据保留在 named volume 里）"
echo "    ${COMPOSE} down -v          停止并删除数据卷（⚠️ 数据丢失）"
echo
echo "  ${BOLD}升级到新版本${OFF}"
echo "    cd ${INSTALL_DIR} && sudo bash <(curl -fsSL https://raw.githubusercontent.com/${REPO}/main/deploy/install-docker.sh) --version <新版本>"
echo
echo "${BOLD}════════════════════════════════════════${OFF}"
echo
