/**
 * 全局类型定义 —— 前后端共享的数据契约 (API Contract v1)
 * 后端 server/ 目录下的实现必须严格对齐本文件的字段命名。
 */

/* ---------------- 枚举与基础常量 ---------------- */

/** 学科 */
export type Subject = '语文' | '数学' | '英语' | '物理' | '化学' | '生物' | '地理' | '历史' | '政治' | '道法'

export const SUBJECTS: Subject[] = [
  '语文', '数学', '英语', '物理', '化学', '生物', '地理', '历史', '政治', '道法',
]

/** 错因类型 —— AI 智能分析机的核心归因维度 */
export type ErrorType =
  | 'knowledge_gap'   // 知识盲点：概念/公式/定理没掌握
  | 'misread'         // 审题不清：题意理解偏差
  | 'calculation'     // 计算失误：会做但算错
  | 'method'          // 方法不当：思路方向错误
  | 'time'            // 时间不足：会做但没做完
  | 'careless'        // 粗心大意：抄错、看错符号
  | 'expression'      // 书写不规范：过程/步骤缺失

export const ERROR_TYPES: ErrorType[] = [
  'knowledge_gap', 'misread', 'calculation', 'method', 'time', 'careless', 'expression',
]

export const ERROR_TYPE_LABEL: Record<ErrorType, string> = {
  knowledge_gap: '知识盲点',
  misread: '审题不清',
  calculation: '计算失误',
  method: '方法不当',
  time: '时间不足',
  careless: '粗心大意',
  expression: '书写不规范',
}

export const ERROR_TYPE_COLOR: Record<ErrorType, string> = {
  knowledge_gap: '#ef4444',
  misread: '#f59e0b',
  calculation: '#3b82f6',
  method: '#8b5cf6',
  time: '#06b6d4',
  careless: '#ec4899',
  expression: '#84cc16',
}

export const ERROR_TYPE_DESC: Record<ErrorType, string> = {
  knowledge_gap: '概念、公式或定理本身没有掌握，导致无法启动解题。',
  misread: '题意理解出现偏差，把题目要求理解错了。',
  calculation: '思路正确，但运算过程出错导致结果错误。',
  method: '解题方向本身不对，需要更换解法模型。',
  time: '时间分配不合理，题目未在规定时间内完成。',
  careless: '看错符号、抄错数字等低级失误。',
  expression: '步骤缺失、单位不规范导致扣分。',
}

/** 题目类型 */
export type QuestionType =
  | '选择题' | '填空题' | '判断题' | '计算题' | '应用题' | '解答题'
  | '作文题' | '阅读理解' | '完形填空' | '语法填空' | '翻译题' | '实验题' | '证明题'

export const QUESTION_TYPES: QuestionType[] = [
  '选择题', '填空题', '判断题', '计算题', '应用题', '解答题',
  '作文题', '阅读理解', '完形填空', '语法填空', '翻译题', '实验题', '证明题',
]

/** 错题订正状态 */
export type ReviewStatus = 'unreviewed' | 'learning' | 'mastered'

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  unreviewed: '待复盘',
  learning: '巩固中',
  mastered: '已掌握',
}

/** 难度 1-5 */
export type Difficulty = 1 | 2 | 3 | 4 | 5

/* ---------------- 学生档案 ---------------- */

export interface Student {
  id: string
  name: string
  grade: string
  avatarColor: string
  school?: string
  note?: string
  createdAt: string
}

export interface StudentInput {
  name: string
  grade: string
  avatarColor?: string
  school?: string
  note?: string
}

/* ---------------- 错题 ---------------- */

export interface QuestionImage {
  id: string
  url: string
  /** base64 数据（拍照上传时同时保留，便于 AI 识别与离线预览） */
  dataUrl?: string
  createdAt?: string
}

export interface Question {
  id: string
  studentId: string
  studentName?: string
  subject: Subject
  grade: string
  semester?: string
  knowledgePoints: string[]
  questionType: QuestionType
  source?: string
  /** 题干文本（拍照 OCR 结果或手动录入） */
  stem: string
  /** 题目选项（选择题等） */
  options?: string[]
  /** 学生的错误答案 */
  myAnswer?: string
  /** 正确答案 */
  correctAnswer?: string
  /** 错因类型 */
  errorType: ErrorType
  /** 错因详细描述（AI 生成或手填） */
  errorDetail?: string
  difficulty: Difficulty
  /** 分值 */
  points?: number
  images: QuestionImage[]
  /** AI 分析结果 */
  aiAnalysis?: AIAnalysis | null
  /** 掌握度 0-100 */
  mastery: number
  status: ReviewStatus
  /** 是否已经完成订正 */
  corrected: boolean
  tags: string[]
  createdAt: string
  updatedAt?: string
  reviewedAt?: string | null
  nextReviewAt?: string | null
}

