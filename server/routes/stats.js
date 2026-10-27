/**
 * server/routes/stats.js —— 多维统计 / 学情报告 / 导出
 *
 *   GET /api/stats/overview?studentId=&range=   → StatsOverview
 *   GET /api/stats/report?studentId=            → InsightReport
 *   GET /api/stats/export?studentId=&format=    → 文件流 (xlsx | csv)
 *   GET /api/knowledge/points?subject=          → KnowledgePointRef[]  (挂在 /api/knowledge)
 */

import { Router } from 'express'
import ExcelJS from 'exceljs'
import { db, fetchAllQuestions, knowledgePointRefs, dateKey } from '../db.js'
import { buildInsightReport, ERROR_TYPE_LABEL } from '../ai.js'
import { canAccessStudent, forbidden, requirePermission, scopeFor } from '../auth.js'

export const ERROR_TYPES = Object.keys(ERROR_TYPE_LABEL)

const router = Router()
export const knowledgeRouter = Router()

/* ========================================================================== */
/* 统计核心                                                                   */
/* ========================================================================== */

/**
 * 解析时间范围：'7d' | '14d' | '30d' | '90d' | 'all' | '3w' | '6m' | '1y'
 * @returns {number|null} 天数；null 表示不限制
 */
export function parseRange(range) {
  if (!range || String(range).toLowerCase() === 'all') return null
  const s = String(range).trim().toLowerCase()
  const named = { today: 1, week: 7, fortnight: 14, month: 30, quarter: 90, halfyear: 180, year: 365 }
  if (named[s]) return named[s]
  const m = s.match(/^(\d+)\s*([dwmy])?$/)
  if (m) {
    const n = Number(m[1])
    const unit = m[2] ?? 'd'
    if (unit === 'd') return n
    if (unit === 'w') return n * 7
    if (unit === 'm') return n * 30
    if (unit === 'y') return n * 365
  }
  return 90
}

const DAY = 86400000

function ts(v) {
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

function round1(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10) / 10
}

function avg(list) {
  if (!list.length) return 0
  return list.reduce((a, b) => a + b, 0) / list.length
}

/** 错因中文标签 */
const ERR_LABEL = {
  knowledge_gap: '知识盲点',
  misread: '审题不清',
  calculation: '计算失误',
  method: '方法不当',
  time: '时间不足',
  careless: '粗心大意',
  expression: '书写不规范',
}

/**
 * 计算 StatsOverview。
 * @param {object} opts
 * @param {string} [opts.studentId]
 * @param {string} [opts.range]
 * @param {string[]} [opts.studentIds] 数据范围白名单（不限制时省略）
 */
