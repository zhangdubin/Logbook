# syntax=docker/dockerfile:1
#
# Dockerfile —— 生产环境部署版本（容器）
# ============================================================================
# 构建：
#   docker build -t cuoti-analytics:1.0.0 .
#   docker build -t cuoti-analytics:1.0.0 --build-arg VERSION=1.0.0 .
#
# 运行：
#   docker run -d --name cuoti -p 5181:5181 \
#     -v cuoti-data:/app/server/data \
#     -v cuoti-uploads:/app/server/uploads \
#     cuoti-analytics:1.0.0
#
# 完整用法见 docker-compose.yml 与 docs/05-开发与部署指南.md
# ============================================================================

# ---------------------------------------------------------------------------
# 阶段 1：构建前端产物
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

# 先只拷依赖清单，这样后续改代码不会让 npm 缓存层失效
COPY --chmod=u=rwX,go=rX package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 再拷构建所需源码
COPY --chmod=u=rwX,go=rX index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY --chmod=u=rwX,go=rX src ./src
COPY --chmod=u=rwX,go=rX public ./public

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
COPY --chmod=u=rwX,go=rX package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# 前端构建产物
# --chown=node:node：直接以 node 用户属主落盘。
# 不要用 `RUN chown -R node:node /app` —— 那会把整个 /app 复制成新的一层，
# 实测凭空多出 76 MB（node_modules + dist 全量复制一遍）。
COPY --from=builder --chown=node:node --chmod=u=rwX,go=rX /app/dist ./dist

# 后端程序（server/data、server/uploads 的内容不进镜像，由数据卷承载）
COPY --chown=node:node --chmod=u=rwX,go=rX server ./server
# --chmod=755：确保入口脚本是「可读 + 可执行」——
# 只有执行位没有读位的话，解释器读不了脚本，容器会报 Permission denied
COPY --chown=node:node --chmod=755 deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# 构建信息（版本号 / 提交号 / 构建时间）
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
