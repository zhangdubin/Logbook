#!/usr/bin/env node
/**
 * scripts/test-infer.mjs —— 启发式识别（学科 / 题型 / 知识点）的**纯函数自测**
 * ---------------------------------------------------------------------------
 * 不启动服务、不联网、不调模型，只跑 server/vision.js 里的纯函数。
 *
 *   node scripts/test-infer.mjs          # 打印样例输出
 *   node scripts/test-infer.mjs --assert # 额外做断言（CI 用），有失败则退出码 1
 *
 * 覆盖：
 *   - inferSubjectFromText：数学 / 语文 / 英语 / 物理 / 化学 / 生物 / 地理 / 历史 / 道法
 *   - 边界：纯数字无运算符（低置信度）、短文本（低置信度）、语文 vs 英语（拼音混淆）
 *   - inferQuestionTypeFromText：选择 / 判断 / 填空 / 解答 / 作文 / 计算
 *   - inferKnowledgePoints：按学科出知识点，最多 5 个
 *   - draftFromOcrLines：用户手选学科优先 + 低置信度告警
 */

import {
  inferSubjectFromText,
  inferQuestionTypeFromText,
  inferKnowledgePoints,
  draftFromOcrLines,
  classifyOcrLines,
  normalizeDraft,
  assertDraftKnowledgePoints,
  areAnswersEquivalent,
  normalizeAnswerText,
  normalizeOptionLetter,
  normalizeOptionText,
  extractNumbers,
  crossCheckDraft,
  findLowConfidenceFields,
  refineDraft,
} from '../server/vision.js'
import { preprocessImage } from '../server/ocr.js'

