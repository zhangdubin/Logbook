/**
 * server/vision.js —— 视觉识别链路的核心
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 组织视觉模型提示词（只输出 JSON）
 *   2. 容错解析模型返回（剥离 ```json 围栏 / 修复被截断的 JSON）
 *   3. 字段校验与修正（枚举收敛、选项字母归一、答案合法性）
 *   4. **置信度融合**：ocrToken / modelSelf / structure / crossCheck 四个信号加权
 *
 * 依赖：server/modelClient.js（HTTP 调用）
 */

import { callChat } from './modelClient.js'

/* -------------------------------------------------------------------------- */
/* 枚举（与 src/lib/types.ts 保持一致）                                         */
/* -------------------------------------------------------------------------- */

export const SUBJECTS = [
  '语文', '数学', '英语', '物理', '化学', '生物', '地理', '历史', '政治', '道法',
]

export const QUESTION_TYPES = [
  '选择题', '填空题', '判断题', '计算题', '应用题', '解答题',
  '作文题', '阅读理解', '完形填空', '语法填空', '翻译题', '实验题', '证明题',
]

/* -------------------------------------------------------------------------- */
/* 提示词                                                                      */
/* -------------------------------------------------------------------------- */

export const VISION_SYSTEM_PROMPT = `你是 K12 错题结构化引擎，负责把学生拍下的错题照片转写并结构化。
【铁律】
1. 只输出一个 JSON 对象，不要输出任何解释文字、不要使用 Markdown 代码块。
2. 题干必须**逐字转写**，禁止改写、概括、润色或补充题目里没有的内容。
3. 数学/物理公式一律用 LaTeX 表示（行内用 $...$）。
4. 选项**原样保留**，去掉选项前面的字母前缀（A. / B、/ (C) 等），只保留选项内容本身。
5. 学生用**红笔/铅笔手写**的作答识别为 myAnswer；**印刷体**（黑色/蓝色印刷的）答案识别为 correctAnswer。
   如果照片里只有手写作答而没有印刷答案，correctAnswer 填 null。
6. 看不清或不确定的字段，给出**较低的 confidence**，并在 notes 中说明原因。
7. 必须输出的 JSON 结构（字段名一字不差）：
{
  "stem": "题干原文",
  "options": ["选项内容1", "选项内容2"],
  "myAnswer": "学生手写作答" 或 null,
  "correctAnswer": "印刷体正确答案" 或 null,
  "subject": "语文|数学|英语|物理|化学|生物|地理|历史|政治|道法",
  "questionType": "选择题|填空题|判断题|计算题|应用题|解答题|作文题|阅读理解|完形填空|语法填空|翻译题|实验题|证明题",
  "knowledgePoints": ["知识点1", "知识点2"],
  "difficulty": 3,
  "ocrText": "照片中识别到的全部文字",
  "fieldConfidence": {
    "stem": 0.0, "options": 0.0, "myAnswer": 0.0, "correctAnswer": 0.0, "knowledgePoints": 0.0
  },
  "notes": null
}
8. difficulty 必须是 1-5 的整数；fieldConfidence 必须是 0-1 的小数。
9. 可选：额外返回一个 "analysis" 对象（包含 summary / diagnosis / correctSteps / tips 等），
   用于给这道错题生成讲解；拿不准时省略该字段即可。`

/* -------------------------------------------------------------------------- */
/* JSON 容错解析                                                                */
/* -------------------------------------------------------------------------- */

/** 取出第一个完整配平的 JSON 对象 */
function extractBalanced(text) {
  let depth = 0
  let inStr = false
  let esc = false
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) return text.slice(start, i + 1)
      if (depth < 0) return null
    }
  }
  return null
}

/** 修复被截断的 JSON：补齐括号、去掉悬空键与尾逗号 */
function repairTruncatedJson(text) {
  const stack = []
  let inStr = false
  let esc = false
  let lastSafe = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') { inStr = false; lastSafe = i }
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); continue }
    if (ch === '}' || ch === ']') { stack.pop(); lastSafe = i; continue }
    if (!/\s/.test(ch)) lastSafe = i
  }
  let out = lastSafe >= 0 ? text.slice(0, lastSafe + 1) : ''
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/, '')
  out = out.replace(/,\s*$/, '')
  out = out.replace(/:\s*$/, ':null')
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i]
  return out
}

/**
 * 容错解析模型返回的 JSON。
 * @returns {{data: object|null, repaired: boolean}}
 */
