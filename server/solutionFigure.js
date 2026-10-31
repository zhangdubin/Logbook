/**
 * server/solutionFigure.js —— 解题步骤的**图形化数据**生成
 * ============================================================================
 * 目标：让「解题步骤」不只是文字，能配一张**看得懂的示意图**。
 *
 * ── 为什么不让大模型来生成图形？ ──────────────────────────────────────────
 * 模型画图极不稳：坐标会飘、标签会错、格式每次不一样，
 * 而且出了错没法复现。而**图形这件事本身是确定性的** ——
 * 「这题讲的是行程问题，答案 120 千米/时」→ 数轴上就该有 120 这个点。
 *
 * 所以规则是：**图形由代码从题目数据推导，模型只负责文字。**
 * 推导不出来就**不生成图**（宁缺毋滥 —— 画错的图比没图更糟）。
 *
 * ── 支持的图形类型 ───────────────────────────────────────────────────────
 *   numberLine  数轴：方程的解、正负、行程、比较大小
 *   fraction    分数/百分数条：几分之几、占比
 *   bar         条形对比：比、倍数、谁多谁少
 *   geometry    几何示意图：三角形 / 矩形 / 圆 / 平行线
 *   equation    等式变形链：一步一步的算式
 *
 * 所有函数都是**纯函数**（不读环境、不发请求），可以单测。
 */

// ---------------------------------------------------------------------------
// 数字提取
// ---------------------------------------------------------------------------

/** 把全角数字/符号转成半角，方便后面解析 */
export function toHalfWidth(s) {
  return String(s ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[－−–—]/g, '-')
    .replace(/[，]/g, ',')
}

/** 抽出一个字符串里的第一个数字（支持小数、负数、百分号） */
export function firstNumber(text) {
  const s = toHalfWidth(text)
  const m = s.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const v = Number(m[0])
  return Number.isFinite(v) ? v : null
}

