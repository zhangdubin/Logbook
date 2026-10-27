/**
 * entry/client —— 数据访问层（真实接口 + 演示数据自动降级）
 * ---------------------------------------------------------------------------
 * 切换机制：
 *   1. 默认全部走 src/lib/api.ts 的真实接口；
 *   2. 真实接口「不可用」时（连接失败 / 5xx），自动降级到 src/pages/__mock__
 *      的内存实现，页面照常渲染与交互，不会白屏；
 *   3. 接口恢复后下一次请求自动切回真实数据（每次请求都先打真实接口）；
 *   4. 单条资源的 404 属于正常业务响应（题目被删了），不做降级，直接报错；
 *   5. UI 通过 useDataMode() 拿到当前模式，演示模式下会显示顶部的提示条。
 */

import api, { ApiRequestError } from '@/lib/api'
import { mockApi } from '@/pages/__mock__'
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

export type DataMode = 'live' | 'mock'

/**
 * - collection：列表类接口（404 说明路由还没实现，可降级）
 * - resource  ：单条资源（404 说明资源不存在，如实报错，不降级）
 * - mutation ：写操作（404 说明路由还没实现，可降级）
 */
type CallKind = 'collection' | 'resource' | 'mutation'

let mode: DataMode = 'live'
const listeners = new Set<(m: DataMode) => void>()

function setMode(next: DataMode): void {
  if (next === mode) return
  mode = next
  listeners.forEach((fn) => {
    try {
      fn(mode)
    } catch {
      /* 忽略订阅者异常 */
    }
  })
}

export function getDataMode(): DataMode {
  return mode
}

export function subscribeDataMode(listener: (m: DataMode) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 是否允许在接口异常时回落到本地演示数据。
 * 开发环境默认开启（方便无后端时演示）；生产构建默认关闭，
 * 避免用假数据顶替真实学情；需要无后端演示时设置 `VITE_ALLOW_MOCK=true`。
 */
const ALLOW_MOCK =
  import.meta.env.VITE_ALLOW_MOCK === 'true' ||
  (import.meta.env.VITE_ALLOW_MOCK !== 'false' && import.meta.env.DEV)

/** 判断这个错误是否应该「如实报错」而不是降级到演示数据 */
function isFatal(err: unknown, kind: CallKind): boolean {
  if (err instanceof ApiRequestError) {
    if (err.status >= 500) return !ALLOW_MOCK // 后端未就绪 / 崩溃 -> 降级
    if (err.status === 404) return kind === 'resource' // 资源不存在 -> 如实报错
    return true // 400 / 403 等业务错误 -> 如实报错
  }
  // 网络层异常（后端没启动）：开发环境降级到演示数据，生产环境如实报错
  return !ALLOW_MOCK
}

async function withFallback<T>(
  live: () => Promise<T>,
  fallback: () => T,
  kind: CallKind = 'collection',
): Promise<T> {
  try {
    const result = await live()
    setMode('live')
    return result
  } catch (err) {
    if (isFatal(err, kind)) throw err
    setMode('mock')
    return fallback()
  }
}

/* -------------------------------------------------------------------------- */
/* 对外接口（与 src/lib/api.ts 保持同名同义）                                   */
/* -------------------------------------------------------------------------- */

export const dataClient = {
  /* -------- 学生 -------- */
  listStudents: (): Promise<Student[]> =>
    withFallback(() => api.listStudents(), () => mockApi.listStudents(), 'collection'),
  createStudent: (input: StudentInput): Promise<Student> =>
    withFallback(() => api.createStudent(input), () => mockApi.createStudent(input), 'mutation'),
  updateStudent: (id: string, input: Partial<StudentInput>): Promise<Student> =>
    withFallback(() => api.updateStudent(id, input), () => mockApi.updateStudent(id, input), 'mutation'),
  deleteStudent: (id: string): Promise<void> =>
    withFallback(() => api.deleteStudent(id), () => mockApi.deleteStudent(id), 'mutation'),

  /* -------- 错题 -------- */
  listQuestions: (params: Record<string, string | number | undefined>): Promise<Paged<Question>> =>
    withFallback(() => api.listQuestions(params), () => mockApi.listQuestions(params), 'collection'),
  getQuestion: (id: string): Promise<Question> =>
    withFallback(() => api.getQuestion(id), () => mockApi.getQuestion(id), 'resource'),
  createQuestion: (input: QuestionInput): Promise<Question> =>
    withFallback(() => api.createQuestion(input), () => mockApi.createQuestion(input), 'mutation'),
  updateQuestion: (id: string, input: Partial<QuestionInput>): Promise<Question> =>
    withFallback(() => api.updateQuestion(id, input), () => mockApi.updateQuestion(id, input), 'mutation'),
  deleteQuestion: (id: string): Promise<void> =>
    withFallback(() => api.deleteQuestion(id), () => mockApi.deleteQuestion(id), 'mutation'),
  markCorrected: (id: string, corrected = true): Promise<Question> =>
    withFallback(() => api.markCorrected(id, corrected), () => mockApi.markCorrected(id, corrected), 'mutation'),
  analyzeQuestion: (id: string): Promise<AIAnalysis> =>
    withFallback(() => api.analyzeQuestion(id), () => mockApi.analyzeQuestion(id), 'mutation'),

  /* -------- 拍照 -------- */
  analyzePhoto: (payload: PhotoAnalysisRequest): Promise<PhotoAnalysisResponse> =>
    withFallback(() => api.analyzePhoto(payload), () => mockApi.analyzePhoto(payload), 'mutation'),
  uploadPhoto: (file: File): Promise<{ url: string; id: string; dataUrl: string }> =>
    withFallback(() => api.uploadPhoto(file), () => mockApi.uploadPhoto(file), 'mutation'),

  /* -------- 知识点 -------- */
  getKnowledgePoints: (subject?: string): Promise<KnowledgePointRef[]> =>
    withFallback(() => api.getKnowledgePoints(subject), () => mockApi.getKnowledgePoints(subject), 'collection'),
}

export default dataClient
