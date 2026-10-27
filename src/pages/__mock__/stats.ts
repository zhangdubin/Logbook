/**
 * ============================================================================
 * 本地演示数据（Mock）—— 后端接口未就绪时用于前端页面的渲染自测
 * ============================================================================
 *
 * 【数据契约】
 *   本文件所有导出的数据结构严格遵循 `src/lib/types.ts` 中的定义：
 *     - Student
 *     - StatsOverview（含 bySubject / byErrorType / byKnowledge / byQuestionType /
 *       trend / heatmap / weakPoints / recent）
 *     - InsightReport
 *     - Question
 *   因此后端 `server/index.js` 的 /api/stats/overview、/api/stats/report 只需返回
 *   相同形状的数据，页面无需任何改动即可切换。
 *
 * 【切换真实接口】
 *   页面实现策略：始终「优先请求真实接口，失败后回落到本文件的 Mock 数据」。
 *   回落的开关由下面的 `USE_MOCK` 控制：
 *     - 开发环境（`import.meta.env.DEV`）默认开启，方便无后端时演示；
 *     - 生产构建默认关闭，接口异常时如实展示错误态，绝不用假数据顶替真实学情；
 *     - 需要在生产环境做无后端演示时，显式设置 `VITE_ALLOW_MOCK=true`。
 *
 * 【数据说明】
 *   这里的错题明细是用固定种子的伪随机数生成的（mulberry32），
 *   因此每次刷新得到的演示数据完全一致，方便比对与截图。
 * ============================================================================
 */

import {
  ERROR_TYPE_LABEL,
  ERROR_TYPE_COLOR,
} from '@/lib/types'
import type {
  ErrorType,
  InsightReport,
  Question,
  QuestionType,
  StatBucket,
  StatsOverview,
  Student,
  Subject,
} from '@/lib/types'
import { RANGE_DAYS } from '@/pages/dashboard/types'
import type { RangeKey } from '@/pages/dashboard/types'

/* ------------------------------------------------------------------ 开关 */
/**
 * true = 接口失败时回落到本地演示数据；false = 只用真实接口。
 * 开发环境默认开启；生产构建默认关闭（避免用假数据顶替真实学情），
 * 需要无后端演示时显式设置环境变量 `VITE_ALLOW_MOCK=true`。
 */
export const USE_MOCK =
  import.meta.env.VITE_ALLOW_MOCK === 'true' ||
  (import.meta.env.VITE_ALLOW_MOCK !== 'false' && import.meta.env.DEV)

/* ---------------------------------------------------------------- 演示学生 */
export const MOCK_STUDENT: Student = {
  id: 'stu_demo_001',
  name: '林小满',
  grade: '初二',
  avatarColor: '#3b63f6',
  school: '实验第二中学',
  note: '初二 (3) 班 · 数学教师重点关注对象',
  createdAt: '2026-09-01T08:00:00.000Z',
}

/* ------------------------------------------------------------ 随机数工具 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------ 学科种子配置 */
interface SubjectSeed {
  subject: Subject
  weight: number
  masteryBase: number
  knowledge: string[]
  types: QuestionType[]
  errorWeights: Partial<Record<ErrorType, number>>
  stems: string[]
}

