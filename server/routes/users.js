/**
 * server/routes/users.js —— 账号管理（仅系统管理员）
 *
 *   GET    /api/users                              → User[]
 *   POST   /api/users                              body UserInput → User
 *   PATCH  /api/users/:id                          body Partial<UserInput> → User
 *   DELETE /api/users/:id                          → 204
 *   POST   /api/users/:id/password   body { password } → { ok: true }
 *   POST   /api/users/:id/students/:studentId      → User（建立关联）
 *   DELETE /api/users/:id/students/:studentId      → User（解除关联）
 *
 * 响应体**永远不含** password_hash。
 */

import { Router } from 'express'

import {
  db,
  uid,
  nowISO,
  getUserRow,
  getUserRowByUsername,
  linkedStudentIdsForUser,
  listUserRows,
  mapUser,
  ROLE_LINK_COLUMN,
  VALID_ROLES,
} from '../db.js'
import {
  destroyUserSessions,
  hashPassword,
  requirePermission,
  userResponse,
} from '../auth.js'

const router = Router()

const AVATAR_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

/* 所有账号管理接口都需要 users:manage 权限（= admin） */
router.use(requirePermission('users:manage'))

function badRequest(res, message) {
  return res.status(400).json({ error: 'BadRequest', message })
}

function notFound(res, message = '账号不存在') {
  return res.status(404).json({ error: 'NotFound', message })
}

/** 解除该账号在 students 表上的全部关联 */
function clearLinks(userId, role) {
  const col = ROLE_LINK_COLUMN[role]
  if (!col) return
  db.prepare(`UPDATE students SET ${col} = NULL WHERE ${col} = ?`).run(userId)
}

/** 建立关联：把 studentId 指向该账号 */
function applyLink(userId, role, studentId) {
  const col = ROLE_LINK_COLUMN[role]
  if (!col) return
  db.prepare(`UPDATE students SET ${col} = ? WHERE id = ?`).run(userId, studentId)
}

/** 批量设置关联（覆盖式） */
function applyLinks(userId, role, studentIds) {
  clearLinks(userId, role)
  if (!Array.isArray(studentIds)) return
  for (const sid of studentIds) {
    const exists = db.prepare('SELECT id FROM students WHERE id = ?').get(String(sid))
    if (!exists) continue
    applyLink(userId, role, String(sid))
  }
}

/* ------------------------------ 列表 ------------------------------ */
router.get('/', (_req, res) => {
  res.json(
    listUserRows().map((row) => mapUser(row, linkedStudentIdsForUser(row.id, row.role))),
  )
})

