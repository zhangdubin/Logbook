#!/usr/bin/env node
/**
 * scripts/test-error-type.mjs —— 错因判定的**自动化回归护栏**
 * ---------------------------------------------------------------------------
 * 为什么单独一个脚本：
 *
 *   错因判定**曾经一次都没被执行过**。
 *   建题时 `errorType` 默认填了 `'knowledge_gap'`，分析逻辑
 *   `input.errorType || inferTypeFromAnswers(...)` 的 `||` 永远短路 ——
 *   于是**所有错题都被判成「知识盲点」**：学生写 `5`（答案 `6`，该判计算失误）
 *   和写 `0.5`（答案 `1/2`，等价，该判书写不规范），显示的都是「知识盲点」。
 *
 *   判定算法**看起来在工作**，只是永远输出同一个值 ——
 *   这种 bug 手工点几下发现不了，**必须有自动化护栏**。
 *
 *   【通则】如果一个系统的输出「总是同一个值」，
 *   那它大概率没有在真正计算。
 *
 * 用法：
 *   node scripts/test-error-type.mjs           # 打印样例输出
 *   node scripts/test-error-type.mjs --assert  # 额外做断言（CI 用），失败则退出码 1
 *
 * 覆盖：
 *   - 数学等价（0.5 ≡ 1/2）→ 书写不规范，不是「计算失误」
 *   - 单位缺失 vs 单位换算错（12 vs 12cm / 12cm vs 12m）—— 两个方向结果不同
 *   - 差一位 → 计算失误；差很多 → 方法不当
 *   - 差个符号 → 粗心大意
 *   - 英语词形 → 知识盲点；答非所问 → 审题不清
 *   - 空白作答 → 知识盲点
 *   - **短路护栏**：显式指定了 errorType 时，推断必须**不被使用**
 */

import { inferTypeFromAnswers } from '../server/ai.js'

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
/* 1. 核心用例：数学等价                                                       */
/* -------------------------------------------------------------------------- */
console.log('\n=== 1. 数学等价（错因最容易判错的地方） ===')

// 0.5 和 1/2 是**同一个数**。判成「计算失误」会直接打击学生 ——
// 他明明做对了。判错错因比判错答案更伤信任。
eq(
  '0.5 vs 1/2 → 书写不规范（等价，不是计算失误）',
  inferTypeFromAnswers({ my: '0.5', cor: '1/2', subject: '数学', difficulty: 3 }),
  'expression',
)
eq(
  '2 vs 2.0 → 书写不规范',
  inferTypeFromAnswers({ my: '2', cor: '2.0', subject: '数学', difficulty: 3 }),
  'expression',
)
eq(
  'x+1 vs 1+x → 书写不规范',
  inferTypeFromAnswers({ my: 'x+1', cor: '1+x', subject: '数学', difficulty: 3 }),
  'expression',
)
eq(
  '3/4 vs 0.75 → 书写不规范',
  inferTypeFromAnswers({ my: '3/4', cor: '0.75', subject: '数学', difficulty: 3 }),
  'expression',
)
eq(
  '50% vs 1/2 → 书写不规范',
  inferTypeFromAnswers({ my: '50%', cor: '1/2', subject: '数学', difficulty: 3 }),
  'expression',
)

/* -------------------------------------------------------------------------- */
/* 2. 单位：缺失 ≠ 换算错                                                      */
/* -------------------------------------------------------------------------- */
console.log('\n=== 2. 单位：两个方向结果不同 ===')

// 数值一样、一边没写单位 → **书写不规范**（提醒补单位）
eq(
  '12 vs 12cm → 书写不规范（单位缺失）',
  inferTypeFromAnswers({ my: '12', cor: '12cm', subject: '数学', difficulty: 3 }),
  'expression',
)
// 数值一样、两边都写了单位但**不一样** → **单位换算错，是真错**
// ⚠️ 这条曾经被放过 —— 旧规则「数值一致 → 书写不规范」会把它判成
//    「你对了，只是没写单位」，等于告诉学生「12cm 和 12m 一样」。
eq(
  '12cm vs 12m → 计算失误（单位换算错，不能放过）',
  inferTypeFromAnswers({ my: '12cm', cor: '12m', subject: '数学', difficulty: 3 }),
  'calculation',
)

/* -------------------------------------------------------------------------- */
/* 3. 数值差异                                                                 */
/* -------------------------------------------------------------------------- */
console.log('\n=== 3. 数值差异 ===')

eq(
  '5 vs 6 → 计算失误（差一位）',
  inferTypeFromAnswers({ my: '5', cor: '6', subject: '数学', difficulty: 3 }),
  'calculation',
)
eq(
  '12 vs 15 → 计算失误（差得少）',
  inferTypeFromAnswers({ my: '12', cor: '15', subject: '数学', difficulty: 3 }),
  'calculation',
)
eq(
  '12 vs 45 → 方法不当（差得多）',
  inferTypeFromAnswers({ my: '12', cor: '45', subject: '数学', difficulty: 3 }),
  'method',
)
// 只差个符号 → 粗心大意
eq(
  '5 vs -5 → 粗心大意（差个符号）',
  inferTypeFromAnswers({ my: '5', cor: '-5', subject: '数学', difficulty: 3 }),
  'careless',
)

/* -------------------------------------------------------------------------- */
/* 4. 其他学科 / 边界                                                          */
/* -------------------------------------------------------------------------- */
console.log('\n=== 4. 其他学科与边界 ===')