/* -------------------------------------------------------------------------- */
/* 断言小工具                                                                   */
/* -------------------------------------------------------------------------- */
let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    pass++
  } else {
    fail++
    failures.push(`${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

/* -------------------------------------------------------------------------- */
/* 样例数据                                                                     */
/* -------------------------------------------------------------------------- */
const SUBJECT_SAMPLES = [
  {
    name: '数学（几何 + 算式）',
    expect: '数学',
    text: '3. 一个三角形的底是 8cm，高是 5cm，求它的面积和周长。\nA. 20cm² B. 26cm C. 40cm² D. 13cm',
  },
  {
    name: '数学（分数应用）',
    expect: '数学',
    text: '小明有 24 颗糖，给了小红一半，又买来 8 颗。小明现在有多少颗糖？\n答：C',
  },
  {
    name: '数学（方程）',
    expect: '数学',
    text: '解方程：3x + 5 = 20，求 x 的值，并写出解题步骤。',
  },
  {
    name: '语文（拼音）',
    expect: '语文',
    text: '看拼音写汉字：bàng bàng dǎng zhī，组词并造一个句子。',
  },
  {
    name: '语文（古诗）',
    expect: '语文',
    text: '《春晓》的作者是谁？这首诗描写了怎样的中心思想？用自己的话写出段落大意。',
  },
  {
    name: '英语（语法选择）',
    expect: '英语',
    text: 'There ___ a book and two pens on the desk.\nA. is B. are C. have D. has',
  },
  {
    name: '英语（阅读）',
    expect: '英语',
    text: 'Read the passage and choose the best answer. What is Tom doing? He is reading a book.',
  },
  {
    name: '物理（力学）',
    expect: '物理',
    text: '一辆小车在水平面上受到的摩擦力是多少？已知推力为 20N，请画出受力的示意图。',
  },
  {
    name: '化学（化学式）',
    expect: '化学',
    text: '写出下列物质的化学式：氢氧化钠、硫酸、氧气，并说明它们在水中的溶液颜色。',
  },
  {
    name: '生物（细胞）',
    expect: '生物',
    text: '用显微镜观察植物细胞的结构，写出细胞各部分的名称和作用。',
  },
  {
    // 「加速度」里藏着数学的「速度」，以前会被判成数学（bench real 档 physics 样例就栽在这）
    name: '物理（加速度）',
    expect: '物理',
    text: '一个物体在光滑水平面上受到 5N 的拉力，质量是 2kg，求它的加速度和受到的摩擦力大小。',
  },
  {
    // 「平均分配」里藏着数学的「平均分」
    name: '生物（染色体分裂）',
    expect: '生物',
    text: '细胞分裂过程中染色体先复制再平均分配，子细胞与母细胞的遗传物质相同。',
  },
  {
    name: '地理（地势）',
    expect: '地理',
    text: '我国地势西高东低，呈阶梯状分布，这对气候有什么影响？',
  },
  {
    name: '道法（习惯养成）',
    expect: '道法',
    text: '我们在学习中要养成主动思考的好习惯，请说说这样做的好处。',
  },
  {
    name: '地理（经纬网）',
    expect: '地理',
    text: '读经纬网图，回答问题：该地的经纬度是多少？属于什么气候？地形以什么为主？',
  },
  {
    name: '历史（近代史）',
    expect: '历史',
    text: '简述鸦片战争后签订的中英南京条约的主要内容及其影响。',
  },
  {
    name: '道法（法治）',
    expect: '道法',
    text: '宪法是国家的根本大法，公民的基本权利义务有哪些？结合道德与法治谈你的认识。',
  },
]

const TYPE_SAMPLES = [
  {
    name: '选择题（4 个选项行）',
    expect: '选择题',
    text: '1. 下列各数中，最小的是（　）\nA. 0.5\nB. 0.05\nC. 5%\nD. 1/20',
    groups: { options: [{ text: '0.5' }, { text: '0.05' }, { text: '5%' }, { text: '1/20' }] },
  },
  {
    name: '判断题',
    expect: '判断题',
    text: '5. 光的传播速度比声快。（　）',
    groups: {},
  },
  {
    name: '填空题',
    expect: '填空题',
    text: '6. 一个正方形的边长是 3 厘米，它的周长是（　）厘米。',
    groups: {},
  },
  {
    name: '作文题',
    expect: '作文题',
    text: '7. 以《我的好朋友》为题目写一篇习作，不少于 400 字。',
    groups: {},
  },
  {
    name: '解答题',
    expect: '解答题',
    text: '8. 解方程：2x + 6 = 14，求 x，并写出计算过程。',
    groups: {},
  },
  {
    name: '计算题（纯算式）',
    expect: '计算题',
    text: '12 × 3 + 48 ÷ 6 =',
    groups: {},
  },
]

/* -------------------------------------------------------------------------- */
/* 1. 学科判定                                                                 */
/* -------------------------------------------------------------------------- */
console.log('=== 学科判定（inferSubjectFromText）===')
for (const s of SUBJECT_SAMPLES) {
  const r = inferSubjectFromText(s.text)
  const line = `${s.subject ?? s.name}`
  console.log(
    `  ${s.name.padEnd(18)} → ${String(r.subject || '（无法判定）').padEnd(4)}  置信度 ${r.confidence.toFixed(2)}  依据: ${(r.evidence || []).join(', ')}`,
  )
  eq(`${s.name} 学科`, r.subject, s.expect)
  check(`${s.name} 置信度 > 0.45`, r.confidence > 0.45, `实际 ${r.confidence}`)
  check(`${s.name} 有依据`, (r.evidence || []).length > 0)
}

/* ---- 边界情况 ---- */
console.log('\n=== 边界情况（必须低置信度）===')
const edgeCases = [
  { name: '纯数字无运算符', text: '1234 5678 9012' },
  { name: '极短文本', text: '求' },
  { name: '空白', text: '   ' },
  { name: '两学科特征各半（物理+化学）', text: '水的密度 溶液浓度' },
]
for (const e of edgeCases) {
  const r = inferSubjectFromText(e.text)
  console.log(
    `  ${e.name.padEnd(24)} → ${String(r.subject || '（无法判定）').padEnd(4)}  置信度 ${r.confidence.toFixed(2)}  候选: ${(r.candidates || []).map((c) => `${c.subject}(${c.confidence})`).join(', ')}`,
  )
  check(`${e.name} 低置信度`, r.confidence <= 0.45, `实际 ${r.confidence}`)
}
eq('空白文本无学科', inferSubjectFromText('   ').subject, '')

/* ---- Lead 反馈的两条误判（2026-10-28） ---- */
console.log('\n=== 误判回归（Lead 反馈）===')
const regressions = [
  {
    name: '纯文字数学应用题 → 数学',
    text: '小明买了一些苹果和梨，一共花了十二块五，问他一共买了多少个水果？',
    expect: '数学',
    minConf: 0.6,
  },
  {
    name: '语文阅读题夹英文 → 语文',
    text: '四、阅读下面的短文，回答问题。What is the main idea of the passage? 这篇短文主要讲了什么？请用中文概括。',
    expect: '语文',
    minConf: 0.6,
  },
  {
    name: '语文卷里的拼音不算英语 → 语文',
    text: '四、给下列加点字选择正确读音。停（ting / ding）削（xue / xiao）载（zai / zai）抄写下面的词语，并造一个句子。',
    expect: '语文',
    minConf: 0.45,
  },
  {
    name: '英语阅读题（英文为主）→ 英语',
    text: 'Read the passage and choose the best answer. What is Tom doing? He is reading a book.',
    expect: '英语',
    minConf: 0.6,
  },
]
for (const c of regressions) {
  const r = inferSubjectFromText(c.text)
  console.log(
    `  ${c.name.padEnd(30)} → ${String(r.subject || '（无法判定）').padEnd(4)}  置信度 ${r.confidence.toFixed(2)}  依据: ${(r.evidence || []).join(', ')}`,
  )
  eq(`${c.name} 学科`, r.subject, c.expect)
  check(`${c.name} 置信度 >= ${c.minConf}`, r.confidence >= c.minConf, `实际 ${r.confidence}`)
}

/* -------------------------------------------------------------------------- */
/* 2. 题型判定                                                                 */
/* -------------------------------------------------------------------------- */
console.log('\n=== 题型判定（inferQuestionTypeFromText）===')
for (const t of TYPE_SAMPLES) {
  const r = inferQuestionTypeFromText(t.text, t.groups)
  console.log(`  ${t.name.padEnd(20)} → ${r.questionType.padEnd(4)}  置信度 ${r.confidence.toFixed(2)}  依据: ${(r.evidence || []).join(', ')}`)
  eq(`${t.name} 题型`, r.questionType, t.expect)
}

/* -------------------------------------------------------------------------- */
/* 3. 知识点                                                                   */
/* -------------------------------------------------------------------------- */
console.log('\n=== 知识点（inferKnowledgePoints）===')
// 返回结构：[{ name, confidence, level, evidence[] }] —— 对象数组
const kpCases = [
  { subject: '数学', text: '鸡兔同笼问题：笼子里有鸡和兔共 20 只，脚 56 只，求鸡兔各几只？', expectAny: ['鸡兔同笼问题'] },
  { subject: '数学', text: '甲乙两地相距 240 千米，两车相向而行，求相遇时间。', expectAny: ['速度与时间问题'] },
  { subject: '数学', text: '一个三角形的面积是多少？求周长。', expectAny: ['面积与周长'] },
  { subject: '数学', text: '把一根木头锯成 6 段，每隔 5 米栽一棵树，两端都栽，一共栽多少棵？', expectAny: ['植树与间隔问题'] },
  { subject: '数学', text: '一项工程甲队单独做 10 天完成，乙队单独做 15 天完成，两队合作几天完成？', expectAny: ['工程效率问题'] },
  { subject: '数学', text: '计算 3/4 + 1/8 的结果，结果化成最简分数。', expectAny: ['分数运算'] },
  { subject: '语文', text: '给加点字注音并组词，再写两个近义词。', expectAny: ['字词积累', '拼音与多音字'] },
  { subject: '语文', text: '修改病句：春天的北京是一年四季中最美的季节。', expectAny: ['病句辨析'] },
  { subject: '语文', text: '按课文填空：床前明月光，＿＿＿＿＿。', expectAny: ['古诗文默写'] },
  { subject: '英语', text: '用括号内词的适当形式填空，注意时态变化。', expectAny: ['语法与时态', '语法填空技巧'] },
  { subject: '英语', text: '完形填空：通读全文，从每题所给的四个选项中选出最佳答案。', expectAny: ['完形填空技巧'] },
]
for (const c of kpCases) {
  const kps = inferKnowledgePoints(c.text, c.subject)
  console.log(`  ${c.subject}  ${c.text.slice(0, 22)}… → ${JSON.stringify(kps)}`)
  // 断言包含期望知识点（不再要求等于）
  check(`${c.subject} 知识点命中`, kps.some((k) => c.expectAny.includes(k.name)), `实际 ${JSON.stringify(kps)}`)
  check(`${c.subject} 知识点 ≤ 3`, kps.length <= 3, `实际 ${kps.length}`)
  check(`${c.subject} 知识点结构合法`, kps.every((k) => typeof k.name === 'string' && k.name && typeof k.confidence === 'number' && k.confidence > 0 && k.confidence <= 1 && ['基础', '进阶', '难点'].includes(k.level) && Array.isArray(k.evidence) && k.evidence.length > 0), `实际 ${JSON.stringify(kps)}`)
  const hit = kps.find((k) => c.expectAny.includes(k.name))
  check(`${c.subject} 命中项 confidence ≥ 0.5`, !hit || hit.confidence >= 0.5, `实际 ${hit && hit.confidence}`)
}
eq('无证据时知识点为空', inferKnowledgePoints('随便一段没有特征的话', '数学').length, 0)

/* -------------------------------------------------------------------------- */
/* 4. draftFromOcrLines 接线                                                    */
/* -------------------------------------------------------------------------- */
console.log('\n=== draftFromOcrLines 接线 ===')
const ocrLines = [
  { text: '3.小明有24颗糖，给了小红一半，', score: 0.995 },
  { text: '又买来8颗。小明现在有多少颗糖？', score: 0.982 },
  { text: 'A. 12 B. 16 C.20 D.24', score: 0.944 },
  { text: '答：C', score: 0.930 },
]

// 4.1 用户没选学科 -> 走启发式
const auto = draftFromOcrLines(ocrLines, {})
console.log(`  未选学科 → subject=${auto.draft.subject} 置信度=${auto.draft.subjectConfidence} 依据=[${(auto.draft.subjectEvidence || []).join(', ')}]`)
eq('启发式学科（数学应用题）', auto.draft.subject, '数学')
check('启发式给出置信度', typeof auto.draft.subjectConfidence === 'number')
check('启发式给出依据', Array.isArray(auto.draft.subjectEvidence) && auto.draft.subjectEvidence.length > 0)
eq('题型（选择题）', auto.draft.questionType, '选择题')
check('知识点非空', auto.draft.knowledgePoints.length > 0, JSON.stringify(auto.draft.knowledgePoints))
console.log(`  告警: ${JSON.stringify(auto.warnings)}`)

// 4.2 用户手选学科 -> 优先于启发式
const manual = draftFromOcrLines(ocrLines, { fallbackSubject: '英语' })
console.log(`  手选英语 → subject=${manual.draft.subject} 置信度=${manual.draft.subjectConfidence}`)
eq('用户手选学科优先', manual.draft.subject, '英语')
eq('用户手选时置信度为 1', manual.draft.subjectConfidence, 1)
check('用户手选时不报学科告警', !manual.warnings.some((w) => w.includes('学科')), JSON.stringify(manual.warnings))

// 4.3 低置信度 -> 必须给告警，不能静默
const vague = draftFromOcrLines([{ text: '12', score: 0.9 }, { text: '34', score: 0.9 }], {})
console.log(`  极简文本 → subject=${vague.draft.subject} 置信度=${vague.draft.subjectConfidence} 告警=${JSON.stringify(vague.warnings)}`)
check('低置信度有告警', vague.warnings.some((w) => w.includes('学科')), JSON.stringify(vague.warnings))
check('低置信度 < 0.45', vague.draft.subjectConfidence < 0.45, `实际 ${vague.draft.subjectConfidence}`)

// 4.4 位置信号（辅助）：无字母前缀但整体靠右的若干行 -> 判为选项
const positional = classifyOcrLines([
  { text: '小明有24颗糖，他一共吃了几颗？', score: 0.9, box: [60, 40, 500, 80] },
  { text: '12', score: 0.9, box: [320, 120, 360, 150] },
  { text: '16', score: 0.9, box: [320, 160, 360, 190] },
  { text: '20', score: 0.9, box: [320, 200, 360, 230] },
])
console.log(`  位置信号 → 选项数 ${positional.groups.options.length}  题干 ${JSON.stringify(positional.groups.stem.map((s) => s.text))}`)
check('位置信号识别出选项', positional.groups.options.length === 3, `实际 ${positional.groups.options.length}`)

/* -------------------------------------------------------------------------- */
/* 4.5 契约守卫：draft.knowledgePoints 必须是 string[]                          */
/* -------------------------------------------------------------------------- */
/*
 * 线上事故回归：draft.knowledgePoints 一度是**对象数组**，
 * 前端 KnowledgePointInput 直接 `{kp}` 渲染 → React 报
 * “Objects are not valid as a React child”（minified #31），
 * 而整个 App 没有错误边界 → 一次渲染崩溃 = 整页白屏。
 *
 * 契约（**故意不一样，别顺手统一**）：
 *   draft.knowledgePoints    → string[]（前端表单填值）
 *   analysis.knowledgePoints → 对象数组（前端「考点定位」要显示把握度与依据）
 */
console.log('\n=== 契约守卫：draft.knowledgePoints 必须是 string[] ===')

// 4.5.1 模型路径：模型返回对象数组 -> draft 里必须变成字符串数组
const modelRaw = {
  subject: '语文',
  questionType: '填空题',
  stem: '看拼音写汉字：bàng bàng dǎng zhī，并组词造句。',
  options: [],
  knowledgePoints: [
    { name: '拼音与多音字', confidence: 0.48, level: '基础', evidence: ['读音'] },
    { name: '形近字辨析', confidence: 0.35, level: '进阶', evidence: ['字形'] },
  ],
  fieldConfidence: { stem: 0.9, knowledgePoints: 0.48 },
}
const norm = normalizeDraft(modelRaw, { fallbackSubject: '语文' })
console.log(`  模型路径 → draft.knowledgePoints=${JSON.stringify(norm.draft.knowledgePoints)}`)
check(
  '模型路径：draft.knowledgePoints 每一项都是 string',
  Array.isArray(norm.draft.knowledgePoints) && norm.draft.knowledgePoints.every((k) => typeof k === 'string'),
  JSON.stringify(norm.draft.knowledgePoints),
)
eq('模型路径：知识点名字保留', norm.draft.knowledgePoints[0], '拼音与多音字')
check(
  '模型路径：没有空串/未定义',
  norm.draft.knowledgePoints.every((k) => typeof k === 'string' && k.trim().length > 0),
  JSON.stringify(norm.draft.knowledgePoints),
)

// 4.5.2 模型路径：模型给字符串（旧格式）也要正常
const normStr = normalizeDraft({ ...modelRaw, knowledgePoints: ['古诗文默写'] }, {})
check(
  '模型路径（字符串格式）：draft.knowledgePoints 每一项都是 string',
  normStr.draft.knowledgePoints.every((k) => typeof k === 'string'),
  JSON.stringify(normStr.draft.knowledgePoints),
)
eq('模型路径（字符串格式）：原样保留', normStr.draft.knowledgePoints[0], '古诗文默写')

// 4.5.3 纯 OCR 路径
const ocrDraft = draftFromOcrLines(ocrLines, {})
console.log(`  OCR 路径 → draft.knowledgePoints=${JSON.stringify(ocrDraft.draft.knowledgePoints)}`)
check(
  'OCR 路径：draft.knowledgePoints 每一项都是 string',
  Array.isArray(ocrDraft.draft.knowledgePoints) && ocrDraft.draft.knowledgePoints.every((k) => typeof k === 'string'),
  JSON.stringify(ocrDraft.draft.knowledgePoints),
)
check(
  'OCR 路径：inference.knowledgePoints 仍是对象数组（analysis 用）',
  Array.isArray(ocrDraft.inference.knowledgePoints) &&
    ocrDraft.inference.knowledgePoints.every((k) => k && typeof k === 'object' && typeof k.name === 'string'),
  JSON.stringify(ocrDraft.inference.knowledgePoints),
)

// 4.5.4 形状不对就抛：守卫不能静默放过对象
const badShapes = [
  ['对象数组', [{ name: 'x' }]],
  ['数字', [123]],
  ['null', [null]],
  ['对象里没有 name', [{ foo: 'bar' }]],
]
for (const [label, shape] of badShapes) {
  let threw = false
  try {
    assertDraftKnowledgePoints(shape)
  } catch (e) {
    threw = true
  }
  check(`守卫：${label} 必须抛错（而不是静默返回）`, threw)
}
let threwNonArray = false
try {
  assertDraftKnowledgePoints('拼音与多音字')
} catch (e) {
  threwNonArray = true
}
check('守卫：非数组必须抛错', threwNonArray)

/* -------------------------------------------------------------------------- */
/* 5. 答案等价判定（纠错准确率的核心）                                           */
/* -------------------------------------------------------------------------- */
console.log('\n=== 答案等价判定（areAnswersEquivalent）===')

const EQ_CASES = [
  // [a, b, 学科, 期望等价]
  ['1/2', '0.5', '数学', true],
  ['0.5', '1/2', '数学', true],
  ['50%', '0.5', '数学', true],
  ['1/2', '50%', '数学', true],
  ['3:4', '0.75', '数学', true],
  ['2(x+1)', '2x+2', '数学', true],
  ['x+1', '1+x', '数学', true],
  ['12cm', '12cm', '数学', true],
  ['12 cm', '12cm', '数学', true],
  ['007', '7', '数学', true],
  ['0.50', '0.5', '数学', true],
  ['Ａ', 'A', '数学', true],
  ['（A）', 'A', '数学', true],
  ['A.', 'A', '数学', true],
  // 不等价
  ['12cm', '12m', '数学', false],
  ['1/2', '1/3', '数学', false],
  ['0.5', '0.6', '数学', false],
  ['A', 'B', '数学', false],
  ['walk', 'walked', '英语', false],
  ['', 'A', '数学', false],
  ['A', '', '数学', false],
]
for (const [a, b, subject, expected] of EQ_CASES) {
  const got = areAnswersEquivalent(a, b, subject)
  eq(`等价 ${JSON.stringify(a)} vs ${JSON.stringify(b)}(${subject})`, got, expected)
}

// 单位不同必须是两个量
check('单位不同不等价（12cm vs 12m）', areAnswersEquivalent('12cm', '12m') === false)
check('非数学学科不做代数式等价', areAnswersEquivalent('ab', 'a*b', '英语') === false)

console.log('  --- normalizeAnswerText ---')
const NORM_CASES = [
  ['Ａ', 'A'],
  ['（Ａ）', 'A'],
  ['A.', 'A'],
  ['  12 cm ', '12cm'],
  ['0.50', '0.5'],
  ['3.0', '3'],
  ['007', '7'],
  ['答：C', 'C'],
  ['答案：B。', 'b'],
  ['  １２３  ', '123'],
]
for (const [input, expected] of NORM_CASES) {
  eq(`归一 ${JSON.stringify(input)}`, normalizeAnswerText(input), expected)
}
eq('归一：选项字母（大写）', normalizeOptionLetter('（b）'), 'B')
eq('归一：不是字母返回空', normalizeOptionLetter('12厘米'), '')
eq('归一：选项内容去前缀', normalizeOptionText('A. 12 厘米'), '12厘米')

console.log('  --- extractNumbers ---')
eq('抽数值带单位', JSON.stringify(extractNumbers('12cm')), JSON.stringify([{ value: 12, unit: 'cm' }]))
eq('抽多个数值', extractNumbers('3米5厘米').length, 2)
eq('百分号不算单位', extractNumbers('50%')[0].unit, '')

/* -------------------------------------------------------------------------- */
/* 6. 交叉核对 + 低置信字段 + 预处理降级                                          */
/* -------------------------------------------------------------------------- */
console.log('\n=== 交叉核对（crossCheckDraft）===')

const CROSS_OCR = [
  '3.小明有24颗糖，给了小红一半，又买来8颗。小明现在有多少颗糖？',
  'A. 12 B. 16 C. 20 D. 24',
].join('\n')
const CROSS_STEM = '3.小明有24颗糖，给了小红一半，又买来8颗。小明现在有多少颗糖？'

// 6.1 两边一致 -> 没有冲突
{
  const r = crossCheckDraft({
    draft: { stem: CROSS_STEM, options: ['12', '16', '20', '24'], myAnswer: 'C', subject: '数学' },
    ocrText: CROSS_OCR,
    fieldConfidence: { stem: 0.92, options: 0.88, myAnswer: 0.8 },
  })
  eq('一致时无冲突', r.conflicts.length, 0)
  eq('一致时 agreement=1', r.agreement, 1)
}

// 6.2 模型漏选项 -> 冲突并采信 OCR
{
  const r = crossCheckDraft({
    draft: { stem: CROSS_STEM, options: ['12', '16', '20'], myAnswer: 'C', subject: '数学' },
    ocrText: CROSS_OCR,
    fieldConfidence: { stem: 0.9, options: 0.6 },
  })
  eq('漏选项要报冲突', r.conflicts.length, 1)
  eq('漏选项时采信 OCR', r.conflicts[0].chosen, 'ocr')
  eq('漏选项的字段是 options', r.conflicts[0].field, 'options')
  check('冲突要带理由', typeof r.conflicts[0].reason === 'string' && r.conflicts[0].reason.length > 0)
}

// 6.3 答案冲突 -> 冲突并按置信度择优
{
  const r = crossCheckDraft({
    draft: { stem: CROSS_STEM, options: ['12', '16', '20', '24'], myAnswer: 'B', subject: '数学' },
    ocrText: `${CROSS_OCR}\n答：C`,
    fieldConfidence: { stem: 0.9, options: 0.85, myAnswer: 0.5 },
  })
  const ans = r.conflicts.find((c) => c.field === 'myAnswer')
  check('答案冲突要报出来', !!ans)
  eq('答案冲突时采信 OCR（把握度更高）', ans?.chosen, 'ocr')
}

// 6.4 等价答案不算冲突（0.5 vs 1/2）
{
  const r = crossCheckDraft({
    draft: { stem: '一个正方形的边长是多少？', options: [], myAnswer: '0.5', subject: '数学' },
    ocrText: '一个正方形的边长是多少？\n答：1/2',
    fieldConfidence: { stem: 0.9, myAnswer: 0.5 },
  })
  eq('0.5 与 1/2 不算冲突', r.conflicts.filter((c) => c.field === 'myAnswer').length, 0)
}

// 6.5 agreement 落在 0~1
{
  const r = crossCheckDraft({
    draft: { stem: CROSS_STEM, options: ['12'], myAnswer: 'C' },
    ocrText: CROSS_OCR,
    fieldConfidence: {},
  })
  check('agreement 在 0~1', r.agreement >= 0 && r.agreement <= 1, `实际 ${r.agreement}`)
}

console.log('  --- findLowConfidenceFields ---')
{
  const low = findLowConfidenceFields({
    draft: { stem: '题干' },
    fieldConfidence: { stem: 0.6, options: 0.9, myAnswer: 0.5 },
    ocrText: '题干',
  })
  check('低置信字段要被找出来', low.some((f) => f.field === 'stem'), JSON.stringify(low))
  check('低置信字段带原因', low.every((f) => typeof f.reason === 'string' && f.reason.length > 0))
  const none = findLowConfidenceFields({
    draft: { stem: '题干' },
    fieldConfidence: { stem: 0.95, options: 0.95 },
    ocrText: '题干',
  })
  eq('高置信时不报低置信字段', none.length, 0)
}

console.log('  --- refineDraft：无低置信字段时不该调模型 ---')
{
  const r = await refineDraft({ cfg: {}, draft: { stem: 'x' }, lowConfidenceFields: [] })
  eq('没有低置信字段 -> 不校正', r.corrections.length, 0)
  eq('没有低置信字段 -> improved=false', r.improved, false)
}

console.log('  --- refineDraft：对着一台假模型端到端跑一遍 ---')
{
  // 起一个假的 OpenAI 兼容端点：把模型「想改什么」写死，按测试场景切换。
  const http = await import('node:http')
  let reply = { corrections: [] }
  let sawImage = false
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}')
        sawImage = JSON.stringify(parsed).includes('image_url')
      } catch {
        /* 忽略 */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'mock',
          object: 'chat.completion',
          model: 'mock',
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(reply) }, finish_reason: 'stop' }],
        }),
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const cfg = { enabled: true, baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock', apiKey: 'x', timeoutMs: 5000 }

  const OCR_FULL = [
    '3.小明有24颗糖，给了小红一半，又买来8颗。小明现在有多少颗糖？',
    'A. 12 B. 16 C. 20 D. 24',
    '答：C',
  ].join('\n')
  const draft = {
    stem: '3.小明有24颗糖，给了小红一半。',
    options: ['12', '16', '20', '24'],
    myAnswer: 'B',
    correctAnswer: 'C',
    subject: '数学',
  }
  const base = {
    cfg,
    draft,
    fieldConfidence: { stem: 0.5, options: 0.9, myAnswer: 0.4 },
    ocrText: OCR_FULL,
    imageSrc: 'data:image/jpeg;base64,AAAA',
    lowConfidenceFields: ['stem', 'myAnswer'],
  }

  // 1) 可验证的校正（补上了漏读的半句 + 答案与 OCR 一致）-> 采纳
  reply = {
    corrections: [
      {
        field: 'stem',
        from: '3.小明有24颗糖，给了小红一半。',
        to: '3.小明有24颗糖，给了小红一半，又买来8颗。小明现在有多少颗糖？',
        reason: '第二行没识别出来',
      },
      { field: 'myAnswer', from: 'B', to: 'C', reason: '红笔写的是C' },
    ],
  }
  {
    const r = await refineDraft(base)
    eq('可验证的校正要采纳', r.corrections.length, 2)
    eq('improved=true', r.improved, true)
    check('第二遍必须带图（否则模型在纯猜）', sawImage)
    check('采纳的校正要带理由', r.corrections.every((c) => typeof c.reason === 'string' && c.reason.length > 0))
  }

  // 2) 不可验证的校正（凭空改成另一个答案）-> 必须拒绝
  reply = {
    corrections: [
      { field: 'myAnswer', from: 'B', to: 'D', reason: '我觉得是D' },
      { field: 'stem', from: '3.小明有24颗糖，给了小红一半。', to: '一道完全不相干的题目', reason: '不确定' },
    ],
  }
  {
    const r = await refineDraft(base)
    eq('没有证据的校正不能采纳', r.corrections.length, 0)
    eq('没有证据时 improved=false', r.improved, false)
    eq('被拒绝的校正要记下来', r.rejected.length, 2)
  }

  // 3) 模型引用的原值跟当前值不一致（疑似串题）-> 拒绝
  reply = {
    corrections: [{ field: 'myAnswer', from: 'D', to: 'C', reason: '改成C' }],
  }
  {
    const r = await refineDraft(base)
    eq('原值对不上要拒绝', r.corrections.length, 0)
    check('原值对不上要有理由', r.rejected[0]?.reason?.includes('原值'), r.rejected[0]?.reason)
  }

  // 4) 改了不在清单里的字段 -> 拒绝
  reply = {
    corrections: [{ field: 'difficulty', from: '3', to: '5', reason: '很难' }],
  }
  {
    const r = await refineDraft(base)
    eq('不在清单里的字段不能改', r.corrections.length, 0)
  }

  server.close()
}

console.log('  --- preprocessImage：侧车不可用必须降级成 null ---')
{
  // 1) 网络错误
  const r1 = await preprocessImage({
    baseUrl: 'http://127.0.0.1:1',
    imageBase64: 'AAAA',
    timeoutMs: 500,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED')
    },
  })
  eq('侧车不可用 -> null', r1, null)

  // 2) 侧车返回 404（旧版本没有这个端点）
  const r2 = await preprocessImage({
    baseUrl: 'http://127.0.0.1:9',
    imageBase64: 'AAAA',
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  })
  eq('端点不存在 -> null', r2, null)

  // 3) 返回体里没有图片
  const r3 = await preprocessImage({
    baseUrl: 'http://127.0.0.1:9',
    imageBase64: 'AAAA',
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }),
  })
  eq('返回体没有图片 -> null', r3, null)

  // 4) 正常返回
  const r4 = await preprocessImage({
    baseUrl: 'http://ocr.local',
    imageBase64: 'data:image/jpeg;base64,AAAA',
    fetchImpl: async (url, init) => {
      eq('预处理请求打到 /preprocess', url, 'http://ocr.local/preprocess')
      check('预处理请求带 image 字段', JSON.parse(init.body).image === 'AAAA')
      return {
        ok: true,
        json: async () => ({
          ok: true,
          image: 'data:image/jpeg;base64,BBBB',
          variant: 'clahe_color',
          width: 932,
          height: 232,
          ms: 91,
        }),
      }
    },
  })
  eq('正常返回：拿到增强图', r4?.image, 'data:image/jpeg;base64,BBBB')
  eq('正常返回：变体名', r4?.variant, 'clahe_color')
  eq('正常返回：宽', r4?.width, 932)

  // 5) 没配置地址 / 没有图片
  eq('没配地址 -> null', await preprocessImage({ baseUrl: '', imageBase64: 'AAAA' }), null)
  eq('没有图片 -> null', await preprocessImage({ baseUrl: 'http://x', imageBase64: '' }), null)
}

/* -------------------------------------------------------------------------- */
/* 7. 结论                                                                     */
/* -------------------------------------------------------------------------- */
console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log(`  - ${f}`)
  if (process.argv.includes('--assert')) process.exit(1)
} else if (process.argv.includes('--assert')) {
  console.log('全部通过 ✅')
}
