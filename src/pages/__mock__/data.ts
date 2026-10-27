/**
 * __mock__ —— 离线演示数据
 * ---------------------------------------------------------------------------
 * 用途：后端 server/index.js 尚未就绪（或接口临时不可用）时，前端页面依然能够
 * 正常渲染、交互，不出现白屏。数据完全遵循 src/lib/types.ts 的契约。
 *
 * 切换机制见 src/pages/entry/client.ts：
 *   1. 任何请求先走真实接口 api.*；
 *   2. 真实接口抛错（网络不可达 / 404 / 5xx）时，自动降级到本目录的 mock 实现；
 *   3. 一旦探测到真实接口可用，后续请求全部走真实接口。
 */

import type {
  AIAnalysis,
  AIErrorDiagnosis,
  AIKnowledgePoint,
  AIPracticeTask,
  AISimilarQuestion,
  Difficulty,
  ErrorType,
  KnowledgePointRef,
  Question,
  QuestionType,
  Student,
  Subject,
} from '@/lib/types'

const DAY = 86400_000

/** 相对今天 n 天前的某个时刻，输出 ISO 字符串 */
function iso(daysAgo: number, hour = 19, minute = 20): string {
  const d = new Date(Date.now() - daysAgo * DAY)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

/** 占位图（内联 SVG，避免依赖任何外部资源） */
export const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#eef2ff"/><rect x="12" y="12" width="456" height="276" fill="none" stroke="#c7d2fe" stroke-width="2" stroke-dasharray="8 6"/><text x="240" y="150" font-size="26" text-anchor="middle" fill="#6366f1" font-family="sans-serif">错题照片</text><text x="240" y="186" font-size="15" text-anchor="middle" fill="#818cf8" font-family="sans-serif">示例占位图 · 演示数据</text></svg>`,
  )

/* -------------------------------------------------------------------------- */
/* 学生                                                                       */
/* -------------------------------------------------------------------------- */

export const mockStudents: Student[] = [
  {
    id: 'stu_ming',
    name: '小明',
    grade: '五年级',
    avatarColor: '#3b63f6',
    school: '实验二小',
    note: '数学计算偏弱，做题速度快但容易漏步骤。',
    createdAt: iso(120, 9, 0),
  },
  {
    id: 'stu_tian',
    name: '甜甜',
    grade: '初二',
    avatarColor: '#ec4899',
    school: '育才中学',
    note: '英语阅读理解在进步，物理刚开始接触。',
    createdAt: iso(90, 20, 10),
  },
  {
    id: 'stu_zhe',
    name: '阿哲',
    grade: '高一',
    avatarColor: '#10b981',
    school: '第一中学',
    note: '物理力学需要补强，数学函数部分理解不错。',
    createdAt: iso(60, 21, 30),
  },
]

/* -------------------------------------------------------------------------- */
/* AI 分析构造器                                                               */
/* -------------------------------------------------------------------------- */

export interface AnalysisSeed {
  subject: Subject
  questionType: QuestionType
  summary: string
  diagnosisType: ErrorType
  confidence: number
  reason: string
  evidence?: string[]
  rootCauses: string[]
  correctSteps: { title: string; detail: string }[]
  knowledgeGaps: string[]
  tips: string[]
  knowledgePoints?: AIKnowledgePoint[]
  similarQuestions?: AISimilarQuestion[]
  practicePlan?: AIPracticeTask[]
}