export type QuestionInput = Partial<Omit<Question, 'id' | 'createdAt' | 'updatedAt'>> & {
  subject: Subject
  grade?: string
  knowledgePoints?: string[]
  questionType?: QuestionType
  errorType?: ErrorType
  stem?: string
}

/* ---------------- AI 智能分析 ---------------- */

export interface AIKnowledgePoint {
  name: string
  confidence: number
  /** 该知识点在教材体系中的层级 */
  level?: '基础' | '进阶' | '难点'
}

export interface AIErrorDiagnosis {
  type: ErrorType
  confidence: number
  reason: string
  /** 支撑判断的证据（来自题干/作答痕迹） */
  evidence?: string[]
}

export interface AICorrectStep {
  title: string
  detail: string
}

export interface AISimilarQuestion {
  stem: string
  answer: string
  analysis: string
  difficulty: Difficulty
}

export interface AIPracticeTask {
  day: number
  focus: string
  task: string
  minutes: number
}

export interface AIAnalysis {
  /** 是否由真实大模型生成（false 表示本地启发式引擎产出） */
  byModel: boolean
  model?: string
  subject?: Subject
  questionType?: QuestionType
  knowledgePoints: AIKnowledgePoint[]
  diagnosis: AIErrorDiagnosis
  /** 根因链，最多 3 条 */
  rootCauses: string[]
  /** 正确解法分步讲解 */
  correctSteps: AICorrectStep[]
  /** 需要补学的知识点 */
  knowledgeGaps: string[]
  /** 针对性学习建议 */
  tips: string[]
  /** 同类题推荐 */
  similarQuestions: AISimilarQuestion[]
  /** 练习计划 */
  practicePlan: AIPracticeTask[]
  /** 一句话总结 */
  summary: string
  createdAt: string
}

export interface PhotoAnalysisRequest {
  /** base64 data url（含前缀）或服务器上的图片地址 */
  image: string
  grade?: string
  subject?: Subject
  hint?: string
}

export interface PhotoAnalysisResponse {
  /** OCR + 结构化后的题目草稿 */
  draft: {
    subject: Subject
    questionType: QuestionType
    knowledgePoints: string[]
    stem: string
    options?: string[]
    myAnswer?: string
    correctAnswer?: string
    difficulty: Difficulty
    confidence: number
    ocrText: string
    /** 逐字段置信度（0~1），前端据此高亮可疑字段 */
    fieldConfidence?: Record<string, number>
  }
  analysis: AIAnalysis
  /** 识别链路说明：用了哪条引擎、置信度怎么来的、有哪些警告 */
  pipeline?: {
    /** 'vision-model' | 'local-ocr' | 'hint-fallback' */
    ocrEngine: string
    ocrEngineLabel: string
    model?: string
    /** 置信度融合的各分量 */
    signals?: { name: string; value: number; weight: number }[]
    warnings?: string[]
  }
}

/* ---------------- 统计分析 ---------------- */

export interface StatBucket<T = string> {
  key: T
  label: string
  total: number
  corrected: number
  /** 掌握度均值 0-100 */
  mastery: number
  /** 错误率 0-100 */
  errorRate: number
}

export interface ErrorTypeStat {
  type: ErrorType
  label: string
  count: number
  ratio: number
}

export interface TrendPoint {
  date: string
  total: number
  corrected: number
  mastery: number
}

export interface HeatCell {
  date: string
  count: number
}

export interface StatsOverview {
  studentId?: string
  totals: {
    questions: number
    corrected: number
    activeDays: number
    /** 整体掌握度 */
    mastery: number
    pending: number
    mastered: number
    /** 较上周期变化百分比 */
    masteryDelta: number
    questionDelta: number
  }
  bySubject: StatBucket<Subject>[]
  byKnowledge: StatBucket[]
  byErrorType: ErrorTypeStat[]
  byQuestionType: StatBucket<QuestionType>[]
  byGrade?: StatBucket[]
  trend: TrendPoint[]
  heatmap: HeatCell[]
  /** 需要优先突破的知识点 */
  weakPoints: { name: string; subject: string; total: number; mastery: number; severity: '高' | '中' | '低' }[]
  recent: Question[]
}