const SUBJECT_SEEDS: SubjectSeed[] = [
  {
    subject: '数学',
    weight: 40,
    masteryBase: 58,
    knowledge: ['一元二次方程', '一次函数图像', '相似三角形', '概率初步', '勾股定理', '分式方程', '四边形证明', '统计与平均数'],
    types: ['计算题', '应用题', '解答题', '选择题', '填空题', '证明题'],
    errorWeights: { knowledge_gap: 30, calculation: 22, method: 17, careless: 12, misread: 10, expression: 6, time: 3 },
    stems: [
      '已知二次函数 f(x)=x²-2ax+3 在区间 [1,3] 上单调递增，求 a 的取值范围。',
      '如图，在 △ABC 中，DE∥BC，已知 AD=3，AD:DE=2:5，求 △ADE 与 △ABC 的面积比。',
      '某班级抽取 20 名学生做一分钟跳绳测试，整理数据后计算平均数与中位数，请回答下列问题。',
    ],
  },
  {
    subject: '英语',
    weight: 22,
    masteryBase: 70,
    knowledge: ['一般过去时', '定语从句', '非谓语动词', '阅读理解·细节题', '完形填空·逻辑衔接', '宾语从句'],
    types: ['选择题', '语法填空', '完形填空', '阅读理解', '翻译题', '作文题'],
    errorWeights: { knowledge_gap: 24, misread: 22, careless: 14, method: 12, calculation: 8, expression: 10, time: 10 },
    stems: [
      'If it ______ (rain) tomorrow, we will stay at home and watch a film.',
      'The girl ______ is wearing a red coat is my cousin.',
      '阅读下面短文，回答第 18-20 题：Regular exercise can reduce stress and improve sleep quality.',
    ],
  },
  {
    subject: '物理',
    weight: 16,
    masteryBase: 55,
    knowledge: ['欧姆定律', '浮力与压强', '功与机械能', '光的折射', '杠杆平衡', '电路故障分析'],
    types: ['计算题', '实验题', '选择题', '解答题', '填空题'],
    errorWeights: { knowledge_gap: 28, calculation: 20, method: 18, careless: 13, misread: 11, expression: 7, time: 3 },
    stems: [
      '电源电压保持不变，滑动变阻器最大阻值为 20Ω，闭合开关后电流表示数变为 0.5A，求此时滑动变阻器接入电路的阻值。',
      '一个体积为 200cm³ 的物体漂浮在水面上，求它受到的浮力大小（g 取 10N/kg）。',
      '在探究「杠杆平衡条件」的实验中，请根据实验数据归纳出结论并说明实验次数不少于三次的原因。',
    ],
  },
  {
    subject: '化学',
    weight: 12,
    masteryBase: 68,
    knowledge: ['化学方程式配平', '溶液浓度计算', '常见气体性质', '金属活动性顺序', '酸碱指示剂'],
    types: ['填空题', '选择题', '实验题', '计算题', '解答题'],
    errorWeights: { knowledge_gap: 25, calculation: 18, careless: 16, expression: 16, misread: 13, method: 8, time: 4 },
    stems: [
      '实验室用高锰酸钾制取氧气，写出该反应的化学方程式并说明为什么试管口要放一团棉花。',
      '将 50g 溶质质量分数为 20% 的硝酸钾溶液稀释为 10%，需要加水多少克？',
      '下列物质常温下分别与稀盐酸、稀硫酸反应的产物有何异同？',
    ],
  },
  {
    subject: '语文',
    weight: 10,
    masteryBase: 74,
    knowledge: ['文言实词与虚词', '现代文阅读·内容概括', '病句辨析', '记叙文审题立意', '古诗鉴赏'],
    types: ['阅读理解', '作文题', '解答题', '填空题', '选择题'],
    errorWeights: { knowledge_gap: 22, misread: 26, careless: 12, method: 16, expression: 16, calculation: 4, time: 4 },
    stems: [
      '阅读下面的文言文，完成第 9-12 题：学而不思则罔，思而不学则殆。',
      '请以「那一刻，我长大了」为话题写一篇不少于 600 字的记叙文，要求写出真情实感。',
      '下列句子没有语病的一项是（　　）。',
    ],
  },
]

