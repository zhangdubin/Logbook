/**
 * server/routes/students.js —— 学生档案
 *   GET    /api/students          → Student[]（按数据范围过滤）
 *   POST   /api/students          → Student
 *   PATCH  /api/students/:id      → Student
 *   DELETE /api/students/:id      → 204
 *
 * 权限：read=全部角色 / create=admin / update=admin+teacher / delete=admin
 * 数据范围：teacher→所授学生，parent→自己孩子，student→本人
 */

import { Router } from 'express'
import {
  db,
  listStudents,
  getStudent,
  uid,
  nowISO,
  bindable,
} from '../db.js'
import {
  canAccessStudent,
  forbidden,
  requirePermission,
  scopeFor,
} from '../auth.js'

const router = Router()

const AVATAR_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

/** 统一的 400 响应 */
function badRequest(res, message) {
  return res.status(400).json({ error: 'BadRequest', message })
}

/* ------------------------------ 列表 ------------------------------ */
router.get('/', requirePermission('students:read'), (req, res) => {
  const { ids } = scopeFor(req)
  res.json(listStudents(ids ?? undefined))
})

/* ------------------------------ 新建 ------------------------------ */
router.post('/', requirePermission('students:create'), (req, res) => {
  const body = req.body ?? {}
  const name = String(body.name ?? '').trim()
  if (!name) return badRequest(res, '学生姓名不能为空')

  const id = body.id ? String(body.id) : uid('stu')
  const createdAt = nowISO()
  const avatarColor = body.avatarColor || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]

  db.prepare(
    `INSERT INTO students (id, name, grade, avatar_color, school, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    String(body.grade ?? ''),
    avatarColor,
    body.school ?? null,
    body.note ?? null,
    createdAt,
  )

  res.status(201).json(getStudent(id))
})

/* ------------------------------ 更新 ------------------------------ */
router.patch('/:id', requirePermission('students:update'), (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'NotFound', message: '学生不存在' })

  // 数据范围：教师只能改自己带的学生
  if (!canAccessStudent(req, id)) {
    return forbidden(res, '无权修改该学生的档案')
  }

  const body = req.body ?? {}
  const name = body.name !== undefined ? String(body.name).trim() : existing.name
  if (!name) return badRequest(res, '学生姓名不能为空')

  const grade = body.grade !== undefined ? String(body.grade) : existing.grade
  const avatarColor = body.avatarColor !== undefined ? body.avatarColor : existing.avatar_color
  const school = body.school !== undefined ? body.school : existing.school
  const note = body.note !== undefined ? body.note : existing.note

  db.prepare(
    `UPDATE students SET name = ?, grade = ?, avatar_color = ?, school = ?, note = ? WHERE id = ?`,
  ).run(name, grade, avatarColor, bindable(school), bindable(note), id)

  res.json(getStudent(id))
})

/* ------------------------------ 删除 ------------------------------ */
router.delete('/:id', requirePermission('students:delete'), (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT id FROM students WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'NotFound', message: '学生不存在' })

  // 一并清理该学生的错题，避免孤儿数据
  db.prepare('DELETE FROM questions WHERE student_id = ?').run(id)
  db.prepare('DELETE FROM students WHERE id = ?').run(id)

  res.status(204).end()
})

export { router as studentsRouter, AVATAR_COLORS }
export default router