/** 抽出字符串里的所有数字 */
export function allNumbers(text) {
  const s = toHalfWidth(text)
  const out = []
  const re = /-?\d+(?:\.\d+)?/g
  let m
  while ((m = re.exec(s)) !== null) {
    const v = Number(m[0])
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

/**
 * 把 LaTeX 片段**降级成可读的纯文本**。
 *
 * SVG 里没法渲染 LaTeX（那是 KaTeX 的活，前端组件负责）。
 * 但图上的**标签**得是学生看得懂的：
 *   $\frac{3}{4}$  → 3/4
 *   $2x + 6 = 18$ → 2x + 6 = 18
 *   $\sqrt{9}$    → √(9)
 * 不能降级的（渲染失败会露馅）就**去掉美元符号**，至少不显示成源码。
 */
export function stripLatex(text) {
  return toHalfWidth(text)
    .replace(/\$\$/g, '')
    .replace(/\$/g, '')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\times|\\cdot|\\ast/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\pm/g, '±')
    .replace(/\\leq|\\le/g, '≤')
    .replace(/\\geq|\\ge/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\left|\\right/g, '')
    .replace(/\\mathrm\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\text\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\quad|\\qquad/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\{([^{}]*)\}/g, '$1')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 解析「答案」里的数值。
 * 支持：120、120km、1/2、0.5、50%、3:4
 * @returns {{value: number|null, kind: 'number'|'fraction'|'percent'|'ratio'|null, numerator?: number, denominator?: number}}
 */
export function parseAnswerValue(text) {
  const s = stripLatex(text).replace(/\s+/g, '')
  if (!s) return { value: null, kind: null }
  // 百分比 50%
  let m = s.match(/^(-?\d+(?:\.\d+)?)%$/)
  if (m) return { value: Number(m[1]) / 100, kind: 'percent', numerator: Number(m[1]), denominator: 100 }

  // 比 3:4
  m = s.match(/^(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/)
  if (m && Number(m[2]) !== 0) {
    return { value: Number(m[1]) / Number(m[2]), kind: 'ratio', numerator: Number(m[1]), denominator: Number(m[2]) }
  }

  // 分数 a/b
  m = s.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/)
  if (m && Number(m[2]) !== 0) {
    return { value: Number(m[1]) / Number(m[2]), kind: 'fraction', numerator: Number(m[1]), denominator: Number(m[2]) }
  }

  // 纯数值（可带单位）
  m = s.match(/^(-?\d+(?:\.\d+)?)/)
  if (m) return { value: Number(m[1]), kind: 'number' }

  return { value: null, kind: null }
}

// ---------------------------------------------------------------------------
// 关键词判定
// ---------------------------------------------------------------------------

const RE = {
  equation: /(方程|根|解是|解为|x\s*=|未知数|不等式|区间)/,
  fraction: /(几分之几|分数|分之|占.*%|百分之|百分比|占比)/,
  ratio: /(之比|的比|倍数|多.*几倍|比多少|谁多|谁少|相差)/,
  geometry: /(三角形|正方形|长方形|矩形|平行四边形|梯形|圆|平行线|垂直|全等|相似|周长|面积|底|高|对角线|弧度)/,
  timeline: /(行程|速度|相遇|追及|时间.*分|出发|到达|走了|骑|开车)/,
  compare: /(比较大小|从大到小|从小到大|排序|最大|最小|最小公倍数|最大公约数)/,
}

/** 文本里有没有命中某个关键词 */
function hit(text, re) {
  return re.test(toHalfWidth(text))
}

// ---------------------------------------------------------------------------
// 各种图形的生成
// ---------------------------------------------------------------------------

/**
 * 数轴：把一个（或几个）关键数值标在数轴上。
 * @param {number[]} values 要标出的点
 */
function numberLineFigure(values, labels = []) {
  const nums = values.filter((v) => Number.isFinite(v))
  if (nums.length === 0) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  // 数值太密集就放大范围，避免点挤在一起
  const pad = Math.max((max - min) * 0.25, Math.abs(max) * 0.2, 2)
  const from = Math.floor(min - pad)
  const to = Math.ceil(max + pad)
  const span = to - from || 1

  // 刻度间隔：找一个好看的步长
  const raw = span / 8
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag

  const points = nums.map((v, i) => ({
    at: v,
    label: labels[i] ?? String(v),
    tone: i === 0 ? 'a' : 'b',
  }))

  return { kind: 'numberLine', numberLine: { from, to, step, points } }
}

/**
 * 分数条 / 百分数条
 */
function fractionFigure(numerator, denominator, label) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return {
    kind: 'fraction',
    fraction: { numerator, denominator, label: label ?? `${numerator}/${denominator}` },
  }
}

/**
 * 条形对比
 */
function barFigure(items, unit) {
  const clean = (items ?? [])
    .map((it) => ({ label: String(it.label ?? ''), value: Number(it.value) }))
    .filter((it) => Number.isFinite(it.value))
  if (clean.length < 2) return null
  return { kind: 'bar', bar: { items: clean, unit } }
}

/**
 * 几何示意图（**示意**，不按真实比例** —— 免得画出来和题目对不上）
 */
function geometryFigure(shape, labels = []) {
  const shapes = new Set(['triangle', 'rect', 'circle', 'parallel'])
  if (!shapes.has(shape)) return null
  return { kind: 'geometry', geometry: { shape, labels } }
}

/**
 * 判断一段文字是不是**真等式**（而不是「求 x 的值」这种带等号的中文散文）。
 *
 * 为什么要单独判：题干里常混着散文，
 *   「解方程 2x + 6 = 18，求 x 的值」  ← 这段是等式
 *   「求 x 的值.已知 3/4 = 0.75」      ← 这段是散文，只是里面有个等号
 * 不判的话，图上会画出「求 x 的值 = 已知 3/4」这种鬼东西。
 *
 * 判据：等号**两边都不含中文**（中文书上的算式是纯数学符号 + 字母）。
 */
function looksLikeEquation(part) {
  const s = String(part ?? '').trim()
  if (!s.includes('=')) return false
  const sides = s.split('=')
  if (sides.length < 2 || sides.length > 3) return false
  for (const side of sides) {
    const t = side.trim()
    if (!t) return false
    // 含中文 → 是散文不是算式
    if (/[\u4e00-\u9fa5]/.test(t)) return false
    // 至少要有一个数学符号或数字（排除「a=b」之外的纯字母误判）
    if (!/[\d+\-*/^()=<>√×÷π]/.test(t)) return false
  }
  return true
}

/**
 * 从一段文字里找出所有**等式子串**。
 *
 * 题干里的等式常常夹在中文里：
 *   「解方程 2x + 6 = 18，求 x 的值」→ 要抽出「2x + 6 = 18」
 *   「已知 3/4 = 0.75」            → 要抽出「3/4 = 0.75」
 * 所以不能整句判，只能**先把等式子串抠出来**，再判它像不像算式。
 *
 * @returns {string[]}
 */
export function findEquations(text) {
  const s = toHalfWidth(text)
  // 两边都由「数学字符」组成的等式（中文进不来）
  const re = /[0-9A-Za-z()[\]{}+\-*/^=<>√×÷π.,%\s]{1,60}=[0-9A-Za-z()[\]{}+\-*/^=<>√×÷π.,%\s]{1,60}/g
  const out = []
  let m
  while ((m = re.exec(s)) !== null) {
    const cand = m[0].trim().replace(/\s+/g, ' ')
    if (looksLikeEquation(cand)) out.push(cand)
    // 防止零宽匹配导致死循环
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return out
}

/**
 * 等式变形链：把步骤里的一串等号拆成链条
 */
function equationFigure(text) {
  const s = toHalfWidth(text)
  // 找 a = b = c 或 a = b，b = c 这样的片段
  const parts = s
    .split(/[，,；;]/)
    .map((x) => x.trim())
    .filter((x) => x.includes('='))
    .filter(looksLikeEquation)
  if (parts.length === 0) return null
  const chain = parts.map((x) => x.replace(/\s*=\s*/g, ' = ').trim())
  // 至少要有一步是真的变形（含运算符）
  const hasOp = chain.some((x) => /[+\-*/×÷]/.test(x))
  if (!hasOp) return null
  return { kind: 'equation', equation: { steps: chain } }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 按**步骤的角色**决定画什么图，内容从题干/答案里取。
 *
 * 本地模板的步骤是通用话（「审题与标注条件」「列式分步计算」），
 * 步骤本身推不出图；但**角色**是明确的 —— 角色决定「画什么」，
 * 题干和答案提供「画什么内容」。
 *
 * @param {{title?: string, detail?: string}} step
 * @param {object} ctx
 * @returns {object|null}
 */
export function figureForRole(step = {}, ctx = {}) {
  const title = String(step.title ?? '')
  const stem = stripLatex(ctx.stem ?? '')
  const subject = String(ctx.subject ?? '')
  const correct = parseAnswerValue(ctx.correctAnswer ?? '')
  const mine = parseAnswerValue(ctx.myAnswer ?? '')

  // 「列式 / 解方程 / 建立关系」→ 画题干里那个等式
  if (hit(title, /(列式|解方程|建立关系|数量关系|计算|求解|代入)/)) {
    // 题干里的等式常夹在中文中（「解方程 2x + 6 = 18」），先抠出等式子串再判
    for (const eq of findEquations(stem)) {
      const fig = equationFigure(eq)
      if (fig) return fig
    }
    // 没有等式就退回「答案落在哪」—— 数轴
    if (correct.value !== null) {
      const values = [correct.value]
      const labels = ['正确']
      if (mine.value !== null && mine.value !== correct.value) {
        values.push(mine.value)
        labels.push('我的')
      }
      const fig = numberLineFigure(values, labels)
      if (fig) return fig
    }
  }

  // 「检验 / 作答 / 结论」→ 画答案（和学生的答案）在哪
  if (hit(title, /(检验|作答|结论|答案|回代)/)) {
    const values = []
    const labels = []
    if (correct.value !== null) {
      values.push(correct.value)
      labels.push('正确')
    }
    if (mine.value !== null && mine.value !== correct.value) {
      values.push(mine.value)
      labels.push('我的')
    }
    if (values.length) {
      const fig = numberLineFigure(values, labels)
      if (fig) return fig
    }
  }

  // 「审题 / 条件」→ 题干里有比就画比，有分数就画分数
  if (hit(title, /(审题|条件|已知|理解)/)) {
    const ratio = stem.match(/(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)/)
    if (ratio) {
      const fig = barFigure(
        [{ label: '前者', value: Number(ratio[1]) }, { label: '后者', value: Number(ratio[2]) }],
        '',
      )
      if (fig) return fig
    }
    const frac = stem.match(/(\d+)\s*\/\s*(\d+)/)
    if (frac) {
      const fig = fractionFigure(Number(frac[1]), Number(frac[2]), `${frac[1]}/${frac[2]}`)
      if (fig) return fig
    }
    // 几何题先认形状
    if (hit(stem, RE.geometry) && (subject === '数学' || subject === '物理')) {
      let shape = null
      if (hit(stem, /三角形/)) shape = 'triangle'
      else if (hit(stem, /正方形|长方形|矩形|平行四边形|梯形/)) shape = 'rect'
      else if (hit(stem, /圆/)) shape = 'circle'
      else if (hit(stem, /平行线/)) shape = 'parallel'
      const fig = geometryFigure(shape)
      if (fig) return fig
    }
  }

  return null
}

/**
 * 给一个解题步骤推导图形。
 *
 * @param {object} p
 * @param {{title?: string, detail?: string}} p.step
 * @param {object} p.ctx
 * @param {string} [ctx.subject]     学科
 * @param {string} [ctx.stem]        题干
 * @param {string} [ctx.correctAnswer] 正确答案
 * @param {string} [ctx.myAnswer]    学生答案
 * @param {string} [ctx.questionType] 题型
 * @returns {object|null} figure 数据，null 表示这一步不需要图
 */
export function buildFigureForStep(step = {}, ctx = {}) {
  const text = `${step.title ?? ''} ${step.detail ?? ''}`
  const subject = String(ctx.subject ?? '')
  const stem = String(ctx.stem ?? '')
  const correct = parseAnswerValue(ctx.correctAnswer ?? '')
  const mine = parseAnswerValue(ctx.myAnswer ?? '')
  const all = `${text} ${stem}`

  // 1) 等式变形 —— 最明确，优先
  if (hit(text, /(解|列|得|所以|即|代入|化简|移项|去分母|约分)/) && text.includes('=')) {
    const fig = equationFigure(text)
    if (fig) return fig
  }

  // 1b) **步骤的角色**决定了该配什么图。
  //
  // 为什么要这一段：本地模板给的步骤是「审题与标注条件」「列式分步计算」这种
  // **通用话**，本身没有数字，从步骤文本推不出图 —— 于是大部分题都配不上图，
  // 功能等于白做。但步骤的**角色**是明确的：
  //   「列式分步计算」→ 该画等式
  //   「检验与作答」  → 该画答案落在哪
  //   「分析数量关系」→ 该画比/倍数对比
  // 所以：**角色决定画什么，内容从题干里取**。
  const roleFig = figureForRole(step, ctx)
  if (roleFig) return roleFig

  // 2) 分数 / 百分数
  if (hit(all, RE.fraction)) {
    const cand = correct.kind === 'fraction' ? correct
      : mine.kind === 'fraction' ? mine
        : (() => {
            // 从文字里找「a/b」或「x%」
            const m = toHalfWidth(all).match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/)
            if (m) return { numerator: Number(m[1]), denominator: Number(m[2]), kind: 'fraction' }
            const p = toHalfWidth(all).match(/(-?\d+(?:\.\d+)?)\s*%/)
            if (p) return { numerator: Number(p[1]), denominator: 100, kind: 'percent' }
            return { kind: null }
          })()
    if (cand.kind === 'fraction' && cand.denominator) {
      const fig = fractionFigure(cand.numerator, cand.denominator, `${cand.numerator}/${cand.denominator}`)
      if (fig) return fig
    }
  }

  // 3) 比 / 倍数 → 条形对比
  if (hit(all, RE.ratio)) {
    const ratio = toHalfWidth(all).match(/(-?\d+(?:\.\d+)?)\s*[:：]\s*(-?\d+(?:\.\d+)?)/)
    if (ratio) {
      const a = Number(ratio[1])
      const b = Number(ratio[2])
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const fig = barFigure(
          [{ label: '前者', value: a }, { label: '后者', value: b }],
          '',
        )
        if (fig) return fig
      }
    }
  }

  // 4) 几何
  if (hit(all, RE.geometry) && (subject === '数学' || subject === '物理')) {
    let shape = null
    if (hit(all, /三角形/)) shape = 'triangle'
    else if (hit(all, /正方形|长方形|矩形|平行四边形|梯形/)) shape = 'rect'
    else if (hit(all, /圆/)) shape = 'circle'
    else if (hit(all, /平行线/)) shape = 'parallel'
    const fig = geometryFigure(shape)
    if (fig) return fig
  }

  // 5) 数轴：方程/不等式/行程/比较大小，且能拿到数值
  if (hit(all, RE.equation) || hit(all, RE.timeline) || hit(all, RE.compare)) {
    const values = []
    const labels = []
    if (correct.value !== null) {
      values.push(correct.value)
      labels.push('正确')
    }
    if (mine.value !== null && mine.value !== correct.value) {
      values.push(mine.value)
      labels.push('我的')
    }
    if (values.length === 0) {
      // 题干里找个数顶上
      const n = firstNumber(text)
      if (n !== null) {
        values.push(n)
        labels.push('')
      }
    }
    const fig = numberLineFigure(values, labels)
    if (fig) return fig
  }

  // 6) 兜底：题干是行程题且步骤里出现速度/时间 → 数轴
  if (hit(all, RE.timeline)) {
    const nums = allNumbers(text)
    if (nums.length >= 1) {
      const fig = numberLineFigure(nums.slice(0, 2), ['', ''])
      if (fig) return fig
    }
  }

  return null
}

/**
 * 给整组步骤批量挂上图形。
 *
 * @param {Array<{title?: string, detail?: string}>} steps
 * @param {object} ctx
 * @returns {Array} 每一步多一个可选的 figure 字段
 */
export function attachFigures(steps = [], ctx = {}) {
  if (!Array.isArray(steps)) return []
  return steps.map((step, index) => {
    const figure = buildFigureForStep(step, ctx)
    return figure ? { ...step, figure } : { ...step }
  })
}

export default { buildFigureForStep, attachFigures, parseAnswerValue, firstNumber, allNumbers, toHalfWidth }
