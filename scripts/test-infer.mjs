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
} from '../server/vision.js'

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
  { name: '两学科特征各半（语文+英语）', text: 'read the passage 完成下列阅读理解任务 read the passage and answer' },
]
for (const e of edgeCases) {
  const r = inferSubjectFromText(e.text)
  console.log(
    `  ${e.name.padEnd(24)} → ${String(r.subject || '（无法判定）').padEnd(4)}  置信度 ${r.confidence.toFixed(2)}  候选: ${(r.candidates || []).map((c) => `${c.subject}(${c.confidence})`).join(', ')}`,
  )
  check(`${e.name} 低置信度`, r.confidence <= 0.45, `实际 ${r.confidence}`)
}
eq('空白文本无学科', inferSubjectFromText('   ').subject, '')

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
const kpCases = [
  { subject: '数学', text: '鸡兔同笼问题：笼子里有鸡和兔共 20 只，脚 56 只，求鸡兔各几只？', expectAny: ['鸡兔同笼'] },
  { subject: '数学', text: '甲乙两地相距 240 千米，两车相向而行，求相遇时间。', expectAny: ['行程问题'] },
  { subject: '数学', text: '一个三角形的面积是多少？求周长。', expectAny: ['几何面积'] },
  { subject: '语文', text: '给加点字注音并组词，再写两个近义词。', expectAny: ['字词基础', '拼音', '词语积累'] },
  { subject: '英语', text: '用括号内词的适当形式填空，注意时态变化。', expectAny: ['语法与时态', '语法填空'] },
]
for (const c of kpCases) {
  const kps = inferKnowledgePoints(c.text, c.subject)
  console.log(`  ${c.subject}  ${c.text.slice(0, 22)}… → [${kps.join(', ')}]`)
  check(`${c.subject} 知识点命中`, kps.some((k) => c.expectAny.includes(k)), `实际 ${JSON.stringify(kps)}`)
  check(`${c.subject} 知识点 ≤ 5`, kps.length <= 5)
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
/* 5. 结论                                                                     */
/* -------------------------------------------------------------------------- */
console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log(`  - ${f}`)
  if (process.argv.includes('--assert')) process.exit(1)
} else if (process.argv.includes('--assert')) {
  console.log('全部通过 ✅')
}
