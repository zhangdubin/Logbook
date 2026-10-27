/**
 * server/seed.js —— 种子数据（npm run seed）
 *
 * 生成 3 名学生（小学四年级 / 初中初二 / 初三），每人 60~90 道贴近真实教辅的错题，
 * 覆盖数学 / 语文 / 英语（初二含物理、生物、地理；初三含物理、化学、道法）。
 *
 * 同时补建 3 个演示账号：teacher / parent / student（口令 `<角色>123`），
 * 并把它们与演示学生关联起来（教师=全部，家长/学生=第一个）。
 *
 * 幂等：每次运行先清空 questions / students，再重新写入，不会产生重复数据；
 * 演示账号**已存在则不覆盖口令**。
 */

import { db, uid, nowISO } from './db.js'
import { hashPassword, ensureAdminUser } from './auth.js'

/* ========================================================================== */
/* 随机工具                                                                    */
/* ========================================================================== */

let seedState = 20261026
/** 可复现的伪随机（xorshift32），保证多次运行分布稳定 */
function rnd() {
  seedState ^= seedState << 13
  seedState ^= seedState >>> 17
  seedState ^= seedState << 5
  seedState >>>= 0
  return seedState / 0xffffffff
}
const ri = (min, max) => min + Math.floor(rnd() * (max - min + 1))
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p

/* ========================================================================== */
/* 文案库                                                                      */
/* ========================================================================== */

const SOURCES = ['单元测试卷', '课堂练习册', '期中考试卷', '课后习题', '周末测试卷', '单元过关卷', '课堂小测', '模拟卷']

const TAGS = ['重点', '易错', '考试', '作业', '复习', '课堂', '提升', '基础']

const ERROR_DETAIL_BANK = {
  knowledge_gap: (kp) => `本题考查「${kp}」的核心方法，概念没有真正掌握，看到题目无法把条件转成对应的解题步骤。`,
  misread: (kp) => `审题时忽略了题目中的关键限定条件，把「${kp}」的所求对象理解错了。`,
  calculation: (kp) => `解题方向正确，但在「${kp}」的运算过程中出现偏差，通分/小数点处理不严谨。`,
  method: (kp) => `「${kp}」的通用模型没有建立，选择了错误的解题路径，需要重新梳理思路。`,
  time: (kp) => `「${kp}」属于耗时题型，整卷时间分配不合理，题目没能在规定时间内完成。`,
  careless: (kp) => `「${kp}」的结论其实算对了，但抄写时看错符号、字母或数字，属于可避免的低级失误。`,
  expression: (kp) => `「${kp}」的结果正确，但缺少必要的中间步骤和单位书写，过程分被扣。`,
}

/** 错因权重：知识盲点与计算失误占比最高，符合真实情况 */
const ERROR_WEIGHTS = [
  ['knowledge_gap', 22],
  ['calculation', 20],
  ['careless', 16],
  ['misread', 12],
  ['method', 11],
  ['expression', 11],
  ['time', 8],
]

function pickErrorType() {
  const total = ERROR_WEIGHTS.reduce((a, [, w]) => a + w, 0)
  let r = rnd() * total
  for (const [type, w] of ERROR_WEIGHTS) {
    r -= w
    if (r <= 0) return type
  }
  return 'knowledge_gap'
}

/* ========================================================================== */
/* 错误答案生成                                                                */
/* ========================================================================== */

function mutateNumber(text, kind) {
  const m = String(text).match(/-?\d+(\.\d+)?/)
  if (!m) return text
  const num = Number(m[0])
  const raw = m[0]
  let next
  if (kind === 'careless') {
    if (raw.includes('.')) {
      const parts = raw.split('.')
      const last = String(parts[1]).slice(-1)
      next = `${parts[0]}.${parts[1].slice(0, -1)}${last === '9' ? '8' : String(Number(last) + 1)}`
    } else {
      next = String(num + (rnd() < 0.5 ? 1 : -1))
    }
    return text.replace(raw, next)
  }
  if (kind === 'calculation') {
    const delta = num === 0 ? 1 : Math.max(1, Math.round(Math.abs(num) * (0.05 + rnd() * 0.25)))
    next = String(num + (rnd() < 0.5 ? delta : -delta))
    return text.replace(raw, next)
  }
  // method / misread：给出另一个看似合理的数
  const factor = pick([0.5, 2, 1.5, 0.8, 1.2, 3])
  next = String(Math.round(num * factor * 100) / 100)
  return text.replace(raw, next)
}

/** 常见形近字错写表（模拟粗心抄错） */
const TYPO_MAP = {
  水: '永', 是: '事', 干: '千', 土: '士', 人: '入', 大: '太', 天: '夭', 日: '曰',
  王: '玉', 己: '已', 未: '末', 兔: '免', 刀: '力', 侯: '候', 睛: '晴', 蓝: '篮',
  抄: '妙', 幕: '慕', 沿: '治', 抱: '饱', 陡: '徒', 燥: '躁', 戴: '带', 辩: '辨',
}

/** 文字类（非数字）答案的"学生作答" */
const TEXT_WRONG = {
  语文: ['（只抄了原文，没有概括）', '（答成了上一问的内容）', '（理解偏差，答非所问）', '（只写了一个字）'],
  英语: ['（时态没判断对）', '（词形变化写错）', '（没写）', '（语序颠倒）'],
  数学: ['（不会）', '（算到一半不会了）', '（只写了式子没算）'],
  物理: ['（不会）', '（没画受力图，直接乱写）', '（公式不会用）'],
  化学: ['（不会配平）', '（没写反应条件）', '（化学式写错了一个字母）'],
  生物: ['（没背下来）', '（答成了别的内容）'],
  地理: ['（记混了）', '（没写）'],
  道法: ['（没背）', '（只写了一句）'],
}

/** 把文字答案改成"写错一个字"的版本，模拟粗心抄错 */
function mutateText(correct) {
  const s = String(correct ?? '')
  if (!s) return '（抄错了一个字）'
  const idx = s.length - 1
  const ch = s[idx]
  const typo = TYPO_MAP[ch]
  if (typo) return s.slice(0, idx) + typo
  // 英文等字母结尾：末尾字母打错
  if (/[a-zA-Z]/.test(ch)) {
    const lower = 'abcdefghijklmnopqrstuvwxyz'
    const i = lower.indexOf(ch.toLowerCase())
    const alt = lower[(i + 1) % 26]
    return s.slice(0, idx) + (ch === ch.toUpperCase() ? alt.toUpperCase() : alt)
  }
  // 其他情况：末尾漏写
  return s.slice(0, idx)
}

/** 根据错因生成"学生当时的作答" */
function makeWrongAnswer(correct, errorType, subject) {
  const isNumeric = /\d/.test(String(correct ?? ''))
  if (!isNumeric) {
    // 文字型答案：无法用数字变异，单独构造
    switch (errorType) {
      case 'knowledge_gap':
        return chance(0.6) ? '' : '不会'
      case 'careless':
        return mutateText(correct)
      case 'calculation':
        return '（只抄了题干里的原句）'
      case 'method':
        return pick(TEXT_WRONG[subject] ?? ['（答非所问）'])
      case 'misread':
        return pick(TEXT_WRONG[subject] ?? ['（答非所问）'])
      case 'time':
        return chance(0.5) ? '' : '（时间不够，未完成）'
      case 'expression':
        return correct // 结果对，但步骤缺失
      default:
        return ''
    }
  }
  switch (errorType) {
    case 'knowledge_gap':
      return chance(0.65) ? '' : '不会'
    case 'careless':
      return mutateNumber(correct, 'careless')
    case 'calculation':
      return mutateNumber(correct, 'calculation')
    case 'method':
      return mutateNumber(correct, 'method')
    case 'misread':
      return mutateNumber(correct, 'method')
    case 'time':
      return chance(0.5) ? '' : '（时间不够，未完成）'
    case 'expression':
      return correct // 结果对，但步骤缺失
    default:
      return ''
  }
}

/* ========================================================================== */
/* 题目模板                                                                    */
/* ========================================================================== */