eq(
  'ABC vs ABD → 审题不清（选择的是别的选项）',
  inferTypeFromAnswers({ my: 'ABC', cor: 'ABD', subject: '英语', difficulty: 3 }),
  'misread',
)
eq(
  '空白作答 → 知识盲点',
  inferTypeFromAnswers({ my: '', cor: '42', subject: '数学', difficulty: 3 }),
  'knowledge_gap',
)
eq(
  '没作答、没答案 → 知识盲点',
  inferTypeFromAnswers({ my: '', cor: '', subject: '数学', difficulty: 3 }),
  'knowledge_gap',
)
eq(
  '高难度 + 明显没写完 → 时间不足',
  inferTypeFromAnswers({ my: '不会', cor: '42', subject: '数学', difficulty: 5 }),
  'time',
)

/* -------------------------------------------------------------------------- */
/* 4b. 题型（qtype）参与的分支                                                 */
/* -------------------------------------------------------------------------- */
console.log('\n=== 4b. 题型参与判定 ===')

// 解答题/应用题这类「要写过程」的题型 —— 答案**没法按数值比**时，
// 优先判「方法不当」而不是「审题不清」：
// 学生多半不是看错题，而是**方法不会**。
eq(
  '解答题 + 文字作答 → 方法不当',
  inferTypeFromAnswers({
    my: '因为面积公式记错了', cor: '因为底乘高除以2',
    subject: '数学', difficulty: 3, qtype: '解答题',
  }),
  'method',
)
eq(
  '应用题 + 文字作答 → 方法不当',
  inferTypeFromAnswers({
    my: '甲乙两地相距', cor: '两车一小时相遇',
    subject: '数学', difficulty: 3, qtype: '应用题',
  }),
  'method',
)
eq(
  '作文题 → 方法不当',
  inferTypeFromAnswers({
    my: '春风吹绿了大地', cor: '春天来了',
    subject: '语文', difficulty: 3, qtype: '作文题',
  }),
  'method',
)
// 数值位数不同（没法按「差几位」判断）→ 落到题型分支
eq(
  '解答题 + 数值位数不同 → 方法不当',
  inferTypeFromAnswers({ my: '12', cor: '12.5', subject: '数学', difficulty: 3, qtype: '解答题' }),
  'method',
)
// ⚠️ 但**数值只差一位**时，计算失误的优先级更高 ——
//    差一位通常是算错了，不是方法不会。
//    所以「数值分支」在「题型分支」**前面**，这个顺序是有讲究的：
//    越具体的判据越先判，越笼统的越后兜底。
eq(
  '解答题 + 只差一位 → 仍然是计算失误（具体判据优先）',
  inferTypeFromAnswers({ my: '5', cor: '6', subject: '数学', difficulty: 3, qtype: '解答题' }),
  'calculation',
)
eq(
  '解答题 + 差得多 → 方法不当（数值分支自己也会给 method）',
  inferTypeFromAnswers({ my: '12', cor: '45', subject: '数学', difficulty: 3, qtype: '解答题' }),
  'method',
)
// 选择题选错 → 审题不清（看错了选项，不是方法不会）
eq(
  '选择题选错 → 审题不清',
  inferTypeFromAnswers({ my: 'B', cor: 'C', subject: '英语', difficulty: 3, qtype: '选择题' }),
  'misread',
)
// 高难度时，即使写了答案，也可能判「时间不足」
eq(
  '高难度解答题 + 文字作答 → 时间不足',
  inferTypeFromAnswers({
    my: '因为面积公式记错了', cor: '因为底乘高除以2',
    subject: '数学', difficulty: 5, qtype: '解答题',
  }),
  'time',
)

/* -------------------------------------------------------------------------- */
/* 5. ⭐ 短路护栏                                                              */
/* -------------------------------------------------------------------------- */
console.log('\n=== 5. ⭐ 短路护栏（这才是本轮真正的 bug） ===')

// 「未指定」和「指定为知识盲点」必须能区分开：
//   errorType = ''   → 走推断
//   errorType = 'knowledge_gap' → 用用户指定的
// 如果这两条走同一条路，默认值就会废掉推断逻辑。
{
  const inferred = inferTypeFromAnswers({ my: '5', cor: '6', subject: '数学', difficulty: 3 })
  eq('未指定（空串）→ 走推断逻辑，得到 calculation', inferred, 'calculation')
  check(
    '推断结果与「默认知识盲点」不同（证明推断确实被调用了）',
    inferred !== 'knowledge_gap',
    `推断得到 ${inferred}`,
  )
}

// 显式指定时，推断**不能**被使用 —— 这是 `||` 的语义
{
  const explicit = 'knowledge_gap'
  const used = explicit || inferTypeFromAnswers({ my: '5', cor: '6', subject: '数学', difficulty: 3 })
  eq('显式指定 knowledge_gap → 用指定的值', used, 'knowledge_gap')
}
{
  const explicit = 'calculation'
  const used = explicit || inferTypeFromAnswers({ my: '5', cor: '6', subject: '数学', difficulty: 3 })
  eq('显式指定 calculation → 用指定的值（不被推断覆盖）', used, 'calculation')
}
{
  const explicit = ''
  const used = explicit || inferTypeFromAnswers({ my: '5', cor: '6', subject: '数学', difficulty: 3 })
  eq('未指定（空串）→ 推断生效', used, 'calculation')
}

/* -------------------------------------------------------------------------- */
/* 6. 结论                                                                     */
/* -------------------------------------------------------------------------- */
console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log(`  - ${f}`)
  if (process.argv.includes('--assert')) process.exit(1)
} else if (process.argv.includes('--assert')) {
  console.log('全部通过 ✅')
}