/* ------------------------------------------------------------- 错题工厂 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function buildMockQuestions(): Question[] {
  const rand = mulberry32(20260926)
  const total = 168
  const out: Question[] = []
  const totalWeight = SUBJECT_SEEDS.reduce((s, x) => s + x.weight, 0)

  for (let i = 0; i < total; i++) {
    // 学科：按权重抽取
    let pick = rand() * totalWeight
    let seed = SUBJECT_SEEDS[0]
    for (const s of SUBJECT_SEEDS) {
      pick -= s.weight
      if (pick <= 0) {
        seed = s
        break
      }
    }

    const knowledge = seed.knowledge[Math.floor(rand() * seed.knowledge.length)]
    const questionType = seed.types[Math.floor(rand() * seed.types.length)]
    const stem = seed.stems[Math.floor(rand() * seed.stems.length)]

    // 错因：按学科权重抽取
    const entries = Object.entries(seed.errorWeights) as [ErrorType, number][]
    const errTotal = entries.reduce((s, [, w]) => s + w, 0)
    let ePick = rand() * errTotal
    let errorType: ErrorType = 'knowledge_gap'
    for (const [type, w] of entries) {
      ePick -= w
      if (ePick <= 0) {
        errorType = type
        break
      }
    }

    // 掌握度：基准 + 随机波动；错因越「轻」掌握度越高
    const penalty: Record<ErrorType, number> = {
      knowledge_gap: -22,
      method: -14,
      misread: -8,
      calculation: -4,
      time: -2,
      careless: 2,
      expression: -6,
    }
    const mastery = Math.round(
      Math.max(12, Math.min(96, seed.masteryBase + penalty[errorType] + (rand() * 26 - 13))),
    )
    const corrected = rand() < Math.min(0.92, 0.2 + mastery / 130)
    const status: Question['status'] =
      mastery >= 80 && corrected ? 'mastered' : corrected ? 'learning' : 'unreviewed'

    // 时间：最近 90 天内，近期密度略高
    const daysAgo = Math.floor(Math.pow(rand(), 1.45) * 90)
    const date = new Date()
    date.setHours(8 + Math.floor(rand() * 11), Math.floor(rand() * 60), 0, 0)
    date.setDate(date.getDate() - daysAgo)

    const difficulty = (1 + Math.floor(rand() * 5)) as Question['difficulty']

    out.push({
      id: `mq_${String(i + 1).padStart(4, '0')}`,
      studentId: MOCK_STUDENT.id,
      studentName: MOCK_STUDENT.name,
      subject: seed.subject,
      grade: MOCK_STUDENT.grade,
      semester: '2026 秋季学期',
      knowledgePoints: [knowledge],
      questionType,
      source: rand() > 0.6 ? '单元测试卷' : '课堂练习',
      stem,
      myAnswer: '（学生作答略）',
      correctAnswer: '（见解析）',
      errorType,
      errorDetail: `本题被归类为「${ERROR_TYPE_LABEL[errorType]}」，建议结合同类题做一次变式训练。`,
      difficulty,
      points: [5, 6, 8, 10, 12][Math.floor(rand() * 5)],
      images: [],
      mastery,
      status,
      corrected,
      tags: [ERROR_TYPE_LABEL[errorType], knowledge],
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
      reviewedAt: corrected ? date.toISOString() : null,
      nextReviewAt: null,
    })
  }

  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

const MOCK_QUESTIONS: Question[] = buildMockQuestions()

/* ------------------------------------------------------------ 统计工具函数 */
function inRange(q: Question, cutoff: Date | null): boolean {
  if (!cutoff) return true
  return new Date(q.createdAt).getTime() >= cutoff.getTime()
}

function avg(list: number[]): number {
  if (!list.length) return 0
  return list.reduce((s, v) => s + v, 0) / list.length
}

function toBucket<T extends string>(key: T, label: string, list: Question[]): StatBucket<T> {
  const total = list.length
  const corrected = list.filter((q) => q.corrected).length
  return {
    key,
    label,
    total,
    corrected,
    mastery: Math.round(avg(list.map((q) => q.mastery))),
    errorRate: total ? Math.round(((total - corrected) / total) * 100) : 0,
  }
}

const SEVERITY_ORDER: Record<'高' | '中' | '低', number> = { 高: 0, 中: 1, 低: 2 }

