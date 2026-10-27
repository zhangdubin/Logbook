/**
 * server/auth.js —— 认证与分级权限（唯一事实来源）
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 口令哈希与校验（node:crypto scrypt，无第三方依赖）
 *   2. 会话（数据库表 + HttpOnly Cookie），支持滑动续期
 *   3. 登录失败限流（内存 Map，15 分钟 5 次）
 *   4. PERMISSIONS —— 权限矩阵（能做什么）
 *   5. scopeStudentIds —— 数据范围（能对谁做）
 *
 * 核心原则：权限 = 权限点（permission）+ 数据范围（data scoping），
 * 两者都在**服务端**强制执行；前端隐藏入口只是体验优化。
 */

import crypto from 'node:crypto'

import {
  db,
  uid,
  nowISO,
  toBool,
  mapUser,
  getUserRow,
  linkedStudentIdsForUser,
  ROLE_LINK_COLUMN,
  VALID_ROLES,
} from './db.js'

/* ========================================================================== */
/* 权限矩阵 —— 「能做什么」                                                     */
/* ========================================================================== */

export const PERMISSIONS = {
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

export const PERMISSION_LIST = Object.keys(PERMISSIONS)

/** 角色是否拥有某权限点 */
export function hasPermission(role, permission) {
  const allowed = PERMISSIONS[permission]
  if (!allowed) return false
  return allowed.includes(role)
}

/** 某角色拥有的全部权限点 */
export function permissionsForRole(role) {
  return PERMISSION_LIST.filter((p) => PERMISSIONS[p].includes(role))
}

/* ========================================================================== */
/* 口令哈希                                                                    */
/* ========================================================================== */

const SCRYPT_KEYLEN = 64

/** 生成 `scrypt$<saltHex>$<hashHex>` */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex')
  return `scrypt$${salt}$${hash}`
}

/**
 * 校验口令（恒定时间比较）。
 * 注意：长度不一致时**不能**直接交给 timingSafeEqual。
 */
export function verifyPassword(password, stored) {
  if (!stored) return false
  const parts = String(stored).split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, hashHex] = parts
  if (!salt || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== SCRYPT_KEYLEN) return false
  let actual
  try {
    actual = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN)
  } catch {
    return false
  }
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

/* ========================================================================== */
/* 会话                                                                        */
/* ========================================================================== */

export const SESSION_COOKIE = 'ct_session'
/** 30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000)

/** 创建会话并返回 token */
export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('hex')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_TTL_MS)
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    token,
    userId,
    now.toISOString(),
    expires.toISOString(),
    String(req?.headers?.['user-agent'] ?? ''),
    clientIp(req),
  )
  return { token, expiresAt: expires.toISOString() }
}

/** 滑动续期：每次鉴权成功把过期时间往后推 30 天 */
export function touchSession(token) {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(expires, token)
}

export function destroySession(token) {
  if (!token) return
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function destroyUserSessions(userId, exceptToken = '') {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken)
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }
}

/** 清理过期会话 */
export function pruneExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?').run(nowISO())
}

/** 从请求里取会话 token（Cookie 优先，其次 Authorization: Bearer） */
export function readToken(req) {
  const raw = req?.headers?.cookie
  if (raw) {
    for (const part of String(raw).split(';')) {
      const idx = part.indexOf('=')
      if (idx < 0) continue
      if (part.slice(0, idx).trim() === SESSION_COOKIE) {
        const v = decodeURIComponent(part.slice(idx + 1).trim())
        if (v) return v
      }
    }
  }
  const auth = req?.headers?.authorization
  if (auth && /^Bearer\s+/i.test(auth)) {
    const v = auth.replace(/^Bearer\s+/i, '').trim()
    if (v) return v
  }
  return ''
}

/* ========================================================================== */
/* 登录限流                                                                    */
/* ========================================================================== */

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
/** username|ip → { count, firstAt } */
const loginAttempts = new Map()

function attemptKey(username, ip) {
  return `${String(username || '').toLowerCase()}|${ip || ''}`
}

function pruneAttempts() {
  const now = Date.now()
  for (const [k, v] of loginAttempts) {
    if (now - v.firstAt > WINDOW_MS) loginAttempts.delete(k)
  }
}

/** 是否已被锁定（15 分钟内失败 5 次） */
export function isRateLimited(username, ip) {
  pruneAttempts()
  const rec = loginAttempts.get(attemptKey(username, ip))
  if (!rec) return false
  return rec.count >= MAX_ATTEMPTS
}

/** 记录一次失败 */
export function recordFailure(username, ip) {
  pruneAttempts()
  const key = attemptKey(username, ip)
  const rec = loginAttempts.get(key)
  if (!rec) {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() })
    return
  }
  rec.count += 1
  loginAttempts.set(key, rec)
}

/** 成功登录后清零 */
export function clearFailures(username, ip) {
  loginAttempts.delete(attemptKey(username, ip))
}

/* ========================================================================== */
/* 中间件                                                                      */
/* ========================================================================== */

/** 统一的 401 / 403 响应 */
export function unauthorized(res, message = '请先登录') {
  return res.status(401).json({ error: 'Unauthorized', message })
}

export function forbidden(res, message = '当前角色无权执行此操作') {
  return res.status(403).json({ error: 'Forbidden', message })
}

