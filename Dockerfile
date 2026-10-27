# syntax=docker/dockerfile:1
#
# Dockerfile —— 生产环境部署版本（容器）
# ============================================================================
# 构建：
#   docker build -t cuoti-analytics:1.1.0 \
#     --build-arg VERSION=1.1.0 --build-arg COMMIT=8a46202 .
#
#   - VERSION / COMMIT 写进容器里的 /api/version，COMMIT 不传也行
#     （不传时前端只显示版本号，不显示短 hash）。
#   - 服务器上没有 git 也没关系：不要用 `$(git rev-parse --short HEAD)`，
#     直接写死短 hash，或者干脆不传这个参数。
#
# 运行：
#   docker run -d --name cuoti -p 5181:5181 \
#     -v cuoti-data:/app/server/data \
#     -v cuoti-uploads:/app/server/uploads \
#     cuoti-analytics:1.1.0
#
# 或者用 docker compose（推荐）：
#   docker compose up -d
#   docker compose --profile ocr up -d     # 连本地 OCR 侧车一起起
#
# 完整用法见 docker-compose.yml 与 docs/05-开发与部署指南.md
#
# ---------------------------------------------------------------------------
# 兼容性：这份 Dockerfile **classic builder 和 BuildKit 都能构建**。
# 老的服务器（没装 buildx）用的是 classic builder，它不支持
# `COPY --chmod=...`，会直接报
#     "the --chmod option requires BuildKit"
# 所以下面所有权限都改用 RUN chmod 归一化。
# ============================================================================

# ---------------------------------------------------------------------------
# 阶段 1：构建前端产物
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

# 先只拷依赖清单，这样后续改代码不会让 npm 缓存层失效
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 再拷构建所需源码
# 这一段以 root 身份构建，权限位再差也能读到，所以不用特意处理
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY src ./src
COPY public ./public

# 类型检查 + 生产构建 → dist/
RUN npx tsc --noEmit && npx vite build

# ---------------------------------------------------------------------------
# 阶段 2：运行时（只装生产依赖）
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime

LABEL org.opencontainers.image.title="错题本 · 学情智能分析系统" \
      org.opencontainers.image.description="小学 / 初中错题统计分析系统，含拍照 OCR 录入、AI 智能分析与多维学情统计" \
      org.opencontainers.image.source="https://github.com/zhangdubin/Logbook" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

ENV NODE_ENV=production \
    PORT=5181 \
    HOST=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# 生产依赖（express / exceljs / multer 等）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# 前端构建产物
# --chown=node:node：直接以 node 用户属主落盘。
# 不要用 `RUN chown -R node:node /app` —— 那会把整个 /app 复制成新的一层，
# 实测凭空多出 76 MB（node_modules + dist 全量复制一遍）。
COPY --from=builder --chown=node:node /app/dist ./dist

# 后端程序（server/data、server/uploads 的内容不进镜像，由数据卷承载）
COPY --chown=node:node server ./server

# 容器入口脚本
COPY --chown=node:node deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# ---------------------------------------------------------------------------
# 权限归一化
# ---------------------------------------------------------------------------
# 刻意**不用** `COPY --chmod=...`：--chmod 是 BuildKit 独有的选项，
# 没装 buildx 的服务器（classic builder）会直接构建失败。
#
# 权限位也**不能依赖构建上下文**：COPY 会保留源文件的权限位，
# 工作区里被写成 600 的 package.json 进镜像后，非 root 的 node 用户读不到，
# 容器会反复重启并报 ERR_INVALID_PACKAGE_CONFIG。
#   a+rX = 所有用户可读，目录/已是可执行的文件再加执行位
RUN chmod 644 package.json package-lock.json \
 && chmod -R a+rX dist server \
 && chmod 755 /usr/local/bin/entrypoint.sh

# 构建信息（版本号 / 提交号 / 构建时间）
# COMMIT 传不传都行：传了就显示短 hash，没传就留空，
# 前端会退化成只显示版本号（服务器上没有 git 也无所谓）。
ARG VERSION=1.0.0
ARG COMMIT=""
RUN printf '{\n  "commit": "%s",\n  "builtAt": "%s",\n  "version": "%s"\n}\n' \
      "${COMMIT}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${VERSION}" \
      > server/build-info.json \
 && chown node:node server/build-info.json

# 数据目录：先建好并交给 node 用户，
# 这样 named volume 首次挂载时会自动继承正确的属主，避免容器内写不进去
RUN mkdir -p /app/server/data /app/server/uploads /app/backups \
 && chown node:node /app/server/data /app/server/uploads /app/backups

# 非 root 运行
USER node

EXPOSE 5181

# 数据卷：数据库与上传的错题原图
VOLUME ["/app/server/data", "/app/server/uploads"]

# 健康检查：打后端公开的 /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5181)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server/index.js"]