/**
 * 每个模板返回一个"题目工厂"，可多次调用生成不同数据变体。
 * tags: 学科 | 模板名
 */
const TEMPLATES = []

function T(subject, gradeBand, name, build) {
  TEMPLATES.push({ subject, gradeBand, name, build })
}

/* ------------------------------- 数学 ------------------------------- */
T('数学', 'primary', '分数加减法', () => {
  const a = ri(2, 9)
  const b = ri(1, a)
  const den = pick([4, 5, 6, 8, 9, 10])
  const correct = `${a + b}/${den}`
  return {
    questionType: '计算题',
    knowledgePoints: ['分数四则运算'],
    stem: `计算：${a}/${den} + ${b}/${den} = ？`,
    myAnswer: '',
    correctAnswer: correct,
    difficulty: 2,
    points: 4,
  }
})

T('数学', 'primary', '异分母分数加法', () => {
  const d1 = pick([2, 3, 4])
  const d2 = pick([6, 8, 12])
  const n1 = ri(1, d1 - 1)
  const n2 = ri(1, d2 - 1)
  const lcm = d1 * d2 / gcd(d1, d2)
  const sum = (n1 * (lcm / d1) + n2 * (lcm / d2)) / lcm
  return {
    questionType: '计算题',
    knowledgePoints: ['分数四则运算'],
    stem: `计算：${n1}/${d1} + ${n2}/${d2} = ？`,
    myAnswer: '',
    correctAnswer: `${sum}/${lcm === 1 ? '' : lcm}`.replace('/1', ''),
    difficulty: 3,
    points: 4,
  }
})

T('数学', 'primary', '分数乘法', () => {
  const a = ri(1, 5)
  const b = ri(1, 5)
  const c = ri(2, 9)
  const num = a * b
  const den = c * 6
  const g = gcd(num, den)
  return {
    questionType: '计算题',
    knowledgePoints: ['分数四则运算'],
    stem: `计算：${a}/6 × ${b}/${c} = ？`,
    myAnswer: '',
    correctAnswer: g > 1 ? `${num / g}/${den / g}` : `${num}/${den}`,
    difficulty: 3,
    points: 4,
  }
})

T('数学', 'primary', '分数应用题（求几分之几）', () => {
  const total = pick([120, 180, 240, 300, 360, 450])
  const den = pick([3, 4, 5, 6, 8])
  const num = ri(1, den - 1)
  const ans = (total * num) / den
  return {
    questionType: '应用题',
    knowledgePoints: ['分数应用题'],
    stem: `果园里有苹果树 ${total} 棵，其中红富士占总数的 ${num}/${den}，红富士有多少棵？`,
    myAnswer: '',
    correctAnswer: `${ans} 棵`,
    difficulty: 3,
    points: 5,
  }
})

T('数学', 'primary', '分数应用题（已知部分求总数）', () => {
  const den = pick([3, 4, 5, 6])
  const num = ri(1, den - 1)
  const part = pick([12, 18, 24, 30, 36, 45])
  const total = (part * den) / num
  return {
    questionType: '应用题',
    knowledgePoints: ['分数应用题'],
    stem: `一本书共 ${part} 页，已经看了全书的 ${num}/${den}，这本书一共有多少页？`,
    myAnswer: '',
    correctAnswer: `${total} 页`,
    difficulty: 4,
    points: 5,
  }
})

T('数学', 'primary', '行程问题（相遇）', () => {
  const v1 = pick([45, 50, 55, 60])
  const v2 = pick([35, 40, 45])
  const t = pick([2, 3, 4])
  const total = (v1 + v2) * t
  return {
    questionType: '应用题',
    knowledgePoints: ['行程问题'],
    stem: `甲、乙两地相距 ${total} 千米，两车同时从两地相对开出，甲车每小时行 ${v1} 千米，乙车每小时行 ${v2} 千米，几小时后两车相遇？`,
    myAnswer: '',
    correctAnswer: `${t} 小时`,
    difficulty: 3,
    points: 5,
  }
})

T('数学', 'primary', '速度时间路程', () => {
  const v = pick([60, 70, 80, 90])
  const t = pick([2.5, 3, 4, 1.5])
  const s = v * t
  return {
    questionType: '应用题',
    knowledgePoints: ['行程问题'],
    stem: `一辆汽车以每小时 ${v} 千米的速度行驶 ${t} 小时，一共行驶了多少千米？`,
    myAnswer: '',
    correctAnswer: `${s} 千米`,
    difficulty: 2,
    points: 4,
  }
})

T('数学', 'primary', '长方形面积与周长', () => {
  const a = ri(5, 15)
  const b = ri(3, 12)
  return {
    questionType: '解答题',
    knowledgePoints: ['面积与周长'],
    stem: `一个长方形的长是 ${a} 厘米，宽是 ${b} 厘米，它的面积和周长各是多少？`,
    myAnswer: '',
    correctAnswer: `面积 ${a * b} 平方厘米，周长 ${(a + b) * 2} 厘米`,
    difficulty: 2,
    points: 5,
  }
})

T('数学', 'primary', '三角形面积', () => {
  const base = ri(6, 14)
  const h = pick([4, 5, 6, 8])
  const s = (base * h) / 2
  return {
    questionType: '解答题',
    knowledgePoints: ['面积与周长'],
    stem: `一个三角形的底是 ${base} 厘米，高是 ${h} 厘米，它的面积是多少平方厘米？`,
    myAnswer: '',
    correctAnswer: `${s} 平方厘米`,
    difficulty: 3,
    points: 5,
  }
})

T('数学', 'primary', '简便计算', () => {
  const a = pick([25, 125])
  const b = pick([32, 88])
  const ans = a * b
  return {
    questionType: '计算题',
    knowledgePoints: ['运算定律与简便计算'],
    stem: `用简便方法计算：${a} × ${b} = ？`,
    myAnswer: '',
    correctAnswer: String(ans),
    difficulty: 3,
    points: 4,
  }
})

T('数学', 'primary', '平均数', () => {
  const n = pick([4, 5, 6])
  const arr = Array.from({ length: n }, () => ri(60, 100))
  const avg = arr.reduce((a, b) => a + b, 0) / n
  return {
    questionType: '解答题',
    knowledgePoints: ['统计与可能性'],
    stem: `${ri(4, 6)} 名同学的成绩分别是 ${arr.join('、')} 分，他们的平均分是多少？`,
    myAnswer: '',
    correctAnswer: `${avg} 分`,
    difficulty: 2,
    points: 4,
  }
})

T('数学', 'primary', '可能性', () => {
  const red = ri(2, 5)
  const white = ri(3, 6)
  return {
    questionType: '解答题',
    knowledgePoints: ['统计与可能性'],
    stem: `盒子里有 ${red} 个红球和 ${white} 个白球，任意摸出一个，摸到红球的可能性是多少？`,
    myAnswer: '',
    correctAnswer: `${red}/${red + white}`,
    difficulty: 3,
    points: 4,
  }
})

T('数学', 'primary', '三角形内角和', () => {
  const a = ri(30, 80)
  const b = ri(30, 80)
  return {
    questionType: '解答题',
    knowledgePoints: ['三角形内角和'],
    stem: `一个三角形中两个角分别是 ${a}° 和 ${b}°，第三个角是多少度？`,
    myAnswer: '',
    correctAnswer: `${180 - a - b}°`,
    difficulty: 2,
    points: 4,
  }
})

/* --------------------------- 数学（初中） --------------------------- */
T('数学', 'middle', '解一元一次方程', () => {
  const a = ri(2, 8)
  const b = ri(3, 20)
  const x = ri(2, 15)
  return {
    questionType: '计算题',
    knowledgePoints: ['解方程'],
    stem: `解方程：${a}x + ${b} = ${a * x + b}`,
    myAnswer: '',
    correctAnswer: `x = ${x}`,
    difficulty: 2,
    points: 5,
  }
})

