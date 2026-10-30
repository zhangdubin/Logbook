#!/usr/bin/env node
/**
 * server/repair-knowledge-points.js —— 知识点数据订正（命令行入口）
 * ---------------------------------------------------------------------------
 * 放在 `server/` 下是有原因的：**运行镜像里只有 `dist/` 和 `server/`**，
 * `scripts/` 不进镜像 —— 所以维护工具必须放在 `server/` 才能在容器里用。
 *
 *   docker exec -it cuoti-analytics node server/repair-knowledge-points.js
 *
 * 后端启动时也会自动跑一次（见 server/index.js），
 * 所以正常情况下**不需要手动执行** —— 这条命令是给「想亲眼确认」的人用的。
 */

import { repairKnowledgePoints } from './db.js'

const { scanned, fixed } = repairKnowledgePoints()

console.log(`[repair] 扫描错题 ${scanned} 条，需要订正 ${fixed} 条`)
if (fixed) {
  console.log('[repair] 已把「知识点是对象数组」的历史数据改成字符串数组')
} else {
  console.log('[repair] 数据是干净的，无需改动')
}