export function computeOverview({ studentId, range, studentIds } = {}) {
  const days = parseRange(range)
  const all = fetchAllQuestions({ studentId, studentIds })

  const now = Date.now()
  const end = now + 1000
  const curStart = days === null ? -Infinity : now - days * DAY
  const prevStart = days === null ? null : now - 2 * days * DAY
  const prevEnd = days === null ? null : curStart

  const inCur = (q) => ts(q.createdAt) >= curStart && ts(q.createdAt) <= end
  const inPrev = (q) => prevStart !== null && ts(q.createdAt) >= prevStart && ts(q.createdAt) < prevEnd

  const current = all.filter(inCur)
  const previous = days === null ? [] : all.filter(inPrev)

  /* ------------------------------ totals ------------------------------ */
  const masteryNow = avg(current.map((q) => q.mastery))
  const masteryPrev = avg(previous.map((q) => q.mastery))

  const totals = {
    questions: current.length,
    corrected: current.filter((q) => q.corrected).length,
    activeDays: new Set(current.map((q) => dateKey(new Date(q.createdAt)))).size,
    mastery: Math.round(masteryNow),
    pending: current.filter((q) => q.status !== 'mastered').length,
    mastered: current.filter((q) => q.status === 'mastered').length,
    masteryDelta: masteryPrev > 0 ? round1(((masteryNow - masteryPrev) / masteryPrev) * 100) : 0,
    questionDelta:
      previous.length > 0
        ? round1(((current.length - previous.length) / previous.length) * 100)
        : current.length > 0
          ? 100
          : 0,
  }

  /* --------------------------- 分组统计 --------------------------- */
  const bucket = (key) => {
    const map = new Map()
    for (const q of current) {
      const k = key(q)
      if (!k) continue
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(q)
    }
    return map
  }

  const toStatBucket = (k, list) => {
    const total = list.length
    const corrected = list.filter((q) => q.corrected).length
    const mastery = Math.round(avg(list.map((q) => q.mastery)))
    const errorRate = total ? Math.round(((total - corrected) / total) * 100) : 0
    return { key: k, label: k, total, corrected, mastery, errorRate }
  }

  const bySubject = [...bucket((q) => q.subject).entries()]
    .map(([k, list]) => toStatBucket(k, list))
    .sort((a, b) => b.total - a.total)

  const byQuestionType = [...bucket((q) => q.questionType).entries()]
    .map(([k, list]) => toStatBucket(k, list))
    .sort((a, b) => b.total - a.total)

  const byGrade = [...bucket((q) => q.grade).entries()]
    .map(([k, list]) => toStatBucket(k, list))
    .sort((a, b) => b.total - a.total)

  const errorTypeMap = bucket((q) => q.errorType)
  const byErrorType = ERROR_TYPES.filter((t) => errorTypeMap.has(t))
    .map((t) => {
      const list = errorTypeMap.get(t)
      return {
        type: t,
        label: ERR_LABEL[t] ?? t,
        count: list.length,
        ratio: current.length ? Math.round((list.length / current.length) * 100) : 0,
      }
    })
    .sort((a, b) => b.count - a.count)

  /* --------------------------- 知识点统计 --------------------------- */
  const kpMap = new Map()
  for (const q of current) {
    const kps = Array.isArray(q.knowledgePoints) ? q.knowledgePoints : []
    for (const name of kps) {
      if (!name) continue
      if (!kpMap.has(name)) kpMap.set(name, [])
      kpMap.get(name).push(q)
    }
  }
  const byKnowledge = [...kpMap.entries()]
    .map(([name, list]) => {
      const total = list.length
      const corrected = list.filter((q) => q.corrected).length
      return {
        key: name,
        label: name,
        total,
        corrected,
        mastery: Math.round(avg(list.map((q) => q.mastery))),
        errorRate: total ? Math.round(((total - corrected) / total) * 100) : 0,
        subject: list[0]?.subject ?? '',
      }
    })
    .sort((a, b) => b.total - a.total || a.mastery - b.mastery)
    .slice(0, 20)

  /* ------------------------- 趋势 / 热力图 ------------------------- */
  const trendDays = days === null ? 90 : Math.min(days, 92)
  const trendStart = new Date(now - (trendDays - 1) * DAY)
  trendStart.setHours(0, 0, 0, 0)

  const dayMap = new Map()
  for (const q of current) {
    const key = dateKey(new Date(q.createdAt))
    if (!dayMap.has(key)) dayMap.set(key, [])
    dayMap.get(key).push(q)
  }

  const trend = []
  const heatmap = []
  for (let i = 0; i < trendDays; i++) {
    const d = new Date(trendStart.getTime() + i * DAY)
    const key = dateKey(d)
    const list = dayMap.get(key) ?? []
    trend.push({
      date: key,
      total: list.length,
      corrected: list.filter((q) => q.corrected).length,
      mastery: Math.round(avg(list.map((q) => q.mastery))),
    })
    heatmap.push({ date: key, count: list.length })
  }

  /* ---------------------------- 薄弱知识点 ---------------------------- */
  let weakCandidates = byKnowledge.filter((k) => k.mastery < 75)
  if (!weakCandidates.length) weakCandidates = [...byKnowledge].sort((a, b) => a.mastery - b.mastery).slice(0, 5)
  const weakPoints = weakCandidates
    .sort((a, b) => a.mastery - b.mastery || b.total - a.total)
    .slice(0, 12)
    .map((k) => ({
      name: k.label,
      subject: k.subject,
      total: k.total,
      mastery: k.mastery,
      severity: k.mastery < 40 ? '高' : k.mastery < 65 ? '中' : '低',
    }))

  /* ------------------------------ 最近错题 ------------------------------ */
  const recent = [...current]
    .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
    .slice(0, 10)

  return {
    studentId: studentId || undefined,
    totals,
    bySubject,
    byKnowledge,
    byErrorType,
    byQuestionType,
    byGrade,
    trend,
    heatmap,
    weakPoints,
    recent,
  }
}

/* ========================================================================== */
/* /api/stats/overview                                                        */
/* ========================================================================== */

