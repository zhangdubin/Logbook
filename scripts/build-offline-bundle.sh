#!/usr/bin/env bash
# =============================================================================
# build-offline-bundle.sh —— 在**有网**的机器上打包离线部署包
# =============================================================================
# 用法：
#   bash scripts/build-offline-bundle.sh
#   bash scripts/build-offline-bundle.sh --no-ocr        # 不带 OCR 侧车（小 600MB）
#   bash scripts/build-offline-bundle.sh --version 1.1.15
#
# 产出：deploy-dist/cuoti-analytics-offline-v<版本>.tar.gz
#
# 包里有什么：
#   images/cuoti-analytics-*.tar          docker save 的应用镜像
#   images/cuoti-analytics-ocr-*.tar      docker save 的 OCR 镜像（--no-ocr 时没有）
#   docker-compose.offline.yml            离线版编排（没有 build: 段）
#   install-offline.sh                    离线一键安装脚本
#   server/ dist/ src/ public/            程序文件（dist 已构建好，服务器不用装 node）
#   README-离线部署.md                    给人看的说明
#
# 为什么必须预构建镜像：
#   离线服务器上 `docker build` 会卡在三处 ——
#     1) 拉基础镜像 node:24-alpine / python:3.12-slim-bookworm
#     2) `npm ci`（npm registry）
#     3) OCR 镜像的 `pip install`（pypi 镜像源）
#   预构建好就一个字节都不用下。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_OCR=1
VERSION=""
OUT_DIR="$ROOT/deploy-dist"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-ocr)  WITH_OCR=0; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    --out)     OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
die()  { echo "  ${R}✗ $*${N}" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "没有 docker"
docker info >/dev/null 2>&1 || die "docker 服务没起来"

STAGE="$ROOT/.offline-stage/cuoti-analytics-offline-v${VERSION}"
rm -rf "$ROOT/.offline-stage"
mkdir -p "$STAGE/images"

# ------------------------- 1. 构建镜像 -------------------------
info "构建应用镜像 cuoti-analytics:${VERSION}"
docker build \
  --build-arg "VERSION=${VERSION}" \
  --build-arg "COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo '')" \
  -f "$ROOT/Dockerfile" -t "cuoti-analytics:${VERSION}" "$ROOT"
ok "应用镜像就绪"

if [ "$WITH_OCR" = "1" ]; then
  info "构建 OCR 镜像 cuoti-analytics-ocr:${VERSION}（要拉 pypi，慢一点）"
  docker build -t "cuoti-analytics-ocr:${VERSION}" \
    -f "$ROOT/deploy/docker/ocr.Dockerfile" -t "cuoti-analytics-ocr:${VERSION}" "$ROOT"
  ok "OCR 镜像就绪"
fi

# ------------------------- 2. docker save -------------------------
info "导出镜像（docker save）…"
docker save "cuoti-analytics:${VERSION}" | gzip -1 > "$STAGE/images/cuoti-analytics-${VERSION}.tar.gz"
ok "应用镜像已导出"

if [ "$WITH_OCR" = "1" ]; then
  docker save "cuoti-analytics-ocr:${VERSION}" | gzip -1 > "$STAGE/images/cuoti-analytics-ocr-${VERSION}.tar.gz"
  ok "OCR 镜像已导出"
fi

# ------------------------- 3. 拷贝程序文件 -------------------------
info "拷贝程序文件…"
for item in server dist src public deploy index.html package.json package-lock.json \
            vite.config.ts tsconfig.json tsconfig.node.json Dockerfile docker-compose.yml \
            .env.example README.md; do
  [ -e "$ROOT/$item" ] && cp -a "$ROOT/$item" "$STAGE/" || true
done
# dist 不存在就先构建前端
if [ ! -d "$STAGE/dist" ]; then
  info "dist 不存在，先构建前端…"
  (cd "$ROOT" && npm run build)
  cp -a "$ROOT/dist" "$STAGE/"
fi

cp -a "$ROOT/deploy/docker-compose.offline.yml" "$STAGE/docker-compose.offline.yml"
cp -a "$ROOT/deploy/install-offline.sh" "$STAGE/install-offline.sh"
chmod +x "$STAGE/install-offline.sh"

# 权限归一化：源码目录里可能有 600 的文件（我这边的编辑器就是这么存的），
# 直接打包过去会让服务器上「非 root 的账号」读不了 compose 文件。
find "$STAGE" -type d -exec chmod 755 {} \;
find "$STAGE" -type f -exec chmod 644 {} \;
chmod +x "$STAGE/install-offline.sh"
find "$STAGE/deploy" -type f -name '*.sh' -exec chmod 755 {} \; 2>/dev/null || true

# 打包说明
# ⚠ 这里必须用**带引号**的 heredoc（<<'MDEOF'）。
#   正文里有 markdown 的 ``` 代码块 —— 反引号在不带引号的 heredoc 里
#   会被当成**命令替换**，于是 bash 会去执行 `bash` 这个命令，
#   而 `bash` 没有输入就等着 stdin —— 整个脚本就卡死在这里。
#   带引号 = 一个字符都不展开，版本号用下面的 sed 替换。
cat > "$STAGE/README-离线部署.md" <<'MDEOF'
# 错题本 · 离线部署包 v__VERSION__

这个包**完全不需要联网**。把它拷到服务器上解开就能跑。

## 目录里有什么

| 路径 | 说明 |
|---|---|
| \`install-offline.sh\` | 一键安装脚本（不联网） |
| \`docker-compose.offline.yml\` | 离线版编排（没有 build 段，直接用预构建镜像） |
| \`images/*.tar.gz\` | 预构建好的镜像（app + OCR） |
| \`server/\` \`dist/\` | 后端程序 + 已构建好的前端（服务器不用装 node） |
| \`src/\` \`Dockerfile\` | 源码，留着方便二次开发 |

## 服务器上怎么装

```bash
# 1. 解包（假设离线包在 ~/ 下）
tar -xzf cuoti-analytics-offline-v__VERSION__.tar.gz -C /opt
cd /opt/cuoti-analytics-offline-v__VERSION__

# 2. 一键安装
sudo bash install-offline.sh --dir /opt/cuoti-analytics --port 5181 --ocr
```

装完访问 http://<服务器IP>:5181 ，默认账号 **admin / admin123**（请立刻改密码）。

## 也可以手动来

```bash
cd /opt/cuoti-analytics

# 导入镜像
for f in images/*.tar.gz; do gunzip -c "\$f" | docker load; done

# 准备 .env
cp .env.example .env && vi .env

# 启动
docker compose -f docker-compose.offline.yml --profile ocr up -d
```

## 说明

- **不需要 node、不需要 python、不需要联网** —— 都在镜像里了
- **不需要 Docker Hub** —— 基础镜像已经打进包里的镜像文件
- 数据在 named volume \`cuoti-data\` 里，\`docker compose down\` 不丢，\`down -v\` 才删
- 大模型走 \`AI_BASE_URL\` / \`AI_API_KEY\` 配置。**留空就是纯本地模式**
  （本地 OCR + 启发式引擎），识别率会低一些，但完全离线可用
MDEOF

# 把占位符换回真实版本号（放在 heredoc 外面，避免反引号被当命令替换）
sed -i.bak "s/__VERSION__/${VERSION}/g" "$STAGE/README-离线部署.md" && rm -f "$STAGE/README-离线部署.md.bak"

# ------------------------- 4. 打包 -------------------------
info "打包…"
mkdir -p "$OUT_DIR"
TARBALL="$OUT_DIR/cuoti-analytics-offline-v${VERSION}.tar.gz"
tar -czf "$TARBALL" -C "$(dirname "$STAGE")" "$(basename "$STAGE")"
rm -rf "$ROOT/.offline-stage"

( cd "$OUT_DIR" && shasum -a 256 "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" 2>/dev/null \
  || sha256sum "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" )

SIZE=$(du -h "$TARBALL" | awk '{print $1}')
ok "离线包就绪：$TARBALL （${SIZE}）"
echo
echo "  拷到服务器："
echo "    scp $(basename "$TARBALL") user@<服务器IP>:/tmp/"
echo
echo "  服务器上解开并安装："
echo "    sudo mkdir -p /opt && sudo tar -xzf /tmp/$(basename "$TARBALL") -C /opt"
echo "    cd /opt/cuoti-analytics-offline-v${VERSION}"
echo "    sudo bash install-offline.sh --dir /opt/cuoti-analytics --port 5181 --ocr"