/* ------------------------------------------------------------- 总览数据 */
export function mockOverview(range: RangeKey = '30d'): StatsOverview {
  const days = RANGE_DAYS[range]
  const now = new Date()
  const cutoff = days ? new Date(now.getTime() - days * 24 * 3600 * 1000) : null
  const prevCutoff = days ? new Date(now.getTime() - days * 2 * 24 * 3600 * 1000) : null

  const current = MOCK_QUESTIONS.filter((q) => inRange(q, cutoff))
  const previous = days
    ? MOCK_QUESTIONS.filter((q) => {
        const t = new Date(q.createdAt).getTime()
        return t < (cutoff as Date).getTime() && t >= (prevCutoff as Date).getTime()
      })
    : []

  const mastery = Math.round(avg(current.map((q) => q.mastery)))
  const prevMastery = previous.length ? Math.round(avg(previous.map((q) => q.mastery))) : mastery
  const masteryDelta = prevMastery ? Math.round(((mastery - prevMastery) / prevMastery) * 100) : 0
  const questionDelta = previous.length
    ? Math.round(((current.length - previous.length) / previous.length) * 100)
    : 0

  const activeDays = new Set(current.map((q) => toISODate(new Date(q.createdAt)))).size

  // 学科分布
  const bySubject: StatBucket<Subject>[] = SUBJECT_SEEDS.map((s) =>
    toBucket<Subject>(s.subject, s.subject, current.filter((q) => q.subject === s.subject)),
  )
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total)

  // 错因构成
  const byErrorType = (Object.keys(ERROR_TYPE_LABEL) as ErrorType[])
    .map((type) => {
      const count = current.filter((q) => q.errorType === type).length
      return {
        type,
        label: ERROR_TYPE_LABEL[type],
        count,
        ratio: current.length ? Math.round((count / current.length) * 100) : 0,
        color: ERROR_TYPE_COLOR[type],
      }
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)

  // 知识点分布（额外附带学科，便于页面展示）
  const knowledgeNames = Array.from(new Set(MOCK_QUESTIONS.flatMap((q) => q.knowledgePoints)))
  const byKnowledge: (StatBucket & { subject: string })[] = knowledgeNames
    .map((name) => {
      const list = current.filter((q) => q.knowledgePoints.includes(name))
      const b = toBucket(name, name, list)
      const subject = list[0]?.subject ?? ''
      return { ...b, key: name, label: name, subject }
    })
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)

  // 题型分布
  const typeNames = Array.from(new Set(current.map((q) => q.questionType)))
  const byQuestionType: StatBucket<QuestionType>[] = typeNames
    .map((t) => toBucket<QuestionType>(t, t, current.filter((q) => q.questionType === t)))
    .sort((a, b) => b.total - a.total)

  // 趋势：按天
  const trendDays = days ?? 30
  const trend: StatsOverview['trend'] = []
  let carried = mastery
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000)
    const key = toISODate(d)
    const list = current.filter((q) => toISODate(new Date(q.createdAt)) === key)
    const dayMastery = list.length ? Math.round(avg(list.map((q) => q.mastery))) : carried
    if (list.length) carried = dayMastery
    trend.push({
      date: key,
      total: list.length,
      corrected: list.filter((q) => q.corrected).length,
      mastery: dayMastery,
    })
  }

  // 热力图：近 14 周
  const heatmap: StatsOverview['heatmap'] = []
  for (let i = 97; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000)
    const key = toISODate(d)
    heatmap.push({
      date: key,
      count: MOCK_QUESTIONS.filter((q) => toISODate(new Date(q.createdAt)) === key).length,
    })
  }

  // 优先突破知识点
  const weakPoints = byKnowledge
    .map((b) => {
      const severity: '高' | '中' | '低' = b.mastery < 50 ? '高' : b.mastery < 70 ? '中' : '低'
      const subject =
        MOCK_QUESTIONS.find((q) => q.knowledgePoints.includes(b.label))?.subject ?? ''
      return { name: b.label, subject, total: b.total, mastery: b.mastery, severity }
    })
    .sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.total - a.total,
    )
    .slice(0, 8)

  const recent = current.slice(0, 8)

  return {
    studentId: MOCK_STUDENT.id,
    totals: {
      questions: current.length,
      corrected: current.filter((q) => q.corrected).length,
      activeDays,
      mastery,
      pending: current.filter((q) => q.status === 'unreviewed').length,
      mastered: current.filter((q) => q.status === 'mastered').length,
      masteryDelta,
      questionDelta,
    },
    bySubject,
    byKnowledge,
    byErrorType,
    byQuestionType,
    byGrade: undefined,
    trend,
    heatmap,
    weakPoints,
    recent,
  }
}

