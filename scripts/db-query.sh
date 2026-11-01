#!/usr/bin/env bash
# scripts/db-query.sh —— **只读**地查数据库
# ---------------------------------------------------------------------------
# 为什么需要这个：
#
#   直接 `sqlite3 server/data/cuoti.db "SELECT ..."` **会拿写锁** ——
#   而应用正在跑的时候，它和应用的写事务会打架。
#   应用这边已经内置 `busy_timeout = 8000`（会等），
#   但**手工查询这个连接自己是没有 busy_timeout 的**，
#   撞上了就是一句 `Error: database is locked`。
#
#   两种安全做法：
#     ① `PRAGMA query_only = 1`  —— 打开就是只读，**根本不拿写锁**
#     ② 只读 URI `file:...?mode=ro` —— 连文件都是只读打开的
#
#   这个脚本用 ① + ② 双保险。
#
# 用法：
#   bash scripts/db-query.sh "SELECT COUNT(*) FROM questions;"
#   bash scripts/db-query.sh ".tables"
#   bash scripts/db-query.sh                       # 进交互模式
#
#   # 容器部署时（数据在 named volume 里，宿主机看不到）：
#   bash scripts/db-query.sh --container "SELECT COUNT(*) FROM questions;"
#   bash scripts/db-query.sh --container "cuoti-analytics" "SELECT * FROM questions LIMIT 5;"
#
# ⚠️ 只读。想改数据请用应用自己的 API —— 那才是有校验、有备份的那条路。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── 容器模式 ──────────────────────────────────────────────────────
# 容器部署时数据库在 named volume（cuoti-data）里，**宿主机路径上找不到**。
# 这时直接在容器里查 —— 而且容器里的 node 本来就有 node:sqlite，
# 不需要宿主机装 sqlite3，也不需要把数据库拷出来。
if [ "${1:-}" = "--container" ]; then
  # 两种写法都支持：
  #   --container "SQL"                → 默认容器名
  #   --container "容器名" "SQL"        → 指定容器
  if [ -n "${3:-}" ]; then
    CONTAINER="$2"
    SQL="$3"
  else
    CONTAINER="${CUOTI_CONTAINER:-cuoti-analytics}"
    SQL="${2:-.tables}"
  fi
  DB_IN_CONTAINER="${CUOTI_DB_FILE_IN_CONTAINER:-/app/server/data/cuoti.db}"
  if [ ! -e "/var/run/docker.sock" ]; then
    echo "找不到 docker —— 容器模式需要能访问 docker daemon。" >&2
    exit 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "本机没有 docker 命令。" >&2
    exit 1
  fi
  # 容器里用 node 的 node:sqlite 开**只读**连接（readOnly: true → 不拿写锁）
  #
  # ⚠️ 这段 JS 用**单引号**包在 shell 里 —— 里面必须只用双引号。
  #    用双引号包 shell 的话，JS 里的双引号会把 shell 字符串截断，
  #    结果 node 收到的是**半截脚本**（报错还很难看懂）。
  exec docker exec "$CONTAINER" node -e '
    import("node:sqlite").then(({ DatabaseSync }) => {
      const db = new DatabaseSync(process.argv[1], { readOnly: true })
      const sql = process.argv[2]
      if (sql.trim().startsWith(".")) {
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all("table")
        console.log(rows.map(r => r.name).join(String.fromCharCode(10)))
      } else {
        console.log(db.prepare(sql).all())
      }
    })
  ' "$DB_IN_CONTAINER" "$SQL"
fi

DB_FILE="${CUOTI_DB_FILE:-$ROOT/server/data/cuoti.db}"

if [ ! -f "$DB_FILE" ]; then
  echo "找不到数据库文件：$DB_FILE" >&2
  echo "（如果数据在别处，用 CUOTI_DB_FILE=/path/to/cuoti.db 指定）" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "本机没有 sqlite3 命令行工具。" >&2
  echo "备选：用 node 读（同样只读）：" >&2
  echo "  node -e \"import('node:sqlite').then(({DatabaseSync})=>{" >&2
  echo "    const db=new DatabaseSync(process.argv[1],{readOnly:true});" >&2
  echo "    console.log(db.prepare(process.argv[2]).all())})\" '$DB_FILE' '你的 SQL'" >&2
  exit 1
fi

# mode=ro → 连文件都是只读打开的；query_only → 额外禁止写
exec sqlite3 -readonly "file:$DB_FILE?mode=ro" \
  "PRAGMA query_only = 1;" \
  "${1:-.tables}"
