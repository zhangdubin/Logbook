import type {
  AIAnalysis,
  AIConnectionTestResult,
  AIProviderPreset,
  AISettings,
  AISettingsInput,
  ChatMessage,
  ChatResponse,
  InsightReport,
  KnowledgePointRef,
  LoginRequest,
  LoginResult,
  Paged,
  PermissionMatrix,
  PhotoAnalysisRequest,
  PhotoAnalysisResponse,
  Question,
  QuestionInput,
  PublishInput,
  PublishResult,
  StatsOverview,
  Student,
  StudentInput,
  SystemConfig,
  SystemConfigInput,
  UpdateInfo,
  UpdateStatus,
  User,
  UserInput,
} from './types'

const BASE = '/api'

/** 401 时广播，由 AuthProvider 负责跳转登录页 */
export const UNAUTHORIZED_EVENT = 'cuoti:unauthorized'

export class ApiRequestError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

/**
 * @param opts.suppressAuthRedirect
 *   该端点的 401 不代表「登录过期」时置为 true，避免误把用户踢回登录页。
 *   例如自助改密时「当前密码不正确」也返回 401。
 */
async function request<T>(
  path: string,
  init?: RequestInit,
  opts?: { suppressAuthRedirect?: boolean },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      msg = data?.message || data?.error || msg
    } catch {
      /* ignore */
    }
    if (res.status === 401 && !opts?.suppressAuthRedirect) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    }
    throw new ApiRequestError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as unknown as T
}

const json = (body: unknown) => JSON.stringify(body)

