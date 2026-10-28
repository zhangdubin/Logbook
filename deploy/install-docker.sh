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

# 端口占用早提示（不中断，只提醒）。
# 放在最前面，免得用户白等一趟 2~5 分钟的镜像构建，最后才发现端口被占。
# 真正的拦截在启动前那一段。
EARLY_OCCUPIED="$(docker ps --filter "publish=${PORT}" --format '{{.Names}}' 2>/dev/null || true)"
if [ -n "$EARLY_OCCUPIED" ]; then
  warn "端口 ${PORT} 当前有容器在用：$(echo "$EARLY_OCCUPIED" | tr '\n' ' ')"
  echo "    如果这些不是本项目的旧容器，启动时会因为端口冲突失败。"
  echo "    提前处理：docker ps --filter publish=${PORT}   然后 docker stop <名字> && docker rm <名字>"
  echo
fi

# ---------------------------- 1. 解析版本 -----------------------------------
if [ "$VERSION" = "latest" ]; then
  step "查询最新版本"
  latest_json="$(curl -fsSL --retry 4 --retry-delay 2 --retry-all-errors --connect-timeout 20 --retry-max-time 120 \
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
  # --retry-max-time 是关键：curl 8.x 里 --max-time 是**每次重试**单独计时，
  # 光有 --max-time 的话最坏情况是「单次超时 × 重试次数」，能卡几小时。
  # --retry-max-time 给整个重试窗口封个顶。
  curl -fsSL --retry 6 --retry-delay 3 --retry-all-errors \
    --connect-timeout 25 --max-time 300 --retry-max-time 420 \
    -o "$out" "$url" 2>/dev/null
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
# 先解到临时目录，再挪进安装目录。
# 顶层目录名随下载来源而变，不能按名字匹配：
#   - Release 部署包  → cuoti-analytics-v1.1.4/
#   - 源码 tarball    → Logbook-1.1.4/（GitHub 自己的命名，owner-repo-短 sha）
# 之前写死 'cuoti-analytics-*'，一旦回退到源码 tarball 就直接找不到目录、脚本退出。
EXTRACT_DIR="$TMP_DIR/extract"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$TARBALL" -C "$EXTRACT_DIR"

