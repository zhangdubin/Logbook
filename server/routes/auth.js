/**
 * server/routes/auth.js —— 登录 / 注销 / 当前用户 / 权限矩阵 / 自助改密
 *
 *   POST /api/auth/login         body { username, password } → { user, permissions } + Set-Cookie
 *   POST /api/auth/logout        → 204（删除 session + 清 Cookie）
 *   GET  /api/auth/me            → { user, permissions }
 *   GET  /api/auth/permissions   → Record<permission, Role[]>
 *   POST /api/auth/password      body { currentPassword, newPassword } → { ok: true }
 */

import { Router } from 'express'

import { db, nowISO } from '../db.js'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearFailures,
  clientIp,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  isRateLimited,
  permissionsForRole,
  readToken,
  recordFailure,
  requireAuth,
  requirePermission,
  userResponse,
  verifyPassword,
} from '../auth.js'
import {
  clearOverrides,
  effectiveMatrix,
  isCustomized,
  matrixInfo,
  saveMatrix,
} from '../permissionMatrix.js'

const router = Router()

/* ------------------------------ 登录 ------------------------------ */
router.post('/login', (req, res) => {
  const body = req.body ?? {}
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')

  if (!username || !password) {
    return res.status(400).json({ error: 'BadRequest', message: '用户名与密码不能为空' })
  }

  const ip = clientIp(req)
  // 限流：15 分钟内失败 5 次即锁定
  if (isRateLimited(username, ip)) {
    return res
      .status(429)
      .json({ error: 'TooManyRequests', message: '登录尝试过于频繁，请 15 分钟后再试' })
  }

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)

  if (!row) {
    recordFailure(username, ip)
    return res.status(401).json({ error: 'Unauthorized', message: '账号或密码错误' })
  }

  if (!verifyPassword(password, row.password_hash)) {
    recordFailure(username, ip)
    return res.status(401).json({ error: 'Unauthorized', message: '账号或密码错误' })
  }

  if (row.status !== 'active') {
    return res.status(403).json({ error: 'Forbidden', message: '账号已被禁用，请联系管理员' })
  }

  // 成功登录：清零失败计数
  clearFailures(username, ip)

  const { token } = createSession(row.id, req)
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowISO(), row.id)

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // 注意：Express 的 maxAge 单位是**毫秒**（内部换算成 Max-Age 秒）
    maxAge: SESSION_TTL_MS,
  })

  res.json({
    user: userResponse(row),
    permissions: permissionsForRole(row.role),
  })
})

/* ------------------------------ 注销 ------------------------------ */
router.post('/logout', (req, res) => {
  const token = readToken(req)
  if (token) destroySession(token)
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' })
  res.status(204).end()
})

/* --------------------------- 当前用户 --------------------------- */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    permissions: permissionsForRole(req.user.role),
  })
})

/* ---------------------------- 权限矩阵 ---------------------------- */
/**
 * GET /api/auth/permissions
 *
 * 返回当前生效的矩阵 + 内置默认矩阵 + 是否被改过 + 哪些角色可配置。
 * 需要登录（但任何角色都能看 —— 这是权限的透明度）。
 */
router.get('/permissions', requireAuth, (_req, res) => {
  res.json(matrixInfo())
})

/**
 * PUT /api/auth/permissions
 * body { matrix: { teacher: ['students:read', ...], parent: [...] } } → { ok, matrix, customized }
 *
 * 需要 `users:manage` 权限（默认只有系统管理员）。
 * 两条硬约束：
 *   - `admin` 固定拥有全部权限，传入的 admin 配置被忽略（防自锁）
 *   - 权限点必须在后端白名单内，否则 400
 */
router.put('/permissions', requireAuth, requirePermission('users:manage'), (req, res) => {
  const body = req.body ?? {}
  // 兼容两种写法：{ matrix: {...} } 和直接 {...}
  const input = body.matrix && typeof body.matrix === 'object' ? body.matrix : body
  try {
    res.json(saveMatrix(input))
  } catch (e) {
    res.status(400).json({ ok: false, message: e?.message || '权限矩阵保存失败' })
  }
})

/**
 * PUT /api/auth/permissions/reset → { ok, matrix, customized }
 * 恢复成后端内置的默认权限矩阵。
 */
router.put('/permissions/reset', requireAuth, requirePermission('users:manage'), (_req, res) => {
  clearOverrides()
  res.json({ ok: true, matrix: effectiveMatrix(), customized: isCustomized() })
})

/* --------------------------- 自助修改口令 --------------------------- */
/**
 * POST /api/auth/password  body { currentPassword, newPassword } → { ok: true }
 *
 * 任何登录用户都能改**自己的**口令（不需要 users:manage）：
 *   - 必须校验旧口令，错则 401「当前密码不正确」
 *   - 新口令长度 ≥ 6 且不能与旧口令相同，否则 400
 *   - 成功后作废该账号的**其它** session（保留当前 session）
 *   - 同时把 must_change_password 归零
 */
router.post('/password', requireAuth, (req, res) => {
  const body = req.body ?? {}
  const currentPassword = String(body.currentPassword ?? '')
  const newPassword = String(body.newPassword ?? '')

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!row) {
    return res.status(401).json({ error: 'Unauthorized', message: '请先登录' })
  }

  // 1. 旧口令必须正确
  if (!currentPassword || !verifyPassword(currentPassword, row.password_hash)) {
    return res.status(401).json({ error: 'Unauthorized', message: '当前密码不正确' })
  }

  // 2. 新口令强度与重复性
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'BadRequest', message: '新密码长度至少 6 位' })
  }
  if (verifyPassword(newPassword, row.password_hash)) {
    return res.status(400).json({ error: 'BadRequest', message: '新密码不能与当前密码相同' })
  }

  db.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
  ).run(hashPassword(newPassword), row.id)

  // 3. 作废该账号的其它 session，保留当前 session
  destroyUserSessions(row.id, req.sessionToken)

  res.status(200).json({ ok: true })
})

export { router as authRouter }
export default router