/* ------------------------------------------------------------- 诊断报告 */
export const MOCK_REPORT: InsightReport = {
  studentId: MOCK_STUDENT.id,
  studentName: MOCK_STUDENT.name,
  byModel: false,
  model: undefined,
  summary:
    '林小满同学近 30 天共记录 42 道错题，其中数学占比 41%，错因以「知识盲点」和「计算失误」为主。整体掌握度 63%，较上一周期下降 3 个百分点，说明近期新增错题较多、订正进度滞后。优势集中在英语阅读与语文概括类题目，失分主要出现在数学函数与几何证明这类需要多步推导的知识点上。建议本周把「一元二次方程」与「相似三角形」作为主攻方向，每天保证 30 分钟订正 + 变式训练。',
  strengths: [
    {
      title: '英语阅读理解稳定',
      detail: '近一个月英语错题以细节题为主，26 道错题中 19 道已完成订正，掌握度 74%，明显高于其他学科。',
      evidence: '英语学科掌握度 74%，订正率 73%，高于全科平均水平 11 个百分点',
    },
    {
      title: '语文阅读概括能力提升明显',
      detail: '现代文阅读的失分主要是答题表述不完整，属于表达规范问题而非理解偏差，一个月内掌握度提升了 12 分。',
      evidence: '「现代文阅读·内容概括」掌握度从 61% 提升到 73%',
    },
    {
      title: '错题记录习惯已养成',
      detail: '近 30 天有 21 天主动记录错题，最长连续记录 9 天，学习主动性良好。',
      evidence: '活跃天数 21 天 / 30 天，连续记录最长 9 天',
    },
  ],
  weaknesses: [
    {
      title: '函数与方程类问题仍是短板',
      detail: '「一元二次方程」相关 7 道错题中仅 2 道订正，函数图像性质的理解存在断层，缺少从「数」到「形」的转换训练。',
      evidence: '「一元二次方程」掌握度 41%，错误率 71%，属高风险知识点',
      subject: '数学',
    },
    {
      title: '审题环节失分集中',
      detail: '有 8 道错题被判为「审题不清」，集中在题干条件多、设问绕的题目上，读题习惯需要专门训练。',
      evidence: '「审题不清」占全部错因的 19%，位居第二',
      subject: '英语',
    },
    {
      title: '订正闭环不完整',
      detail: '42 道错题中 16 道仍处于待复盘状态，且多数订正停留在抄写答案，没有做二次变式验证。',
      evidence: '待复盘 16 道，占比 38%，连续两周未复盘的有 5 道',
      subject: '数学',
    },
  ],
  riskSubjects: [
    {
      subject: '数学',
      reason: '错题量最高且掌握度低于全科均值，函数、几何证明两个模块出现连续性失分。',
      score: 78,
    },
    {
      subject: '物理',
      reason: '力学模块实验探究类题目反复出错，公式推导与图像分析尚未形成体系。',
      score: 46,
    },
    {
      subject: '英语',
      reason: '整体较稳，但语法填空与完形填空的失分率偏高，属于可快速提分的模块。',
      score: 32,
    },
  ],
  suggestions: [
    {
      title: '每天固定 30 分钟「一题三做」',
      detail:
        '从「一元二次方程」开始，每道错题在订正后另做 2 道同类变式题，全部记录进错题本，避免只抄答案的假性订正。',
      priority: '高',
    },
    {
      title: '给审题加一道「条件圈画」流程',
      detail:
        '做题时先用不同颜色笔圈出已知条件与设问目标，30 秒内复述题目要求，再动笔列式，可直接减少「审题不清」类失分。',
      priority: '高',
    },
    {
      title: '补齐函数与几何证明两块知识断层',
      detail:
        '本周安排 3 次 40 分钟专题：一次讲一次练，配套 6 道基础 + 4 道提升题，先把「会做」的问题解决再谈速度。',
      priority: '高',
    },
    {
      title: '建立错题二次复盘机制',
      detail: '订正后第 3 天、第 7 天各回看一次，用 1 分钟口述解题思路；连续两次复盘通过的题目标记为「已掌握」。',
      priority: '中',
    },
    {
      title: '物理力学实验专题',
      detail: '整理控制变量法答题模板，明确「控制什么、改变什么、观察什么、得出什么」四要素，避免实验题丢分。',
      priority: '中',
    },
    {
      title: '英语语法保底训练',
      detail: '每天 10 分钟时态与从句填空，优先保住语法填空这一块确定性得分。',
      priority: '低',
    },
  ],
  weeklyPlan: [
    { day: 1, focus: '数学 · 一元二次方程', task: '重做 3 道典型错题 + 3 道变式，完成「判别式与韦达定理」笔记', minutes: 35 },
    { day: 2, focus: '审题训练', task: '精做 4 道条件较多的题目，全程圈画条件并复述设问', minutes: 30 },
    { day: 3, focus: '物理 · 浮力与压强', task: '回看 3 道实验题错题，整理控制变量法答题模板', minutes: 30 },
    { day: 4, focus: '数学 · 相似三角形', task: '复习判定条件，完成 4 道基础 + 2 道提升题', minutes: 40 },
    { day: 5, focus: '英语 · 时态与从句', task: '语法填空 15 题 + 订正昨天所有英语错题', minutes: 25 },
    { day: 6, focus: '数学 · 函数图像', task: '画出 4 个常见二次函数图像，练习由图像反推性质', minutes: 35 },
    { day: 7, focus: '周复盘', task: '重做本周全部错题，标记已掌握题目并制定下周计划', minutes: 30 },
  ],
  parentNotes: [
    '孩子近 30 天记录了 42 道错题，学习主动性不错，但数学函数与几何证明仍是薄弱环节。',
    '目前最需要支持的不是加量，而是保证「订正 + 变式」的完整闭环，避免抄完答案就翻篇。',
    '建议每天固定 30 分钟学习时段，家长只做一件事：确认当天订正是否完成并口述思路，不代替讲题。',
    '英语和语文相对稳定，可以作为孩子的正反馈来源，用「今天错题减少 2 道」来鼓励。',
    '两周后复看一次报告，若数学掌握度未回升 5 个百分点，再与数学老师沟通调整方法。',
  ],
  createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
}