SRC_DIR=""
for d in "$EXTRACT_DIR"/*/; do
  [ -d "$d" ] || continue
  SRC_DIR="${d%/}"
  break
done
# 没有顶层目录时，说明文件直接铺在根上
[ -n "$SRC_DIR" ] || SRC_DIR="$EXTRACT_DIR"

# 校验包里确实有我们要的东西 —— 下到半截文件或下错包时立刻就能发现，
# 而不是等到 docker build 报一堆看不懂的错。
[ -f "$SRC_DIR/Dockerfile" ] \
  || fail "包里没有 Dockerfile —— 下到的不是本系统的发布包，请检查网络后重试"
[ -f "$SRC_DIR/docker-compose.yml" ] \
  || fail "包里没有 docker-compose.yml —— 下到的不是本系统的发布包，请检查网络后重试"

mkdir -p "$INSTALL_DIR"
# 已有安装时保留数据与用户配置
if [ -d "$INSTALL_DIR/server/data" ]; then
  cp -a "$INSTALL_DIR/server/data" "$SRC_DIR/server/data.keep" 2>/dev/null || true
  rm -rf "$SRC_DIR/server/data"
  mv "$SRC_DIR/server/data.keep" "$SRC_DIR/server/data" 2>/dev/null || true
fi
if [ -d "$INSTALL_DIR/server/uploads" ]; then
  cp -a "$INSTALL_DIR/server/uploads" "$SRC_DIR/server/uploads.keep" 2>/dev/null || true
  rm -rf "$SRC_DIR/server/uploads"
  mv "$SRC_DIR/server/uploads.keep" "$SRC_DIR/server/uploads" 2>/dev/null || true
fi
if [ -f "$INSTALL_DIR/.env" ]; then
  cp -a "$INSTALL_DIR/.env" "$SRC_DIR/.env" 2>/dev/null || true
fi

# 把内容挪到 INSTALL_DIR 根下
if [ "$SRC_DIR" != "$INSTALL_DIR" ]; then
  (cd "$SRC_DIR" && tar -cf - .) | (cd "$INSTALL_DIR" && tar -xf -)
fi
ok "已安装到 ${INSTALL_DIR}"

# ---- 必须刷新 mtime（否则会构建出「上一版」的镜像）------------------------
# tar 会把文件的 mtime 归一化成一个固定时间（这里是 1970-01-01），
# 而 BuildKit 的增量上下文传输是按 **(mtime, size)** 判断文件有没有变的。
# 版本升级时绝大多数文件的大小不变（比如 package.json 的 1.1.1 → 1.1.2
# 长度一模一样），于是 BuildKit 会直接复用上一版的缓存内容 ——
# 构建出来的镜像里 package.json 还写着旧版本号。
#
# 统一 touch 一遍，强制 BuildKit 重新读取文件内容。
find "$INSTALL_DIR" -exec touch {} + 2>/dev/null || true

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
# 构建日志留一份，失败时把真正的报错显示出来（别只丢一句猜测）
BUILD_LOG="$TMP_DIR/build.log"
if ! docker build "${BUILD_ARGS[@]}" -t "cuoti-analytics:${IMAGE_TAG}" . > "$BUILD_LOG" 2>&1; then
  fail "镜像构建失败。真正的报错在下面几行：
$(grep -iE 'error|failed|cannot|denied' "$BUILD_LOG" | tail -6 | sed 's/^/  /')
  常见原因：
    - 报 the --chmod option requires BuildKit → Docker 版本太老，请升级 Docker Engine
    - 报 dial unix ... connect: no such file → Docker 守护进程没在跑，systemctl start docker
    - 报 no space left on device → 磁盘满了，docker system prune -a 清一下"
fi

ok "主应用镜像构建完成"

if [ "$WITH_OCR" = "1" ]; then
  step "构建本地 OCR 侧车镜像"
  if ! docker build -f deploy/docker/ocr.Dockerfile -t "cuoti-analytics-ocr:${IMAGE_TAG}" . > "$TMP_DIR/ocr-build.log" 2>&1; then
    warn "OCR 侧车构建失败，主应用不受影响（拍照识别会退回默认引擎）"
    grep -iE 'error|failed|cannot' "$TMP_DIR/ocr-build.log" | tail -4 | sed 's/^/    /'
  fi
  ok "OCR 侧车镜像构建完成"
fi

# ---- 端口占用检查 ----------------------------------------------------------
# 返回值：占用 ${PORT} 且**不属于本项目**的容器名（空格分隔；没有则为空）
#
# 为什么要排除本项目自己的容器：升级时旧容器还占着端口，但 compose 会
# 自动把它替换掉 —— 那不是冲突。要是把它当成冲突，升级就永远做不成。
port_conflict() {
  local project="$1"
  local names out=""
  names="$(docker ps --filter "publish=${PORT}" --format '{{.Names}}' 2>/dev/null || true)"
  for n in $names; do
    case "$n" in
      *"$project"*) ;;          # 本项目自己的，compose 会自动替换
      *) out="$out $n" ;;
    esac
  done
  echo "${out# }"
}

# ---------------------------- 7. 启动 ----------------------------------------
if [ "$SKIP_COMPOSE" = "1" ]; then
  warn "已跳过启动（--skip-compose）"
else
  # ---- 端口预检：端口被占着就别白跑一趟构建了 ------------------------------
  COMPOSE_PROJECT="$(grep -m1 '^name:' docker-compose.yml 2>/dev/null | sed 's/^name:[[:space:]]*//' | tr -d '"'"'"' \r')"
  COMPOSE_PROJECT="${COMPOSE_PROJECT:-cuoti-analytics}"
  OCCUPIED_BY="$(port_conflict "$COMPOSE_PROJECT")"
  if [ -n "$OCCUPIED_BY" ]; then
    echo
    warn "端口 ${PORT} 已经被别的容器占用了：${OCCUPIED_BY}"
    echo "    这些容器还在用 ${PORT}，新服务会起不来。"
    echo
    echo "    两种做法，选一个："
    echo
    echo "    A) 停掉旧容器，然后用同样的端口起新版本（推荐）："
    echo "         docker stop ${OCCUPIED_BY} && docker rm ${OCCUPIED_BY}"
    echo "         cd ${INSTALL_DIR} && docker compose up -d"
    echo
    echo "    B) 换个端口，旧容器先留着："
    echo "         sudo bash <(curl -fsSL https://raw.githubusercontent.com/${REPO}/main/deploy/install-docker.sh) --version ${VERSION} --port $((PORT + 1))"
    echo
    fail "端口冲突，已中止（上面的命令复制执行即可）"
  fi

  step "启动服务"
  # 注意：不能用 `PROFILE_ARGS=()` 再 "${PROFILE_ARGS[@]}" ——
  # bash 4.3 及更早版本在 `set -u` 下展开空数组会报 unbound variable。
  START_LOG="$TMP_DIR/compose-up.log"
  if [ "$WITH_OCR" = "1" ]; then
    $COMPOSE --profile ocr -f docker-compose.yml -f docker-compose.override.yml up -d > "$START_LOG" 2>&1 \
      || fail "启动失败。真正的报错在下面几行：
$(grep -iE 'error|failed|allocated|denied|cannot' "$START_LOG" | tail -6 | sed 's/^/  /')
  完整日志：cd ${INSTALL_DIR} && $COMPOSE logs --tail=50"
  else
    $COMPOSE -f docker-compose.yml -f docker-compose.override.yml up -d > "$START_LOG" 2>&1 \
      || fail "启动失败。真正的报错在下面几行：
$(grep -iE 'error|failed|allocated|denied|cannot' "$START_LOG" | tail -6 | sed 's/^/  /')
  完整日志：cd ${INSTALL_DIR} && $COMPOSE logs --tail=50"
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