export function parseModelJson(text) {
  if (typeof text !== 'string') return { data: null, repaired: false }
  let t = text.trim()
  const fence = t.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/)
  if (fence) t = fence[1].trim()
  t = t.replace(/^json\s*/i, '').trim()
  const first = t.indexOf('{')
  if (first < 0) return { data: null, repaired: false }
  t = t.slice(first)

  try {
    return { data: JSON.parse(t), repaired: false }
  } catch {
    /* 继续尝试 */
  }

  const balanced = extractBalanced(t)
  if (balanced) {
    try {
      return { data: JSON.parse(balanced), repaired: false }
    } catch {
      /* 继续尝试修复 */
    }
  }

  const repaired = repairTruncatedJson(t)
  if (repaired) {
    try {
      return { data: JSON.parse(repaired), repaired: true }
    } catch {
      /* 放弃 */
    }
  }
  return { data: null, repaired: false }
}

/* -------------------------------------------------------------------------- */
/* 视觉识别调用                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 把图片直接发给视觉模型，取回结构化草稿。
 *
 * @param {object} p
 * @param {object} p.cfg         resolveProviderConfig() 的结果
 * @param {string} p.imageSrc    data url 或 http(s) 图片地址
 * @param {string} [p.hint]
 * @param {string} [p.grade]
 * @param {string} [p.subject]
 * @param {string} [p.ocrText]   本地 OCR 文本（作为补充线索）
 * @returns {Promise<{raw: object, repaired: boolean, model: string}>}
 */
