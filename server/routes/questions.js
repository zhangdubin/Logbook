/**
 * server/routes/questions.js —— 错题本
 *   GET    /api/questions            → { items, total, page, pageSize }
 *   GET    /api/questions/:id        → Question
 *   POST   /api/questions            → Question
 *   PATCH  /api/questions/:id        → Question
 *   DELETE /api/questions/:id        → 204
 *   POST   /api/questions/:id/corrected  body { corrected } → Question
 *   POST   /api/questions/:id/analyze    → AIAnalysis
 */

import { Router } from 'express'
import {
  db,
  queryQuestions,
  getQuestion,
  mapQuestion,
  getStudentName,
  uid,
  nowISO,
  bindable,
  parseJSON,
  attachUploadToStudent,
  extractUploadFilename,
  normalizeKnowledgePoints,
} from '../db.js'
import { analyzeQuestion } from '../ai.js'
import { canAccessStudent, forbidden, requirePermission, scopeFor } from '../auth.js'

const router = Router()

const STATUSES = ['unreviewed', 'learning', 'mastered']

function badRequest(res, message) {
  return res.status(400).json({ error: 'BadRequest', message })
}

function notFound(res) {
  return res.status(404).json({ error: 'NotFound', message: '错题不存在' })
}

/**
 * 数据范围守卫：错题所属学生必须在当前账号范围内。
 * 越权一律 403。
 */
function guardQuestion(req, res, studentId) {
  if (canAccessStudent(req, studentId)) return true
  forbidden(res, '无权访问该学生的错题')
  return false
}

/**
 * 把错题里引用的上传文件补挂到该错题所属学生名下。
 * 这样「家长看自己孩子的题」时，配图也能正常加载。
 * 只在 uploads.student_id 为空时补写，不覆盖已有归属。
 */
function bindImagesToStudent(images, studentId) {
  if (!Array.isArray(images) || !studentId) return
  for (const img of images) {
    if (!img || typeof img !== 'object') continue
    const filename = extractUploadFilename(img.url)
    if (filename) attachUploadToStudent(filename, studentId)
  }
}

/* --------------------------- 列表（过滤 + 分页） --------------------------- */
router.get('/', requirePermission('questions:read'), (req, res) => {
  const q = req.query
  const { ids } = scopeFor(req)

  // 显式指定了范围外的 studentId → 403（比静默忽略更明确）
  if (q.studentId && !canAccessStudent(req, String(q.studentId))) {
    return forbidden(res, '无权访问该学生的错题')
  }

  const result = queryQuestions({
    studentId: q.studentId || undefined,
    studentIds: ids ?? undefined,
    subject: q.subject || undefined,
    knowledgePoint: q.knowledgePoint || undefined,
    errorType: q.errorType || undefined,
    status: q.status || undefined,
    corrected: q.corrected === undefined || q.corrected === '' ? undefined : q.corrected === 'true' || q.corrected === '1',
    keyword: q.keyword || undefined,
    startDate: q.startDate || undefined,
    endDate: q.endDate || undefined,
    page: q.page ? Number(q.page) : 1,
    pageSize: q.pageSize ? Number(q.pageSize) : 20,
  })
  res.json(result)
})

/* ------------------------------ 详情 ------------------------------ */
router.get('/:id', requirePermission('questions:read'), (req, res) => {
  const row = db.prepare('SELECT student_id FROM questions WHERE id = ?').get(req.params.id)
  if (!row) return notFound(res)
  if (!guardQuestion(req, res, row.student_id)) return

  const q = getQuestion(req.params.id)
  if (!q) return notFound(res)
  res.json(q)
})

