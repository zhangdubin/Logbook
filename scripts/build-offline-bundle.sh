#!/usr/bin/env bash
# =============================================================================
# build-offline-bundle.sh —— 在**有网**的机器上打包离线部署包
# =============================================================================
# 用法：
#   bash scripts/build-offline-bundle.sh                       # 双架构（amd64 + arm64）
#   bash scripts/build-offline-bundle.sh --platform linux/amd64   # 只要 amd64（小一半）
#   bash scripts/build-offline-bundle.sh --no-ocr             # 不带 OCR 侧车
#   bash scripts/build-offline-bundle.sh --version 1.1.18
#
# 产出：deploy-dist/cuoti-analytics-offline-v<版本>.tar.gz
#
# 包里有什么：
#   images/cuoti-analytics-<版本>-<架构>.tar.gz      docker save 的应用镜像
#   images/cuoti-analytics-ocr-<版本>-<架构>.tar.gz  docker save 的 OCR 镜像
#   docker-compose.offline.yml                       离线版编排（没有 build: 段）
#   install-offline.sh                               离线一键安装脚本
#   server/ dist/ src/ public/                       程序文件（dist 已构建好）
#   README-离线部署.md                               给人看的说明
#
# ---------------------------------------------------------------------------
# ⚠ **为什么要分架构**（踩过的坑）
# ---------------------------------------------------------------------------
# 离线包里的镜像是 `docker save` 出来的**具体架构**的二进制。
# 架构不对时，Docker 报的错是：
#
#     exec /usr/local/bin/entrypoint.sh: exec format error
#
# 这句话**极具误导性** —— 看着像脚本坏了，其实是**架构不匹配**：
# kernel 拿到 `#!/bin/sh`，去执行镜像里的 /bin/sh，而那个二进制是给别的 CPU 写的。
#
# 所以镜像必须**按目标服务器的架构构建**。
# 一台 NAS 往往是 Intel(x86_64)，而构建机的 mac 是 arm64 —— 不分架构就一定会踩。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_OCR=1
VERSION=""
OUT_DIR="$ROOT/deploy-dist"
# 默认双架构。两个都要的话，一个包就够 —— 安装脚本会按 uname -m 自己挑。
PLATFORMS="linux/amd64 linux/arm64"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-ocr)   WITH_OCR=0; shift ;;
    --version)  VERSION="$2"; shift 2 ;;
    --out)      OUT_DIR="$2"; shift 2 ;;
    --platform) PLATFORMS="$2"; shift 2 ;;
    -h|--help)  sed -n '3,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

if [ -z "$VERSION" ]; then
  VERSION="$(node -e "console.log(require('$ROOT/package.json').version)")"
fi

if [ -t 1 ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else
  R=""; G=""; Y=""; B=""; N=""
fi
info() { echo "${B}[离线打包]${N} $*"; }
ok()   { echo "  ${G}✓${N} $*"; }
warn() { echo "  ${Y}!${N} $*"; }
die()  { echo "  ${R}✗ $*${N}" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "没有 docker"
docker info >/dev/null 2>&1 || die "docker 服务没起来"

HOST_ARCH="$(uname -m)"

# 平台 → 架构后缀（镜像文件名用）
arch_of() {
  case "$1" in
    linux/amd64) echo "amd64" ;;
    linux/arm64) echo "arm64" ;;
    linux/arm/v7) echo "armv7" ;;
    *) echo "${1##*/}" ;;
  esac
}

# 判断某个平台是不是本机原生（原生就用经典构建器，快；跨架构用 buildx + QEMU）
is_native() {
  case "$(arch_of "$1")" in
    amd64) [ "$HOST_ARCH" = "x86_64" ] || [ "$HOST_ARCH" = "amd64" ] ;;
    arm64) [ "$HOST_ARCH" = "aarch64" ] || [ "$HOST_ARCH" = "arm64" ] ;;
    armv7) [ "$HOST_ARCH" = "armv7l" ] ;;
    *) return 1 ;;
  esac
}

HAVE_BUILDX=0
docker buildx version >/dev/null 2>&1 && HAVE_BUILDX=1

STAGE="$ROOT/.offline-stage/cuoti-analytics-offline-v${VERSION}"
rm -rf "$ROOT/.offline-stage"
mkdir -p "$STAGE/images"

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '')"

