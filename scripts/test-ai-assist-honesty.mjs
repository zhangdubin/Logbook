#!/usr/bin/env node
/**
 * scripts/test-ai-assist-honesty.mjs —— AI 辅助信息**必须逐条对得上实际发生的事**
 * ---------------------------------------------------------------------------
 * 这条原则是被真实 bug 逼出来的：
 *
 *   v1.1.19 之前，`aiAssist.enhancedImage` 写的是「增强图**生成**了」，
 *   而不是「模型**看过**它」。本地 OCR 路径下**根本没有模型**，
 *   但接口照样报 `enhancedImage: true`，
 *   界面就会显示「看的是增强后的图」—— **那是假话**。
 *
 *   同一个毛病还有 `selfChecked` / `agreement`：
 *   本地路径下 draft 本身就是从 ocr.text 推导出来的，
 *   拿它跟 ocr.text 比 —— **自己跟自己比，一致度永远是 100%**，
 *   报出去就成了「两个引擎高度一致」的假象。
 *
 *   【通则】AI 辅助信息必须**逐条对得上实际发生的事**，
 *   否则「可解释」就成了「自我宣传」——
 *   而**说谎的可解释性比没有可解释性更糟**：用户一旦发现被骗，
 *   连真的那部分也不信了。
 *
 * 用法：
 *   node scripts/test-ai-assist-honesty.mjs           # 打印结果
 *   node scripts/test-ai-assist-honesty.mjs --assert  # 失败则退出码 1
 *
 * 需要：
 *   - 本脚本会**自己起**一个 mock 模型（scripts/mock-vision-model.mjs 的逻辑内嵌）
 *   - OCR 侧车可选：起了就跑完整的「模型 + OCR」断言，
 *     没起就跳过依赖 OCR 的那几条（但核心断言仍然会跑）
 *
 * 环境变量：
 *   OCR_HOST=http://127.0.0.1:8869   # OCR 侧车地址（可选）
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzePhoto } from '../server/ai.js'
/* 前端的显示规则（依赖无关的 TS，Node 能直接导入）——
   断言的是**界面到底会显示哪几行**，而不只是字段之间不矛盾。 */
import {
  chosenSourceText,
  conflictText,
  engineSublineParts,
  shouldShowAgreement,
  shouldShowEnhanced,
  shouldShowNoConflictHint,
} from '../src/pages/entry/aiAssistRules.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/* -------------------------------------------------------------------------- */
/* 断言小工具                                                                   */
/* -------------------------------------------------------------------------- */
let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

/* -------------------------------------------------------------------------- */
/* 内嵌 mock 模型（带图 → 视觉草稿；纯文本 → 分析）                             */
/* -------------------------------------------------------------------------- */
const VISION_DRAFT = {
  stem: '小明身高 1.5 米，长方形的长是 8 米，宽是 5 米。求这个长方形的面积和周长。',
  options: ['40 平方米', '13 米', '26 平方米', '13 平方米'],
  myAnswer: '13',
  correctAnswer: '26',
  subject: '数学',
  questionType: '计算题',
  knowledgePoints: ['长方形面积'],
  difficulty: 3,
  ocrText: '小明身高 1.5 米',
  fieldConfidence: { stem: 0.94, options: 0.88, myAnswer: 0.91, correctAnswer: 0.86 },
}

function startMockModel() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => {
        raw += c
      })
      req.on('end', () => {
        let body = {}
        try {
          body = raw ? JSON.parse(raw) : {}
        } catch {
          body = {}
        }
        const messages = body.messages || []
        const hasImage = JSON.stringify(messages).includes('image_url')
        const text = JSON.stringify(hasImage ? VISION_DRAFT : { summary: 'mock 分析', tips: [] })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'chatcmpl-mock',
            model: body.model || 'mock-vision',
            choices: [
              { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } },
            ],
          }),
        )
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