export async function recognizeWithVision({ cfg, imageSrc, hint, grade, subject, ocrText } = {}) {
  const content = [
    {
      type: 'text',
      text: [
        '请识别这张错题照片并按系统提示的 JSON 结构输出。',
        grade ? `年级：${grade}` : '',
        subject ? `已知学科：${subject}` : '',
        hint ? `补充线索：${hint}` : '',
        ocrText ? `本地 OCR 识别到的文字（可能有误，请以图片为准）：\n${String(ocrText).slice(0, 1200)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
  // 图片必须是**完整 data URL**（data:image/jpeg;base64,...）：
  // OpenAI 兼容端点（含本地 vLLM）都要求这个格式，裸 base64 会被拒绝。
  if (imageSrc) content.push({ type: 'image_url', image_url: { url: imageSrc } })

  const text = await callChat({
    cfg,
    model: cfg.visionModelEffective || cfg.model,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    json: true,
    timeoutMs: cfg.timeoutMs ?? 25000,
    temperature: cfg.temperature ?? 0.3,
  })

  const { data, repaired } = parseModelJson(text)
  if (!data || typeof data !== 'object') throw new Error('模型返回的内容不是合法 JSON')
  return { raw: data, repaired, model: cfg.visionModelEffective || cfg.model }
}

/**
 * 纯文本结构化：模型不支持图片输入时，用「本地 OCR 文本 + 大模型」整理草稿。
 *
 * @param {object} p
 * @param {object} p.cfg
 * @param {string} p.ocrText
 * @returns {Promise<{raw: object, repaired: boolean, model: string}>}
 */
export async function recognizeFromOcrText({ cfg, ocrText, hint, grade, subject } = {}) {
  const prompt = [
    '下面是本地 OCR 引擎从一张错题照片中识别出的文字，请把它整理成结构化错题草稿。',
    '注意：OCR 可能把选项连成一行（例如 "A.12B.16C.20D.24"），请自行拆分成独立选项；',
    '单独成行的「答：X」通常是学生用红笔写下的作答，应填入 myAnswer。',
    grade ? `年级：${grade}` : '',
    subject ? `已知学科：${subject}` : '',
    hint ? `补充线索：${hint}` : '',
    `OCR 原文：\n${String(ocrText ?? '').slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join('\n')

  const text = await callChat({
    cfg,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    json: true,
    timeoutMs: cfg.timeoutMs ?? 25000,
    temperature: cfg.temperature ?? 0.3,
  })

  const { data, repaired } = parseModelJson(text)
  if (!data || typeof data !== 'object') throw new Error('模型返回的内容不是合法 JSON')
  return { raw: data, repaired, model: cfg.model }
}

/* -------------------------------------------------------------------------- */
/* 草稿归一化                                                                  */
/* -------------------------------------------------------------------------- */

const OPTION_PREFIX = /^\s*[（(]?\s*([A-Ha-h])\s*[）).、．:：]\s*/
const OPTION_PREFIX_PAREN = /^\s*[（(]\s*([A-Ha-h])\s*[）)]\s*/

function stripOptionPrefix(text) {
  let s = String(text ?? '').trim()
  const m = s.match(OPTION_PREFIX) ?? s.match(OPTION_PREFIX_PAREN)
  if (m) {
    const letter = m[1].toUpperCase()
    const rest = s.slice(m[0].length).trim()
    // 只有当剩余内容非空时才认为是"字母前缀"，避免吃掉 "A" 这种纯答案
    if (rest) return { text: rest, letter }
  }
  return { text: s, letter: null }
}

function clamp01(v, dflt = 0) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(1, Math.max(0, n))
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100
}

/** 从 OCR 行里猜测「答：X」这类手写作答 */
export function extractAnswerHints(ocrLines = []) {
  const hints = []
  for (const line of ocrLines) {
    const text = String(line?.text ?? '').trim()
    if (!text) continue
    const m = text.match(/^(?:正确答案|参考答案|标准答案|答案|我的答案|我选|选择|答|选)\s*[:：、]?\s*(.+)$/)
    if (m) {
      const label = m[0].split(/[:：、]/)[0].trim()
      const value = m[1].trim()
      if (value) {
        const isCorrect = /答案/.test(label)
        hints.push({ value, line: text, kind: isCorrect ? 'correctAnswer' : 'myAnswer' })
      }
      continue
    }
    // 整行只有一个选项字母
    if (/^[A-Ha-h]$/.test(text)) hints.push({ value: text.toUpperCase(), line: text, kind: 'myAnswer' })
  }
  return hints
}

/**
 * 拆分一行里的选项，例如 "A.12B.16C.20D.24" -> [A:12, B:16, C:20, D:24]。
 * 字母必须**严格递增**（允许有缺口，如 A,B,D —— 缺口要留给 layout 信号惩罚）。
 */
export function splitOptionLine(line) {
  const text = String(line ?? '')
  const re = /([A-Ha-h])\s*[.、．)）:：]\s*/g
  const marks = []
  let m
  while ((m = re.exec(text)) !== null) {
    marks.push({ letter: m[1].toUpperCase(), start: m.index, contentStart: m.index + m[0].length })
  }
  if (marks.length < 2) return null
  let prev = ''
  for (const mark of marks) {
    if (prev && mark.letter <= prev) return null
    prev = mark.letter
  }
  const options = []
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length
    const content = text.slice(marks[i].contentStart, end).trim()
    if (content) options.push({ letter: marks[i].letter, text: content })
  }
  return options.length >= 2 ? options : null
}

/**
 * 把 OCR 的每一行按用途归类：题干 / 选项 / 学生作答 / 其他。
 * 这是「字段级置信度」与「字段级分位数 ocrToken」的基础（纯规则，不依赖模型）。
 *
 * @returns {{groups: {stem: object[], options: object[], answer: object[], other: object[]}, texts: string[]}}
 */
export function classifyOcrLines(lines = []) {
  const groups = { stem: [], options: [], answer: [], other: [] }
  const texts = lines.map((l) => String(l?.text ?? '').trim()).filter(Boolean)
  const answerHints = extractAnswerHints(lines)

  const scoreOf = (t) => {
    const hit = lines.find((l) => String(l?.text ?? '').trim() === t)
    const s = Number(hit?.score)
    return Number.isFinite(s) ? s : 0.9
  }
  const singleOption = (t) => String(t ?? '').match(/^([A-Ha-h])\s*[.、．)）:：]\s*(.+)$/)

  let i = 0
  while (i < texts.length) {
    const t = texts[i]
    const hint = answerHints.find((h) => h.line === t)
    if (hint) {
      groups.answer.push({ text: t, score: scoreOf(t), kind: hint.kind, value: hint.value, letter: null })
      i++
      continue
    }
    // 情况一：一行里挤了多个选项，如 "A.12B.16C.20D.24"
    const split = splitOptionLine(t)
    if (split) {
      const score = scoreOf(t)
      for (const o of split) groups.options.push({ text: o.text, letter: o.letter, score })
      i++
      continue
    }
    // 情况二：每个选项单独一行，如 "A.12" / "B.16" / ...
    if (singleOption(t)) {
      const group = []
      let j = i
      while (j < texts.length) {
        const m = singleOption(texts[j])
        if (!m) break
        group.push({ letter: m[1].toUpperCase(), text: m[2].trim(), score: scoreOf(texts[j]) })
        j++
      }
      const asc = group.every((g, k) => k === 0 || g.letter > group[k - 1].letter)
      if (group.length >= 2 && asc) {
        for (const g of group) groups.options.push({ text: g.text, letter: g.letter, score: g.score })
        i = j
        continue
      }
    }
    groups.stem.push({ text: t, score: scoreOf(t), letter: null })
    i++
  }

  return { groups, texts }
}

/**
 * 仅用本地 OCR 文本构造草稿（没有视觉模型时的降级路径）。
 *
 * 除了草稿本身，还会把 OCR 的每一行按用途分组（题干 / 选项 / 作答），
 * 以便派生**逐字段置信度**（视觉模型不在场时前端仍然有字段级信号）。
 *
 * @returns {{draft: object, optionLetters: string[], warnings: string[], groups: object}}
 */