/* ------------------------------ 新建 ------------------------------ */
router.post('/', (req, res) => {
  const body = req.body ?? {}
  const username = String(body.username ?? '').trim()
  const name = String(body.name ?? '').trim()
  const password = String(body.password ?? '')
  const role = String(body.role ?? '').trim()

  if (!username) return badRequest(res, '用户名不能为空')
  if (!name) return badRequest(res, '姓名不能为空')
  if (!password) return badRequest(res, '密码不能为空')
  if (!VALID_ROLES.includes(role)) {
    return badRequest(res, `角色必须是 ${VALID_ROLES.join(' / ')}`)
  }

  if (getUserRowByUsername(username)) {
    return res.status(409).json({ error: 'Conflict', message: '用户名已存在' })
  }

  const id = uid('usr')
  const createdAt = nowISO()
  const avatarColor =
    body.avatarColor ||
    AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]

  db.prepare(
    `INSERT INTO users (
        id, username, name, role, password_hash, avatar_color, phone, note,
        status, must_change_password, created_at, last_login_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    username,
    name,
    role,
    hashPassword(password),
    avatarColor,
    body.phone ? String(body.phone) : null,
    body.note ? String(body.note) : null,
    body.status === 'disabled' ? 'disabled' : 'active',
    body.mustChangePassword ? 1 : 0,
    createdAt,
  )

  if (Array.isArray(body.studentIds)) applyLinks(id, role, body.studentIds)

  const row = getUserRow(id)
  res.status(200).json(userResponse(row))
})

/* ------------------------------ 更新 ------------------------------ */
router.patch('/:id', (req, res) => {
  const id = req.params.id
  const existing = getUserRow(id)
  if (!existing) return notFound(res)

  const body = req.body ?? {}
  const isSelf = req.user && req.user.id === id

  const username =
    body.username !== undefined ? String(body.username).trim() : existing.username
  if (!username) return badRequest(res, '用户名不能为空')

  if (username !== existing.username && getUserRowByUsername(username)) {
    return res.status(409).json({ error: 'Conflict', message: '用户名已存在' })
  }

  const name = body.name !== undefined ? String(body.name).trim() : existing.name
  if (!name) return badRequest(res, '姓名不能为空')

  let role = existing.role
  if (body.role !== undefined && String(body.role).trim() !== existing.role) {
    role = String(body.role).trim()
    if (!VALID_ROLES.includes(role)) {
      return badRequest(res, `角色必须是 ${VALID_ROLES.join(' / ')}`)
    }
    if (isSelf) return badRequest(res, '不能修改自己的角色')
    if (existing.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
      return badRequest(res, '系统至少需要保留一个管理员账号')
    }
  }

  const status = body.status !== undefined ? (body.status === 'disabled' ? 'disabled' : 'active') : existing.status
  const avatarColor =
    body.avatarColor !== undefined ? String(body.avatarColor) : existing.avatar_color
  const phone = body.phone !== undefined ? (body.phone ? String(body.phone) : null) : existing.phone
  const note = body.note !== undefined ? (body.note ? String(body.note) : null) : existing.note

  // 口令：留空 = 不修改
  const rawPassword = body.password === undefined || body.password === null ? '' : String(body.password)

  // 管理员不能通过 PATCH 改自己的口令（必须走 POST /api/auth/password 校验旧口令）
  if (rawPassword && isSelf) {
    return badRequest(res, '修改自己的密码请使用 POST /api/auth/password（需校验当前密码）')
  }

  const passwordHash = rawPassword ? hashPassword(rawPassword) : existing.password_hash
  const mustChange =
    rawPassword ? 0 : body.mustChangePassword === undefined ? existing.must_change_password : body.mustChangePassword ? 1 : 0

  db.prepare(
    `UPDATE users
        SET username = ?, name = ?, role = ?, password_hash = ?, avatar_color = ?,
            phone = ?, note = ?, status = ?, must_change_password = ?
      WHERE id = ?`,
  ).run(
    username,
    name,
    role,
    passwordHash,
    avatarColor,
    phone,
    note,
    status,
    mustChange ? 1 : 0,
    id,
  )

  // 角色变化 → 关联列含义变化，需要重挂
  if (role !== existing.role) {
    clearLinks(existing.id, existing.role)
    if (Array.isArray(body.studentIds)) applyLinks(id, role, body.studentIds)
  } else if (Array.isArray(body.studentIds)) {
    applyLinks(id, role, body.studentIds)
  }

  // 口令变更或被禁用 → 该账号的所有 session 立即失效
  // （口令被改 = 凭据已变，旧会话必须作废，否则旧会话在改密后仍然有效 = 安全漏洞）
  if (rawPassword || status === 'disabled') {
    destroyUserSessions(id)
  }

  const row = getUserRow(id)
  res.status(200).json(userResponse(row))
})

/* ------------------------------ 删除 ------------------------------ */
router.delete('/:id', (req, res) => {
  const id = req.params.id
  const existing = getUserRow(id)
  if (!existing) return notFound(res)

  if (req.user && req.user.id === id) {
    return badRequest(res, '不能删除当前登录的账号')
  }
  if (existing.role === 'admin' && countAdmins() <= 1) {
    return badRequest(res, '系统至少需要保留一个管理员账号')
  }

  clearLinks(id, existing.role)
  destroyUserSessions(id)
  db.prepare('DELETE FROM users WHERE id = ?').run(id)

  res.status(204).end()
})

/* --------------------------- 重置口令 --------------------------- */
/**
 * POST /api/users/:id/password  body { password } → { ok: true }
 *
 * 安全约定：
 *   - 管理员**重置他人**口令不需要旧口令（管理员职责）
 *   - 管理员**不能**用这个端点改自己的口令（那必须走 POST /api/auth/password 校验旧口令），
 *     否则就成了绕过旧口令校验的后门
 *   - 重置后目标账号的**所有** session 立即失效（否则旧会话在重置后仍然有效 = 安全漏洞）
 */
router.post('/:id/password', (req, res) => {
  const id = req.params.id
  const existing = getUserRow(id)
  if (!existing) return notFound(res)

  if (req.user && req.user.id === id) {
    return badRequest(res, '修改自己的密码请使用 POST /api/auth/password（需校验当前密码）')
  }

  const password = String(req.body?.password ?? '')
  if (!password) return badRequest(res, '密码不能为空')

  db.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
  ).run(hashPassword(password), id)

  // 口令被重置 → 目标账号的所有 session 立即失效
  destroyUserSessions(id)

  res.status(200).json({ ok: true })
})

/* ------------------------- 关联 / 解除关联 ------------------------- */
router.post('/:id/students/:studentId', (req, res) => {
  const id = req.params.id
  const studentId = String(req.params.studentId)
  const existing = getUserRow(id)
  if (!existing) return notFound(res)

  const col = ROLE_LINK_COLUMN[existing.role]
  if (!col) return badRequest(res, '管理员账号不支持关联学生')

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)
  if (!student) return notFound(res, '学生不存在')

  applyLink(id, existing.role, studentId)
  res.status(200).json(userResponse(getUserRow(id)))
})

router.delete('/:id/students/:studentId', (req, res) => {
  const id = req.params.id
  const studentId = String(req.params.studentId)
  const existing = getUserRow(id)
  if (!existing) return notFound(res)

  const col = ROLE_LINK_COLUMN[existing.role]
  if (!col) return badRequest(res, '管理员账号不支持关联学生')

  db.prepare(`UPDATE students SET ${col} = NULL WHERE id = ? AND ${col} = ?`).run(
    studentId,
    id,
  )
  res.status(200).json(userResponse(getUserRow(id)))
})

/* ------------------------------ 工具 ------------------------------ */
function countAdmins() {
  return Number(
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get()?.c ?? 0,
  )
}

export { router as usersRouter }
export default router
