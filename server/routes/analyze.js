/**
 * server/routes/analyze.js —— AI 分析端点
 *
 *   POST /api/analyze/photo   body { image, grade?, subject?, hint? } → PhotoAnalysisResponse
 *   POST /api/ai/chat         body { studentId?, message, history?, questionId? } → 对话式追问
 */

import { Router } from 'express'
import { db, fetchAllQuestions } from '../db.js'
import { analyzePhoto, buildChatAnswer } from '../ai.js'
import { computeOverview } from './stats.js'
import { canAccessStudent, forbidden, requirePermission, scopeFor } from '../auth.js'

const router = Router()
export const chatRouter = Router()

/* ========================================================================== */
/* POST /api/analyze/photo                                                     */
/* ========================================================================== */

router.post('/photo', requirePermission('questions:create'), async (req, res) => {
  const body = req.body ?? {}
  const image = String(body.image ?? '').trim()
  const hint = String(body.hint ?? '').trim()
  // image 与 hint 至少给一个：只有文字线索时本地引擎也能产出草稿
  if (!image && !hint) {
    return res.status(400).json({ error: 'BadRequest', message: 'image 与 hint 不能同时为空' })
  }

  // 若请求体带了 studentId，必须在当前账号的数据范围内
  if (body.studentId && !canAccessStudent(req, String(body.studentId))) {
    return forbidden(res, '无权访问该学生的数据')
  }

  try {
    const result = await analyzePhoto({
      image,
      grade: body.grade,
      subject: body.subject,
      hint,
    })
    res.json(result)
  } catch (err) {
    // 理论上 analyzePhoto 内部已完全兜底，这里只是最后一道保险
    console.error('[analyze/photo] 意外异常:', err)
    res.status(500).json({ error: 'InternalError', message: '图片分析失败' })
  }
})

/* ========================================================================== */
/* POST /api/ai/chat                                                           */
/* ========================================================================== */

chatRouter.post('/chat', requirePermission('stats:read'), async (req, res) => {
  const body = req.body ?? {}
  const message = String(body.message ?? '').trim()
  if (!message) {
    return res.status(400).json({ error: 'BadRequest', message: 'message 不能为空' })
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter((h) => h && typeof h.content === 'string')
        .slice(-8)
        .map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content }))
    : []

  const studentId = body.studentId ? String(body.studentId) : undefined
  const { ids } = scopeFor(req)

  // 越权访问别人的学生 → 403
  if (studentId && !canAccessStudent(req, studentId)) {
    return forbidden(res, '无权访问该学生的数据')
  }

  // 未指定学生时，取「范围内」的第一位学生
  let studentRow = null
  if (studentId) {
    studentRow = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId)
  } else if (Array.isArray(ids)) {
    if (!ids.length) {
      return res.status(404).json({ error: 'NotFound', message: '当前账号没有可查询的学生' })
    }
    studentRow = db.prepare('SELECT * FROM students WHERE id = ? ORDER BY created_at ASC').get(ids[0])
  } else {
    studentRow = db.prepare('SELECT * FROM students ORDER BY created_at ASC LIMIT 1').get()
  }

  if (studentId && !studentRow) {
    return res.status(404).json({ error: 'NotFound', message: '学生不存在' })
  }

  const student = studentRow
    ? {
        id: studentRow.id,
        name: studentRow.name,
        grade: studentRow.grade,
        school: studentRow.school,
        avatarColor: studentRow.avatar_color,
      }
    : null

  const scopeStudentId = studentId ?? student?.id
  // 与 /api/stats/overview 保持同一统计口径（默认 90 天）
  const stats = computeOverview({ studentId: scopeStudentId, range: '90d' })
  const questions = fetchAllQuestions({ studentId: scopeStudentId })

  try {
    const result = await buildChatAnswer({ message, history, student, stats, questions })
    res.json(result)
  } catch (err) {
    console.error('[ai/chat] 意外异常:', err)
    res.status(500).json({ error: 'InternalError', message: '对话分析失败' })
  }
})

export { router as analyzeRouter }
export default router
