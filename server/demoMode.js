/**
 * server/demoMode.js —— 演示模式判定
 * ---------------------------------------------------------------------------
 * 背景：
 *   登录页有一块「演示账号」面板（管理员 / 教师 / 家长 / 学生，点一下直接登录）。
 *   这块面板**只应该出现在演示环境**里。生产环境还显示它有两个问题：
 *     1. 把默认口令公开给所有访问者（admin/admin123 等）；
 *     2. 一键登录等于把管理员账号敞开。
 *
 * 判定来源（优先级从高到低）：
 *   1. 数据库设置 `system.demo` —— 管理员在「系统设置」里手动开关，运行时即生效；
 *   2. 环境变量 `DEMO_MODE=true` —— 部署级别的开关；
 *   3. 环境变量 `SEED_DEMO=true|force` —— 演示 compose 配置隐含演示环境；
 *   4. 默认关闭。
 *
 * 对外只暴露一个布尔值（`/api/version` 的 `demo` 字段），
 * 前端据此决定「演示账号」面板渲不渲染。
 */

import { db } from './db.js'
import { parseJSON, nowISO } from './db.js'

/** 数据库里的设置键 */
export const DEMO_SETTINGS_KEY = 'system.demo'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'force'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', ''])

/** 把各种写法的布尔值解析成 true / false / null（无法判断时为 null） */
export function parseBoolish(raw) {
  if (typeof raw === 'boolean') return raw
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().toLowerCase()
  if (TRUE_VALUES.has(s)) return true
  if (FALSE_VALUES.has(s)) return false
  return null
}

/** 读数据库里存的值；没存过返回 null（表示「没设置」） */
function readStoredDemo() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(DEMO_SETTINGS_KEY)
    if (!row) return null
    const raw = parseJSON(row.value, null)
    if (raw === null || raw === undefined) return null
    if (typeof raw === 'object') return parseBoolish(raw.enabled ?? raw.demo ?? raw.value)
    return parseBoolish(raw)
  } catch {
    return null
  }
}

/** 写数据库里的值 */
export function writeStoredDemo(enabled) {
  const value = Boolean(enabled)
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(DEMO_SETTINGS_KEY, JSON.stringify({ enabled: value }), nowISO())
  return value
}

/** 删除数据库里的值（回到「由环境变量决定」） */
export function clearStoredDemo() {
  try {
    db.prepare('DELETE FROM settings WHERE key = ?').run(DEMO_SETTINGS_KEY)
  } catch {
    /* 忽略 */
  }
}

/**
 * 当前是不是演示环境。
 * @returns {{demo: boolean, source: 'setting'|'env'|'seed'|'default', stored: boolean|null}}
 */
export function resolveDemoMode() {
  const stored = readStoredDemo()
  if (stored !== null) {
    return { demo: stored, source: 'setting', stored }
  }

  const envDemo = parseBoolish(process.env.DEMO_MODE)
  if (envDemo !== null) {
    return { demo: envDemo, source: 'env', stored }
  }

  // SEED_DEMO=force / true 都意味着这是演示环境
  const seed = parseBoolish(process.env.SEED_DEMO)
  if (seed === true) {
    return { demo: true, source: 'seed', stored }
  }

  return { demo: false, source: 'default', stored }
}

/** 只要一个布尔值时用这个 */
export function isDemoMode() {
  return resolveDemoMode().demo
}

/**
 * 对外的完整信息（给 /api/version 与系统设置页用）。
 * @returns {{demo: boolean, source: string, stored: boolean|null, envDemo: boolean|null, seedDemo: boolean|null}}
 */
export function demoModeInfo() {
  const r = resolveDemoMode()
  return {
    demo: r.demo,
    source: r.source,
    stored: r.stored,
    envDemo: parseBoolish(process.env.DEMO_MODE),
    seedDemo: parseBoolish(process.env.SEED_DEMO),
  }
}

export default { DEMO_SETTINGS_KEY, resolveDemoMode, isDemoMode, demoModeInfo, writeStoredDemo, clearStoredDemo }
