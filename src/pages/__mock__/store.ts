/**
 * __mock__/store —— 内存版 API 实现（接口未就绪时的降级方案）
 * ---------------------------------------------------------------------------
 * 与 src/lib/api.ts 的方法签名保持一致，可以直接替换使用。
 * 数据在内存中可变：新增 / 修改 / 删除都会即时反映到后续查询结果。
 */

import type {
  AIAnalysis,
  KnowledgePointRef,
  Paged,
  PhotoAnalysisRequest,
  PhotoAnalysisResponse,
  Question,
  QuestionInput,
  Student,
  StudentInput,
} from '@/lib/types'
import { buildAnalysis, buildMockPhotoAnalysis, mockKnowledgePoints, mockQuestions, mockStudents } from './data'

/* -------------------------------------------------------------------------- */
/* 内存状态                                                                   */
/* -------------------------------------------------------------------------- */

const students: Student[] = mockStudents.map((s) => ({ ...s }))
const questions: Question[] = mockQuestions.map((q) => ({ ...q }))

let seq = 0
const uid = (prefix: string): string => `${prefix}_mock_${Date.now().toString(36)}_${++seq}`

const nowISO = (): string => new Date().toISOString()

/* -------------------------------------------------------------------------- */
/* 工具                                                                       */
/* -------------------------------------------------------------------------- */

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function notFound(what: string): Error {
  return new Error(`${what}不存在（演示数据）`)
}

/* -------------------------------------------------------------------------- */
/* 学生                                                                       */
/* -------------------------------------------------------------------------- */