export function buildAnalysis(seed: AnalysisSeed, createdAt: string): AIAnalysis {
  const diagnosis: AIErrorDiagnosis = {
    type: seed.diagnosisType,
    confidence: seed.confidence,
    reason: seed.reason,
    evidence: seed.evidence ?? [],
  }
  const plan: AIPracticeTask[] = seed.practicePlan ?? [
    { day: 1, focus: '重做一遍', task: '把同类错题重做一遍，写出完整步骤', minutes: 15 },
    { day: 2, focus: '补知识点', task: '回顾课本例题，把公式默写一遍', minutes: 10 },
    { day: 4, focus: '变式训练', task: '做 3 道同类变式题并口述思路', minutes: 20 },
    { day: 7, focus: '回顾复盘', task: '整理错题本，遮住答案自测', minutes: 15 },
  ]
  return {
    byModel: false,
    model: '本地启发式引擎（演示数据）',
    subject: seed.subject,
    questionType: seed.questionType,
    knowledgePoints:
      seed.knowledgePoints ??
      seed.knowledgeGaps.map((name) => ({ name, confidence: 0.72, level: '基础' as const })),
    diagnosis,
    rootCauses: seed.rootCauses,
    correctSteps: seed.correctSteps,
    knowledgeGaps: seed.knowledgeGaps,
    tips: seed.tips,
    similarQuestions:
      seed.similarQuestions ?? [
        {
          stem: '同类变式：把上题中的条件换成两个相近的量，再求平均数。',
          answer: '先求总量，再除以份数',
          analysis: '两步走的结构，和原题一致，先抓"总量 = 份数 × 平均数"这个关系。',
          difficulty: 3,
        },
        {
          stem: '同类变式：给出 3 个班的人数，求全校三个班的平均人数。',
          answer: '求和后除以 3',
          analysis: '同样是先合后分，注意人数必须一一对应。',
          difficulty: 2,
        },
      ],
    practicePlan: plan,
    summary: seed.summary,
    createdAt,
  }
}

/* -------------------------------------------------------------------------- */
/* 错题                                                                       */
/* -------------------------------------------------------------------------- */

function question(
  base: Omit<Question, 'tags' | 'updatedAt' | 'reviewedAt' | 'nextReviewAt' | 'semester' | 'points' | 'source' | 'studentName'> &
    Partial<
      Pick<
        Question,
        'tags' | 'updatedAt' | 'reviewedAt' | 'nextReviewAt' | 'semester' | 'points' | 'source' | 'studentName'
      >
    >,
): Question {
  return {
    semester: '2026 上学期',
    points: 5,
    source: '课堂练习',
    tags: [],
    reviewedAt: null,
    nextReviewAt: null,
    ...base,
  }
}

