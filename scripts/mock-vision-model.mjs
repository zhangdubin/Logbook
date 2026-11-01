#!/usr/bin/env node
/**
 * scripts/mock-vision-model.mjs —— 模拟「能看图的」大模型（OpenAI 兼容接口）
 * ---------------------------------------------------------------------------
 * 为什么需要它：
 *
 *   模型路径（视觉模型直读图片）**没有 API key 就完全没法测**。
 *   而模型路径恰恰是问题最多的地方：
 *     · 视觉模型吃的是不是增强图？
 *     · 两遍识别的第二遍有没有真的改东西？
 *     · OCR ↔ 模型的冲突有没有被发现？
 *     · **AI 辅助信息有没有在「根本没发生的事」上撒谎？**
 *
 *   真实踩过的坑（v1.1.19）：
 *     `enhancedImage` 写的是「增强图**生成**了」，而不是「模型**看过**它」。
 *     本地 OCR 路径下没有模型，但接口照样报 enhancedImage=true，
 *     界面就会显示「看的是增强后的图」—— **那是假话**。
 *
 *   有了这个 mock，**「AI 辅助信息必须逐条对得上实际发生的事」**这条原则
 *   就能被自动化测试守住，而不是靠人眼。
 *
 * 用法：
 *   node scripts/mock-vision-model.mjs [port]
 *   # 默认 8898
 *
 *   然后把后端的模型配置指过来：
 *   PUT /api/settings/ai
 *   { "baseUrl": "http://127.0.0.1:8898/v1", "apiKey": "mock-key",
 *     "model": "mock-vision", "visionModel": "mock-vision",
 *     "enableModel": true, "ocrEnabled": true, "ocrBaseUrl": "http://127.0.0.1:8869" }
 */

import http from 'node:http'

const port = Number(process.argv[2]) || 8898

/** 视觉模型看到的「草稿」—— 字段名必须和 VISION_SYSTEM_PROMPT 里要求的**一字不差** */
const VISION_DRAFT = {
  stem: '小明身高 1.5 米，长方形的长是 8 米，宽是 5 米。求这个长方形的面积和周长。',
  options: ['40 平方米', '13 米', '26 平方米', '13 平方米'],
  myAnswer: '13',
  correctAnswer: '26',
  subject: '数学',
  questionType: '计算题',
  knowledgePoints: ['长方形面积', '长方形周长'],
  difficulty: 3,
  ocrText: '小明身高 1.5 米，长方形的长是 8 米，宽是 5 米。',
  fieldConfidence: {
    stem: 0.94,
    options: 0.88,
    myAnswer: 0.91,
    correctAnswer: 0.86,
    knowledgePoints: 0.8,
  },
  notes: null,
}

/** 第二遍「定向校正」的返回 —— 故意让它改一个字，好验证采纳链路 */
const REFINE_CORRECTIONS = {
  corrections: [
    {
      field: 'correctAnswer',
      from: '26',
      to: '26',
      reason: '与本地 OCR 读到的「26」一致',
    },
  ],
}

/** 文本模型的分析返回 */
const ANALYSIS = {
  summary: '面积和周长计算问题',
  diagnosis: {
    type: 'calculation',
    confidence: 0.8,
    reason: '周长算错',
    evidence: ['长和宽各是 8 和 5'],
  },
  rootCauses: ['周长公式记混了'],
  correctSteps: [
    { title: '审题', detail: '找出长 8 米、宽 5 米' },
    { title: '计算面积', detail: '8 × 5 = 40 平方米' },
    { title: '计算周长', detail: '(8 + 5) × 2 = 26 米' },
  ],
  knowledgeGaps: ['周长公式'],
  tips: ['画图标注长宽'],
  similarQuestions: [],
  practicePlan: [],
}

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
    const last = messages[messages.length - 1] || {}
    const content = typeof last.content === 'string' ? last.content : ''
    const hasImage = JSON.stringify(messages).includes('image_url')

    // 认得出这是「第二遍定向校正」还是「第一遍草稿」
    let payload
    if (hasImage && /校正|corrections/.test(content)) {
      payload = REFINE_CORRECTIONS
    } else if (hasImage) {
      payload = VISION_DRAFT
    } else {
      payload = ANALYSIS
    }

    const text = JSON.stringify(payload)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'chatcmpl-mock-vision',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'mock-vision',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: text, reasoning_content: '' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    )
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-vision-model] 监听 http://127.0.0.1:${port}/v1`)
  console.log('  · 带图的请求 → 返回视觉草稿 JSON')
  console.log('  · 纯文本请求 → 返回分析 JSON')
})