/* ------------------------------ 新建 ------------------------------ */
router.post('/', requirePermission('questions:create'), (req, res) => {
  const body = req.body ?? {}
  if (!body.subject) return badRequest(res, '学科（subject）不能为空')

  const id = body.id ? String(body.id) : uid('q')

  // studentId 缺省时归到「范围内」的第一位学生
  let studentId = body.studentId ? String(body.studentId) : ''
  if (studentId) {
    if (!guardQuestion(req, res, studentId)) return
  } else {
    const { ids } = scopeFor(req)
    const first = Array.isArray(ids)
      ? ids.length
        ? db.prepare('SELECT id FROM students WHERE id = ? ORDER BY created_at ASC').get(ids[0])
        : null
      : db.prepare('SELECT id FROM students ORDER BY created_at ASC LIMIT 1').get()
    if (first) studentId = first.id
    if (!studentId) return badRequest(res, '当前账号没有可用的学生，无法录入错题')
  }

  const now = nowISO()
  // 知识点一律存字符串数组（历史上存过对象数组，会让前端渲染崩溃、搜索失效）
  const knowledgePoints = normalizeKnowledgePoints(body.knowledgePoints)
  const options = Array.isArray(body.options) ? body.options : []
  const images = Array.isArray(body.images) ? body.images : []
  const tags = Array.isArray(body.tags) ? body.tags : []

  const mastery = clampMastery(body.mastery ?? 30)
  const status = STATUSES.includes(body.status) ? body.status : 'unreviewed'
  const corrected = body.corrected ? 1 : 0

  // 配图补挂归属：上传时没指定学生的，在错题落库后补写
  bindImagesToStudent(images, studentId)

  db.prepare(
    `INSERT INTO questions (
        id, student_id, subject, grade, semester, knowledge_points, question_type, source,
        stem, options, my_answer, correct_answer, error_type, error_detail, difficulty, points,
        images, ai_analysis, mastery, status, corrected, tags, created_at, updated_at,
        reviewed_at, next_review_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    studentId,
    String(body.subject),
    body.grade ? String(body.grade) : '',
    bindable(body.semester),
    JSON.stringify(knowledgePoints),
    body.questionType ? String(body.questionType) : '解答题',
    bindable(body.source),
    body.stem ? String(body.stem) : '',
    JSON.stringify(options),
    bindable(body.myAnswer),
    bindable(body.correctAnswer),
    body.errorType ? String(body.errorType) : 'knowledge_gap',
    bindable(body.errorDetail),
    Number(body.difficulty ?? 3) || 3,
    body.points === undefined || body.points === null ? null : Number(body.points),
    JSON.stringify(images),
    body.aiAnalysis ? JSON.stringify(body.aiAnalysis) : null,
    mastery,
    status,
    corrected,
    JSON.stringify(tags),
    now,
    now,
    bindable(body.reviewedAt),
    bindable(body.nextReviewAt),
  )

  res.status(201).json(getQuestion(id))
})

/* ------------------------------ 更新 ------------------------------ */
router.patch('/:id', requirePermission('questions:update'), (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!existing) return notFound(res)
  if (!guardQuestion(req, res, existing.student_id)) return

  const body = req.body ?? {}
  const sets = []
  const params = []

  const setIf = (col, value) => {
    sets.push(`${col} = ?`)
    params.push(value)
  }

  // 错题最终归属的学生（可能这次被改挂）
  let nextStudentId = existing.student_id
  if (body.studentId !== undefined) {
    nextStudentId = String(body.studentId)
    // 改挂到范围外的学生 → 403
    if (!guardQuestion(req, res, nextStudentId)) return
    setIf('student_id', nextStudentId)
  }
  if (body.subject !== undefined) setIf('subject', String(body.subject))
  if (body.grade !== undefined) setIf('grade', String(body.grade))
  if (body.semester !== undefined) setIf('semester', bindable(body.semester))
  if (body.knowledgePoints !== undefined) {
    setIf('knowledge_points', JSON.stringify(normalizeKnowledgePoints(body.knowledgePoints)))
  }
  if (body.questionType !== undefined) setIf('question_type', String(body.questionType))
  if (body.source !== undefined) setIf('source', bindable(body.source))
  if (body.stem !== undefined) setIf('stem', String(body.stem))
  if (body.options !== undefined) {
    setIf('options', JSON.stringify(Array.isArray(body.options) ? body.options : []))
  }
  if (body.myAnswer !== undefined) setIf('my_answer', bindable(body.myAnswer))
  if (body.correctAnswer !== undefined) setIf('correct_answer', bindable(body.correctAnswer))
  if (body.errorType !== undefined) setIf('error_type', String(body.errorType))
  if (body.errorDetail !== undefined) setIf('error_detail', bindable(body.errorDetail))
  if (body.difficulty !== undefined) setIf('difficulty', Number(body.difficulty) || 3)
  if (body.points !== undefined) {
    setIf('points', body.points === null ? null : Number(body.points))
  }
  if (body.images !== undefined) {
    setIf('images', JSON.stringify(Array.isArray(body.images) ? body.images : []))
  }  if (body.aiAnalysis !== undefined) {
    setIf('ai_analysis', body.aiAnalysis ? JSON.stringify(body.aiAnalysis) : null)
  }
  if (body.mastery !== undefined) setIf('mastery', clampMastery(body.mastery))
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return badRequest(res, 'status 必须是 unreviewed / learning / mastered')
    setIf('status', body.status)
  }
  if (body.corrected !== undefined) setIf('corrected', body.corrected ? 1 : 0)
  if (body.tags !== undefined) setIf('tags', JSON.stringify(Array.isArray(body.tags) ? body.tags : []))
  if (body.reviewedAt !== undefined) setIf('reviewed_at', bindable(body.reviewedAt))
  if (body.nextReviewAt !== undefined) setIf('next_review_at', bindable(body.nextReviewAt))

  setIf('updated_at', nowISO())
  params.push(id)
  db.prepare(`UPDATE questions SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  // 配图补挂归属（新增图片或改挂学生时都要处理）
  const effectiveImages =
    body.images !== undefined
      ? Array.isArray(body.images)
        ? body.images
        : []
      : parseJSON(existing.images, [])
  bindImagesToStudent(effectiveImages, nextStudentId)

  res.json(getQuestion(id))
})

/* ------------------------------ 删除 ------------------------------ */
router.delete('/:id', requirePermission('questions:delete'), (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT id, student_id FROM questions WHERE id = ?').get(id)
  if (!existing) return notFound(res)
  if (!guardQuestion(req, res, existing.student_id)) return
  db.prepare('DELETE FROM questions WHERE id = ?').run(id)
  res.status(204).end()
})

/* --------------------------- 标记订正 --------------------------- */
router.post('/:id/corrected', requirePermission('review:run'), (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!existing) return notFound(res)
  if (!guardQuestion(req, res, existing.student_id)) return

  const body = req.body ?? {}
  const corrected = body.corrected === undefined ? true : Boolean(body.corrected)
  const now = new Date()
  const nowStr = now.toISOString()

  if (corrected) {
    // 订正后掌握度显著提升：首次订正直接到 70（巩固中），再次订正到 95（已掌握）
    const mastery = clampMastery(Math.max(Number(existing.mastery ?? 30) + 25, 70))
    const status = mastery >= 85 ? 'mastered' : 'learning'
    const next = new Date(now.getTime() + reviewIntervalDays(mastery) * 86400000)
    db.prepare(
      `UPDATE questions SET corrected = 1, mastery = ?, status = ?, reviewed_at = ?, next_review_at = ?, updated_at = ? WHERE id = ?`,
    ).run(mastery, status, nowStr, next.toISOString(), nowStr, id)
  } else {
    // 撤销订正
    const mastery = clampMastery(Number(existing.mastery ?? 30) - 10)
    db.prepare(
      `UPDATE questions SET corrected = 0, mastery = ?, status = 'unreviewed', reviewed_at = NULL, updated_at = ? WHERE id = ?`,
    ).run(mastery, nowStr, id)
  }

  res.json(getQuestion(id))
})