export function draftFromOcrLines(lines = [], ctx = {}) {
  const warnings = []
  const { groups, texts } = classifyOcrLines(lines)

  const options = groups.options.map((o) => o.text)
  const optionLetters = groups.options.map((o) => o.letter).filter(Boolean)
  const stem = groups.stem.map((g) => g.text).join('\n').trim()

  if (!options.length) warnings.push('本地 OCR 未识别到选项行')
  if (!stem) warnings.push('本地 OCR 未识别到题干文字')

  const myHint = groups.answer.find((g) => g.kind === 'myAnswer')
  const corHint = groups.answer.find((g) => g.kind === 'correctAnswer')

  return {
    draft: {
      subject: ctx.fallbackSubject || '数学',
      questionType: ctx.fallbackQuestionType || '解答题',
      knowledgePoints: ctx.fallbackKnowledgePoints || [],
      stem,
      options,
      myAnswer: myHint?.value ?? '',
      correctAnswer: corHint?.value ?? '',
      difficulty: 3,
      ocrText: texts.join('\n'),
    },
    optionLetters,
    warnings,
    groups,
  }
}

/**
 * 由本地 OCR 的逐行 rec_scores 派生**逐字段置信度**。
 *
 * 映射规则（docs/07 §5.2 第 3 步：字段级置信度用该字段自己的分位数，而不是全文平均）：
 *   stem           -> 题干相关行 scores 的 P20
 *   options        -> 选项行 scores 均值
 *   myAnswer       -> 命中「答 / 答案 / 解」等作答行的 P20（该行缺失时给 0.3）
 *   correctAnswer  -> 识别到印刷体答案行则取其 score，否则给 0.1（基本不可信）
 *   knowledgePoints-> 由题干证据充分度推导（推理值，上限 0.6）
 *
 * 无法归属的行不参与任何字段。
 */
export function fieldConfidenceFromOcr(groups = {}, ctx = {}) {
  const g = groups ?? {}
  const avg = (arr) => {
    const list = (arr ?? []).filter((x) => x && Number.isFinite(Number(x.score)))
    if (!list.length) return 0
    return list.reduce((a, b) => a + Number(b.score), 0) / list.length
  }
  const scores = (arr) => (arr ?? []).map((x) => Number(x?.score)).filter(Number.isFinite)

  const stemConf = round2(percentile(scores(g.stem), 0.2))
  const optionsConf = round2(avg(g.options))
  const myScores = scores((g.answer ?? []).filter((x) => x.kind === 'myAnswer'))
  const corScores = scores((g.answer ?? []).filter((x) => x.kind === 'correctAnswer'))
  const myConf = myScores.length ? round2(percentile(myScores, 0.2)) : 0.3
  const corConf = corScores.length ? round2(percentile(corScores, 0.2)) : 0.1
  const stemLongEnough = String(ctx.stem ?? '').trim().length >= 8
  const kpConf = round2(Math.min(stemConf || 0.3, 0.6) * (stemLongEnough ? 1 : 0.6))

  return {
    stem: stemConf,
    options: optionsConf,
    myAnswer: myConf,
    correctAnswer: corConf,
    knowledgePoints: kpConf,
  }
}

/**
 * 把模型返回的草稿收敛为严格结构。
 *
 * @param {object} raw     模型返回
 * @param {object} ctx     { fallbackSubject, fallbackQuestionType, fallbackKnowledgePoints, hint, ocrText, ocrLines }
 * @returns {{draft: object, fieldConfidence: object, warnings: string[], repaired: boolean}}
 */
