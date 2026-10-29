#!/usr/bin/env node
/**
 * scripts/test-advice.mjs —— 「建议是否准确」的回归用例
 * ---------------------------------------------------------------------------
 * 用户诉求：「**并能给出准确的建议**」。
 *
 * 这类东西最难的不是写得对，是**写得具体**。之前所有建议都是模板：
 *   「分步书写，步骤之间留出间距」
 * 对「鸡兔同笼」和「分数加减」是同一句 —— 等于没说。
 *
 * 这里用可断言的方式锁住「具体性」：
 *   - 建议里必须出现**这道题自己的数字**（不是模板话）
 *   - 建议里必须出现**认出来的题型模型**
 *   - 单位和题干一致（题干说「米」就不能说「千米」）
 *   - 答案一致时**不能**把错因说得那么肯定（把握度要压下来）
 *   - 认不出模型时要老实（不硬编）
 *
 * 用法：node scripts/test-advice.mjs [--assert]
 */

import { localAnalyze } from '../server/ai.js'
import { detectProblemModel, extractQuantities } from '../server/problemModels.js'

let passed = 0
let failed = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) {
    passed += 1
    console.log(`  \x1b[32m✓\x1b[0m ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    failed += 1
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
    console.log(`  \x1b[31m✗\x1b[0m ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

/* ======================================================================== */
console.log('\n\x1b[1m一、题目模型识别\x1b[0m')

const MODEL_CASES = [
  ['小明和小华同时从甲地出发相向而行，甲乙两地相距 300 千米，小明每小时行 60 千米，小华每小时行 40 千米，几小时后两人相遇？', '数学', 'meet'],
  ['甲在乙前面 100 米，乙每分钟走 80 米，甲每分钟走 60 米，几分钟能追上？', '数学', 'chase'],
  ['一项工程甲单独做 10 天完成，乙单独做 15 天完成，两人合做几天完成？', '数学', 'work'],
  ['把 20 克盐放进 80 克水里，浓度是多少？', '数学', 'concentration'],
  ['一件商品进价 80 元，标价 100 元，打八折出售利润率是多少？', '数学', 'profit'],
  ['小明 5 次射击的平均成绩是 82 分，第 6 次要打多少分才能使平均分达到 84 分？', '数学', 'average'],
  ['笼子里有鸡和兔共 20 只，一共有 56 条腿，鸡和兔各有几只？', '数学', 'chicken_rabbit'],
  ['在一条 100 米的小路一边种树，每隔 5 米种一棵，两端都种，共种多少棵？', '数学', 'tree'],
  ['一个长方形的长是 8 米，宽是 5 米，求它的面积和周长。', '数学', 'geometry'],
  ['一根绳子长 20 米，第一次用去全长的 25%，还剩多少米？', '数学', 'fraction'],
  ['修改病句：通过这次活动，使我明白了团结的重要。', '语文', 'grammar_cn'],
  ['He ____ (go) to school yesterday.', '英语', 'tense'],
  ['一个体积 0.001 立方米的铁块浸没在水中，求浮力。', '物理', 'physics_pressure'],
]

for (const [stem, subject, expectKey] of MODEL_CASES) {
  const m = detectProblemModel(stem, subject)
  check(
    `${subject}·${expectKey} 识别正确`,
    m?.key === expectKey,
    m ? `识别为 ${m.key}（把握 ${m.confidence}）` : '没识别出来',
  )
}

/* ======================================================================== */
console.log('\n\x1b[1m二、建议必须落到这道题自己的数字上\x1b[0m')

{
  const stem =
    '小明和小华同时从甲地出发相向而行，甲乙两地相距 300 千米，小明每小时行 60 千米，小华每小时行 40 千米，几小时后两人相遇？'
  const r = localAnalyze({ subject: '数学', stem, myAnswer: '2', correctAnswer: '3', grade: '初一', difficulty: 3 })
  const all = [...r.correctSteps.map((s) => s.detail), ...r.tips].join('\n')

  check('步骤里出现了题干的 300', all.includes('300'))
  check('步骤里出现了题干的 60 和 40', all.includes('60') && all.includes('40'))
  check(
    '步骤里算出了具体结果（300 ÷ 100 = 3）',
    /300\s*÷\s*100\s*=\s*3/.test(all),
    (all.match(/300\s*÷[^，。\n]*/) ?? [''])[0],
  )
  check('建议里点名了「相遇问题」', all.includes('相遇问题'))
  check('没有出现「千米/时」写错成别的单位', !all.includes('千米/时/'))
  check(
    '没有套用通用模板当主要建议（步骤里应出现计算式）',
    r.correctSteps.some((s) => /[×÷]/.test(s.detail)),
  )
}

{
  const stem = '一个长方形的长是 8 米，宽是 5 米，求这个长方形的面积和周长。'
  const r = localAnalyze({ subject: '数学', stem, myAnswer: '40', correctAnswer: '40平方米', grade: '初一', difficulty: 3 })
  const all = [...r.correctSteps.map((s) => s.detail), ...r.tips].join('\n')

  check('长方形题算出了面积 8 × 5 = 40', /8\s*×\s*5\s*=\s*40/.test(all), (all.match(/8\s*×[^，。\n]*/) ?? [''])[0])
  check('算出了周长 2 × (8 + 5) = 26', /2\s*×\s*\(\s*8\s*\+\s*5\s*\)\s*=\s*26/.test(all))
  check('单位用的是题干的「米」而不是「千米」', all.includes('8 米') && !all.includes('8 千米'))
  check('面积单位正确（平方米）', all.includes('40 平方米'))
}

/* ======================================================================== */
console.log('\n\x1b[1m二之二、立体图形（体积/表面积）不能被当成面积题\x1b[0m')

{
  // 「表面积」里有「面积」两个字。正则里 `|` 优先级最低，
  // 否定环视只管第一个分支 —— 不小心就会把体积题判成面积题，
  // 然后拿面积公式去讲体积题。
  const box = '一个长方体长5厘米，宽3厘米，高4厘米，体积是多少立方厘米？'
  const r1 = localAnalyze({ subject: '数学', stem: box, myAnswer: '40', correctAnswer: '60', grade: '初一', difficulty: 3 })
  const all1 = [...r1.correctSteps.map((s) => s.detail), ...r1.tips].join('\n')
  check('长方体体积题认出「立体图形体积与表面积」',
    r1.knowledgePoints.some((k) => /立体图形/.test(k.name)), JSON.stringify(r1.knowledgePoints.map((k) => k.name)))
  check('算出了体积 5 × 3 × 4 = 60', /5\s*×\s*3\s*×\s*4\s*=\s*60/.test(all1), (all1.match(/5\s*×[^，。\n]*/) ?? [''])[0])
  check('体积单位是「立方厘米」', all1.includes('60 立方厘米'))

  const cube = '一个正方体的棱长是2分米，它的表面积是多少平方分米？'
  const r2 = localAnalyze({ subject: '数学', stem: cube, myAnswer: '20', correctAnswer: '24', grade: '初一', difficulty: 3 })
  const all2 = [...r2.correctSteps.map((s) => s.detail), ...r2.tips].join('\n')
  check('正方体表面积题也走立体图形模型',
    r2.knowledgePoints.some((k) => /立体图形/.test(k.name)), JSON.stringify(r2.knowledgePoints.map((k) => k.name)))
  check('算出了表面积 6 × 2² = 24', /6\s*×\s*2/.test(all2) && /24/.test(all2), (all2.match(/6\s*×[^，。\n]*/) ?? [''])[0])

  // 反向：平面面积题**不能**被立体图形抢走
  const flat = '一个长方形长8米，宽5米，面积是多少平方米？'
  const r3 = localAnalyze({ subject: '数学', stem: flat, myAnswer: '40', correctAnswer: '40平方米', grade: '初一', difficulty: 3 })
  // 注意：知识点名可能来自 OCR 启发式（"面积与周长"），
  // 也可能来自模型（"几何面积与周长"）—— 两者按别名去重，只会留一个。
  check('平面面积题仍走平面几何模型',
    r3.knowledgePoints.some((k) => /面积与周长/.test(k.name))
    && !r3.knowledgePoints.some((k) => /立体图形/.test(k.name)),
    JSON.stringify(r3.knowledgePoints.map((k) => k.name)))
}

/* ======================================================================== */
console.log('\n\x1b[1m二之三、知识点是对象数组时不能被过滤掉\x1b[0m')

{
  // AI 分析结果里的 knowledgePoints 是**对象数组**（{name, confidence, level}）。
  // 之前 inferKnowledgePoints 只留字符串，对象数组会被整个过滤掉 ——
  // 模型识别出来的知识点全丢了。
  const stem = '甲乙两地相距300千米，两车相向而行，速度分别是60和40千米每小时，几小时相遇？'
  const r = localAnalyze({
    subject: '数学',
    stem,
    knowledgePoints: [{ name: '相遇问题', confidence: 0.91, level: '难点' }],
    myAnswer: '2', correctAnswer: '3', grade: '初一', difficulty: 3,
  })
  check('对象数组形式的知识点被保留', r.knowledgePoints.some((k) => /相遇/.test(k.name)),
    JSON.stringify(r.knowledgePoints.map((k) => k.name)))
  check('没有出现 [object Object]', !JSON.stringify(r).includes('[object Object]'))
}

/* ======================================================================== */
console.log('\n\x1b[1m三、答案一致时不能把错因说得那么肯定\x1b[0m')

{
  const stem = '一个长方形的长是 8 米，宽是 5 米，求它的面积和周长。'
  const same = localAnalyze({ subject: '数学', stem, myAnswer: '40', correctAnswer: '40', grade: '初一', difficulty: 3 })
  const diff = localAnalyze({ subject: '数学', stem, myAnswer: '13', correctAnswer: '40', grade: '初一', difficulty: 3 })

  check(
    '答案一致 → 把握度被压到 0.6 以下',
    same.diagnosis.confidence < 0.6,
    `把握 ${same.diagnosis.confidence}`,
  )
  check(
    '答案不一致 → 把握度更高',
    diff.diagnosis.confidence > same.diagnosis.confidence,
    `${diff.diagnosis.confidence} > ${same.diagnosis.confidence}`,
  )
  check(
    '答案一致时说明里承认「看不到过程」',
    /看不到|无法确定|建议对照原卷/.test(same.diagnosis.reason + same.diagnosis.evidence.join('')),
  )
  check(
    '答案一致时不应断言「过程分被扣」',
    !/因此过程分被扣/.test(same.diagnosis.reason),
  )
}

{
  const r = localAnalyze({
    subject: '数学',
    stem: '小明和小华同时从甲地出发相向而行，甲乙两地相距 300 千米，小明每小时行 60 千米，小华每小时行 40 千米，几小时后两人相遇？',
    myAnswer: '',
    correctAnswer: '3',
    grade: '初一',
    difficulty: 3,
  })
  check('没作答 → 证据里点明「未作答」', r.diagnosis.evidence.some((e) => e.includes('作答为空') || e.includes('未作答')))
}

/* ======================================================================== */
console.log('\n\x1b[1m四、认不出来时要老实，不能硬编\x1b[0m')

{
  const stem = '这是一道没有任何特征的题目，请写出你的答案。'
  const m = detectProblemModel(stem, '数学')
  check('无特征题干 → 不给出模型', m === null, m ? `硬编成了 ${m.key}` : '')

  const r = localAnalyze({ subject: '数学', stem, myAnswer: 'x', correctAnswer: 'y', grade: '初一', difficulty: 3 })
  check('无模型时退回通用步骤（仍然可用）', Array.isArray(r.correctSteps) && r.correctSteps.length > 0)
  check(
    '无模型时不会硬编具体算式',
    !r.correctSteps.some((s) => /=\s*\d/.test(s.detail) && /÷|×/.test(s.detail)),
  )
}

{
  // 「既有相遇又有追及特征」→ 应当降低把握度而不是乱选
  const stem = '两人相向而行，同时甲又从后面出发去追乙，问谁先到。'
  const m = detectProblemModel(stem, '数学')
  check(
    '特征打架时把握度被压低（标记为 ambiguous）',
    !m || m.ambiguous || m.confidence < 0.7,
    m ? `confidence=${m.confidence} ambiguous=${m.ambiguous}` : '未识别',
  )
}

/* ======================================================================== */
console.log('\n\x1b[1m五、数值抽取\x1b[0m')

{
  const q = extractQuantities('甲乙两地相距 300 千米，小明每小时行 60 千米，小华每小时行 40 千米')
  const speeds = q.filter((x) => x.label === 'speed').map((x) => x.value)
  const dist = q.filter((x) => x.label === 'distance').map((x) => x.value)
  check('速度抽出来了', speeds.includes(60) && speeds.includes(40), JSON.stringify(speeds))
  check('距离抽出来了', dist.includes(300), JSON.stringify(dist))
  check('单位没丢', q.every((x) => Boolean(x.unit)))
}

/* ======================================================================== */
console.log(
  `\n\x1b[1m结果：${passed} 通过 / ${failed} 失败\x1b[0m` +
    (failed ? `\n\x1b[31m失败项：\x1b[0m\n${failures.map((f) => `  - ${f}`).join('\n')}` : ''),
)

if (process.argv.includes('--assert') && failed) process.exit(1)
process.exit(failed ? 1 : 0)