T('数学', 'middle', '列方程解应用题', () => {
  const x = ri(8, 40)
  const n = pick([3, 4, 5])
  return {
    questionType: '应用题',
    knowledgePoints: ['解方程', '分数应用题'],
    stem: `某校买了 ${n} 套桌椅，每套 ${x} 元，一共花了多少钱？（用方程解）`,
    myAnswer: '',
    correctAnswer: `${x * n} 元（设每套 x 元，${n}x = ${x * n}，x = ${x}）`,
    difficulty: 3,
    points: 6,
  }
})

T('数学', 'middle', '比例问题', () => {
  const a = ri(2, 6)
  const b = a * pick([2, 3, 4])
  return {
    questionType: '应用题',
    knowledgePoints: ['比例问题'],
    stem: `按 3 : ${a + 1} 配制一种混凝土，需要水泥 ${a} 吨，需要沙子多少吨？`,
    myAnswer: '',
    correctAnswer: `${b} 吨`,
    difficulty: 4,
    points: 6,
  }
})

T('数学', 'middle', '几何证明', () => {
  const angle = pick([40, 50, 60, 70])
  return {
    questionType: '证明题',
    knowledgePoints: ['三角形内角和', '面积与周长'],
    stem: `如图，在 △ABC 中，∠A = ${angle}°，∠B = ${angle + 10}°，求 ∠C 的度数，并说明理由。`,
    myAnswer: '',
    correctAnswer: `∠C = ${180 - angle * 2 - 10}°（三角形内角和为 180°）`,
    difficulty: 3,
    points: 6,
  }
})

T('数学', 'middle', '百分数应用', () => {
  const base = pick([200, 300, 500, 800])
  const rate = pick([10, 20, 25, 40])
  return {
    questionType: '应用题',
    knowledgePoints: ['百分数应用题'],
    stem: `某商品原价 ${base} 元，涨价 ${rate}% 后的售价是多少元？`,
    myAnswer: '',
    correctAnswer: `${(base * (1 + rate / 100)).toFixed(2).replace(/\.00$/, '')} 元`,
    difficulty: 3,
    points: 5,
  }
})

T('数学', 'middle', '圆的面积', () => {
  const r = pick([2, 3, 4, 5])
  return {
    questionType: '计算题',
    knowledgePoints: ['面积与周长'],
    stem: `一个圆的半径是 ${r} 厘米，它的面积是多少平方厘米？（π 取 3.14）`,
    myAnswer: '',
    correctAnswer: `${(3.14 * r * r).toFixed(2)} 平方厘米`,
    difficulty: 3,
    points: 5,
  }
})

T('数学', 'middle', '数据的分析', () => {
  const arr = Array.from({ length: 5 }, () => ri(60, 95))
  const avg = (arr.reduce((a, b) => a + b, 0) / 5).toFixed(1)
  return {
    questionType: '解答题',
    knowledgePoints: ['统计与可能性'],
    stem: `某小组 5 次射击成绩为 ${arr.join('、')} 环，求这组数据的平均数与中位数。`,
    myAnswer: '',
    correctAnswer: `平均数 ${avg} 环，中位数 ${[...arr].sort((x, y) => x - y)[2]} 环`,
    difficulty: 3,
    points: 5,
  }
})

T('数学', 'middle', '幂的运算', () => {
  const n = pick([2, 3])
  const e = pick([2, 3])
  const val = Math.pow(n, e)
  return {
    questionType: '计算题',
    knowledgePoints: ['运算定律与简便计算'],
    stem: `计算：${n}^${e} = ？`,
    myAnswer: '',
    correctAnswer: String(val),
    difficulty: 2,
    points: 4,
  }
})

/* --------------------------- 数学（初三） --------------------------- */
T('数学', 'senior', '二次函数', () => {
  const a = pick([1, 1, 2])
  const b = ri(-6, 6)
  const c = ri(-8, 8)
  return {
    questionType: '解答题',
    knowledgePoints: ['解方程', '函数与图像'],
    stem: `已知二次函数 y = ${a === 1 ? '' : a}x² ${b >= 0 ? '+' : '-'} ${Math.abs(b)}x ${c >= 0 ? '+' : '-'} ${Math.abs(c)}，求它的顶点坐标。`,
    myAnswer: '',
    correctAnswer: `顶点坐标 (${(-b / (2 * a)).toFixed(1)}, ${(c - (b * b) / (4 * a)).toFixed(1)})`,
    difficulty: 5,
    points: 8,
  }
})

T('数学', 'senior', '圆与切线', () => {
  const r = pick([3, 5, 6, 10])
  return {
    questionType: '解答题',
    knowledgePoints: ['面积与周长', '几何图形的认识'],
    stem: `⊙O 的半径为 ${r}，弦 AB 所在直线到圆心 O 的距离为 ${r - 1}，求弦 AB 的长。`,
    myAnswer: '',
    correctAnswer: `AB = ${2 * Math.sqrt(Math.max(0, r * r - (r - 1) * (r - 1))).toFixed(2)}`,
    difficulty: 5,
    points: 8,
  }
})

T('数学', 'senior', '相似三角形', () => {
  const k = pick([2, 3, 4])
  const a = ri(3, 9)
  return {
    questionType: '证明题',
    knowledgePoints: ['面积与周长'],
    stem: `△ABC ∽ △DEF，相似比为 ${k} : 1，若 △ABC 的周长为 ${a * k} cm，求 △DEF 的周长。`,
    myAnswer: '',
    correctAnswer: `${a} cm`,
    difficulty: 4,
    points: 7,
  }
})

T('数学', 'senior', '概率', () => {
  const red = ri(2, 6)
  const white = ri(2, 6)
  const blue = ri(1, 5)
  const total = red + white + blue
  return {
    questionType: '解答题',
    knowledgePoints: ['统计与可能性'],
    stem: `不透明的袋中装有 ${red} 个红球、${white} 个白球、${blue} 个蓝球，随机摸一个，摸到红球的可能性是多少？`,
    myAnswer: '',
    correctAnswer: `${red}/${total}`,
    difficulty: 3,
    points: 5,
  }
})

T('数学', 'senior', '反比例函数', () => {
  const k = pick([6, 8, 12])
  const x = pick([2, 3, 4])
  return {
    questionType: '解答题',
    knowledgePoints: ['函数与图像', '比例问题'],
    stem: `已知 y 是 x 的反比例函数，当 x = ${x} 时 y = ${k}，求 y 与 x 的函数关系式。`,
    myAnswer: '',
    correctAnswer: `y = ${(k / x).toFixed(2)}/x，即 y = ${k}/x`,
    difficulty: 4,
    points: 6,
  }
})

