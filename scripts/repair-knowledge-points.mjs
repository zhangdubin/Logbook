#!/usr/bin/env node
/**
 * scripts/repair-knowledge-points.mjs —— 清洗历史「知识点是对象数组」的错题数据
 * ---------------------------------------------------------------------------
 * 背景：
 *   有一段时间后端把 draft.knowledgePoints 改成了对象数组
 *   （{name, confidence, level, evidence}），前端又把它原样存回了
 *   questions.knowledge_points 列。于是库里那批错题的知识点是对象而不是字符串。
 *
 *   后果：
 *     - 前端把它当 React 子节点渲染 → React error #31 → **整页白屏**
 *     - 知识点下拉里会出现 `{"name":"小数乘法","confidence":0.5,...}` 这种文本
 *
 * 现在读写两侧都已经归一化（server/db.js 的 normalizeKnowledgePoints），
 * 所以**新数据不会再坏**；这个脚本用来把**存量数据**就地改正。
 *
 * 用法：
 *   node scripts/repair-knowledge-points.mjs            # 干跑：只看会改什么，不写入
 *   node scripts/repair-knowledge-points.mjs --apply    # 真正写入
 *
 * 退出码：0 = 正常；1 = 出错。
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(ROOT, 'server', 'data', 'cuoti.db')

const APPLY = process.argv.includes('--apply')

/** 知识点 → 字符串数组；与 server/db.js 的 normalizeKnowledgePoints 保持一致 */
function normalizeKnowledgePoints(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const kp of list) {
    let name = ''
    if (typeof kp === 'string') name = kp.trim()
    else if (kp && typeof kp === 'object') {
      const n = kp.name
      if (typeof n === 'string') name = n.trim()
      else if (n && typeof n === 'object' && typeof n.name === 'string') name = n.name.trim()
    }
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`✗ 找不到数据库：${DB_PATH}`)
  console.error('  指定别的库：DB_PATH=/path/to/cuoti.db node scripts/repair-knowledge-points.mjs')
  process.exit(1)
}

console.log(`数据库：${DB_PATH}`)
console.log(APPLY ? '模式：写入' : '模式：干跑（加 --apply 才会真正修改）')
console.log('---')

const db = new DatabaseSync(DB_PATH)
const rows = db.prepare('SELECT id, knowledge_points FROM questions').all()

let changed = 0
const updates = []

for (const row of rows) {
  let raw = []
  try {
    raw = JSON.parse(row.knowledge_points ?? '[]')
  } catch {
    raw = []
  }
  if (!Array.isArray(raw)) continue
  const alreadyFine = raw.every((k) => typeof k === 'string')
  if (alreadyFine) continue

  const fixed = normalizeKnowledgePoints(raw)
  changed += 1
  updates.push([JSON.stringify(fixed), row.id])
  if (changed <= 10) {
    console.log(`  · ${row.id}`)
    console.log(`      修复前：${JSON.stringify(raw).slice(0, 140)}`)
    console.log(`      修复后：${JSON.stringify(fixed).slice(0, 140)}`)
  }
}

if (!changed) {
  console.log('✓ 没有需要清洗的数据')
  db.close()
  process.exit(0)
}

console.log('---')
console.log(`共 ${changed} 条需要清洗`)

if (!APPLY) {
  console.log('（干跑模式，未写入。加 --apply 真正执行）')
  db.close()
  process.exit(0)
}

const upd = db.prepare('UPDATE questions SET knowledge_points = ? WHERE id = ?')
db.exec('BEGIN')
try {
  for (const [kp, id] of updates) upd.run(kp, id)
  db.exec('COMMIT')
  console.log(`✓ 已清洗 ${updates.length} 条`)
} catch (err) {
  db.exec('ROLLBACK')
  console.error('✗ 清洗失败（已回滚）：', err?.message ?? err)
  db.close()
  process.exit(1)
}

db.close()
