/**
 * scripts/test-solution-figure.mjs —— 解题步骤图形生成的单元测试
 * ============================================================================
 * 跑法：npm run test:figure
 *
 * 这些函数是**纯函数**（不读环境、不发请求），所以可以直接单测。
 * 图形推导错了比没有图更糟 —— 宁可少给一张，也不能给一张错的。
 */

import assert from 'node:assert/strict'
import {
  buildFigureForStep,
  attachFigures,
  parseAnswerValue,
  firstNumber,
  allNumbers,
  toHalfWidth,
} from '../server/solutionFigure.js'

let pass = 0
let fail = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    pass++
    process.stdout.write('  \x1b[32m✓\x1b[0m ' + name + '\n')
  } catch (err) {
    fail++
    failures.push({ name, err })
    process.stdout.write('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + (err?.message ?? err) + '\n')
  }
}

console.log('\n\x1b[1m结果：\x1b[0m 数字与答案解析')
// ---------------------------------------------------------------- 数字解析
check('全角数字转半角', () => {
  assert.equal(toHalfWidth('１２３'), '123')
  assert.equal(toHalfWidth('１２．５'), '12.5')
  assert.equal(toHalfWidth('－３'), '-3')
})

check('抽第一个数字', () => {
  assert.equal(firstNumber('速度是 60 千米/时'), 60)
  assert.equal(firstNumber('负数 -3.5 米'), -3.5)
  assert.equal(firstNumber('没有数字'), null)
})

check('抽所有数字', () => {
  assert.deepEqual(allNumbers('甲 60 乙 40'), [60, 40])
})

check('解析答案：小数', () => {
  const r = parseAnswerValue('12.5')
  assert.equal(r.kind, 'number')
  assert.equal(r.value, 12.5)
})

check('解析答案：分数 a/b', () => {
  const r = parseAnswerValue('3/4')
  assert.equal(r.kind, 'fraction')
  assert.equal(r.value, 0.75)
})

check('解析答案：百分数', () => {
  const r = parseAnswerValue('75%')
  assert.equal(r.kind, 'percent')
  assert.equal(r.value, 0.75)
})

check('解析答案：比 3:4', () => {
  const r = parseAnswerValue('3:4')
  assert.equal(r.kind, 'ratio')
  assert.equal(r.value, 0.75)
})

check('解析答案：带单位', () => {
  const r = parseAnswerValue('120千米/时')
  assert.equal(r.kind, 'number')
  assert.equal(r.value, 120)
})

check('解析答案：空', () => {
  assert.equal(parseAnswerValue('').value, null)
  assert.equal(parseAnswerValue(null).value, null)
})

console.log('\n\x1b[1m结果：\x1b[0m 图形推导')
// ---------------------------------------------------------------- 图形推导
check('方程步骤 → 等式链', () => {
  const f = buildFigureForStep(
    { title: '解方程', detail: '2x + 6 = 18，移项得 2x = 12' },
    { subject: '数学', stem: '2x+6=18' },
  )
  assert.equal(f?.kind, 'equation')
  assert.ok(f.equation.steps.length >= 1)
})

check('分数步骤 → 分数条', () => {
  const f = buildFigureForStep(
    { title: '求分数', detail: '3/4 化成百分数是 75%' },
    { subject: '数学', stem: '3/4' },
  )
  assert.equal(f?.kind, 'fraction')
})

check('比值步骤 → 条形对比', () => {
  const f = buildFigureForStep(
    { title: '求比', detail: '甲乙两数的比是 3:4' },
    { subject: '数学', stem: '3:4' },
  )
  assert.equal(f?.kind, 'bar')
  assert.equal(f.bar.items.length, 2)
})

check('几何步骤 → 几何图', () => {
  const f = buildFigureForStep(
    { title: '求面积', detail: '三角形的底和高' },
    { subject: '数学', stem: '一个三角形' },
  )
  assert.equal(f?.kind, 'geometry')
  assert.equal(f.geometry.shape, 'triangle')
})

check('行程步骤 + 数值答案 → 数轴', () => {
  const f = buildFigureForStep(
    { title: '求速度', detail: '相遇问题，速度和时间' },
    { subject: '数学', stem: '两车相遇', correctAnswer: '60', myAnswer: '50' },
  )
  assert.equal(f?.kind, 'numberLine')
  assert.equal(f.numberLine.points.length, 2)
  assert.ok(f.numberLine.from < f.numberLine.to)
})

check('数轴的点按数值排序且带标签', () => {
  const f = buildFigureForStep(
    { title: '比较大小', detail: '哪个数更大' },
    { subject: '数学', stem: '比较大小', correctAnswer: '10', myAnswer: '3' },
  )
  assert.equal(f.kind, 'numberLine')
  const pts = f.numberLine.points
  assert.equal(pts[0].label, '正确')
  assert.equal(pts[1].label, '我的')
  assert.ok(f.numberLine.from <= Math.min(...pts.map((p) => p.at)))
  assert.ok(f.numberLine.to >= Math.max(...pts.map((p) => p.at)))
})