export const mockApi = {
  listStudents(): Student[] {
    return clone(students)
  },

  createStudent(input: StudentInput): Student {
    const student: Student = {
      id: uid('stu'),
      name: input.name,
      grade: input.grade,
      avatarColor: input.avatarColor ?? '#3b63f6',
      school: input.school ?? '',
      note: input.note ?? '',
      createdAt: nowISO(),
    }
    students.push(student)
    return clone(student)
  },

  updateStudent(id: string, input: Partial<StudentInput>): Student {
    const idx = students.findIndex((s) => s.id === id)
    if (idx < 0) throw notFound('学生')
    const current = students[idx]
    const next: Student = { ...current, ...input, id: current.id, createdAt: current.createdAt }
    students[idx] = next
    return clone(next)
  },

  deleteStudent(id: string): void {
    const idx = students.findIndex((s) => s.id === id)
    if (idx < 0) throw notFound('学生')
    students.splice(idx, 1)
  },

  /* ---------------------------------------------------------------------- */

  listQuestions(params: Record<string, string | number | undefined>): Paged<Question> {
    const page = Math.max(1, Number(params.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 20))
    const str = (key: string): string => {
      const v = params[key]
      return v === undefined || v === null ? '' : String(v)
    }

    let list = questions.slice()

    const studentId = str('studentId')
    if (studentId) list = list.filter((q) => q.studentId === studentId)

    const subject = str('subject')
    if (subject && subject !== 'all') list = list.filter((q) => q.subject === subject)

    const errorType = str('errorType')
    if (errorType && errorType !== 'all') list = list.filter((q) => q.errorType === errorType)

    const status = str('status')
    if (status && status !== 'all') list = list.filter((q) => q.status === status)

    const corrected = str('corrected')
    if (corrected === 'true') list = list.filter((q) => q.corrected)
    else if (corrected === 'false') list = list.filter((q) => !q.corrected)

    const knowledgePoint = str('knowledgePoint')
    if (knowledgePoint) {
      list = list.filter((q) => q.knowledgePoints.some((k) => k.includes(knowledgePoint)))
    }

    const keyword = str('keyword').trim()
    if (keyword) {
      const kw = keyword.toLowerCase()
      list = list.filter((q) =>
        [q.stem, q.myAnswer, q.correctAnswer, q.source, q.errorDetail]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(kw)),
      )
    }

    const startDate = str('startDate')
    if (startDate) list = list.filter((q) => q.createdAt.slice(0, 10) >= startDate)

    const endDate = str('endDate')
    if (endDate) list = list.filter((q) => q.createdAt.slice(0, 10) <= endDate)

    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

    const total = list.length
    const start = (page - 1) * pageSize
    return {
      items: clone(list.slice(start, start + pageSize)),
      total,
      page,
      pageSize,
    }
  },

  getQuestion(id: string): Question {
    const found = questions.find((q) => q.id === id)
    if (!found) throw notFound('错题')
    return clone(found)
  },

  createQuestion(input: QuestionInput): Question {
    const subject = input.subject
    const now = nowISO()
    const studentId = input.studentId ?? students[0]?.id ?? ''
    const studentName = students.find((s) => s.id === studentId)?.name
    const created: Question = {
      id: uid('q'),
      studentId,
      studentName,
      subject,
      grade: input.grade ?? '',
      semester: input.semester ?? '2026 上学期',
      knowledgePoints: input.knowledgePoints ?? [],
      questionType: input.questionType ?? '解答题',
      source: input.source ?? '手动录入',
      stem: input.stem ?? '',
      options: input.options ?? [],
      myAnswer: input.myAnswer ?? '',
      correctAnswer: input.correctAnswer ?? '',
      errorType: input.errorType ?? 'knowledge_gap',
      errorDetail: input.errorDetail ?? '',
      difficulty: input.difficulty ?? 3,
      points: input.points,
      images: input.images ?? [],
      aiAnalysis: input.aiAnalysis ?? null,
      mastery: input.mastery ?? 30,
      status: input.status ?? 'unreviewed',
      corrected: input.corrected ?? false,
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      nextReviewAt: null,
    }
    questions.push(created)
    return clone(created)
  },

  updateQuestion(id: string, input: Partial<QuestionInput>): Question {
    const idx = questions.findIndex((q) => q.id === id)
    if (idx < 0) throw notFound('错题')
    const current = questions[idx]
    const next: Question = {
      ...current,
      ...input,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowISO(),
    }
    questions[idx] = next
    return clone(next)
  },

  deleteQuestion(id: string): void {
    const idx = questions.findIndex((q) => q.id === id)
    if (idx < 0) throw notFound('错题')
    questions.splice(idx, 1)
  },

  markCorrected(id: string, corrected = true): Question {
    const idx = questions.findIndex((q) => q.id === id)
    if (idx < 0) throw notFound('错题')
    const current = questions[idx]
    const mastery = corrected ? Math.min(100, Math.max(current.mastery, 70)) : current.mastery
    const next: Question = {
      ...current,
      corrected,
      mastery,
      status: corrected ? 'learning' : current.status,
      reviewedAt: corrected ? nowISO() : null,
      updatedAt: nowISO(),
    }
    questions[idx] = next
    return clone(next)
  },

  analyzeQuestion(id: string): AIAnalysis {
    const found = questions.find((q) => q.id === id)
    if (!found) throw notFound('错题')
    const analysis = buildAnalysis(
      {
        subject: found.subject,
        questionType: found.questionType,
        summary: `这道题主要错在「${found.errorDetail || '解题环节'}」，按下面的步骤订正一遍就能拿分。`,
        diagnosisType: found.errorType,
        confidence: 0.72,
        reason: found.errorDetail || '结合题干与作答痕迹判断，解题环节存在偏差。',
        evidence: found.myAnswer ? [`我的答案：${found.myAnswer}`, `正确答案：${found.correctAnswer}`] : [],
        rootCauses: [
          found.errorDetail || '对该题型的解题模板不熟悉',
          '缺少"做完回代检验"的习惯',
        ],
        correctSteps: [
          { title: '第一步：读题圈条件', detail: '把题干中的关键条件逐条圈出来。' },
          { title: '第二步：列出关系式', detail: '写出已知量与待求量之间的等量关系。' },
          { title: '第三步：分步书写', detail: '按步骤书写，每一步只做一件事。' },
          { title: '第四步：回代检验', detail: '把答案代回原题检查一遍。' },
        ],
        knowledgeGaps: found.knowledgePoints,
        tips: ['订正时用不同颜色的笔，写清楚每一步的依据', '把同类错题整理到同一页，方便横向对比'],
      },
      nowISO(),
    )
    found.aiAnalysis = analysis
    return clone(analysis)
  },

  analyzePhoto(payload: PhotoAnalysisRequest): PhotoAnalysisResponse {
    return buildMockPhotoAnalysis(payload.subject ?? '数学', payload.hint)
  },

  uploadPhoto(file: File): { url: string; id: string; dataUrl: string } {
    return { url: '', id: uid('img'), dataUrl: '' }
  },

  getKnowledgePoints(subject?: string): KnowledgePointRef[] {
    const list = subject ? mockKnowledgePoints.filter((k) => k.subject === subject) : mockKnowledgePoints
    return clone(list)
  },
}

export type MockApi = typeof mockApi