/**
 * 登录校验中间件：解析 Cookie -> 会话 -> 用户，写入 req.user / req.sessionToken。
 * 未登录一律 401。
 */
export function requireAuth(req, res, next) {
  const token = readToken(req)
  if (!token) return unauthorized(res)

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
  if (!session) return unauthorized(res)

  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    destroySession(token)
    return unauthorized(res)
  }

  const row = getUserRow(session.user_id)
  if (!row) {
    destroySession(token)
    return unauthorized(res)
  }
  if (row.status !== 'active') {
    destroySession(token)
    return unauthorized(res, '账号已被禁用，请联系管理员')
  }

  req.user = mapUser(row, linkedStudentIdsForUser(row.id, row.role))
  req.sessionToken = token
  touchSession(token)
  next()
}

/** 权限点校验中间件：requirePermission('users:manage') */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return unauthorized(res)
    if (!hasPermission(req.user.role, permission)) {
      return forbidden(res)
    }
    next()
  }
}

/* ========================================================================== */
/* 数据范围 —— 「能对谁做」                                                     */
/* ========================================================================== */

/**
 * 返回该账号允许访问的学生 id 数组。
 * admin 返回 null —— 表示「不限制」。
 * @param {object} user
 * @returns {string[]|null}
 */
export function scopeStudentIds(user) {
  if (!user) return []
  if (user.role === 'admin') return null
  const col = ROLE_LINK_COLUMN[user.role]
  if (!col) return []
  const rows = db.prepare(`SELECT id FROM students WHERE ${col} = ?`).all(user.id)
  return rows.map((r) => r.id)
}

/** 请求级缓存的范围信息：{ ids: string[]|null, admin: boolean } */
export function scopeFor(req) {
  if (req._scope) return req._scope
  const user = req.user
  if (!user) {
    req._scope = { ids: [], admin: false }
  } else if (user.role === 'admin') {
    req._scope = { ids: null, admin: true }
  } else {
    req._scope = { ids: scopeStudentIds(user), admin: false }
  }
  return req._scope
}

/** 判断某个 studentId 是否在当前账号的数据范围内 */
export function canAccessStudent(req, studentId) {
  if (!req.user) return false
  const { ids, admin } = scopeFor(req)
  if (admin) return true
  if (!studentId) return true
  return Array.isArray(ids) && ids.includes(String(studentId))
}

/**
 * 数据范围守卫：若请求带了 studentId 且越权，直接 403。
 * @returns {boolean} true = 已放行
 */
export function guardStudentScope(req, res, studentId) {
  if (!studentId) return true
  if (canAccessStudent(req, studentId)) return true
  forbidden(res, '无权访问该学生的数据')
  return false
}

/* ========================================================================== */
/* 首个管理员                                                                  */
/* ========================================================================== */

/**
 * 确保系统里存在管理员账号。
 *
 * 触发条件：**没有任何管理员账号**时创建（全新数据库必然满足；
 * 若先执行过 npm run seed 补建了演示账号、但尚无管理员，同样会补建，
 * 避免出现「没有任何人能登录管理端」的死锁状态）。
 *
 * 口令来自环境变量 ADMIN_USERNAME / ADMIN_PASSWORD。
 */
export function ensureAdminUser() {
  const adminCount = Number(
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get()?.c ?? 0,
  )
  if (adminCount > 0) return null

  const username = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin'
  const password = String(process.env.ADMIN_PASSWORD || 'admin123')
  const id = uid('usr')
  const createdAt = nowISO()

  db.prepare(
    `INSERT INTO users (
        id, username, name, role, password_hash, avatar_color, phone, note,
        status, must_change_password, created_at, last_login_at
     ) VALUES (?, ?, ?, 'admin', ?, ?, ?, ?, 'active', 1, ?, NULL)`,
  ).run(
    id,
    username,
    '系统管理员',
    hashPassword(password),
    '#ef4444',
    null,
    '系统自动创建的首个管理员',
    createdAt,
  )

  const banner = [
    '',
    '='.repeat(72),
    '  首次启动：已自动创建系统管理员账号',
    '='.repeat(72),
    `  用户名 : ${username}`,
    `  口令   : ${password}`,
    '  ⚠️  该账号 must_change_password = 1，请登录后立即修改口令！',
    '  ⚠️  可通过环境变量 ADMIN_USERNAME / ADMIN_PASSWORD 调整初始账号。',
    '='.repeat(72),
    '',
  ].join('\n')
  console.warn(banner)

  return { id, username }
}

/* ========================================================================== */
/* 工具                                                                        */
/* ========================================================================== */

/**
 * 取客户端 IP（仅用于会话审计与限流）。
 * 刻意**不信任** X-Forwarded-For：否则攻击者可伪造该头绕过登录限流。
 */
export function clientIp(req) {
  return String(req?.ip ?? req?.socket?.remoteAddress ?? '')
}

/** 组装前端 User 响应（自动补 linkedStudentIds，绝不返回 password_hash） */
export function userResponse(row) {
  if (!row) return null
  return mapUser(row, linkedStudentIdsForUser(row.id, row.role))
}

export { ROLE_LINK_COLUMN, VALID_ROLES, toBool }
