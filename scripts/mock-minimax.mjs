#!/usr/bin/env node
/**
 * scripts/mock-minimax.mjs —— 模拟 MiniMax M3.1-Flash 的 OpenAI 兼容接口
 * ---------------------------------------------------------------------------
 * 用途：本地复现「模型返回内容为空」这类问题，验证连通性测试能通过。
 *
 * 真实行为（依据 MiniMax 官方 OpenAPI 规范）：
 *   - `max_tokens` 已 deprecated，要用 `max_completion_tokens`
 *   - `MiniMax-M3.1-Flash` **总是会思考**（thinking 默认 max，M3 系列不支持关闭）
 *   - 推理内容放在 `reasoning_content`，最终答案放在 `content`
 *   - 预算不够时 content 为空串，finish_reason = 'length'
 *   - 认证失败等错误也返回 HTTP 200，错误码在 `base_resp.status_code`
 *
 * 用法：node scripts/mock-minimax.mjs [port] [--mode=empty|ok|auth|legacy]
 */

import http from 'node:http'

const port = Number(process.argv[2]) || 8899
const modeArg = process.argv.find((a) => a.startsWith('--mode='))
const mode = modeArg ? modeArg.split('=')[1] : 'ok'

const REASONING = '用户要求只回复 OK。我应当直接回答 OK，不做任何额外解释。'

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
    const budget = body.max_completion_tokens ?? body.max_tokens ?? 0
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }

    // 认证失败（HTTP 200 + base_resp）
    if (mode === 'auth') {
      return send({ base_resp: { status_code: 1004, status_msg: 'invalid api key' }, choices: [] })
    }

    // 老网关：不认 max_completion_tokens
    if (mode === 'legacy') {
      if (body.max_completion_tokens !== undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        return res.end(
          JSON.stringify({
            error: { message: "Unsupported parameter: 'max_completion_tokens' is not supported." },
          }),
        )
      }
      return send({
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
      })
    }

    // 空内容：模拟预算被思考吃光
    if (mode === 'empty') {
      return send({
        choices: [
          {
            index: 0,
            finish_reason: 'length',
            message: { role: 'assistant', content: '', reasoning_content: REASONING },
          },
        ],
      })
    }

    // 返回合法 JSON（模拟模型正常分析）
    if (mode === 'json') {
      const payload = {
        subject: '数学',
        questionType: '应用题',
        knowledgePoints: ['行程问题'],
        diagnosis: {
          type: 'method',
          confidence: 0.7,
          reason: '模型给出的判断',
          evidence: ['模型依据1'],
        },
        rootCauses: ['模型给出的根因一', '模型给出的根因二'],
        correctSteps: [
          { title: '审题', detail: '把条件和问题圈出来' },
          { title: '列式', detail: '根据数量关系列式计算' },
        ],
        knowledgeGaps: ['速度与时间的关系'],
        tips: ['多练行程问题'],
        similarQuestions: [
          { stem: '甲乙相距 400 千米，相向而行，速度 50 和 50，求时间', answer: '4 小时', analysis: '速度和 100', difficulty: 3 },
          { stem: '相距 240 千米，速度 30 和 30', answer: '4 小时', analysis: '速度和 60', difficulty: 3 },
          { stem: '相距 120 千米，速度 20 和 40', answer: '2 小时', analysis: '速度和 60', difficulty: 2 },
        ],
        practicePlan: [
          { day: 1, focus: '复习', task: '复习行程问题', minutes: 20 },
          { day: 2, focus: '练习', task: '做 3 道题', minutes: 20 },
          { day: 3, focus: '练习', task: '做 3 道题', minutes: 20 },
          { day: 4, focus: '错题', task: '整理错题', minutes: 20 },
          { day: 5, focus: '变式', task: '做变式题', minutes: 20 },
          { day: 6, focus: '巩固', task: '重做', minutes: 20 },
          { day: 7, focus: '复盘', task: '复盘', minutes: 20 },
        ],
        summary: '模型生成的摘要',
      }
      return send({
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(payload) },
          },
        ],
      })
    }

    // 正常：预算够就答
    const need = Math.ceil(REASONING.length / 2) + 8
    if (budget && budget < need) {
      return send({
        choices: [
          {
            index: 0,
            finish_reason: 'length',
            message: { role: 'assistant', content: '', reasoning_content: REASONING },
          },
        ],
      })
    }
    return send({
      id: 'chatcmpl-mock-minimax',
      model: body.model,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'OK',
            reasoning_content: REASONING,
          },
        },
      ],
      usage: { total_tokens: budget },
      base_resp: { status_code: 0, status_msg: 'success' },
    })
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-minimax] 监听 http://127.0.0.1:${port}/v1  模式=${mode}`)
})