/* --------------------------- AI 智能分析 --------------------------- */
router.post('/:id/analyze', requirePermission('questions:update'), async (req, res) => {
  const id = req.params.id
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!row) return notFound(res)
  if (!guardQuestion(req, res, row.student_id)) return

  const q = mapQuestion(row, getStudentName(row.student_id))

  // 调用双引擎，任何失败都不会 500（ai.js 内部已做降级）
  const analysis = await analyzeQuestion({
    subject: q.subject,
    grade: q.grade,
    semester: q.semester,
    knowledgePoints: q.knowledgePoints,
    questionType: q.questionType,
    source: q.source,
    stem: q.stem,
    options: q.options,
    myAnswer: q.myAnswer,
    correctAnswer: q.correctAnswer,
    errorType: q.errorType,
    errorDetail: q.errorDetail,
    difficulty: q.difficulty,
    points: q.points,
  })

  // 把分析结论回写到错题（知识点 / 错因 / 错因说明）
  const kps = normalizeKnowledgePoints(analysis.knowledgePoints ?? [])
  db.prepare(
    `UPDATE questions
        SET knowledge_points = ?, error_type = ?, error_detail = ?, ai_analysis = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    JSON.stringify(kps.length ? kps : normalizeKnowledgePoints(q.knowledgePoints)),
    analysis.diagnosis?.type ?? q.errorType,
    analysis.diagnosis?.reason ?? q.errorDetail,
    JSON.stringify(analysis),
    nowISO(),
    id,
  )

  res.json(analysis)
})

/* ------------------------------ 工具 ------------------------------ */
function clampMastery(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 30
  return Math.min(100, Math.max(0, n))
}

/** 艾宾浩斯式复习间隔 */
function reviewIntervalDays(mastery) {
  if (mastery >= 80) return 7
  if (mastery >= 50) return 3
  return 1
}

export { router as questionsRouter, clampMastery, reviewIntervalDays }
export default router