export const mockQuestions: Question[] = [
  question({
    id: 'q_mock_01',
    studentId: 'stu_ming',
    studentName: '小明',
    subject: '数学',
    grade: '五年级',
    knowledgePoints: ['小数乘法', '运算定律'],
    questionType: '计算题',
    stem: '计算：12.5 × 2.4 × 4 ÷ 12.5',
    options: [],
    myAnswer: '12',
    correctAnswer: '9.6',
    errorType: 'method',
    errorDetail: '没有先观察算式结构，凑整的顺序选错了。',
    difficulty: 3,
    images: [{ id: 'img_01', url: PLACEHOLDER_IMAGE, dataUrl: PLACEHOLDER_IMAGE }],
    aiAnalysis: buildAnalysis(
      {
        subject: '数学',
        questionType: '计算题',
        summary: '这道题的关键是先凑整再算乘法交换律，小明的思路方向错了但知识点本身会。',
        diagnosisType: 'method',
        confidence: 0.82,
        reason: '答案 12 与正确结果 9.6 差距较大，且过程里把 2.4×4 先算了，说明没有识别出 12.5 与除号凑整的结构。',
        evidence: ['我的答案 12 等于 2.4×4×(1+…)，中间步骤与正确结构不一致', '题干中存在 12.5 与 ÷12.5 的明显凑整关系'],
        rootCauses: [
          '缺少"先观察数字特征，再决定运算顺序"的习惯',
          '对乘法交换律、结合律的逆用不熟练',
        ],
        correctSteps: [
          { title: '先扫一眼数字特征', detail: '看到 12.5 和 ÷12.5，立刻意识到可以约掉。' },
          { title: '调整运算顺序', detail: '12.5 × (2.4 × 4) ÷ 12.5 = 2.4 × 4 = 9.6。' },
          { title: '回头检验', detail: '把 9.6 代回原式验算，左右相等即正确。' },
        ],
        knowledgeGaps: ['乘法交换律与结合律的逆向使用'],
        tips: [
          '看到"两个相同的数一乘一除"，先划掉再算',
          '口算阶段养成"先凑整"的条件反射',
        ],
      },
      iso(1, 20, 10),
    ),
    mastery: 35,
    status: 'unreviewed',
    corrected: false,
    createdAt: iso(1, 19, 48),
  }),
  question({
    id: 'q_mock_02',
    studentId: 'stu_ming',
    studentName: '小明',
    subject: '数学',
    grade: '五年级',
    knowledgePoints: ['分数加减法', '通分'],
    questionType: '计算题',
    stem: '计算：3/4 + 5/6',
    myAnswer: '8/10',
    correctAnswer: '19/12',
    errorType: 'knowledge_gap',
    errorDetail: '通分方法没掌握，直接把分母相加了。',
    difficulty: 2,
    images: [],
    aiAnalysis: null,
    mastery: 25,
    status: 'unreviewed',
    corrected: false,
    tags: ['口算天天练'],
    createdAt: iso(2, 20, 5),
  }),
  question({
    id: 'q_mock_03',
    studentId: 'stu_ming',
    studentName: '小明',
    subject: '语文',
    grade: '五年级',
    knowledgePoints: ['修辞手法', '句子赏析'],
    questionType: '解答题',
    stem: '句子赏析："月光如流水一般，静静地泻在这一片叶子和花上。"请写出这句话运用的修辞手法及表达效果。',
    myAnswer: '比喻，写出了月亮很亮。',
    correctAnswer: '比喻；把月光比作流水，"泻"字写出月光柔和流动、洒满花叶的情态，营造静谧柔和的意境。',
    errorType: 'expression',
    errorDetail: '只答出了修辞手法，没有结合关键字分析表达效果。',
    difficulty: 4,
    images: [],
    aiAnalysis: buildAnalysis(
      {
        subject: '语文',
        questionType: '解答题',
        summary: '答题模板不完整：修辞 + 关键字 + 表达效果，三段式缺了中间两段。',
        diagnosisType: 'expression',
        confidence: 0.76,
        reason: '答案识别出"比喻"，但缺少对"泻"字的分析以及"营造意境"的表达效果，典型的答题步骤缺失。',
        evidence: ['答案中只有"写出了月亮很亮"，未引用关键字', '缺少"表达效果"相关表述'],
        rootCauses: ['缺少修辞题的三段式答题模板', '赏析时不会圈出关键字'],
        correctSteps: [
          { title: '判断手法', detail: '先写"运用了比喻"，把本体和喻体都点出来。' },
          { title: '抓住关键字', detail: '圈出"泻"，这个字写出月光的动态。' },
          { title: '落到效果', detail: '静谧、柔和、洒满花叶的意境。' },
        ],
        knowledgeGaps: ['修辞赏析答题模板', '炼字类题目的答题规范'],
        tips: ['把"手法 + 关键字 + 效果"写在草稿纸上形成肌肉记忆', '每天口头复述一遍答题模板'],
      },
      iso(3, 18, 30),
    ),
    mastery: 45,
    status: 'learning',
    corrected: false,
    createdAt: iso(3, 18, 12),
  }),
  question({
    id: 'q_mock_04',
    studentId: 'stu_ming',
    studentName: '小明',
    subject: '数学',
    grade: '五年级',
    knowledgePoints: ['小数乘法', '运算定律'],
    questionType: '计算题',
    stem: '计算：0.25 × 3.7 × 4',
    myAnswer: '3.7',
    correctAnswer: '3.7',
    errorType: 'careless',
    errorDetail: '结果算对了，但过程抄漏了一步，被扣过程分。',
    difficulty: 2,
    images: [],
    aiAnalysis: null,
    mastery: 70,
    status: 'learning',
    corrected: true,
    tags: ['过程分'],
    reviewedAt: iso(1, 20, 30),
    nextReviewAt: iso(-2, 9, 0),
    createdAt: iso(5, 19, 20),
  }),
  question({
    id: 'q_mock_05',
    studentId: 'stu_tian',
    studentName: '甜甜',
    subject: '英语',
    grade: '初二',
    knowledgePoints: ['定语从句', '关系代词'],
    questionType: '选择题',
    stem: 'This is the book ___ I bought yesterday.',
    options: ['A. which', 'B. who', 'C. what', 'D. whose'],
    myAnswer: 'B',
    correctAnswer: 'A',
    errorType: 'knowledge_gap',
    errorDetail: '定语从句中先行词是物时用 which 记混了。',
    difficulty: 3,
    images: [{ id: 'img_05', url: PLACEHOLDER_IMAGE, dataUrl: PLACEHOLDER_IMAGE }],
    aiAnalysis: buildAnalysis(
      {
        subject: '英语',
        questionType: '选择题',
        summary: '先行词是 book（物）所以用 which，属于规则性遗忘，不是粗心。',
        diagnosisType: 'knowledge_gap',
        confidence: 0.91,
        reason: '答案选了 who，而先行词 the book 是物证；这是"物用 which，人用 who"的规则没有内化。',
        evidence: ['题干先行词 the book 为物', '我的答案 B 对应 who，只能指人'],
        rootCauses: ['关系代词选择规则未形成条件反射', '做题时没有先圈出先行词'],
        correctSteps: [
          { title: '圈先行词', detail: 'the book，是"物"。' },
          { title: '套规则', detail: '物 → which / that；人 → who / whom。' },
          { title: '代入检验', detail: 'which I bought yesterday 句子通顺，选 A。' },
        ],
        knowledgeGaps: ['定语从句关系代词的选择规则'],
        tips: ['做题第一步永远是圈先行词', '把"物 which，人 who"写在小纸条上贴书桌'],
      },
      iso(1, 21, 40),
    ),
    mastery: 40,
    status: 'unreviewed',
    corrected: false,
    createdAt: iso(1, 21, 25),
  }),
  question({
    id: 'q_mock_06',
    studentId: 'stu_tian',
    studentName: '甜甜',
    subject: '英语',
    grade: '初二',
    knowledgePoints: ['现在完成时', '动词时态'],
    questionType: '填空题',
    stem: 'I ___ (live) in this city since 2019.',
    myAnswer: 'live',
    correctAnswer: 'have lived',
    errorType: 'misread',
    errorDetail: '没注意 since 提示的时间状语。',
    difficulty: 2,
    images: [],
    aiAnalysis: null,
    mastery: 55,
    status: 'learning',
    corrected: false,
    createdAt: iso(4, 21, 0),
  }),
  question({
    id: 'q_mock_07',
    studentId: 'stu_tian',
    studentName: '甜甜',
    subject: '物理',
    grade: '初二',
    knowledgePoints: ['力的示意图', '弹力'],
    questionType: '解答题',
    stem: '画出物体静止在水平桌面时所受的重力和支持力的示意图。',
    myAnswer: '只画了重力',
    correctAnswer: '重力和支持力大小相等、方向相反，作用在同一点上。',
    errorType: 'method',
    errorDetail: '不会判断二力平衡，漏画支持力。',
    difficulty: 4,
    images: [],
    aiAnalysis: null,
    mastery: 30,
    status: 'unreviewed',
    corrected: false,
    tags: ['新学科'],
    createdAt: iso(6, 20, 50),
  }),
  question({
    id: 'q_mock_08',
    studentId: 'stu_zhe',
    studentName: '阿哲',
    subject: '物理',
    grade: '高一',
    knowledgePoints: ['牛顿第二定律', '受力分析'],
    questionType: '计算题',
    stem: '质量为 2kg 的物体在水平面上受 6N 的水平拉力作用，已知动摩擦因数为 0.2，求物体的加速度。',
    myAnswer: '2 m/s²',
    correctAnswer: '1 m/s²',
    errorType: 'calculation',
    errorDetail: '摩擦力没减，直接用 F=ma 算了。',
    difficulty: 4,
    images: [{ id: 'img_08', url: PLACEHOLDER_IMAGE, dataUrl: PLACEHOLDER_IMAGE }],
    aiAnalysis: buildAnalysis(
      {
        subject: '物理',
        questionType: '计算题',
        summary: '受力分析漏掉了摩擦力这一步，思路对但运算起点错了。',
        diagnosisType: 'calculation',
        confidence: 0.85,
        reason: '我的答案 2 m/s² 正好等于 6/2，说明直接把合力当成了拉力，摩擦力没有进入计算。',
        evidence: ['答案 2 = 6N ÷ 2kg', '题目给出动摩擦因数 0.2，但答案中未体现'],
        rootCauses: ['受力分析不完整', '摩擦力公式 f=μN 的使用时机不熟'],
        correctSteps: [
          { title: '受力分析', detail: '重力、支持力、拉力、摩擦力，共四力。' },
          { title: '求摩擦力', detail: 'N = mg = 20N，f = μN = 0.2×20 = 4N。' },
          { title: '列牛顿第二定律', detail: 'F合 = F − f = 6 − 4 = 2N，a = F合/m = 2/2 = 1 m/s²。' },
        ],
        knowledgeGaps: ['受力分析完整性的检查流程', '滑动摩擦力 f=μN 的计算'],
        tips: ['画受力图后数一数力的个数', '把"检查是否漏力"写进答题步骤'],
      },
      iso(2, 22, 10),
    ),
    mastery: 45,
    status: 'learning',
    corrected: false,
    createdAt: iso(2, 22, 0),
  }),
  question({
    id: 'q_mock_09',
    studentId: 'stu_zhe',
    studentName: '阿哲',
    subject: '数学',
    grade: '高一',
    knowledgePoints: ['二次函数', '图像性质'],
    questionType: '解答题',
    stem: '已知二次函数 f(x)=x²−4x+3，求其顶点坐标与对称轴。',
    myAnswer: '顶点 (2,-1)',
    correctAnswer: '顶点 (2,-1)，对称轴 x=2',
    errorType: 'expression',
    errorDetail: '答案对了但漏写对称轴。',
    difficulty: 3,
    images: [],
    aiAnalysis: null,
    mastery: 65,
    status: 'learning',
    corrected: true,
    reviewedAt: iso(1, 12, 0),
    createdAt: iso(7, 21, 15),
  }),
  question({
    id: 'q_mock_10',
    studentId: 'stu_zhe',
    studentName: '阿哲',
    subject: '化学',
    grade: '高一',
    knowledgePoints: ['氧化还原反应', '化合价'],
    questionType: '选择题',
    stem: '下列反应中，属于氧化还原反应的是（ ）',
    options: ['A. CaO + H₂O → Ca(OH)₂', 'B. Fe + CuSO₄ → FeSO₄ + Cu', 'C. HCl + NaOH → NaCl + H₂O', 'D. CaCO₃ → CaO + CO₂'],
    myAnswer: 'A',
    correctAnswer: 'B',
    errorType: 'misread',
    errorDetail: '题目问的是"属于氧化还原反应"，看成了"化合反应"。',
    difficulty: 3,
    images: [],
    aiAnalysis: null,
    mastery: 50,
    status: 'unreviewed',
    corrected: false,
    createdAt: iso(8, 22, 30),
  }),
  question({
    id: 'q_mock_11',
    studentId: 'stu_tian',
    studentName: '甜甜',
    subject: '数学',
    grade: '初二',
    knowledgePoints: ['全等三角形', '判定定理'],
    questionType: '证明题',
    stem: '已知 AB=AD，∠BAD=∠CAD，求证 △ABC ≌ △ADC。',
    myAnswer: '只写了 AB=AD',
    correctAnswer: '还需补充 ∠B=∠C 或 BC 为公共边，再用 SAS 判定。',
    errorType: 'knowledge_gap',
    errorDetail: '全等三角形判定条件记不全。',
    difficulty: 4,
    images: [],
    aiAnalysis: null,
    mastery: 35,
    status: 'unreviewed',
    corrected: false,
    createdAt: iso(9, 19, 40),
  }),
  question({
    id: 'q_mock_12',
    studentId: 'stu_ming',
    studentName: '小明',
    subject: '数学',
    grade: '五年级',
    knowledgePoints: ['小数乘法', '运算定律'],
    questionType: '计算题',
    stem: '简便计算：3.6 × 102 − 3.6 × 2',
    myAnswer: '365.6',
    correctAnswer: '360',
    errorType: 'calculation',
    errorDetail: '乘法分配律用了，但减法时算错了 3.6×2。',
    difficulty: 3,
    images: [],
    aiAnalysis: null,
    mastery: 55,
    status: 'learning',
    corrected: false,
    createdAt: iso(11, 20, 15),
  }),
]