export function normalizeDraft(raw = {}, ctx = {}) {
  const warnings = []
  const r = raw && typeof raw === 'object' ? raw : {}

  /* ---- 学科 ---- */
  let subject = String(r.subject ?? '').trim()
  if (!SUBJECTS.includes(subject)) {
    if (subject) warnings.push(`模型返回的学科「${subject}」不在枚举内，已改为「${ctx.fallbackSubject || '数学'}」`)
    subject = ctx.fallbackSubject || '数学'
  }

  /* ---- 题型 ---- */
  let questionType = String(r.questionType ?? '').trim()
  if (!QUESTION_TYPES.includes(questionType)) {
    if (questionType) warnings.push(`模型返回的题型「${questionType}」不在枚举内，已改为「${ctx.fallbackQuestionType || '解答题'}」`)
    questionType = ctx.fallbackQuestionType || '解答题'
  }

  /* ---- 题干 ---- */
  let stem = String(r.stem ?? '').trim()
  if (!stem) {
    stem = String(ctx.hint ?? '').trim()
    if (stem) warnings.push('模型未返回题干，已回退为用户补充的线索文本')
  }

  /* ---- 选项（字母归一） ---- */
  const rawOptions = Array.isArray(r.options) ? r.options : []
  const options = []
  const letters = []
  for (const o of rawOptions) {
    const { text, letter } = stripOptionPrefix(o)
    if (!text && !letter) continue
    options.push(text)
    letters.push(letter)
  }
  if (rawOptions.length && !options.length) warnings.push('模型返回的选项无法解析，已忽略')
  if (options.length === 1) warnings.push('仅识别到 1 个选项，可能识别不完整')

  /* ---- 答案 ---- */
  const cleanAnswer = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v).trim()
    return s
  }
  let myAnswer = cleanAnswer(r.myAnswer)
  let correctAnswer = cleanAnswer(r.correctAnswer)

  // OCR 里的手写作答可以补齐模型漏掉的 myAnswer
  const hints = extractAnswerHints(ctx.ocrLines ?? [])
  if (!myAnswer && hints.length) {
    myAnswer = hints[0].value
    warnings.push('模型未识别出学生作答，已采用本地 OCR 识别的作答行')
  }

  const legalLetters = options.map((_, i) => String.fromCharCode(65 + i))
  const answerLegal = (value) => {
    if (!value) return true
    const v = value.trim()
    if (legalLetters.includes(v.toUpperCase())) return true
    const m = v.match(OPTION_PREFIX) ?? v.match(OPTION_PREFIX_PAREN)
    if (m && legalLetters.includes(m[1].toUpperCase())) return true
    if (/^[A-Ha-h]$/.test(v) && legalLetters.includes(v.toUpperCase())) return true
    return false
  }
  if (!answerLegal(myAnswer)) warnings.push('我的答案不在选项范围内')
  if (!answerLegal(correctAnswer)) warnings.push('正确答案不在选项范围内')

  /* ---- 知识点 ---- */
  let knowledgePoints = Array.isArray(r.knowledgePoints)
    ? r.knowledgePoints.map((k) => String(k ?? '').trim()).filter(Boolean)
    : []
  if (!knowledgePoints.length && Array.isArray(ctx.fallbackKnowledgePoints)) {
    knowledgePoints = ctx.fallbackKnowledgePoints
    warnings.push('模型未给出知识点，已回退为本地知识点推断')
  }

  /* ---- 难度 ---- */
  let difficulty = Math.round(Number(r.difficulty))
  if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 5) {
    difficulty = 3
    warnings.push('模型返回的难度超出 1-5，已修正为 3')
  }

  /* ---- OCR 文本 ---- */
  let ocrText = String(r.ocrText ?? '').trim()
  if (!ocrText) {
    ocrText = String(ctx.ocrText ?? '').trim()
    if (ocrText) warnings.push('模型未回传 OCR 原文，已使用本地 OCR 文本')
  }

  /* ---- 逐字段置信度 ---- */
  const fcRaw = r.fieldConfidence && typeof r.fieldConfidence === 'object' ? r.fieldConfidence : {}
  const fieldConfidence = {}
  for (const key of ['stem', 'options', 'myAnswer', 'correctAnswer', 'knowledgePoints']) {
    const v = fcRaw[key]
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) {
      fieldConfidence[key] = round2(clamp01(v))
    }
  }
  if (!Object.keys(fieldConfidence).length) {
    // 模型没给逐字段置信度时，用整体 confidence 兜底
    const overall = clamp01(r.confidence, 0.6)
    for (const key of ['stem', 'options', 'myAnswer', 'correctAnswer', 'knowledgePoints']) {
      fieldConfidence[key] = round2(overall)
    }
    warnings.push('模型未给出逐字段置信度，已用整体置信度近似')
  }

  const notes = r.notes ? String(r.notes) : null

  return {
    draft: {
      subject,
      questionType,
      knowledgePoints,
      stem,
      options,
      myAnswer,
      correctAnswer,
      difficulty,
      ocrText,
    },
    fieldConfidence,
    optionLetters: letters.filter(Boolean),
    warnings,
    notes,
  }
}

/* -------------------------------------------------------------------------- */
/* 置信度融合                                                                  */
/* -------------------------------------------------------------------------- */

/** 各信号的默认权重（缺失的信号不参与，权重按实际出现的信号归一） */
export const SIGNAL_WEIGHTS = {
  ocrToken: 0.35,
  modelSelf: 0.35,
  structure: 0.2,
  layout: 0.1,
  crossCheck: 0.1,
}