# ------------------------- 1. 构建 + 导出镜像 -------------------------
# $1 = 平台   $2 = 镜像名（cuoti-analytics / cuoti-analytics-ocr）
build_and_save() {
  local plat="$1" repo="$2"
  local arch tag tarball
  arch="$(arch_of "$plat")"
  tag="${repo}:${VERSION}"
  tarball="$STAGE/images/${repo}-${VERSION}-${arch}.tar.gz"

  if is_native "$plat"; then
    info "构建 ${repo}:${VERSION}（${plat}，本机原生）"
    if [ "$repo" = "cuoti-analytics" ]; then
      docker build --build-arg "VERSION=${VERSION}" --build-arg "COMMIT=${COMMIT}" \
        -f "$ROOT/Dockerfile" -t "$tag" "$ROOT" >/dev/null
    else
      docker build -f "$ROOT/deploy/docker/ocr.Dockerfile" -t "$tag" "$ROOT" >/dev/null
    fi
  else
    [ "$HAVE_BUILDX" = "1" ] || die "要构建 $plat 需要 buildx（当前没有）。请装 buildx 或用 --platform 指定本机架构。"
    info "构建 ${repo}:${VERSION}（${plat}，跨架构，需要 QEMU，稍慢）"
    if [ "$repo" = "cuoti-analytics" ]; then
      docker buildx build --platform "$plat" --load \
        --build-arg "VERSION=${VERSION}" --build-arg "COMMIT=${COMMIT}" \
        -f "$ROOT/Dockerfile" -t "$tag" "$ROOT" >/dev/null
    else
      docker buildx build --platform "$plat" --load \
        -f "$ROOT/deploy/docker/ocr.Dockerfile" -t "$tag" "$ROOT" >/dev/null
    fi
  fi

  # 确认架构真的对 —— 不对就当场失败，别等装到服务器上才发现
  local got
  got="$(docker image inspect "$tag" --format '{{.Architecture}}' 2>/dev/null || echo '?')"
  [ "$got" = "$arch" ] || die "构建出来的架构是 $got，应该是 $arch（$plat）"

  info "导出镜像（docker save）…"
  docker save "$tag" | gzip -1 > "$tarball"
  docker rmi "$tag" >/dev/null 2>&1 || true
  ok "${repo}-${VERSION}-${arch}.tar.gz（$(du -h "$tarball" | awk '{print $1}')）"
}

for plat in $PLATFORMS; do
  build_and_save "$plat" "cuoti-analytics"
  if [ "$WITH_OCR" = "1" ]; then
    build_and_save "$plat" "cuoti-analytics-ocr"
  fi
done