/* -------------------------------------------------------------------------- */
/* 知识点字典                                                                 */
/* -------------------------------------------------------------------------- */

export const mockKnowledgePoints: KnowledgePointRef[] = [
  { name: '小数乘法', subject: '数学', count: 4 },
  { name: '运算定律', subject: '数学', count: 4 },
  { name: '分数加减法', subject: '数学', count: 1 },
  { name: '通分', subject: '数学', count: 1 },
  { name: '二次函数', subject: '数学', count: 1 },
  { name: '图像性质', subject: '数学', count: 1 },
  { name: '全等三角形', subject: '数学', count: 1 },
  { name: '判定定理', subject: '数学', count: 1 },
  { name: '修辞手法', subject: '语文', count: 1 },
  { name: '句子赏析', subject: '语文', count: 1 },
  { name: '定语从句', subject: '英语', count: 1 },
  { name: '关系代词', subject: '英语', count: 1 },
  { name: '现在完成时', subject: '英语', count: 1 },
  { name: '动词时态', subject: '英语', count: 1 },
  { name: '牛顿第二定律', subject: '物理', count: 1 },
  { name: '受力分析', subject: '物理', count: 1 },
  { name: '力的示意图', subject: '物理', count: 1 },
  { name: '弹力', subject: '物理', count: 1 },
  { name: '氧化还原反应', subject: '化学', count: 1 },
  { name: '化合价', subject: '化学', count: 1 },
]

