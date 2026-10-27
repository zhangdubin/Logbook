#!/bin/sh
#
# deploy/docker/entrypoint.sh —— 容器入口
#
# 职责：
#   1. 确保数据目录存在且属主正确（volume 挂到空目录时也会补建）
#   2. 可选：首次启动灌入演示数据（SEED_DEMO=true，默认关）
#   3. 可选：把 OCR_SERVICE_URL 写进系统设置（省得进 UI 手填）
#   4. exec 启动主进程（PID 1，收到 SIGTERM 能优雅退出）
#
# 环境变量：
#   PORT            监听端口，默认 5181
#   HOST            监听地址，默认 0.0.0.0
#   SEED_DEMO       "true" 时首次启动灌演示数据（会清空业务数据，慎用）
#   OCR_SERVICE_URL 本地 OCR 地址，例如 http://ocr:8868；写入系统设置
#   DB_SEED_ADMIN   初始管理员口令（默认 admin123）
#
set -e

APP_DIR="/app"
DATA_DIR="$APP_DIR/server/data"
UPLOAD_DIR="$APP_DIR/server/uploads"
PORT="${PORT:-5181}"
HOST="${HOST:-0.0.0.0}"

echo "[entrypoint] 错题本 · 学情智能分析系统 —— 容器启动"

# --- 1. 数据目录 -----------------------------------------------------------
mkdir -p "$DATA_DIR" "$UPLOAD_DIR" "$APP_DIR/backups"

# volume 首次挂载时属主可能是 root，node 用户会写不进去
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" "$UPLOAD_DIR" "$APP_DIR/backups" 2>/dev/null || true
fi
if [ ! -w "$DATA_DIR" ]; then
  echo "[entrypoint] 警告：$DATA_DIR 不可写，数据库可能无法创建" >&2
fi

# --- 2. 演示数据 -----------------------------------------------------------
# server/seed.js 每次运行都会**清空** questions / students 再重写，
# 所以默认只在数据库还不存在时灌一次，绝不碰已有数据。
#
#   SEED_DEMO=true   数据库不存在时灌演示数据（默认行为）
#   SEED_DEMO=force  强制重灌（**会清空错题与学生数据**，仅用于重置演示环境）
DB_FILE="$DATA_DIR/cuoti.db"
case "${SEED_DEMO:-false}" in
  true|1|yes)
    if [ -f "$DB_FILE" ]; then
      echo "[entrypoint] 数据库已存在，跳过演示数据灌入（避免清空已有错题）" >&2
      echo "[entrypoint]   需要重置演示环境：SEED_DEMO=force docker compose up -d --force-recreate" >&2
    else
      echo "[entrypoint] 首次启动：灌入演示数据…"
      node server/seed.js || echo "[entrypoint] 演示数据灌入失败（不阻断启动）" >&2
    fi
    ;;
  force)
    echo "[entrypoint] SEED_DEMO=force：清空并重灌演示数据…"
    node server/seed.js || echo "[entrypoint] 演示数据灌入失败（不阻断启动）" >&2
    ;;
esac

# --- 3. 本地 OCR 地址写进系统设置 ------------------------------------------
# 系统设置里的「本地 OCR 服务地址」存在数据库的 ai.config 里（字段 ocrBaseUrl / ocrEnabled），
# 容器里没法进 UI 点，所以这里用环境变量代填（仅当数据库里还是空的时候才写）。
#
# 用应用自己的 settings 模块读写，而不是直接开 sqlite：
#   - import server/settings.js 会顺带建好表结构（全新卷上数据库还不存在）
#   - 写出的 JSON 结构与 UI 里保存的一致，将来在 UI 里改也不会打架
if [ -n "${OCR_SERVICE_URL:-}" ]; then
  node --input-type=module -e "
    const { readStoredAiConfig, writeStoredAiConfig } = await import('./server/settings.js');
    const cur = readStoredAiConfig() || {};
    if (!cur.ocrBaseUrl) {
      writeStoredAiConfig({ ...cur, ocrBaseUrl: process.env.OCR_SERVICE_URL, ocrEnabled: true });
      console.log('已写入本地 OCR 地址：' + process.env.OCR_SERVICE_URL);
    } else {
      console.log('本地 OCR 地址已配置（' + cur.ocrBaseUrl + '），保持不变');
    }
  " 2>&1 | sed 's/^/[entrypoint] /' || echo "[entrypoint] OCR 地址写入跳过" >&2
fi

# --- 4. 启动 ---------------------------------------------------------------
# exec 让主进程成为 PID 1，docker stop 的 SIGTERM 能直接到应用
echo "[entrypoint] 监听 http://$HOST:$PORT"
exec "$@"