# ------------------------- 2. 拷贝程序文件 -------------------------
# ⚠ 顺序很重要：先重新生成 server/build-info.json，**再**拷贝 server/，
#   否则拷进去的是上一版的工作区文件（它不进 git，是构建产物）。
( cd "$ROOT" && node -e "
  import('./server/version.js').then(async (m) => {
    const p = m.writeBuildInfo({ commit: '$COMMIT', builtAt: new Date().toISOString() })
    console.log('  · 构建信息：' + p.version + ' @ ' + p.commit)
  })
" ) || warn "build-info.json 生成失败（不影响使用，镜像里会重新生成）"

info "拷贝程序文件…"
for item in server dist src public deploy index.html package.json package-lock.json \
            vite.config.ts tsconfig.json tsconfig.node.json Dockerfile docker-compose.yml \
            .env.example README.md; do
  [ -e "$ROOT/$item" ] && cp -a "$ROOT/$item" "$STAGE/" || true
done
if [ ! -d "$STAGE/dist" ]; then
  info "dist 不存在，先构建前端…"
  (cd "$ROOT" && npm run build)
  cp -a "$ROOT/dist" "$STAGE/"
fi

cp -a "$ROOT/deploy/docker-compose.offline.yml" "$STAGE/docker-compose.offline.yml"
cp -a "$ROOT/deploy/install-offline.sh" "$STAGE/install-offline.sh"
chmod +x "$STAGE/install-offline.sh"


# 权限归一化：源码目录里可能有 600 的文件（某些编辑器就是这么存的），
# 直接打包过去会让服务器上「非 root 的账号」读不了 compose 文件。
find "$STAGE" -type d -exec chmod 755 {} \;
find "$STAGE" -type f -exec chmod 644 {} \;
chmod +x "$STAGE/install-offline.sh"
find "$STAGE/deploy" -type f -name '*.sh' -exec chmod 755 {} \; 2>/dev/null || true

# ------------------------- 3. 打包说明 -------------------------
# ⚠ 这里必须用**带引号**的 heredoc（<<'MDEOF'）。
#   正文里有 markdown 的 ``` 代码块 —— 反引号在不带引号的 heredoc 里
#   会被当成**命令替换**，于是 bash 会去执行 `bash` 这个命令，
#   而 `bash` 没有输入就等着 stdin —— 整个脚本就卡死在这里。
#   带引号 = 一个字符都不展开，版本号用下面的 sed 替换。
cat > "$STAGE/README-离线部署.md" <<'MDEOF'
# 错题本 · 离线部署包 v__VERSION__

这个包**完全不需要联网**。把它拷到服务器上解开就能跑。

## 先看架构对不对（重要）

镜像里的二进制是**按 CPU 架构**编译的。架构不对时 Docker 报：

```
exec /usr/local/bin/entrypoint.sh: exec format error
```

这看着像脚本坏了，其实是**架构不匹配**（kernel 执行不了镜像里的 /bin/sh）。

装之前先确认：

```bash
uname -m
```

| 输出 | 需要的架构 | 本包是否包含 |
|---|---|---|
| `x86_64` / `amd64` | amd64 | 是 |
| `aarch64` / `arm64` | arm64 | 是 |

`install-offline.sh` 会**自己判断**并只导入对应架构的镜像，不用手动选。
如果提示架构不匹配，说明你拿错了包。

## 目录里有什么

| 路径 | 说明 |
|---|---|
| `install-offline.sh` | 一键安装脚本（不联网） |
| `docker-compose.offline.yml` | 离线版编排（没有 build 段，直接用预构建镜像） |
| `images/*.tar.gz` | 预构建好的镜像，**按架构分文件** |
| `server/` `dist/` | 后端程序 + 已构建好的前端（服务器不用装 node） |
| `src/` `Dockerfile` | 源码，留着方便二次开发 |

## 服务器上怎么装

```bash
# 1. 解包
tar -xzf cuoti-analytics-offline-v__VERSION__.tar.gz -C /opt
cd /opt/cuoti-analytics-offline-v__VERSION__

# 2. 一键安装
sudo bash install-offline.sh --dir /opt/cuoti-analytics --port 5181 --ocr
```

装完访问 http://<服务器IP>:5181 ，默认账号 **admin / admin123**（请立刻改密码）。

## 也可以手动来

```bash
cd /opt/cuoti-analytics

# 导入镜像（注意选对架构的文件！）
uname -m     # x86_64 用 -amd64 的那个；aarch64 用 -arm64 的那个
gzip -dc images/cuoti-analytics-__VERSION__-amd64.tar.gz | docker load
gzip -dc images/cuoti-analytics-ocr-__VERSION__-amd64.tar.gz | docker load

# 准备 .env
cp .env.example .env && vi .env

# 启动
docker compose -f docker-compose.offline.yml --profile ocr up -d
```

## 说明

- **不需要 node、不需要 python、不需要联网** —— 都在镜像里了
- **不需要 Docker Hub** —— 基础镜像已经打进包里的镜像文件
- 数据在 named volume `cuoti-data` 里，`docker compose down` 不丢，`down -v` 才删
- 大模型走 `AI_BASE_URL` / `AI_API_KEY` 配置。**留空就是纯本地模式**
  （本地 OCR + 启发式引擎），识别率会低一些，但完全离线可用
MDEOF

# 把占位符换回真实版本号（放在 heredoc 外面，避免反引号被当命令替换）
sed -i.bak "s/__VERSION__/${VERSION}/g" "$STAGE/README-离线部署.md" && rm -f "$STAGE/README-离线部署.md.bak"

# ------------------------- 4. 打包 -------------------------
info "打包…"
mkdir -p "$OUT_DIR"
TARBALL="$OUT_DIR/cuoti-analytics-offline-v${VERSION}.tar.gz"
tar -czf "$TARBALL" -C "$(dirname "$STAGE")" "$(basename "$STAGE")"
# 先记下里面有哪些架构（stage 马上要删）
IMAGE_LIST="$(ls "$STAGE/images" 2>/dev/null | sed 's/^/    /')"
rm -rf "$ROOT/.offline-stage"

( cd "$OUT_DIR" && shasum -a 256 "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" 2>/dev/null \
  || sha256sum "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" )

SIZE="$(du -h "$TARBALL" | awk '{print $1}')"
ok "离线包就绪：$TARBALL （${SIZE}）"
echo
echo "  包含的镜像："
echo "${IMAGE_LIST}"
echo
echo "  拷到服务器："
echo "    scp $(basename "$TARBALL") user@<服务器IP>:/tmp/"
echo
echo "  服务器上解开并安装："
echo "    sudo mkdir -p /opt && sudo tar -xzf /tmp/$(basename "$TARBALL") -C /opt"
echo "    cd /opt/cuoti-analytics-offline-v${VERSION}"
echo "    sudo bash install-offline.sh --dir /opt/cuoti-analytics --port 5181 --ocr"