/* -------------------------------------------------------------------------- */
/* 拍照识别的模拟返回                                                         */
/* -------------------------------------------------------------------------- */

const PHOTO_ANALYSIS_GAPS = ['四步答题流程', '草稿纸使用规范']

export function buildMockPhotoAnalysis(subject: Subject, hint?: string): {
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
  }
  analysis: AIAnalysis
} {
  const isMath = subject === '数学'
  const stem = isMath
    ? '计算：3.6 × 2.5 + 3.6 × 7.5'
    : `${hint || '例题'}：结合材料，完成下面这道${subject}题的解答。`
  const options = isMath
    ? ['A. 36', 'B. 30', 'C. 33', 'D. 27']
    : ['A. 选项一', 'B. 选项二', 'C. 选项三', 'D. 选项四']
  const correct = isMath ? 'B' : 'A'
  const my = isMath ? 'C' : 'B'
  const knowledge = isMath ? ['小数乘法', '运算定律'] : [`${subject}基础考点`]
  const ocrText = `${stem}\n答案：${correct}\n学生作答：${my}`
  return {
    draft: {
      subject,
      questionType: isMath ? '计算题' : '选择题',
      knowledgePoints: knowledge,
      stem,
      options,
      myAnswer: my,
      correctAnswer: correct,
      difficulty: 3,
      confidence: 0.86,
      ocrText,
    },
    analysis: buildAnalysis(
      {
        subject,
        questionType: isMath ? '计算题' : '选择题',
        summary: `识别到一道${subject}题，主要问题出在运算/判断环节，建议按下面的步骤重做一遍。`,
        diagnosisType: 'calculation',
        confidence: 0.68,
        reason: '答案与正确结果不一致，且作答痕迹显示计算过程有跳步。',
        evidence: ['作答痕迹与正确选项不匹配', '题干为多步运算题'],
        rootCauses: ['运算步骤不完整', '缺少结果回代检验的习惯'],
        correctSteps: [
          { title: '第一步：读清已知条件', detail: '把题干中的关键数字圈出来。' },
          { title: '第二步：写出关系式', detail: '列出已知量与待求量的关系。' },
          { title: '第三步：代入并检验', detail: '算完回代原式验证。' },
        ],
        knowledgeGaps: PHOTO_ANALYSIS_GAPS,
        tips: ['写步骤时按"读题 → 列式 → 运算 → 检验"四步走', '不确定时先在草稿纸上画图'],
      },
      new Date().toISOString(),
    ),
  }
}
