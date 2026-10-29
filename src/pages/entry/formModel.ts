/**
 * entry/formModel —— 录入表单的数据模型（拍照录入 / 手动补录 共用）
 */

import { kpNames, safeText, safeTexts } from './kpShape'
import type { Difficulty, ErrorType, Question, QuestionInput, QuestionType, Subject } from '@/lib/types'

/** 表单可编辑字段 */
export interface QuestionFormValue {
  subject: Subject
  questionType: QuestionType
  knowledgePoints: string[]
  stem: string
  options: string[]
  myAnswer: string
  correctAnswer: string
  difficulty: Difficulty
  errorType: ErrorType
  errorDetail: string
  source: string
  points: string
}

/** 需要展示 AI 置信度的字段 */
export type FieldKey =
  | 'subject'
  | 'questionType'
  | 'knowledgePoints'
  | 'stem'
  | 'options'
  | 'myAnswer'
  | 'correctAnswer'
  | 'difficulty'
  | 'errorType'

export type ConfMap = Partial<Record<FieldKey, number>>

export const EMPTY_FORM: QuestionFormValue = {
  subject: '数学',
  questionType: '解答题',
  knowledgePoints: [],
  stem: '',
  options: [],
  myAnswer: '',
  correctAnswer: '',
  difficulty: 3,
  errorType: 'knowledge_gap',
  errorDetail: '',
  source: '',
  points: '',
}

/** 从已有错题回填表单 */
export function formFromQuestion(q: Question): QuestionFormValue {
  return {
    subject: q.subject,
    questionType: q.questionType,
    /* 存量数据里知识点/选项可能是对象（后端形状漂移过），
       这里统一规整成字符串，避免对象一路传到表单被当 React 子节点渲染 → 整页白屏 */
    knowledgePoints: kpNames(q.knowledgePoints),
    stem: safeText(q.stem),
    options: safeTexts(q.options),
    myAnswer: safeText(q.myAnswer),
    correctAnswer: safeText(q.correctAnswer),
    difficulty: (q.difficulty ?? 3) as Difficulty,
    errorType: q.errorType,
    errorDetail: safeText(q.errorDetail),
    source: q.source ?? '',
    points: q.points === undefined || q.points === null ? '' : String(q.points),
  }
}

/** 表单 -> 提交载荷 */
export function formToInput(
  form: QuestionFormValue,
  extra?: {
    studentId?: string
    grade?: string
    images?: Question['images']
    aiAnalysis?: Question['aiAnalysis']
  },
): QuestionInput {
  const points = Number(form.points)
  return {
    studentId: extra?.studentId,
    grade: extra?.grade,
    subject: form.subject,
    questionType: form.questionType,
    knowledgePoints: form.knowledgePoints.filter((k) => k.trim().length > 0),
    stem: form.stem.trim(),
    options: form.options.map((o) => o.trim()).filter((o) => o.length > 0),
    myAnswer: form.myAnswer.trim(),
    correctAnswer: form.correctAnswer.trim(),
    errorType: form.errorType,
    errorDetail: form.errorDetail.trim(),
    difficulty: form.difficulty,
    source: form.source.trim(),
    points: form.points.trim() && Number.isFinite(points) ? points : undefined,
    images: extra?.images ?? [],
    aiAnalysis: extra?.aiAnalysis ?? null,
  }
}

/** 必填校验，返回 字段 -> 错误文案 */
export function validateForm(form: QuestionFormValue): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.stem.trim()) errors.stem = '题干不能为空，拍照识别不准时可以直接手写'
  if (!form.correctAnswer.trim()) errors.correctAnswer = '请填写正确答案，便于后面复盘'
  if (form.questionType === '选择题' && form.options.filter((o) => o.trim()).length < 2) {
    errors.options = '选择题至少要有 2 个选项'
  }
  return errors
}

/** 需要展示选项编辑器的题型 */
const OPTION_TYPES: QuestionType[] = ['选择题', '完形填空', '语法填空', '判断题']

export function showOptions(questionType: QuestionType): boolean {
  return OPTION_TYPES.includes(questionType)
}

/** 置信度对应的展示样式 */
export function confidenceTone(value?: number): { text: string; className: string } {
  if (value === undefined) return { text: '', className: '' }
  const pctText = `${Math.round(value * 100)}%`
  if (value >= 0.8) return { text: `置信度 ${pctText}`, className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
  if (value >= 0.6) return { text: `置信度 ${pctText}`, className: 'bg-amber-50 text-amber-700 ring-amber-200' }
  return { text: `置信度 ${pctText} · 建议核对`, className: 'bg-red-50 text-red-600 ring-red-200' }
}