router.get('/overview', requirePermission('stats:read'), (req, res) => {
  const { studentId, range } = req.query
  const { ids } = scopeFor(req)

  // 指定了范围外的 studentId → 403
  if (studentId && !canAccessStudent(req, String(studentId))) {
    return forbidden(res, '无权查看该学生的统计数据')
  }

  const overview = computeOverview({
    studentId: studentId || undefined,
    range: range || undefined,
    studentIds: ids ?? undefined,
  })
  res.json(overview)
})

/* ========================================================================== */
/* /api/stats/report                                                          */
/* ========================================================================== */

router.get('/report', requirePermission('report:read'), async (req, res) => {
  const studentId = req.query.studentId || undefined
  const { ids } = scopeFor(req)

  if (studentId && !canAccessStudent(req, String(studentId))) {
    return forbidden(res, '无权查看该学生的学情报告')
  }

  // 未指定学生时，取「范围内」的第一位学生
  let student = null
  if (studentId) {
    student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId)
  } else if (Array.isArray(ids)) {
    if (!ids.length) {
      return res.status(404).json({ error: 'NotFound', message: '当前账号没有可查看的学生' })
    }
    student = db.prepare('SELECT * FROM students WHERE id = ? ORDER BY created_at ASC').get(ids[0])
  } else {
    student = db.prepare('SELECT * FROM students ORDER BY created_at ASC LIMIT 1').get()
  }

  if (studentId && !student) {
    return res.status(404).json({ error: 'NotFound', message: '学生不存在' })
  }
  if (!student) {
    return res.status(404).json({ error: 'NotFound', message: '当前账号没有可查看的学生' })
  }

  const studentObj = {
    id: student.id,
    name: student.name,
    grade: student.grade,
    school: student.school,
    avatarColor: student.avatar_color,
  }

  // 报告基于全量历史（不限时间窗）
  const scopeStudentId = studentObj.id
  const stats = computeOverview({ studentId: scopeStudentId, range: 'all' })
  const questions = fetchAllQuestions({ studentId: scopeStudentId })

  const report = await buildInsightReport({ student: studentObj, stats, questions })
  res.json(report)
})

/* ========================================================================== */
/* /api/stats/export                                                          */
/* ========================================================================== */

const CSV_HEADERS = [
  ['学生', 'studentName'],
  ['学科', 'subject'],
  ['年级', 'grade'],
  ['知识点', 'knowledgePoints'],
  ['题型', 'questionType'],
  ['来源', 'source'],
  ['题干', 'stem'],
  ['我的答案', 'myAnswer'],
  ['正确答案', 'correctAnswer'],
  ['错因', 'errorType'],
  ['错因说明', 'errorDetail'],
  ['难度', 'difficulty'],
  ['分值', 'points'],
  ['掌握度', 'mastery'],
  ['状态', 'status'],
  ['是否订正', 'corrected'],
  ['录入时间', 'createdAt'],
  ['复习时间', 'nextReviewAt'],
]

const STATUS_LABEL = { unreviewed: '待复盘', learning: '巩固中', mastered: '已掌握' }

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