/* -------------------------------------------------------------------------- */
/* 找一张样例图                                                                 */
/* -------------------------------------------------------------------------- */
function findSampleImage() {
  const candidates = [
    '/tmp/ocrtest/real/math.jpg',
    '/tmp/ocrtest/clean/math.png',
    path.join(ROOT, 'scripts/ocr-bench/samples/math.jpg'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* 主流程                                                                       */
/* -------------------------------------------------------------------------- */
console.log('\n=== AI 辅助信息必须逐条对得上实际发生的事 ===')

const imagePath = findSampleImage()
if (!imagePath) {
  console.log('  ⚠ 找不到样例图，跳过（先生成：python3 scripts/ocr-bench/make_samples.py --out /tmp/ocrtest）')
  console.log(`\n通过 ${pass} / 失败 ${fail}`)
  process.exit(process.argv.includes('--assert') ? 1 : 0)
}
console.log(`  样例图：${imagePath}`)

const imageBase64 = fs.readFileSync(imagePath).toString('base64')
const { server: mockServer, port: mockPort } = await startMockModel()
const OCR_HOST = process.env.OCR_HOST || 'http://127.0.0.1:8869'

// 先探一下 OCR 侧车在不在
let ocrUp = false
try {
  const r = await fetch(`${OCR_HOST}/health`, { signal: AbortSignal.timeout(2500) })
  ocrUp = r.ok
} catch {
  ocrUp = false
}
console.log(`  OCR 侧车：${ocrUp ? `${OCR_HOST}（可用）` : `${OCR_HOST}（不可用 —— 跳过依赖 OCR 的断言）`}`)

const baseCfg = {
  enabled: true,
  source: 'test',
  provider: 'mock',
  providerName: 'mock',
  apiKey: 'mock-key',
  baseUrl: `http://127.0.0.1:${mockPort}/v1`,
  model: 'mock-vision',
  visionModel: 'mock-vision',
  visionModelEffective: 'mock-vision',
  supportsVision: true,
  temperature: 0.1,
  timeoutMs: 15000,
  maxOutputTokens: 4096,
  ocrBaseUrl: ocrUp ? OCR_HOST : '',
  ocrEnabled: ocrUp,
}

try {
  /* ---------------------------------------------------------------- */
  console.log('\n=== 1. 有模型时的 aiAssist ===')
  /* ---------------------------------------------------------------- */
  const withModel = await analyzePhoto(
    { image: `data:image/jpeg;base64,${imageBase64}`, subject: '数学' },
    { cfg: baseCfg },
  )
  const aa1 = withModel.pipeline?.aiAssist || {}

  eq('usedModel = true（模型真的参与了）', aa1.usedModel, true)
  eq('engineKind = model', aa1.engineKind, 'model')
  check('modelName 有值', !!aa1.modelName, aa1.modelName)
  check('fieldsFromModel 列出模型给的字段', (aa1.fieldsFromModel || []).length > 0, JSON.stringify(aa1.fieldsFromModel))
  check('fieldsFromOcr 至少含 ocrText', (aa1.fieldsFromOcr || []).includes('ocrText') || !ocrUp)

  if (ocrUp) {
    eq('enhancedImage = true（模型确实看过增强图）', aa1.enhancedImage, true)
    check('enhancedVariant 有值', !!aa1.enhancedVariant, aa1.enhancedVariant)
    eq('selfChecked = true（两个引擎真的交叉核对过）', aa1.selfChecked, true)
    check('agreement 有值', aa1.agreement !== undefined, String(aa1.agreement))
  } else {
    eq('没有 OCR → 不可能有增强图，enhancedImage = false', aa1.enhancedImage, false)
    eq('没有 OCR → 不做交叉核对，selfChecked = false', aa1.selfChecked, false)
    eq('没有 OCR → 不报 agreement', aa1.agreement, undefined)
  }

  /* ---------------------------------------------------------------- */
  console.log('\n=== 2. ⭐ 没有模型时的 aiAssist（这里曾经撒谎） ===')
  /* ---------------------------------------------------------------- */
  const noModel = await analyzePhoto(
    { image: `data:image/jpeg;base64,${imageBase64}`, subject: '数学' },
    { cfg: { ...baseCfg, enabled: false, supportsVision: false } },
  )
  const aa2 = noModel.pipeline?.aiAssist || {}

  eq('usedModel = false', aa2.usedModel, false)
  eq('engineKind = local', aa2.engineKind, 'local')
  eq('enhancedImage = false（没有模型看过增强图）', aa2.enhancedImage, false)
  eq('enhancedVariant 不应有值', aa2.enhancedVariant, undefined)
  eq('secondPass = false', aa2.secondPass, false)

  if (ocrUp) {
    eq('selfChecked = false（本地路径下没有两个引擎可比）', aa2.selfChecked, false)
    eq('agreement 不应出现（自己跟自己比不算数）', aa2.agreement, undefined)
  }

  /* ---------------------------------------------------------------- */
  console.log('\n=== 3. ⭐ 界面显示规则（改坏了要红） ===')
  /* ---------------------------------------------------------------- */
  // 后端说没有模型 → 界面**不许**出现「看的是增强后的图」
  const localView = {
    usedModel: false,
    engineKind: 'local',
    enhancedImage: false,
    enhancedVariant: undefined,
    secondPass: false,
    selfChecked: false,
    agreement: undefined,
    conflictCount: 0,
  }
  eq('没有模型 → 不显示增强图', shouldShowEnhanced(localView), false)
  eq('没有模型 → 不显示一致度', shouldShowAgreement(localView), false)
  eq('没有模型 → 不显示「没有冲突」（压根没有两个引擎）', shouldShowNoConflictHint(localView), false)
  const localSub = engineSublineParts(localView, '自动增强')
  check(
    '没有模型 → 副标题里没有「增强后的图」',
    !localSub.some((p) => p.includes('增强')),
    JSON.stringify(localSub),
  )
  check(
    '没有模型 → 副标题明说「图片没有上传到云端」',
    localSub.some((p) => p.includes('没有上传到云端')),
    JSON.stringify(localSub),
  )

  // ⭐ 关键：**只有 enhancedVariant 有值、但没有模型看过** —— 也不能显示
  const lyingView = { ...localView, enhancedVariant: 'clahe_color' }
  eq('只有变体名、模型没看过 → 仍然不显示增强图', shouldShowEnhanced(lyingView), false)
  const lyingSub = engineSublineParts(lyingView, '自动增强')
  check(
    '只有变体名、模型没看过 → 副标题里也没有「增强」',
    !lyingSub.some((p) => p.includes('增强')),
    JSON.stringify(lyingSub),
  )

  // 有模型时该显示的都要显示
  const modelView = {
    usedModel: true,
    engineKind: 'model',
    enhancedImage: true,
    enhancedVariant: 'clahe_color',
    secondPass: true,
    selfChecked: true,
    agreement: 0.9,
    conflictCount: 0,
  }
  eq('有模型 → 显示增强图', shouldShowEnhanced(modelView), true)
  eq('有模型 → 显示一致度', shouldShowAgreement(modelView), true)
  eq('有模型且无冲突 → 显示「没有冲突」', shouldShowNoConflictHint(modelView), true)
  const modelSub = engineSublineParts(modelView, '自动增强对比度和颜色')
  check('有模型 → 副标题里有「增强后的图」', modelSub.some((p) => p.includes('增强后的图')), JSON.stringify(modelSub))
  check('有模型 → 副标题里有「图片由模型直接理解」', modelSub.some((p) => p.includes('直接理解')), JSON.stringify(modelSub))

  /* ---------------------------------------------------------------- */
  console.log('\n=== 4. ⭐ 冲突文案本身也得说对（方向不能反） ===')
  /* ---------------------------------------------------------------- */
  // 「最终采信了谁」的中文映射 —— 写错了就是把「采信 OCR」显示成「采信模型」
  eq('chosen=ocr → 说「OCR」', chosenSourceText('ocr'), 'OCR')
  eq('chosen=vision → 说「模型」', chosenSourceText('vision'), '模型')
  eq('chosen=model → 说「模型」', chosenSourceText('model'), '模型')
  eq('chosen=local → 说「本地 OCR」', chosenSourceText('local'), '本地 OCR')
  eq('chosen=human → 说「人工」', chosenSourceText('human'), '人工')
  eq('不认识的来源原样透出（不猜）', chosenSourceText('xyz'), '「xyz」')
  eq('没有 chosen → 空串', chosenSourceText(undefined), '')

  const labelOf = (f) => ({ stem: '题干', correctAnswer: '正确答案' })[f] || f

  // 冲突明细那句话：模型读到 A、OCR 读到 B，采信谁要说对
  const t1 = conflictText(
    { field: 'correctAnswer', vision: '26', ocr: '25', chosen: 'ocr' },
    labelOf,
  )
  check(
    '冲突句里「模型读到」在前、「OCR 读到」在后 —— 方向不能反',
    t1.includes('模型读到「26」') && t1.includes('OCR 读到「25」'),
    t1,
  )
  check('冲突句里写明采信了 OCR', t1.includes('最终采信OCR'), t1)
  check('冲突句里没有把 OCR 说成模型', !t1.includes('最终采信模型'), t1)

  const t2 = conflictText(
    { field: 'correctAnswer', vision: '26', ocr: '25', chosen: 'vision' },
    labelOf,
  )
  check('chosen=vision 时写明采信了模型', t2.includes('最终采信模型'), t2)
  check('chosen=vision 时没说采信 OCR', !t2.includes('最终采信OCR'), t2)

  // reason 里已经写了「采信」时不重复
  const t3 = conflictText(
    { field: 'correctAnswer', vision: '26', ocr: '25', chosen: 'ocr', reason: '以印刷体为准，采信 OCR' },
    labelOf,
  )
  check('reason 里已说「采信」时不重复一句', (t3.match(/采信/g) || []).length === 1, t3)

  // 只有一方时不要瞎编
  const t4 = conflictText({ field: 'stem', vision: '甲', chosen: 'vision' }, labelOf)
  check('只有一方时不说「不一致」', !t4.includes('不一致'), t4)

  /* ---------------------------------------------------------------- */
  console.log('\n=== 5. 逐条对照：报出来的每件事都得真的发生过 ===')
  /* ---------------------------------------------------------------- */
  // enhancedImage → 必须真的有模型参与
  check(
    'enhancedImage=true ⇒ usedModel=true',
    !aa1.enhancedImage || aa1.usedModel === true,
    `enhancedImage=${aa1.enhancedImage}, usedModel=${aa1.usedModel}`,
  )
  // agreement → 必须真的有 selfChecked
  check(
    'agreement 有值 ⇒ selfChecked=true',
    aa1.agreement === undefined || aa1.selfChecked === true,
    `agreement=${aa1.agreement}, selfChecked=${aa1.selfChecked}`,
  )
  // 字段来源不能同时都非空又互相矛盾
  check(
    'fieldsFromModel 与 fieldsFromOcr 不冲突',
    !(
      (aa1.fieldsFromModel || []).length &&
      (aa1.fieldsFromOcr || []).length &&
      (aa1.fieldsFromModel || []).some((f) => (aa1.fieldsFromOcr || []).includes(f))
    ),
    `model=${JSON.stringify(aa1.fieldsFromModel)} ocr=${JSON.stringify(aa1.fieldsFromOcr)}`,
  )
} finally {
  mockServer.close()
}

/* -------------------------------------------------------------------------- */
/* 结论                                                                         */
/* -------------------------------------------------------------------------- */
console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log(`  - ${f}`)
  if (process.argv.includes('--assert')) process.exit(1)
} else if (process.argv.includes('--assert')) {
  console.log('全部通过 ✅')
}
