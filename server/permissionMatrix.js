/**
 * server/permissionMatrix.js —— 可配置的权限矩阵（唯一事实来源）
 * ---------------------------------------------------------------------------
 * 背景：
 *   原来的权限矩阵写死在代码里（PERMISSIONS 常量），四种角色各能做什么
 *   只能改代码 + 重启服务才能调整。学校/机构实际需求千差万别：
 *   有的学校要家长能导出报表，有的不要；有的希望家长只能看不能录错题。
 *
 * 设计：
 *   1. **默认矩阵**仍写在代码里（DEFAULT_PERMISSIONS），保证「装完即用」，
 *      也保证后端升级新增权限点时，管理员没动过的角色自动继承新权限。
 *   2. 管理员在「账号管理 → 权限矩阵」里改动后，只把**相对默认值的差集**存进
 *      settings 表：
 *        { "teacher": { "granted": ["questions:delete"], "revoked": ["export:run"] } }
 *      存差集而不是全列表，是为了「后端新增权限点时自动生效」——
 *      如果存全列表，新加的权限点对所有角色都会静默消失。
 *   3. **admin 固定拥有全部权限**，不可配置。
 *      这是防自锁：管理员要是能把自己锁在系统外面（比如没了 users:manage），
 *      就只剩改数据库才能救回来。同理不提供「新增角色」「新增权限点」。
 *
 * 生效算法：
 *   最终权限(角色) = ( 默认权限(角色) ∪ granted ) \ revoked
 */

import { db, nowISO, parseJSON } from './db.js'

/* ========================================================================== */
/* 默认矩阵 —— 「能做什么」                                                      */
/* ========================================================================== */

/**
 * 权限点 → 允许的角色。
 * 新增权限点时：往这里加一条即可，前端表格会自动多一行（前端以 defaults 为准）。
 */
export const DEFAULT_PERMISSIONS = {
  'students:read': ['admin', 'teacher', 'parent', 'student'],
  'students:create': ['admin'],
  'students:update': ['admin', 'teacher'],
  'students:delete': ['admin'],
  'questions:read': ['admin', 'teacher', 'parent', 'student'],
  'questions:create': ['admin', 'teacher', 'parent', 'student'],
  'questions:update': ['admin', 'teacher', 'parent', 'student'],
  'questions:delete': ['admin', 'teacher', 'parent'],
  'stats:read': ['admin', 'teacher', 'parent', 'student'],
  'report:read': ['admin', 'teacher', 'parent'],
  'export:run': ['admin', 'teacher', 'parent'],
  'review:run': ['admin', 'teacher', 'parent', 'student'],
  'settings:ai': ['admin'],
  'settings:ocr': ['admin'],
  'system:update': ['admin'],
  'users:manage': ['admin'],
}

/** 全部权限点 */
export const PERMISSION_LIST = Object.keys(DEFAULT_PERMISSIONS)

/** 角色白名单（与 db.js 的 VALID_ROLES 保持一致） */
export const ROLES = ['admin', 'teacher', 'parent', 'student']

/** 固定拥有全部权限、不可配置的角色 */
export const LOCKED_ROLES = ['admin']

/** 可以被管理员配置的角色 */
export const EDITABLE_ROLES = ROLES.filter((r) => !LOCKED_ROLES.includes(r))

/** 数据库里的设置键 */
export const PERMISSION_SETTINGS_KEY = 'system.permissions'

/** 缓存有效期（毫秒）—— 多实例部署时靠它收敛 */
const CACHE_TTL_MS = 5000

/* ========================================================================== */
/* 存储层                                                                      */
/* ========================================================================== */

/**
 * 读数据库里存的差集。
 * @returns {Record<string, {granted: string[], revoked: string[]}>}
 */
function readOverrides() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PERMISSION_SETTINGS_KEY)
    if (!row) return {}
    const parsed = parseJSON(row.value, null)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return normalizeOverrides(parsed)
  } catch {
    return {}
  }
}

/**
 * 把任意形状的输入规整成 { role: {granted: string[], revoked: string[]} }。
 * 非法角色、非法权限点、重复项、granted∩revoked 的冲突项一律丢弃。
 */
function normalizeOverrides(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  for (const [role, value] of Object.entries(input)) {
    if (!EDITABLE_ROLES.includes(role)) continue
    const granted = []
    const revoked = []
    const rawGranted = Array.isArray(value?.granted) ? value.granted : []
    const rawRevoked = Array.isArray(value?.revoked) ? value.revoked : []
    for (const p of rawGranted) {
      if (typeof p === 'string' && PERMISSION_LIST.includes(p)) granted.push(p)
    }
    for (const p of rawRevoked) {
      if (typeof p === 'string' && PERMISSION_LIST.includes(p)) revoked.push(p)
    }
    // 同一个权限点既授予又收回 → 以「收回」为准（更安全）
    const grantedSet = new Set(granted.filter((p) => !revoked.includes(p)))
    if (grantedSet.size === 0 && revoked.length === 0) continue
    out[role] = { granted: [...grantedSet], revoked: [...new Set(revoked)] }
  }
  return out
}

/** 写数据库 */
function writeOverrides(overrides) {
  const value = JSON.stringify(overrides)
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(PERMISSION_SETTINGS_KEY, value, nowISO())
  invalidateCache()
}

/** 删掉数据库里的值（回到默认） */
export function clearOverrides() {
  try {
    db.prepare('DELETE FROM settings WHERE key = ?').run(PERMISSION_SETTINGS_KEY)
  } catch {
    /* 忽略 */
  }
  invalidateCache()
}