/** 模型自报逐字段置信度的加权（correctAnswer 常为空，权重压低） */
export const MODEL_SELF_WEIGHTS = {
  stem: 0.3,
  options: 0.3,
  myAnswer: 0.2,
  correctAnswer: 0.05,
  knowledgePoints: 0.15,
}

function normalizeText(s) {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[，。；：、,.!?！？"'""''（）()【】\[\]]/g, '')
    .toLowerCase()
}

function bigrams(s) {
  const out = new Set()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  if (s.length === 1) out.add(s)
  return out
}

/**
 * 分位数（线性插值）。
 * OCR 置信度是重尾分布：一行 0.3 分就能把算术均值从 0.95 拉到 0.87，
 * 而用户肉眼根本看不出那一行有问题——所以要用低分位数而不是均值。
 */
export function percentile(values, p = 0.2) {
  const arr = (values ?? []).map(Number).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!arr.length) return 0
  if (arr.length === 1) return arr[0]
  const idx = (arr.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return arr[lo]
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo)
}

/**
 * 字符级相似度：bigram Jaccard 与包含度（overlap）的折中。
 * 之所以不用「整串相等」：OCR 常把选项连成一行（A.12B.16C.20D.24），
 * 单纯的 Jaccard 会被这些噪声拉低；overlap 对局部噪声更宽容。
 */
export function textSimilarity(a, b) {
  const ta = normalizeText(a)
  const tb = normalizeText(b)
  if (!ta || !tb) return 0
  if (ta === tb) return 1
  const ga = bigrams(ta)
  const gb = bigrams(tb)
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  const union = ga.size + gb.size - inter
  const jaccard = union > 0 ? inter / union : 0
  const overlap = Math.min(ga.size, gb.size) > 0 ? inter / Math.min(ga.size, gb.size) : 0
  return Math.min(1, (jaccard + overlap) / 2)
}

/**
 * 包含度 coverage = |modelText ∩ ocrText| / |modelText|。
 *
 * `ocr.text` 往往是**整页多道题**，`modelText` 只是一道题，
 * 对称相似度天然被压到 0.3~0.5（系统性低估）。包含度衡量的是
 * 「模型结构化出来的题干+选项，有多少能在 OCR 原文里找到」，
 * 对整页 OCR 天然公平。
 */
export function textCoverage(modelText, ocrText) {
  const tm = normalizeText(modelText)
  const to = normalizeText(ocrText)
  if (!tm) return 0
  const gm = bigrams(tm)
  const go = bigrams(to)
  if (!gm.size) return 0
  let inter = 0
  for (const g of gm) if (go.has(g)) inter++
  return inter / gm.size
}

/**
 * 字段级 ocrToken：按字段归属取分位数后加权
 *   0.5×题干P20 + 0.3×选项行均值 + 0.2×学生作答行P20
 * 缺失的字段不计权重，按剩余权重归一。
 *
 * @returns {number|null} null 表示没有任何可用的 OCR 行
 */
export function ocrTokenFromGroups(groups = {}) {
  const g = groups ?? {}
  const stemScores = (g.stem ?? []).map((x) => Number(x.score)).filter(Number.isFinite)
  const optScores = (g.options ?? []).map((x) => Number(x.score)).filter(Number.isFinite)
  const ansScores = (g.answer ?? [])
    .filter((x) => x.kind === 'myAnswer')
    .map((x) => Number(x.score))
    .filter(Number.isFinite)

  const parts = []
  if (stemScores.length) parts.push({ value: percentile(stemScores, 0.2), weight: 0.5 })
  if (optScores.length) parts.push({ value: optScores.reduce((a, b) => a + b, 0) / optScores.length, weight: 0.3 })
  if (ansScores.length) parts.push({ value: percentile(ansScores, 0.2), weight: 0.2 })
  if (!parts.length) return null

  const w = parts.reduce((a, p) => a + p.weight, 0)
  return parts.reduce((a, p) => a + p.value * p.weight, 0) / w
}

/**
 * 版面完整度（layout 信号）与版面惩罚（layoutPenalty）。
 *
 * 四项各占 0.25：
 *   1. 题号存在
 *   2. 选项字母连续无缺口（A,B,C,D 不能缺 C）
 *   3. 题干含数学符号时检出公式块
 *   4. 检出学生作答块
 *
 * 惩罚：缺题号 ×0.95；选项字母有缺口 ×0.85；该有公式却没检出 ×0.80
 */