export const api = {
  /* -------- 学生 -------- */
  listStudents: () => request<Student[]>('/students'),
  createStudent: (input: StudentInput) =>
    request<Student>('/students', { method: 'POST', body: json(input) }),
  updateStudent: (id: string, input: Partial<StudentInput>) =>
    request<Student>(`/students/${id}`, { method: 'PATCH', body: json(input) }),
  deleteStudent: (id: string) => request<void>(`/students/${id}`, { method: 'DELETE' }),

  /* -------- 错题 -------- */
  listQuestions: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== 'all') qs.set(k, String(v))
    })
    const suffix = qs.toString()
    return request<Paged<Question>>(`/questions${suffix ? `?${suffix}` : ''}`)
  },
  getQuestion: (id: string) => request<Question>(`/questions/${id}`),
  createQuestion: (input: QuestionInput) =>
    request<Question>('/questions', { method: 'POST', body: json(input) }),
  updateQuestion: (id: string, input: Partial<QuestionInput>) =>
    request<Question>(`/questions/${id}`, { method: 'PATCH', body: json(input) }),
  deleteQuestion: (id: string) => request<void>(`/questions/${id}`, { method: 'DELETE' }),
  markCorrected: (id: string, corrected = true) =>
    request<Question>(`/questions/${id}/corrected`, {
      method: 'POST',
      body: json({ corrected }),
    }),
  analyzeQuestion: (id: string) =>
    request<AIAnalysis>(`/questions/${id}/analyze`, { method: 'POST' }),

  /* -------- 拍照分析 -------- */
  analyzePhoto: (payload: PhotoAnalysisRequest) =>
    request<PhotoAnalysisResponse>('/analyze/photo', { method: 'POST', body: json(payload) }),
  uploadPhoto: (file: File, studentId?: string) => {
    const fd = new FormData()
    fd.append('photo', file)
    // 带上 studentId 便于服务端在上传阶段就绑定归属，越权上传会被直接拒绝
    if (studentId) fd.append('studentId', studentId)
    return request<{ url: string; id: string; dataUrl: string }>('/upload/photo', {
      method: 'POST',
      body: fd,
    })
  },

  /* -------- 统计 -------- */
  getOverview: (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v)
    })
    return request<StatsOverview>(`/stats/overview?${qs.toString()}`)
  },
  getReport: (studentId?: string) =>
    request<InsightReport>(`/stats/report${studentId ? `?studentId=${studentId}` : ''}`),
  getKnowledgePoints: (subject?: string) =>
    request<KnowledgePointRef[]>(
      `/knowledge/points${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`,
    ),

  /* -------- AI 对话助手 -------- */
  chat: (payload: {
    studentId?: string
    message: string
    history?: ChatMessage[]
    questionId?: string
  }) => request<ChatResponse>('/ai/chat', { method: 'POST', body: json(payload) }),

  /* -------- AI 模型设置（前端可配置） -------- */
  listProviders: () => request<AIProviderPreset[]>('/settings/providers'),
  getAiSettings: () => request<AISettings>('/settings/ai'),
  saveAiSettings: (input: AISettingsInput) =>
    request<AISettings>('/settings/ai', { method: 'PUT', body: json(input) }),
  resetAiSettings: () => request<void>('/settings/ai', { method: 'DELETE' }),
  testAiConnection: (input?: AISettingsInput) =>
    request<AIConnectionTestResult>('/settings/ai/test', {
      method: 'POST',
      body: input ? json(input) : json({}),
    }),
  exportUrl: (studentId?: string, format: 'xlsx' | 'csv' = 'xlsx') =>
    `${BASE}/stats/export?format=${format}${studentId ? `&studentId=${studentId}` : ''}`,

  /* -------- 认证 -------- */
  login: (payload: LoginRequest) =>
    request<LoginResult>('/auth/login', { method: 'POST', body: json(payload) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<LoginResult>('/auth/me'),
  /** 权限矩阵（权限点 → 允许角色） */
  permissionMatrix: () => request<PermissionMatrix>('/auth/permissions'),
  /** 自助改密：需提供旧密码，改密后作废该账号其它会话 */
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>(
      '/auth/password',
      { method: 'POST', body: json({ currentPassword, newPassword }) },
      // 此处的 401 表示「当前密码不正确」，不是登录过期，不能把用户踢回登录页
      { suppressAuthRedirect: true },
    ),

  /* -------- 账号管理（仅系统管理员） -------- */
  listUsers: () => request<User[]>('/users'),
  createUser: (input: UserInput) => request<User>('/users', { method: 'POST', body: json(input) }),
  updateUser: (id: string, input: Partial<UserInput>) =>
    request<User>(`/users/${id}`, { method: 'PATCH', body: json(input) }),
  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' }),
  resetUserPassword: (id: string, password: string) =>
    request<{ ok: boolean }>(`/users/${id}/password`, { method: 'POST', body: json({ password }) }),
  /** 老师/家长与学生的关联关系 */
  linkStudent: (userId: string, studentId: string, linked: boolean) =>
    request<User>(`/users/${userId}/students/${studentId}`, {
      method: linked ? 'POST' : 'DELETE',
    }),

  /* -------- 系统设置与在线更新 -------- */
  getSystemConfig: () => request<SystemConfig>('/system/config'),
  saveSystemConfig: (input: SystemConfigInput) =>
    request<SystemConfig>('/system/config', { method: 'PUT', body: json(input) }),
  /** 检查 GitHub 上是否有新版本 */
  getUpdateInfo: () => request<UpdateInfo>('/system/update/info'),
  /** 执行一键更新（下载 → 备份 → 覆盖 → 记录） */
  runUpdate: () => request<UpdateStatus>('/system/update/apply', { method: 'POST' }),
  /** 轮询更新任务状态 */
  getUpdateStatus: () => request<UpdateStatus>('/system/update/status'),
  /** 回滚到上一次更新前的备份 */
  rollbackUpdate: () => request<UpdateStatus>('/system/update/rollback', { method: 'POST' }),
  /** 把本机源码打包成版本并发布到 GitHub Release */
  publishRelease: (input: PublishInput) =>
    request<PublishResult>('/system/update/publish', { method: 'POST', body: json(input) }),
}

export default api