/* ========================================================================== */
/* 生效计算 + 缓存                                                              */
/* ========================================================================== */

let cache = null
let cacheAt = 0

function invalidateCache() {
  cache = null
  cacheAt = 0
}

/**
 * 当前生效的权限矩阵：权限点 → 允许的角色。
 * @returns {Record<string, string[]>}
 */
export function effectiveMatrix() {
  const now = Date.now()
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache

  const overrides = readOverrides()
  const result = {}
  for (const perm of PERMISSION_LIST) {
    const roles = new Set(DEFAULT_PERMISSIONS[perm] ?? [])
    // admin 固定拥有全部权限，任何配置都改不动它
    roles.add('admin')
    for (const role of EDITABLE_ROLES) {
      const o = overrides[role]
      if (!o) continue
      if (o.granted.includes(perm)) roles.add(role)
      if (o.revoked.includes(perm)) roles.delete(role)
    }
    result[perm] = ROLES.filter((r) => roles.has(r))
  }

  cache = result
  cacheAt = now
  return result
}

/**
 * 某角色当前拥有的全部权限点。
 * @param {string} role
 * @returns {string[]}
 */
export function effectivePermissionsForRole(role) {
  const matrix = effectiveMatrix()
  return PERMISSION_LIST.filter((p) => matrix[p]?.includes(role))
}

/**
 * 角色是否拥有某权限点。
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  if (!role || !permission) return false
  return Boolean(effectiveMatrix()[permission]?.includes(role))
}

/** 是否被管理员改过 */
export function isCustomized() {
  return Object.keys(readOverrides()).length > 0
}

/* ========================================================================== */
/* 对外的读写接口                                                               */
/* ========================================================================== */

/**
 * 给前端的完整信息。
 * @returns {{matrix: Record<string,string[]>, defaults: Record<string,string[]>,
 *            customized: boolean, editableRoles: string[], roles: string[]}}
 */
export function matrixInfo() {
  return {
    matrix: effectiveMatrix(),
    defaults: DEFAULT_PERMISSIONS,
    customized: isCustomized(),
    editableRoles: EDITABLE_ROLES,
    roles: ROLES,
  }
}

/**
 * 保存一份「角色 → 权限点全列表」的矩阵。
 * 后端负责转成相对默认值的差集再存，这样以后新增权限点会自动跟随默认。
 *
 * @param {Record<string, string[]>} input 角色 → 权限点列表
 * @returns {{ok: true, matrix: Record<string,string[]>, customized: boolean}}
 * @throws {Error} 权限点或角色非法时抛出，message 是中文说明
 */
export function saveMatrix(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('权限矩阵格式不对，应为 { 角色: [权限点] }')
  }

  // 校验角色
  const badRoles = Object.keys(input).filter((r) => !ROLES.includes(r))
  if (badRoles.length) {
    throw new Error(`未知角色：${badRoles.join('、')}`)
  }
  // admin 不可配置：传了就忽略，但明确告知
  if ('admin' in input) {
    // 系统管理员固定拥有全部权限，这里直接忽略传入值
    const { admin: _ignored, ...rest } = input
    input = rest
  }

  // 校验权限点
  const allBadPerms = new Set()
  for (const [role, list] of Object.entries(input)) {
    if (!Array.isArray(list)) {
      throw new Error(`角色 ${role} 的权限列表必须是数组`)
    }
    for (const p of list) {
      if (typeof p !== 'string' || !PERMISSION_LIST.includes(p)) allBadPerms.add(String(p))
    }
  }
  if (allBadPerms.size) {
    throw new Error(`不存在的权限点：${[...allBadPerms].join('、')}`)
  }

  // 全列表 → 相对默认值的差集
  //
  // ⚠️ 只有**请求里明确提到**的角色才动它。
  // 之前写成「没提到的角色当成空列表」，结果保存 { teacher: [...] } 时
  // 会把 parent / student 的权限**全部清空** —— 一个只改一个角色的请求
  // 毁掉了另外两个角色的权限。漏掉一个角色不该等于「收回它全部权限」。
  const overrides = {}
  for (const role of EDITABLE_ROLES) {
    if (!Object.prototype.hasOwnProperty.call(input, role)) continue
    const next = new Set(Array.isArray(input[role]) ? input[role] : [])
    const base = new Set(
      PERMISSION_LIST.filter((p) => (DEFAULT_PERMISSIONS[p] ?? []).includes(role)),
    )
    const granted = [...next].filter((p) => !base.has(p))
    const revoked = [...base].filter((p) => !next.has(p))
    if (granted.length === 0 && revoked.length === 0) continue
    overrides[role] = { granted, revoked }
  }

  // 没提到的角色：保留它现有的差集，不要动
  const current = readOverrides()
  for (const [role, value] of Object.entries(current)) {
    if (Object.prototype.hasOwnProperty.call(overrides, role)) continue
    overrides[role] = value
  }

  writeOverrides(overrides)
  return { ok: true, matrix: effectiveMatrix(), customized: isCustomized() }
}

export default {
  DEFAULT_PERMISSIONS,
  PERMISSION_LIST,
  ROLES,
  LOCKED_ROLES,
  EDITABLE_ROLES,
  PERMISSION_SETTINGS_KEY,
  effectiveMatrix,
  effectivePermissionsForRole,
  hasPermission,
  isCustomized,
  matrixInfo,
  saveMatrix,
  clearOverrides,
}