export function scoreLayout({ draft, groups, optionLetters = [] } = {}) {
  const stem = String(draft?.stem ?? '')
  const checks = []

  // 1. 题号
  const hasQuestionNumber = /^\s*(?:第\s*)?\d+\s*[.、．)）]/.test(stem) || /第\s*\d+\s*题/.test(stem)
  checks.push({ name: 'questionNumber', weight: 0.25, pass: hasQuestionNumber })

  // 2. 选项字母连续无缺口
  const letters = (optionLetters ?? []).filter(Boolean)
  let contiguous = true
  if (letters.length >= 2) {
    contiguous = letters.every((l, i) => l.toUpperCase() === String.fromCharCode(65 + i))
  }
  checks.push({ name: 'optionContinuity', weight: 0.25, pass: contiguous })

  // 3. 公式块（题干含数学符号时才检查）
  const hasMathSymbol = /[=＝+×÷√∠△∽°%π]|\d\s*\/\s*\d|\^|\$|\\frac/.test(stem)
  const hasFormulaBlock = /(\d\s*[=＝]\s*\d)|(\$[^$]+\$)|(\d\s*[+\-×÷*/]\s*\d)|(\d+\s*\/\s*\d+)|(√\s*\d)|(\d+\s*°)/.test(stem)
  checks.push({ name: 'formulaBlock', weight: 0.25, pass: hasMathSymbol ? hasFormulaBlock : true })

  // 4. 学生作答块
  const answerBlocks = (groups?.answer ?? []).length
  const hasAnswerBlock = answerBlocks > 0 || Boolean(draft?.myAnswer) || Boolean(draft?.correctAnswer)
  checks.push({ name: 'answerBlock', weight: 0.25, pass: hasAnswerBlock })

  const score = checks.reduce((acc, c) => acc + (c.pass ? c.weight : 0), 0)

  let penalty = 1
  if (!hasQuestionNumber) penalty *= 0.95
  if (!contiguous) penalty *= 0.85
  if (hasMathSymbol && !hasFormulaBlock) penalty *= 0.8

  return { score: Math.min(1, score), checks, penalty: Math.round(penalty * 1000) / 1000 }
}

/** 模型自报逐字段置信度的加权平均（无模型时返回 null） */
export function weightedModelSelf(fieldConfidence) {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return null
  let sum = 0
  let weight = 0
  for (const [key, w] of Object.entries(MODEL_SELF_WEIGHTS)) {
    const v = Number(fieldConfidence[key])
    if (Number.isFinite(v)) {
      sum += v * w
      weight += w
    }
  }
  if (!weight) return null
  return sum / weight
}

/** 结构校验得分（0~1）：逐项加权 */
export function scoreStructure(draft, { recognized = true, optionLetters = [] } = {}) {
  const checks = []

  // 1. 题干非空且长度 ≥ 8
  checks.push({
    name: 'stem',
    weight: 0.25,
    pass: recognized ? String(draft.stem ?? '').trim().length >= 8 : false,
  })

  // 2. 选项：若存在则 ≥2 项且字母唯一；选择题必须有选项
  const options = Array.isArray(draft.options) ? draft.options : []
  const letters = optionLetters.filter(Boolean)
  // 没有显式字母时（模型直接给了选项内容），字母是隐式 A/B/C…，天然唯一
  const lettersUnique = letters.length === 0 ? true : new Set(letters).size === letters.length
  let optionsPass
  if (!recognized) optionsPass = false
  else if (!options.length) optionsPass = draft.questionType !== '选择题'
  else optionsPass = options.length >= 2 && lettersUnique
  checks.push({ name: 'options', weight: 0.2, pass: optionsPass })

  // 3. 答案：若有选项则必须在合法字母集合内
  const legal = options.map((_, i) => String.fromCharCode(65 + i))
  const legalCheck = (v) => {
    if (!v) return true
    const s = String(v).trim()
    if (legal.includes(s.toUpperCase())) return true
    const m = s.match(OPTION_PREFIX) ?? s.match(OPTION_PREFIX_PAREN)
    return Boolean(m && legal.includes(m[1].toUpperCase()))
  }
  let answerPass
  if (!recognized) answerPass = false
  else if (!options.length) answerPass = true
  else answerPass = legalCheck(draft.myAnswer) && legalCheck(draft.correctAnswer)
  checks.push({ name: 'answers', weight: 0.2, pass: answerPass })

  // 4. 知识点非空
  checks.push({
    name: 'knowledgePoints',
    weight: 0.15,
    pass: Array.isArray(draft.knowledgePoints) && draft.knowledgePoints.length > 0,
  })

  // 5. 学科 / 题型在枚举内
  checks.push({
    name: 'enums',
    weight: 0.1,
    pass: SUBJECTS.includes(draft.subject) && QUESTION_TYPES.includes(draft.questionType),
  })

  // 6. 难度 1-5
  checks.push({
    name: 'difficulty',
    weight: 0.1,
    pass: Number.isFinite(Number(draft.difficulty)) && draft.difficulty >= 1 && draft.difficulty <= 5,
  })

  const score = checks.reduce((acc, c) => acc + (c.pass ? c.weight : 0), 0)
  return { score: Math.min(1, score), checks }
}