export interface InsightReport {
  studentId?: string
  studentName?: string
  byModel: boolean
  model?: string
  /** 学情总评 */
  summary: string
  /** 优势项 */
  strengths: { title: string; detail: string; evidence: string }[]
  /** 薄弱项 */
  weaknesses: { title: string; detail: string; evidence: string; subject?: string }[]
  /** 高风险学科 */
  riskSubjects: { subject: string; reason: string; score: number }[]
  /** 行动建议 */
  suggestions: { title: string; detail: string; priority: '高' | '中' | '低' }[]
  /** 未来 7 天计划 */
  weeklyPlan: AIPracticeTask[]
  /** 家长沟通要点 */
  parentNotes: string[]
  createdAt: string
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/* ---------------- AI 对话助手 ---------------- */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatReference {
  label: string
  detail: string
}

export interface ChatResponse {
  answer: string
  intent: string
  references: ChatReference[]
  followUps: string[]
  dataUsed: {
    questions: number
    mastered: number
    weakSubjects: string[]
  }
  byModel: boolean
  model?: string
  createdAt: string
}

/* ---------------- AI 模型设置（前端可配置） ---------------- */

/** 供应商预设 */
export interface AIProviderPreset {
  id: string
  name: string
  baseUrl: string
  /** 该供应商下的可选模型 */
  models: string[]
  defaultModel: string
  /** 是否支持图片输入（视觉模型） */
  supportsVision: boolean
  /** 国内/国际双地址时给出建议 */
  docUrl?: string
  note?: string
}

export interface AISettings {
  /** 预设 id，或 'custom' */
  provider: string
  baseUrl: string
  /** API Key。读取时后端返回掩码串（如 sk-****abcd），保存时传掩码串表示不修改 */
  apiKey: string
  model: string
  /** 视觉模型单独指定；为空则复用 model */
  visionModel: string
  temperature: number
  timeoutMs: number
  /** 是否启用大模型（关闭则完全走本地启发式引擎） */
  enableModel: boolean
  /** 本地 OCR 服务地址（PaddleOCR / RapidOCR 等），为空则不使用 */
  ocrBaseUrl: string
  ocrEnabled: boolean
  /** 后端是否已保存密钥 */
  hasApiKey: boolean
  /** 实际生效的引擎描述 */
  activeEngine?: string
  updatedAt?: string
}

export interface AISettingsInput {
  provider?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  visionModel?: string
  temperature?: number
  timeoutMs?: number
  enableModel?: boolean
  ocrBaseUrl?: string
  ocrEnabled?: boolean
}

export interface AIConnectionTestResult {
  ok: boolean
  provider: string
  model: string
  /** 人类可读的结论 */
  message: string
  latencyMs: number
  /** 是否为视觉模型 */
  vision: boolean
  /** 失败时的原始错误（已脱敏） */
  detail?: string
}

/* ---------------- 账号与权限 ---------------- */

/** 角色分级：系统管理员 > 教师 > 家长 > 学生 */
export type Role = 'admin' | 'teacher' | 'parent' | 'student'

export const ROLES: Role[] = ['admin', 'teacher', 'parent', 'student']

export const ROLE_LABEL: Record<Role, string> = {
  admin: '系统管理员',
  teacher: '教师',
  parent: '家长',
  student: '学生',
}

export const ROLE_DESC: Record<Role, string> = {
  admin: '管理全部账号、学生档案与系统设置（含 AI 模型与 OCR 配置）',
  teacher: '管理所授学生的错题、班级统计与作业布置，可导出报表',
  parent: '查看自己孩子的错题、统计与学情报告，可导出报表',
  student: '只使用自己的错题本与今日复习，不查看报告与设置',
}

/** 权限点标识 —— 后端 `server/auth.js` 的 PERMISSIONS 是唯一事实来源 */
export type Permission =
  | 'students:read'
  | 'students:create'
  | 'students:update'
  | 'students:delete'
  | 'questions:read'
  | 'questions:create'
  | 'questions:update'
  | 'questions:delete'
  | 'stats:read'
  | 'report:read'
  | 'export:run'
  | 'review:run'
  | 'settings:ai'
  | 'settings:ocr'
  | 'system:update'
  | 'users:manage'

export interface User {
  id: string
  username: string
  name: string
  role: Role
  avatarColor: string
  status: 'active' | 'disabled'
  phone?: string
  note?: string
  lastLoginAt?: string | null
  createdAt: string
  /** 该账号关联的学生 id（按角色含义不同） */
  linkedStudentIds?: string[]
  /** 首次登录需要修改密码（默认管理员账号为 true） */
  mustChangePassword?: boolean
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResult {
  user: User
  /** 该用户拥有的权限点 */
  permissions: Permission[]
}

export interface UserInput {
  username: string
  /** 新建时必填；编辑时留空表示不修改 */
  password?: string
  name: string
  role: Role
  avatarColor?: string
  phone?: string
  note?: string
  status?: 'active' | 'disabled'
  /** 关联的学生 id */
  studentIds?: string[]
}

export interface AuthState {
  user: User | null
  permissions: Permission[]
  loading: boolean
}

/** 权限矩阵：权限点 → 允许的角色 */
export type PermissionMatrix = Record<string, Role[]>

/* ---------------- 系统设置与在线更新 ---------------- */

/** 系统配置（仓库地址等非敏感项） */
export interface SystemConfig {
  /** GitHub 仓库，格式 owner/repo */
  repo: string
  /** 更新完成后是否自动重启服务（需要由 pm2/systemd/docker 等守护进程拉起） */
  autoRestart: boolean
  /** 访问 GitHub 使用的代理地址，如 http://127.0.0.1:7890；空串表示直连 */
  proxy: string
  /** 是否已保存 GitHub 访问令牌（令牌本身永不明文回显） */
  hasToken: boolean
  /** 令牌来源：env = 环境变量 GITHUB_TOKEN，config = 系统设置里保存的，none = 未配置 */
  tokenSource?: 'env' | 'config' | 'none'
  updatedAt?: string
}

export interface SystemConfigInput {
  repo: string
  autoRestart: boolean
  proxy: string
  /** 令牌；留空表示不修改，传入新值表示覆盖 */
  token?: string
}

/** 更新检查结果 */
export interface UpdateInfo {
  /** 是否已配置 GitHub 仓库 */
  configured: boolean
  repo: string
  /** 当前安装版本 */
  currentVersion: string
  /** 最新发布版本（无则空串） */
  latestVersion: string
  /** 最新发布的 tag */
  latestTag: string
  publishedAt: string | null
  /** 更新说明（Release body） */
  notes: string
  /** 是否有可用更新 */
  hasUpdate: boolean
  prerelease: boolean
  /** 优先使用的发布附件名 */
  assetName?: string
  assetSize?: number
  /** 说明性信息，例如「该仓库还没有发布 Release」 */
  message?: string
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'applying'
  | 'restarting'
  | 'done'
  | 'failed'

/** 更新任务状态 */
export interface UpdateStatus {
  state: UpdateState
  message: string
  /** 0~100 */
  progress: number
  /** 运行日志（倒序或正序均可） */
  log: string[]
  startedAt?: string
  finishedAt?: string
  newVersion?: string
  previousVersion?: string
  /** 是否需要重启服务才生效 */
  requiresRestart?: boolean
  error?: string
}

/** 发布新版本到 GitHub 的请求 */
export interface PublishInput {
  /** 目标版本号，如 1.1.0（不写 v 前缀） */
  version: string
  /** 更新说明 */
  notes: string
  /** 是否作为预发布 */
  prerelease: boolean
}

/** 发布结果 */
export interface PublishResult {
  ok: boolean
  version: string
  tag: string
  releaseId?: number
  /** Release 页面地址 */
  releaseUrl?: string
  assetName?: string
  assetSize?: number
  /** 打包进源码包的文件数 */
  fileCount?: number
  /** tag 指向的提交（仅当本机是 git 仓库时返回） */
  commit?: string | null
  /** 本地是否有未提交的改动（为 true 时附件内容与 tag 指向的提交可能不一致） */
  dirty?: boolean
  /** 说明性信息 */
  message?: string
  error?: string
}

/* ---------------- 通用 ---------------- */

export interface ApiError {
  error: string
  message?: string
}

export interface KnowledgePointRef {
  name: string
  subject: string
  count: number
}