/* ------------------------------- 语文 ------------------------------- */
T('语文', 'all', '修辞辨识', () => {
  const bank = [
    {
      stem: '"那又红又大的苹果，像小姑娘涨红的脸。"这句话用了什么修辞手法？',
      correct: '比喻',
      kp: '修辞手法',
      d: 2,
    },
    {
      stem: '"小溪唱着歌儿向前跑去。"这句话用了什么修辞手法？',
      correct: '拟人',
      kp: '修辞手法',
      d: 2,
    },
    {
      stem: '"教室里静悄悄的，连一根针掉在地上都能听见。"这句话用了什么修辞手法？',
      correct: '夸张',
      kp: '修辞手法',
      d: 3,
    },
    {
      stem: '"我们要努力，我们要拼搏，我们要超越自我！"这句话用了什么修辞手法？',
      correct: '排比',
      kp: '修辞手法',
      d: 2,
    },
    {
      stem: '"风像妈妈的手，轻轻地抚摸着我的脸。"这句话用了什么修辞手法？',
      correct: '拟人',
      kp: '修辞手法',
      d: 2,
    },
    {
      stem: '"月光如流水一般，静静地泻在这一片叶子和花上。"这句话用了什么修辞手法？',
      correct: '比喻',
      kp: '修辞手法',
      d: 3,
    },
    {
      stem: '"广场上人山人海，欢声笑语不断。"这句话用了什么修辞手法？',
      correct: '夸张',
      kp: '修辞手法',
      d: 3,
    },
    {
      stem: '"这难道不是我们共同的责任吗？"这句话用了什么修辞手法？',
      correct: '反问',
      kp: '修辞手法',
      d: 3,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '选择题',
    knowledgePoints: [b.kp],
    stem: b.stem,
    options: ['比喻', '拟人', '排比', '夸张'],
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('语文', 'all', '病句修改', () => {
  const bank = [
    {
      stem: '修改病句：通过这次活动，使我明白了团结的重要性。',
      correct: '删去"通过"或"使"',
      d: 3,
    },
    {
      stem: '修改病句：我们要养成边读边思考的好方法。',
      correct: '"方法"改为"习惯"',
      d: 3,
    },
    {
      stem: '修改病句：他的语文成绩明显的提高了。',
      correct: '"明显的"改为"明显地"',
      d: 3,
    },
    {
      stem: '修改病句：全班同学和班主任都参加了，只有小明没来。',
      correct: '"和班主任"删除或改为"除班主任外"',
      d: 4,
    },
    {
      stem: '修改病句：我们班同学基本上都全部到齐了。',
      correct: '"基本上"与"全部"重复，删去其中一个',
      d: 3,
    },
    {
      stem: '修改病句：春天的杭州是个美丽的季节。',
      correct: '"季节"改为"城市"',
      d: 3,
    },
    {
      stem: '修改病句：为了防止交通事故不再发生，我们必须严格遵守交规。',
      correct: '"防止"改为"杜绝"，或删去"不"',
      d: 4,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['病句修改'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

T('语文', 'all', '词语积累', () => {
  const bank = [
    { stem: '写出"严肃"的近义词。', correct: '庄重 / 认真', d: 2 },
    { stem: '写出"慷慨"的反义词。', correct: '吝啬 / 小气', d: 2 },
    { stem: '解释"一丝不苟"的意思。', correct: '形容做事认真细致，一点儿不马虎', d: 3 },
    { stem: '写出一个含有"春"字的成语。', correct: '春暖花开 / 春风得意（合理即可）', d: 2 },
    { stem: '"聚精会神"的近义词是什么？', correct: '专心致志 / 全神贯注', d: 2 },
    { stem: '"遗忘"的反义词是什么？', correct: '牢记 / 记住', d: 2 },
    { stem: '"鸦雀无声"形容的是什么情形？', correct: '形容十分安静、没有一点声音（合理即可）', d: 3 },
  ]
  const b = pick(bank)
  return {
    questionType: '填空题',
    knowledgePoints: ['词语积累与运用'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('语文', 'all', '古诗默写', () => {
  const bank = [
    { stem: '补写诗句："停车坐爱枫林晚，＿＿＿＿＿＿。"', correct: '霜叶红于二月花', d: 2 },
    { stem: '补写诗句："欲穷千里目，＿＿＿＿＿＿。"', correct: '更上一层楼', d: 1 },
    { stem: '补写诗句："春眠不觉晓，＿＿＿＿＿＿。"', correct: '处处闻啼鸟', d: 1 },
    { stem: '补写诗句："读书破万卷，＿＿＿＿＿＿。"', correct: '下笔如有神', d: 2 },
    { stem: '补写诗句："慈母手中线，游子身上衣。＿＿＿＿＿＿。"', correct: '临行密密缝，意恐迟迟归', d: 3 },
    { stem: '补写诗句："会当凌绝顶，＿＿＿＿＿＿。"', correct: '一览众山小', d: 2 },
    { stem: '补写诗句："天街小雨润如酥，＿＿＿＿＿＿。"', correct: '草色遥看近却无', d: 3 },
  ]
  const b = pick(bank)
  return {
    questionType: '填空题',
    knowledgePoints: ['古诗词默写'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('语文', 'all', '阅读理解·概括内容', () => {
  const bank = [
    {
      stem: '阅读下面的短文，用一句话概括全文的主要内容。\n\n　　那年春天，父亲在院角种下一棵枣树……秋天，枣树结满了红果，父亲把最好的果子送给邻居……',
      correct: '父亲种枣树并把丰收的枣子送给邻居，表现了父亲的善良与朴实。',
      d: 4,
    },
    {
      stem: '阅读短文后回答：短文第 4 自然段主要写了什么内容？\n\n　　雨越下越大，我站在屋檐下，看着雨水在地面上汇成小溪……',
      correct: '写雨越下越大以及雨水汇成小溪的情景。',
      d: 3,
    },
    {
      stem: '阅读短文后回答：短文主要写了一件什么事？\n\n　　爷爷每天清晨都到江边打太极拳，无论严寒还是酷暑，从来没有间断过……',
      correct: '写了爷爷坚持多年每天清晨到江边打太极拳的事。',
      d: 3,
    },
    {
      stem: '阅读下面短文，概括段意：\n\n　　第一节课下课了，同学们涌到操场上，有的跳绳，有的踢球，操场上顿时热闹起来。',
      correct: '写了下课铃响后同学们涌到操场活动的热闹情景。',
      d: 3,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '阅读理解',
    knowledgePoints: ['阅读理解'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 6,
  }
})

T('语文', 'all', '阅读理解·体会情感', () => {
  const bank = [
    {
      stem: '"父亲的背影像一座山。"这句话运用了什么修辞？表达了作者怎样的情感？',
      correct: '比喻；表达了作者对父亲的感激、敬爱与心疼。',
      d: 4,
    },
    {
      stem: '短文中反复出现"那盏灯"，有什么作用？',
      correct: '作为行文线索，反复出现强化了牵挂与温暖的主题。',
      d: 4,
    },
    {
      stem: '"我猛地站起来，把书举得高高的。"这句话中"猛地"一词表现了人物怎样的心理？',
      correct: '表现了人物积极主动、想表现自己的急切心理。',
      d: 4,
    },
    {
      stem: '短文结尾与开头有什么呼应？这样写有什么好处？',
      correct: '首尾呼应，使文章结构完整、中心更加突出。',
      d: 4,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '阅读理解',
    knowledgePoints: ['阅读理解', '修辞手法'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 6,
  }
})

T('语文', 'all', '作文审题', () => {
  const bank = [
    {
      stem: '作文题："那一次，我长大了"（不少于 400 字）。请列出你的写作思路。',
      correct: '选一件具体的事，按"事情经过—遇到的困难—我的选择与成长—感悟"来写，重点部分详写。',
      d: 3,
    },
    {
      stem: '作文题目：《我的好朋友》。怎样写才能避免流水账？',
      correct: '选取典型场景，用动作、语言、神态和心理描写代替平铺直叙。',
      d: 4,
    },
    {
      stem: '作文题："我的老师"（不少于 400 字）。怎样选材才能写出真情实感？',
      correct: '选取一两个最能体现老师特点的具体细节，从细微处见真情，而不是罗列事例。',
      d: 4,
    },
    {
      stem: '作文题：《难忘的一件事》。文章应该按什么顺序写？请简要说明。',
      correct: '按事情发展的顺序（起因—经过—结果）写，重点写"经过"部分。',
      d: 3,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '作文题',
    knowledgePoints: ['作文审题与立意'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 8,
  }
})

T('语文', 'all', '标点符号', () => {
  const bank = [
    { stem: '选词填空：妈妈问我："今天作业写完了吗？"（括号内应填"）"还是"？"）', correct: '句末问号在引号外，句内问号在引号内', d: 3 },
    { stem: '判断："妈妈问我今天作业写完了没有。"引号中缺少什么标点？', correct: '缺少问号', d: 3 },
    { stem: '选择：下面句子中破折号的作用是什么？"他终于说出了那句憋在心里很久的话——我要回家了。"', correct: '表示解释说明', d: 4 },
    { stem: '判断："今天是植树节，我们去种树。"（"去种树"后应加什么标点？）', correct: '句号', d: 2 },
  ]
  const b = pick(bank)
  return {
    questionType: '选择题',
    knowledgePoints: ['标点符号运用'],
    stem: b.stem,
    options: ['问号', '句号', '感叹号', '省略号'],
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('语文', 'all', '句子排序', () => {
  const bank = [
    {
      stem: '把下列句子重新排成一段通顺的话：①他仔细观察 ②终于发现了规律 ③蚂蚁是怎样搬食物的呢 ④并做了记录。',
      correct: '③④①②',
      d: 3,
    },
    {
      stem: '把下列句子重新排成一段通顺的话：①于是他明白了道理 ②小明遇到问题从不问别人 ③他认真读了三遍课文 ④遇到不懂的地方就做上标记。',
      correct: '②④③①',
      d: 4,
    },
    {
      stem: '把下列句子重新排成一段通顺的话：①奶奶笑着递给我一个苹果 ②我放学回家 ③我连忙说谢谢 ④我放下书包就跑过去。',
      correct: '②④①③',
      d: 4,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['句子排序与衔接'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

T('语文', 'junior', '文言文阅读', () => {
  const bank = [
    {
      stem: '解释加点词："学而不思则罔，思而不学则殆。"（罔）',
      correct: '迷惑，意思是感到迷茫而无所收获',
      d: 4,
    },
    {
      stem: '把"温故而知新，可以为师矣"翻译成现代汉语。',
      correct: '温习旧知识从而得到新的体会，就可以做老师了。',
      d: 4,
    },
    {
      stem: '解释加点词："三人行，必有我师焉。"（焉）',
      correct: '这里指"哪里"',
      d: 4,
    },
    {
      stem: '《论语》中"温故而知新，可以为师矣"告诉我们什么道理？',
      correct: '告诉我们要经常复习旧知识，从而获得新的理解和体会。',
      d: 4,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['文言文阅读'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 6,
  }
})

/* ------------------------------- 英语 ------------------------------- */
T('英语', 'all', '一般现在时', () => {
  const bank = [
    { stem: 'He ____ (go) to school by bike every day.', correct: 'goes', d: 2 },
    { stem: 'My mother ____ (do) housework on Sundays.', correct: 'does', d: 2 },
    { stem: 'There ____ (be) some milk in the glass.', correct: 'is', d: 2 },
    { stem: 'Tom usually ____ (watch) TV after supper.', correct: 'watches', d: 2 },
    { stem: 'The sun ____ (rise) in the east.', correct: 'rises', d: 2 },
    { stem: 'My father ____ (work) in a hospital.', correct: 'works', d: 2 },
    { stem: 'Amy and Lucy ____ (be) good friends.', correct: 'are', d: 2 },
  ]
  const b = pick(bank)
  return {
    questionType: '语法填空',
    knowledgePoints: ['一般现在时'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('英语', 'all', '一般过去时', () => {
  const bank = [
    { stem: 'We ____ (visit) the museum last Sunday.', correct: 'visited', d: 2 },
    { stem: 'She ____ (be) very tired yesterday.', correct: 'was', d: 2 },
    { stem: 'They ____ (go) to Beijing two years ago.', correct: 'went', d: 3 },
    { stem: 'I ____ (not see) him at the meeting yesterday.', correct: "didn't see", d: 3 },
    { stem: 'We ____ (buy) some fruit yesterday afternoon.', correct: 'bought', d: 3 },
    { stem: 'My father ____ (go) to Beijing last week.', correct: 'went', d: 2 },
    { stem: 'The students ____ (be) very excited yesterday.', correct: 'were', d: 2 },
  ]
  const b = pick(bank)
  return {
    questionType: '语法填空',
    knowledgePoints: ['一般过去时'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('英语', 'all', '现在完成时', () => {
  const bank = [
    { stem: 'I ____ (finish) my homework already.', correct: 'have finished', d: 3 },
    { stem: 'He ____ (live) in Shanghai since 2015.', correct: 'has lived', d: 3 },
    { stem: 'Have you ever ____ (be) to Xi\'an?', correct: 'been', d: 3 },
    { stem: 'She ____ (write) three English letters so far.', correct: 'has written', d: 3 },
    { stem: 'They ____ (know) each other for ten years.', correct: 'have known', d: 3 },
    { stem: 'Just now he ____ (come) back from school.', correct: 'has come', d: 3 },
  ]
  const b = pick(bank)
  return {
    questionType: '语法填空',
    knowledgePoints: ['现在完成时'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('英语', 'all', '状语从句', () => {
  const bank = [
    { stem: '连词成句：he was late, because / he / missed / the bus / .', correct: 'He was late because he missed the bus.', d: 3 },
    { stem: '选择合适的连词："____ it was raining, we still went out."', correct: 'Although', d: 3 },
    { stem: '"You can pass the exam ____ you work hard."中应填哪个词？', correct: 'if', d: 3 },
    { stem: '"He was late ____ the bus broke down."中应填哪个词？', correct: 'because', d: 3 },
    { stem: '"____ you work hard, you will succeed."中应填哪个词？', correct: 'If / If you', d: 3 },
    { stem: '连词成句：late, was, why, he, was, ? / him / arrive / to / late', correct: 'Why was he late to arrive?', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '语法填空',
    knowledgePoints: ['状语从句'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

T('英语', 'all', '宾语从句', () => {
  const bank = [
    { stem: 'He asked me ____ I had finished my homework.', correct: 'whether / if', d: 3 },
    { stem: '改写为宾语从句：He said, "I am busy." → He said that ____.', correct: 'he was busy', d: 3 },
    { stem: '"Where did you go?" 改为宾语从句，连接词用 ____。', correct: 'where', d: 3 },
    { stem: 'The teacher asked us ____ we could finish the work on time.', correct: 'if / whether', d: 3 },
    { stem: '改写为宾语从句：She said, "I am reading." → She said that ____.', correct: 'she was reading', d: 4 },
    { stem: '"What time does the class begin?" 改为宾语从句：He asked ____.', correct: 'what time the class began', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '语法填空',
    knowledgePoints: ['宾语从句'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

T('英语', 'all', '词汇与拼写', () => {
  const bank = [
    { stem: '根据首字母填空：I am very t______ after running.', correct: 'tired', d: 2 },
    { stem: '写出 expensive 的反义词。', correct: 'cheap', d: 2 },
    { stem: '选择：The weather is very ____ (rain) today.', correct: 'rainy', d: 2 },
    { stem: '用所给词的适当形式填空：Tom is good at ____ (swim).', correct: 'swimming', d: 3 },
    { stem: '根据首字母填空：Please write down your n____ and a____.', correct: 'name, address', d: 3 },
    { stem: '选择正确的词：I am interested in ____ (science).', correct: 'science', d: 2 },
    { stem: '写出 below 的反义词。', correct: 'above', d: 2 },
  ]
  const b = pick(bank)
  return {
    questionType: '填空题',
    knowledgePoints: ['词汇与拼写'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('英语', 'all', '连词成句', () => {
  const bank = [
    { stem: '连词成句：is / what / time / it / ?', correct: 'What time is it?', d: 2 },
    { stem: '连词成句：my / birthday / is / May / in / 1st / .', correct: 'My birthday is on May 1st.', d: 3 },
    { stem: '连词成句：often / plays / he / football / .', correct: 'He often plays football.', d: 3 },
    { stem: '连词成句：is / my / sister / a / nurse / .', correct: 'My sister is a nurse.', d: 2 },
    { stem: '连词成句：do / what / you / on / Sundays / do / ?', correct: 'What do you do on Sundays?', d: 3 },
    { stem: '连词成句：beautiful / the / how / picture / is / !', correct: 'How beautiful the picture is!', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '翻译题',
    knowledgePoints: ['句子排序与衔接', '时态综合辨析'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 3,
  }
})

T('英语', 'all', '完形填空', () => {
  const bank = [
    {
      stem: '完形填空（第 5 空）：It was raining hard, so I ____ my umbrella with me.\nA. forget  B. took  C. left  D. missed',
      correct: 'B',
      d: 3,
    },
    {
      stem: '完形填空（第 8 空）：If you want to stay healthy, you should ____ more exercise.\nA. take  B. taking  C. took  D. to take',
      correct: 'A',
      d: 3,
    },
    {
      stem: '完形填空（第 12 空）：The film was so ____ that I fell asleep.\nA. boring  B. boring  C. interesting  D. excited',
      correct: 'A',
      d: 4,
    },
    {
      stem: '完形填空（第 3 空）：She ____ her homework before dinner.\nA. finishes  B. finished  C. will finish  D. finishing',
      correct: 'B',
      d: 3,
    },
    {
      stem: '完形填空（第 6 空）：The cat is ____ the box under the bed.\nA. in  B. on  C. under  D. at',
      correct: 'C',
      d: 2,
    },
    {
      stem: '完形填空（第 15 空）：____ hard work you do, the better grades you will get.\nA. The more  B. More  C. The most  D. Most',
      correct: 'A',
      d: 4,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '完形填空',
    knowledgePoints: ['完形填空', '时态综合辨析'],
    stem: b.stem,
    options: ['A', 'B', 'C', 'D'],
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

T('英语', 'all', '阅读理解', () => {
  const bank = [
    {
      stem: '根据短文回答：Tom usually gets up at 6:30 and goes to school by bike.\nQuestion: How does Tom go to school?\nA. By bus  B. By bike  C. By car  D. On foot',
      correct: 'B',
      d: 2,
    },
    {
      stem: '根据短文回答：Lily is good at English and she often helps her classmates with their homework.\nQuestion: What is Lily good at?\nA. Math  B. English  C. Music  D. Art',
      correct: 'B',
      d: 2,
    },
    {
      stem: '根据短文回答：Jack is twelve years old and he is good at swimming. He goes to the swimming club twice a week.\nQuestion: How often does Jack go to the swimming club?\nA. Once a week  B. Twice a week  C. Three times a week  D. Every day',
      correct: 'B',
      d: 2,
    },
    {
      stem: '根据短文回答：Mr. Green teaches maths. He has been in this school for twenty years and all the students like him.\nQuestion: What does Mr. Green teach?\nA. English  B. Chinese  C. Maths  D. P.E.',
      correct: 'C',
      d: 2,
    },
    {
      stem: '根据短文回答：It was rainy yesterday, so we stayed at home and watched TV.\nQuestion: Why did they stay at home?\nA. Because it was cold  B. Because it was rainy  C. Because they were ill  D. Because it was late',
      correct: 'B',
      d: 2,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '阅读理解',
    knowledgePoints: ['英语阅读理解'],
    stem: b.stem,
    options: ['A', 'B', 'C', 'D'],
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

T('英语', 'junior', '被动语态', () => {
  const bank = [
    { stem: '改为被动语态：They built this bridge in 1998.', correct: 'This bridge was built in 1998.', d: 4 },
    { stem: '用被动语态填空：The classroom ____ (clean) every day.', correct: 'is cleaned', d: 3 },
    { stem: '改为被动语态：People speak English all over the world.', correct: 'English is spoken all over the world.', d: 4 },
    { stem: '用被动语态填空：The bridge ____ (build) in 1998.', correct: 'was built', d: 3 },
    { stem: '改为被动语态：They will finish the work next week.', correct: 'The work will be finished next week.', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '翻译题',
    knowledgePoints: ['被动语态'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 5,
  }
})

/* ------------------------------- 物理 ------------------------------- */
T('物理', 'junior', '浮力', () => {
  const bank = [
    {
      stem: '体积为 0.001 m³ 的物体完全浸没在水中受到的浮力是多少？（ρ水=1.0×10³ kg/m³，g 取 10 N/kg）',
      correct: '10 N',
      d: 3,
    },
    {
      stem: '物体在水中漂浮时，浮力与重力有什么关系？',
      correct: '浮力等于重力（F浮 = G物）',
      d: 2,
    },
    {
      stem: '同一物体分别放入水和盐水中，浮力变大还是变小？',
      correct: '在盐水中浮力变大',
      d: 4,
    },
    {
      stem: '一个物体受到的重力是 30 N，浸没在水中时受到的浮力是 20 N，物体将上浮还是下沉？',
      correct: '上浮（浮力大于重力）',
      d: 4,
    },
    {
      stem: '轮船从河里驶入海里（河水密度小于海水），受到的浮力和排水体积怎样变化？',
      correct: '浮力不变，排水体积变小',
      d: 4,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['浮力'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 6,
  }
})

T('物理', 'junior', '欧姆定律', () => {
  const bank = [
    { stem: '电路中电流为 0.5 A，电压为 6 V，电阻是多少欧姆？', correct: '12 Ω', d: 2 },
    { stem: '两个电阻串联，总电阻与分电阻有什么关系？', correct: '总电阻等于各分电阻之和', d: 3 },
    { stem: '并联电路中各支路两端的电压有什么特点？', correct: '各支路两端电压相等', d: 3 },
    { stem: '一个电阻两端电压为 6 V，通过它的电流是 0.3 A，这个电阻的阻值是多少欧姆？', correct: '20 Ω', d: 3 },
    { stem: '串联电路中各处电流有什么特点？', correct: '串联电路中各处电流相等', d: 2 },
    { stem: '把两个阻值相同的电阻并联，总电阻与每个电阻的关系是什么？', correct: '总电阻等于每个电阻的一半', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['电学'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 5,
  }
})

T('物理', 'junior', '压强', () => {
  const bank = [
    { stem: '一个物体放在水平地面上，压力 200 N，受力面积 0.02 m²，压强是多少帕？', correct: '10000 Pa', d: 3 },
    { stem: '液体压强随深度的增加如何变化？', correct: '随深度增加而增大', d: 2 },
    { stem: '一个杯子底面积为 50 cm²，杯中水深 10 cm，水对杯底的压强是多少？（ρ水=1.0×10³ kg/m³，g 取 10 N/kg）', correct: '1000 Pa', d: 4 },
    { stem: '为什么用菜刀切菜比用小刀省力？', correct: '减小受力面积可以增大压强', d: 3 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['压强'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 5,
  }
})

T('物理', 'junior', '力与运动', () => {
  const bank = [
    { stem: '物体在水平面上匀速直线运动时，摩擦力与推力有什么关系？', correct: '是一对平衡力，大小相等、方向相反', d: 3 },
    { stem: '牛顿第一定律的内容是什么？', correct: '一切物体在没有受到力的作用时，总保持静止状态或匀速直线运动状态', d: 3 },
    { stem: '跳远运动员起跳后为什么能继续向前运动？', correct: '由于惯性，物体具有保持原来运动状态的性质', d: 3 },
    { stem: '用 20 N 的水平力推静止在水平地面上的箱子，箱子没有动，此时箱子受到的摩擦力是多少？', correct: '20 N', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['力与运动'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 5,
  }
})

T('物理', 'junior', '功与机械能', () => {
  const bank = [
    { stem: '功率的物理意义是什么？', correct: '表示做功的快慢', d: 2 },
    { stem: '物体从高处自由下落，重力势能如何转化？', correct: '重力势能转化为动能', d: 3 },
    { stem: '功率为 100 W 的机器正常工作 10 s，做功多少焦耳？', correct: '1000 J', d: 3 },
    { stem: '汽车加速时，动能和势能怎样变化？', correct: '动能增大，重力势能减小（机械能总量不变）', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['功与机械能'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 5,
  }
})

/* ------------------------------- 化学 ------------------------------- */
T('化学', 'senior', '化学方程式', () => {
  const bank = [
    {
      stem: '写出铁在氧气中燃烧的化学方程式。',
      correct: '3Fe + 2O₂ =点燃= Fe₃O₄',
      d: 3,
    },
    {
      stem: '写出实验室用高锰酸钾制取氧气的化学方程式。',
      correct: '2KMnO₄ =加热= K₂MnO₄ + MnO₂ + O₂↑',
      d: 4,
    },
    {
      stem: '检验二氧化碳常用什么试剂？',
      correct: '澄清石灰水',
      d: 2,
    },
    {
      stem: '写出镁条在空气中燃烧的化学方程式。',
      correct: '2Mg + O₂ =点燃= 2MgO',
      d: 3,
    },
    {
      stem: '写出氢气在氧气中燃烧的化学方程式。',
      correct: '2H₂ + O₂ =点燃= 2H₂O',
      d: 3,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['化学方程式'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 6,
  }
})

T('化学', 'senior', '溶液与浓度', () => {
  const bank = [
    {
      stem: '把 50 g 食盐完全溶解在 200 g 水中，所得溶液的溶质质量分数是多少？',
      correct: '20%',
      d: 3,
    },
    {
      stem: '一定温度下不能再溶解某溶质的溶液叫什么？',
      correct: '饱和溶液',
      d: 2,
    },
    {
      stem: '把 100 g 20% 的盐水稀释成 10%，需要加水多少克？',
      correct: '100 g',
      d: 4,
    },
    {
      stem: '要配制 100 g 10% 的氯化钠溶液，需要氯化钠和水各多少克？',
      correct: '氯化钠 10 g，水 90 g',
      d: 4,
    },
    {
      stem: '在 40 g 水中溶解 10 g 食盐，所得溶液的溶质质量分数约为多少？',
      correct: '20%',
      d: 3,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['溶液与浓度'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 6,
  }
})

T('化学', 'senior', '原子与元素', () => {
  const bank = [
    { stem: '水分子由什么微粒构成？', correct: '氢原子和氧原子', d: 2 },
    { stem: '原子的构成微粒有哪些？', correct: '质子、中子和电子', d: 3 },
    { stem: '决定元素化学性质的是原子中的哪一种微粒？', correct: '最外层电子', d: 4 },
    { stem: '相对原子质量约等于什么？', correct: '质子数与中子数之和', d: 3 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['原子与元素'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

/* ------------------------------- 生物 ------------------------------- */
T('生物', 'junior', '细胞与组织结构', () => {
  const bank = [
    { stem: '动植物细胞都有而植物细胞特有的结构是什么？', correct: '细胞壁、液泡（和叶绿体）', d: 3 },
    { stem: '控制物质进出细胞的结构是什么？', correct: '细胞膜', d: 2 },
    { stem: '生物体结构和功能的基本单位是什么？', correct: '细胞', d: 2 },
    { stem: '细胞中含量最多的有机物是什么？', correct: '蛋白质', d: 3 },
    { stem: '细胞核的功能是什么？', correct: '含有遗传物质，是控制生物发育和遗传的"指挥中心"', d: 3 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['细胞与组织结构'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

T('生物', 'junior', '光合作用与呼吸作用', () => {
  const bank = [
    { stem: '光合作用的原料是什么？', correct: '二氧化碳和水', d: 2 },
    { stem: '呼吸作用的主要场所是什么？', correct: '线粒体', d: 3 },
    { stem: '光合作用的产物是什么？', correct: '有机物（淀粉）和氧气', d: 3 },
    { stem: '白天植物只进行光合作用不进行呼吸作用，对吗？为什么？', correct: '不对，白天光合作用和呼吸作用同时进行，只是光合作用强于呼吸作用', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['光合作用与呼吸作用'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

/* ------------------------------- 地理 ------------------------------- */
T('地理', 'junior', '地球与地图', () => {
  const bank = [
    { stem: '划分东西半球的分界线是什么？', correct: '20°W 和 160°E 组成的经线圈', d: 4 },
    { stem: '地球自转的方向是什么？', correct: '自西向东', d: 2 },
    { stem: '地球公转的方向是什么？绕什么转？', correct: '自西向东绕太阳公转', d: 3 },
    { stem: '南半球和北半球的分界线是什么？', correct: '赤道（0°纬线）', d: 2 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['地球与地图'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

T('地理', 'junior', '气候与降水', () => {
  const bank = [
    { stem: '影响气候的主要因素有哪些？', correct: '纬度位置、海陆位置、地形因素等', d: 3 },
    { stem: '我国东部地区降水量自东南向西北递减的主要原因是什么？', correct: '距海远近不同，受夏季风影响程度不同', d: 4 },
    { stem: '热带雨林气候的特点是什么？', correct: '全年高温多雨', d: 3 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['气候与降水'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 4,
  }
})

/* ------------------------------- 道法 ------------------------------- */
T('道法', 'senior', '法律法规常识', () => {
  const bank = [
    {
      stem: '未成年人保护法中的"四大保护"指的是什么？',
      correct: '家庭保护、学校保护、社会保护、网络保护（以及政府保护、司法保护）',
      d: 3,
    },
    {
      stem: '写出公民的两项基本义务。',
      correct: '维护国家统一和全国各民族团结；依法纳税；服兵役等（合理即可）',
      d: 3,
    },
    {
      stem: '什么是违法行为？违法行为有什么后果？',
      correct: '违反国家法律法规的行为即为违法行为，要承担相应的法律责任（民事、行政、刑事等）',
      d: 4,
    },
    {
      stem: '当自己的合法权益受到侵害时，应该怎么办？',
      correct: '可以与对方协商、请求调解或向有关部门求助，必要时依法提起诉讼或报警',
      d: 4,
    },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['法律法规常识'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 5,
  }
})

T('道法', 'senior', '品德修养与责任', () => {
  const bank = [
    { stem: '面对同学之间的矛盾，正确的做法是什么？', correct: '主动沟通、换位思考，求同存异（合理即可）', d: 3 },
    { stem: '怎样做一个负责任的中学生？', correct: '对承诺负责、对学习负责、主动承担责任（合理即可）', d: 3 },
    { stem: '面对学习中的困难，正确的心态是什么？', correct: '主动寻求帮助、调整心态、坚持不懈，不能轻易放弃', d: 3 },
    { stem: '如何理解"诚信"是做人的基本准则？', correct: '诚信是为人处世之本，体现在每一个承诺和每一件小事中', d: 4 },
  ]
  const b = pick(bank)
  return {
    questionType: '解答题',
    knowledgePoints: ['品德修养与责任'],
    stem: b.stem,
    myAnswer: '',
    correctAnswer: b.correct,
    difficulty: b.d,
    points: 5,
  }
})

/* ========================================================================== */
/* 组卷                                                                        */
/* ========================================================================== */

function gcd(a, b) {
  while (b) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

/**
 * 依据学段挑选模板。
 * gradeBand 语义：all=通用 / primary=小学 / middle=初中 / senior=初三 / junior=初高中通用
 */
function templatesFor(subject, band) {
  return TEMPLATES.filter((t) => {
    if (t.subject !== subject) return false
    if (t.gradeBand === 'all') return true
    if (t.gradeBand === band) return true
    if (t.gradeBand === 'junior' && (band === 'middle' || band === 'senior')) return true
    return false
  })
}

const PLANS = [
  {
    id: 'stu_001',
    name: '张梓萱',
    grade: '四年级',
    school: '阳光第一小学',
    avatarColor: '#f59e0b',
    note: '数学计算总出错，语文阅读理解偏弱，英语单词记不牢。',
    band: 'primary',
    subjects: [
      { subject: '数学', count: 26 },
      { subject: '语文', count: 22 },
      { subject: '英语', count: 18 },
    ],
  },
  {
    id: 'stu_002',
    name: '李承泽',
    grade: '初二',
    school: '市实验中学',
    avatarColor: '#3b82f6',
    note: '物理电学部分明显吃力，几何证明题步骤不完整。',
    band: 'middle',
    subjects: [
      { subject: '数学', count: 22 },
      { subject: '物理', count: 14 },
      { subject: '语文', count: 16 },
      { subject: '英语', count: 16 },
      { subject: '生物', count: 6 },
      { subject: '地理', count: 5 },
    ],
  },
  {
    id: 'stu_003',
    name: '王思远',
    grade: '初三',
    school: '育才中学',
    avatarColor: '#10b981',
    note: '化学方程式配平是主要失分点，理综压轴题时间不够。',
    band: 'senior',
    subjects: [
      { subject: '数学', count: 20 },
      { subject: '物理', count: 13 },
      { subject: '化学', count: 13 },
      { subject: '语文', count: 15 },
      { subject: '英语', count: 15 },
      { subject: '道法', count: 6 },
    ],
  },
]

/** 生成时间：最近 90 天内，越靠近今天越密集（模拟真实学习节奏），且不会晚于当前时间 */
function randomCreatedAt() {
  const daysAgo = Math.floor(Math.pow(rnd(), 1.45) * 90)
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(ri(16, 21), ri(0, 59), ri(0, 59), 0)
  const now = Date.now()
  if (d.getTime() > now) d.setTime(now - ri(1, 600) * 1000)
  return d.toISOString()
}

function buildQuestions(plan) {
  const rows = []
  let seq = 0

  const usedStems = new Set()
  for (const { subject, count } of plan.subjects) {
    const pool = templatesFor(subject, plan.band)
    if (!pool.length) {
      console.warn(`[seed] 警告：学生 ${plan.name} 的学科「${subject}」没有可用模板，已跳过`)
      continue
    }

    for (let i = 0; i < count; i++) {
      const tpl = pool[i % pool.length]
      // 同一学生内尽量避免重复题干：最多重抽 24 次
      let t = tpl.build()
      let guard = 0
      while (usedStems.has(t.stem) && guard < 24) {
        t = tpl.build()
        guard++
      }
      usedStems.add(t.stem)

      const errorType = pickErrorType()
      const myAnswer = makeWrongAnswer(t.correctAnswer, errorType, subject)
      const kp = t.knowledgePoints[0] ?? '综合知识点'

      // mastery / status / corrected 三者保持一致
      // 已订正 -> mastery >= 70（>=85 视为已掌握，否则巩固中）；未订正 -> 掌握度偏低、待复盘
      const corrected = errorType === 'expression' || chance(0.34)
      let mastery
      if (corrected) {
        mastery = ri(70, 100)
      } else {
        mastery = ri(5, 58)
      }
      const status = !corrected ? 'unreviewed' : mastery >= 85 ? 'mastered' : 'learning'

      const createdAt = randomCreatedAt()
      const reviewedAt = corrected ? new Date(new Date(createdAt).getTime() + ri(1, 6) * 86400000).toISOString() : null
      const nextReviewAt = corrected
        ? new Date(new Date(reviewedAt).getTime() + (mastery >= 80 ? 7 : mastery >= 50 ? 3 : 1) * 86400000).toISOString()
        : null

      seq++
      rows.push({
        id: `q_${plan.id.replace('stu_', '')}_${String(seq).padStart(3, '0')}`,
        studentId: plan.id,
        subject,
        grade: plan.grade,
        semester: '2025-2026学年第二学期',
        knowledgePoints: JSON.stringify(t.knowledgePoints),
        questionType: t.questionType,
        source: pick(SOURCES),
        stem: t.stem,
        options: JSON.stringify(t.options ?? []),
        myAnswer,
        correctAnswer: t.correctAnswer,
        errorType,
        errorDetail: ERROR_DETAIL_BANK[errorType](kp),
        difficulty: t.difficulty ?? 3,
        points: t.points ?? 4,
        images: JSON.stringify([]),
        ai_analysis: null,
        mastery,
        status,
        corrected: corrected ? 1 : 0,
        tags: JSON.stringify([pick(TAGS), pick(TAGS)]),
        createdAt,
        updatedAt: null,
        reviewedAt,
        nextReviewAt,
      })
    }
  }

  // 打乱顺序（真实错题本不会按学科分类录入）
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
  }
  return rows
}

/* ========================================================================== */
/* 演示账号                                                                    */
/* ========================================================================== */

/**
 * 演示账号（口令统一 `<角色>123`，便于演示与文档）。
 * 幂等：账号已存在时**不覆盖**口令（管理员改过的口令保持不变），只重挂学生关联。
 */
const DEMO_ACCOUNTS = [
  {
    username: 'teacher',
    password: 'teacher123',
    name: '示范教师',
    role: 'teacher',
    avatarColor: '#8b5cf6',
    note: '演示账号：关联全部演示学生',
  },
  {
    username: 'parent',
    password: 'parent123',
    name: '示范家长',
    role: 'parent',
    avatarColor: '#ec4899',
    note: '演示账号：关联演示学生中的第一个',
  },
  {
    username: 'student',
    password: 'student123',
    name: '示范学生',
    role: 'student',
    avatarColor: '#06b6d4',
    note: '演示账号：关联演示学生中的第一个',
  },
]

/** 确保演示账号存在，返回账号 id */
function ensureDemoAccount(acc) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(acc.username)
  if (existing) return existing.id

  const id = uid('usr')
  db.prepare(
    `INSERT INTO users (
        id, username, name, role, password_hash, avatar_color, phone, note,
        status, must_change_password, created_at, last_login_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, NULL)`,
  ).run(
    id,
    acc.username,
    acc.name,
    acc.role,
    hashPassword(acc.password),
    acc.avatarColor,
    null,
    acc.note,
    new Date().toISOString(),
  )
  return id
}

/** 建立演示账号与演示学生的关联 */
function applyDemoAccountLinks(studentIds) {
  const byName = Object.fromEntries(
    DEMO_ACCOUNTS.map((acc) => [acc.username, ensureDemoAccount(acc)]),
  )
  // 保证系统里至少有一个管理员（seed 先于服务启动时补建）
  ensureAdminUser()
  if (!studentIds.length) return

  const placeholders = studentIds.map(() => '?').join(',')

  // 教师 → 关联全部演示学生
  db.prepare(`UPDATE students SET teacher_id = ? WHERE id IN (${placeholders})`).run(
    byName.teacher,
    ...studentIds,
  )
  // 家长 / 学生本人 → 关联第一个演示学生
  db.prepare('UPDATE students SET parent_id = ? WHERE id = ?').run(byName.parent, studentIds[0])
  db.prepare('UPDATE students SET user_id = ? WHERE id = ?').run(byName.student, studentIds[0])
}

/* ========================================================================== */
/* 执行                                                                        */
/* ========================================================================== */

function main() {
  const students = PLANS.map((p) => ({
    id: p.id,
    name: p.name,
    grade: p.grade,
    avatar_color: p.avatarColor,
    school: p.school,
    note: p.note,
    created_at: new Date(Date.now() - 120 * 86400000).toISOString(),
  }))

  const questions = PLANS.flatMap(buildQuestions)

  // 幂等：先清空
  db.exec('DELETE FROM questions')
  db.exec('DELETE FROM students')

  const insStudent = db.prepare(
    `INSERT INTO students (id, name, grade, avatar_color, school, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const s of students) {
    insStudent.run(s.id, s.name, s.grade, s.avatar_color, s.school, s.note, s.created_at)
  }

  // 演示账号 + 学生关联（学生已被重建，关联需要重新挂上）
  applyDemoAccountLinks(students.map((s) => s.id))

  const insQuestion = db.prepare(
    `INSERT INTO questions (
        id, student_id, subject, grade, semester, knowledge_points, question_type, source,
        stem, options, my_answer, correct_answer, error_type, error_detail, difficulty, points,
        images, ai_analysis, mastery, status, corrected, tags, created_at, updated_at,
        reviewed_at, next_review_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const q of questions) {
    insQuestion.run(
      q.id, q.studentId, q.subject, q.grade, q.semester, q.knowledgePoints, q.questionType, q.source,
      q.stem, q.options, q.myAnswer, q.correctAnswer, q.errorType, q.errorDetail, q.difficulty, q.points,
      q.images, q.ai_analysis, q.mastery, q.status, q.corrected, q.tags, q.createdAt, q.updatedAt,
      q.reviewedAt, q.nextReviewAt,
    )
  }

  console.log('✅ 种子数据写入完成')
  console.table(
    students.map((s) => ({
      学生: s.name,
      年级: s.grade,
      学校: s.school,
      错题数: questions.filter((q) => q.studentId === s.id).length,
    })),
  )
  const bySubject = {}
  for (const q of questions) bySubject[q.subject] = (bySubject[q.subject] ?? 0) + 1
  console.log('学科分布:', bySubject)
  const byError = {}
  for (const q of questions) byError[q.errorType] = (byError[q.errorType] ?? 0) + 1
  console.log('错因分布:', byError)
  console.log(`合计：${students.length} 名学生，${questions.length} 道错题`)
  console.log('演示账号：teacher/teacher123、parent/parent123、student/student123')
}

main()