/**
 * 融合置信度。
 *
 * final = Σ(signal.value × signal.weight) / Σ(signal.weight)
 * final_adj = final × layoutPenalty
 *
 * 信号说明：
 *   ocrToken  字段级分位数加权（0.5×题干P20 + 0.3×选项均值 + 0.2×作答P20）
 *   modelSelf 模型自报逐字段置信度（加权平均；**没有模型时不参与**）
 *   structure 结构自洽度（6 项加权检查）
 *   layout    版面完整度（题号/选项连续性/公式块/作答块）
 *   crossCheck 包含度与对称相似度取较大值
 *
 * @param {object} p
 * @param {object} p.draft           归一化后的草稿
 * @param {object} [p.modelConfidence] 模型自报的逐字段置信度（没有模型时传 null）
 * @param {object} [p.ocr]            本地 OCR 结果 {avgScore, scores, text}
 * @param {object} [p.ocrGroups]      OCR 行分组（题干/选项/作答）
 * @param {boolean} [p.recognized]    是否有识别证据（OCR / 模型）
 * @param {string[]} [p.optionLetters]
 * @returns {{confidence: number, signals: {name:string,value:number,weight:number}[], layoutPenalty: number}}
 */
export function fuseConfidence({
  draft,
  modelConfidence,
  ocr,
  ocrGroups,
  recognized = true,
  optionLetters = [],
  crossCheck = true,
} = {}) {
  const signals = []

  // 1) 本地 OCR token：字段级分位数加权（不是全文算术平均）
  const token = ocrTokenFromGroups(ocrGroups)
  if (token !== null) {
    signals.push({ name: 'ocrToken', value: round2(clamp01(token)), weight: SIGNAL_WEIGHTS.ocrToken })
  } else if (ocr && Array.isArray(ocr.scores) && ocr.scores.length) {
    // 没有字段归属信息时退化为全部分数的 P20（仍然比算术平均稳健）
    const p20 = percentile(ocr.scores, 0.2)
    signals.push({ name: 'ocrToken', value: round2(clamp01(p20)), weight: SIGNAL_WEIGHTS.ocrToken })
  }

  // 2) 模型自报逐字段置信度（**只有真的调了模型才有**）
  const self = weightedModelSelf(modelConfidence)
  if (self !== null) {
    signals.push({ name: 'modelSelf', value: round2(clamp01(self)), weight: SIGNAL_WEIGHTS.modelSelf })
  }

  // 3) 结构校验得分
  const structure = scoreStructure(draft, { recognized, optionLetters })
  signals.push({ name: 'structure', value: round2(structure.score), weight: SIGNAL_WEIGHTS.structure })

  // 4) 版面完整度 + 版面惩罚
  const layout = scoreLayout({ draft, groups: ocrGroups, optionLetters })
  signals.push({ name: 'layout', value: round2(layout.score), weight: SIGNAL_WEIGHTS.layout })

  // 5) OCR 原文 vs 模型题干/选项：包含度与对称相似度取较大值
  //    （草稿本身来自 OCR 时不算，否则是自证循环）
  if (ocr?.text && recognized && crossCheck) {
    const modelText = [draft.stem, ...(draft.options ?? [])].filter(Boolean).join(' ')
    const sim = textSimilarity(ocr.text, modelText)
    const coverage = textCoverage(modelText, ocr.text)
    signals.push({
      name: 'crossCheck',
      value: round2(clamp01(Math.max(sim, coverage))),
      weight: SIGNAL_WEIGHTS.crossCheck,
    })
  }

  const totalWeight = signals.reduce((acc, s) => acc + s.weight, 0)
  const fused = totalWeight > 0
    ? signals.reduce((acc, s) => acc + s.value * s.weight, 0) / totalWeight
    : 0
  const final = fused * layout.penalty

  return {
    confidence: round2(clamp01(final)),
    signals,
    layoutPenalty: layout.penalty,
    layoutChecks: layout.checks,
  }
}

export default {
  SUBJECTS,
  QUESTION_TYPES,
  VISION_SYSTEM_PROMPT,
  parseModelJson,
  recognizeWithVision,
  recognizeFromOcrText,
  normalizeDraft,
  draftFromOcrLines,
  fieldConfidenceFromOcr,
  splitOptionLine,
  fuseConfidence,
  scoreStructure,
  textSimilarity,
  extractAnswerHints,
  SIGNAL_WEIGHTS,
}