check('正确答案与我的答案相同时数轴只有一个点', () => {
  const f = buildFigureForStep(
    { title: '求速度', detail: '相遇问题' },
    { subject: '数学', stem: '相遇', correctAnswer: '60', myAnswer: '60' },
  )
  assert.equal(f.numberLine.points.length, 1)
})

check('推不出图形时返回 null（宁缺毋滥）', () => {
  const f = buildFigureForStep(
    { title: '通读题目', detail: '先把题意读明白' },
    { subject: '语文', stem: '阅读短文并回答问题' },
  )
  assert.equal(f, null)
})

check('非数学学科不生成几何图', () => {
  const f = buildFigureForStep(
    { title: '求面积', detail: '三角形的面积' },
    { subject: '语文', stem: '三角形' },
  )
  assert.equal(f, null)
})

check('图形数据是 JSON 可序列化的', () => {
  const f = buildFigureForStep(
    { title: '解方程', detail: '2x + 6 = 18' },
    { subject: '数学', stem: '2x+6=18' },
  )
  assert.doesNotThrow(() => JSON.stringify(f))
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f)
})

console.log('\n\x1b[1m结果：\x1b[0m 批量挂图')
// ---------------------------------------------------------------- 批量
check('attachFigures 保留原有字段', () => {
  const out = attachFigures([{ title: 'a', detail: 'b' }], { subject: '数学' })
  assert.equal(out[0].title, 'a')
  assert.equal(out[0].detail, 'b')
})

check('attachFigures 不修改入参（纯函数）', () => {
  const input = [{ title: 'a', detail: 'b' }]
  const snapshot = JSON.stringify(input)
  attachFigures(input, { subject: '数学', stem: '2x+6=18' })
  assert.equal(JSON.stringify(input), snapshot)
})

check('attachFigures 处理空数组', () => {
  assert.deepEqual(attachFigures([], {}), [])
  assert.deepEqual(attachFigures(null, {}), [])
})

check('attachFigures 逐个推导', () => {
  const out = attachFigures(
    [
      { title: '解方程', detail: '2x + 6 = 18' },
      { title: '通读题意', detail: '读明白题目' },
    ],
    { subject: '数学', stem: '2x+6=18' },
  )
  assert.equal(out[0].figure?.kind, 'equation')
  assert.equal(out[1].figure, undefined)
})

console.log('\n\x1b[1m结果：\x1b[0m 边界情况')
// ---------------------------------------------------------------- 边界
check('答案不是数字时不崩', () => {
  const f = buildFigureForStep(
    { title: '解方程', detail: '2x + 6 = 18' },
    { subject: '数学', stem: '2x+6=18', correctAnswer: '无法确定', myAnswer: '' },
  )
  assert.ok(f === null || typeof f === 'object')
})

check('step 为空对象时不崩', () => {
  assert.doesNotThrow(() => buildFigureForStep({}, {}))
  assert.doesNotThrow(() => buildFigureForStep(undefined, undefined))
})

check('分母为 0 的分数不产生图', () => {
  const f = buildFigureForStep(
    { title: '求分数', detail: '1/0 这种' },
    { subject: '数学', stem: '1/0' },
  )
  // 不该产生一个除零的图形
  if (f?.kind === 'fraction') assert.notEqual(f.fraction.denominator, 0)
})

check('NaN 不会进图形', () => {
  const f = buildFigureForStep(
    { title: '求速度', detail: '速度' },
    { subject: '数学', stem: '速度', correctAnswer: 'abc', myAnswer: 'xyz' },
  )
  if (f?.kind === 'numberLine') {
    for (const p of f.numberLine.points) assert.ok(Number.isFinite(p.at))
  }
})

// ---------------------------------------------------------------- 汇总
/* ⭐ **零断言不是「通过」** ——
 * 一个测试跑出 **0 条断言**，通常意味着它**什么都没测就退出了**。
 * 那是**静默失败** —— CI 会显示绿的，而实际上**什么都没验**。
 * 所以：**0 条断言 = 失败**。 */
if (pass + fail === 0) {
  console.log('\n\x1b[31m⛔ 一条断言都没跑 —— 不算通过（这是「静默失败」的形状）\x1b[0m')
  process.exit(1)
}

console.log(`\n\x1b[1m结果：\x1b[0m ${pass} 通过 / ${fail} 失败`)
if (fail > 0) {
  console.log('\n失败详情：')
  for (const f of failures) {
    console.log(`\n  \x1b[31m✗\x1b[0m ${f.name}`)
    console.log('    ' + (f.err?.stack ?? f.err?.message ?? f.err))
  }
  process.exit(1)
}
console.log('\x1b[32m全部通过\x1b[0m')