router.get('/export', requirePermission('export:run'), async (req, res) => {
  const studentId = req.query.studentId || undefined
  const format = (req.query.format || 'xlsx').toLowerCase()
  const { ids } = scopeFor(req)

  // 越权导出 → 403
  if (studentId && !canAccessStudent(req, String(studentId))) {
    return forbidden(res, '无权导出该学生的数据')
  }

  const questions = fetchAllQuestions({ studentId, studentIds: ids ?? undefined })
  const overview = computeOverview({ studentId, range: 'all', studentIds: ids ?? undefined })
  const stamp = dateKey(new Date())

  if (format === 'csv') {
    const lines = [CSV_HEADERS.map(([h]) => csvCell(h)).join(',')]
    for (const q of questions) {
      const row = CSV_HEADERS.map(([, key]) => {
        let v = q[key]
        if (key === 'knowledgePoints') v = (q.knowledgePoints || []).join('/')
        else if (key === 'errorType') v = ERR_LABEL[q.errorType] ?? q.errorType
        else if (key === 'status') v = STATUS_LABEL[q.status] ?? q.status
        else if (key === 'corrected') v = q.corrected ? '是' : '否'
        else if (v === undefined || v === null) v = ''
        return csvCell(v)
      })
      lines.push(row.join(','))
    }
    const body = '﻿' + lines.join('\r\n') // UTF-8 BOM
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cuoti-export-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(`错题统计_${stamp}.csv`)}`,
    )
    res.setHeader('Content-Length', Buffer.byteLength(body))
    return res.send(body)
  }

  /* ------------------------------ XLSX ------------------------------ */
  const wb = new ExcelJS.Workbook()
  wb.creator = '学生错题统计分析系统'
  wb.created = new Date()

  const headerStyle = (row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } }
    row.alignment = { vertical: 'middle', horizontal: 'center' }
    row.height = 22
  }
  const autoWidth = (ws, widths) => {
    ws.columns.forEach((col, i) => {
      col.width = widths?.[i] ?? 14
    })
  }

  /* Sheet 1 —— 错题明细 */
  const ws1 = wb.addWorksheet('错题明细')
  ws1.addRow(CSV_HEADERS.map(([h]) => h))
  headerStyle(ws1.getRow(1))
  for (const q of questions) {
    ws1.addRow([
      q.studentName ?? '',
      q.subject,
      q.grade,
      (q.knowledgePoints || []).join('/'),
      q.questionType,
      q.source ?? '',
      q.stem,
      q.myAnswer ?? '',
      q.correctAnswer ?? '',
      ERR_LABEL[q.errorType] ?? q.errorType,
      q.errorDetail ?? '',
      q.difficulty,
      q.points ?? '',
      q.mastery,
      STATUS_LABEL[q.status] ?? q.status,
      q.corrected ? '是' : '否',
      q.createdAt,
      q.nextReviewAt ?? '',
    ])
  }
  ws1.views = [{ state: 'frozen', ySplit: 1 }]
  autoWidth(ws1, [10, 8, 10, 22, 10, 14, 46, 14, 14, 10, 30, 6, 6, 8, 8, 8, 20, 20])

  /* Sheet 2 —— 学科统计 */
  const ws2 = wb.addWorksheet('学科统计')
  ws2.addRow(['学科', '错题总数', '已订正', '未订正', '平均掌握度', '未订正率(%)'])
  headerStyle(ws2.getRow(1))
  for (const s of overview.bySubject) {
    ws2.addRow([s.label, s.total, s.corrected, s.total - s.corrected, s.mastery, s.errorRate])
  }
  autoWidth(ws2, [12, 12, 10, 10, 12, 14])

  /* Sheet 3 —— 知识点统计 */
  const ws3 = wb.addWorksheet('知识点统计')
  ws3.addRow(['知识点', '学科', '错题总数', '已订正', '平均掌握度', '未订正率(%)'])
  headerStyle(ws3.getRow(1))
  for (const k of overview.byKnowledge) {
    ws3.addRow([k.label, k.subject, k.total, k.corrected, k.mastery, k.errorRate])
  }
  autoWidth(ws3, [24, 10, 12, 10, 12, 14])

  /* Sheet 4 —— 错因统计 */
  const ws4 = wb.addWorksheet('错因统计')
  ws4.addRow(['错因', '数量', '占比(%)', '说明'])
  headerStyle(ws4.getRow(1))
  const ERR_DESC = {
    knowledge_gap: '概念、公式或定理本身没有掌握，导致无法启动解题。',
    misread: '题意理解出现偏差，把题目要求理解错了。',
    calculation: '思路正确，但运算过程出错导致结果错误。',
    method: '解题方向本身不对，需要更换解法模型。',
    time: '时间分配不合理，题目未在规定时间内完成。',
    careless: '看错符号、抄错数字等低级失误。',
    expression: '步骤缺失、单位不规范导致扣分。',
  }
  for (const e of overview.byErrorType) {
    ws4.addRow([e.label, e.count, e.ratio, ERR_DESC[e.type] ?? ''])
  }
  autoWidth(ws4, [12, 8, 10, 52])

  const buffer = await wb.xlsx.writeBuffer()

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="cuoti-export-${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(`错题统计_${stamp}.xlsx`)}`,
  )
  res.setHeader('Content-Length', buffer.byteLength)
  res.end(Buffer.from(buffer))
})

/* ========================================================================== */
/* /api/knowledge/points                                                       */
/* ========================================================================== */

knowledgeRouter.get('/points', (req, res) => {
  const subject = req.query.subject || undefined
  res.json(knowledgePointRefs(subject))
})

export { router as statsRouter }
export default router
