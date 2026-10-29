#!/usr/bin/env node
/**
 * scripts/test-model-client.mjs —— 模型连通性测试的回归用例
 * ---------------------------------------------------------------------------
 * 为什么需要这个文件？
 *
 * 用户报「配置大模型提示连接失败 / 模型返回内容为空」。
 * 根因不是他配错了 —— Base URL、API Key、模型名都是对的，
 * 是**我们的代码把输出预算给小了**：
 *
 *   1. 连通性测试写死 `maxTokens: 16`
 *      → 推理模型（MiniMax-M3.1-Flash 官方文档：thinking 默认就是 max，
 *        且 M3 系列不支持关闭）把这 16 个 token 全花在思考上，
 *        最终答案一个字都没输出 → content 是空串 → 报「模型返回内容为空」
 *
 *   2. 用的参数名是 `max_tokens`
 *      → MiniMax 官方已把 max_tokens 标为 deprecated，要求用 max_completion_tokens
 *
 *   3. 错误信息一律「连接失败」
 *      → MiniMax 的认证失败(1004)、余额不足(1008)、限流(1002) **都是 HTTP 200**，
 *        错误码在 body 的 base_resp.status_code 里。不解析就只能说「连接失败」，
 *        用户根本不知道该改什么
 *
 * 这里用本地 mock 服务把这几种返回形状都跑一遍，防止回归。
 *
 * 用法：node scripts/test-model-client.mjs [--assert]
 */

import http from 'node:http'
import { callChat } from '../server/modelClient.js'

/* ------------------------------- 迷你断言 ------------------------------- */
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

/* ------------------------- mock：模拟 MiniMax 返回 ------------------------ */

/**
 * @param {(body:object, url:string) => {status:number, json:object, text?:string}} handler
 */
function startMock(handler) {
  return new Promise((resolve) => {
    const received = []
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
          body = { __parseError: raw }
        }
        received.push({ body, url: req.url })
        const out = handler(body, req.url)
        res.writeHead(out.status, { 'Content-Type': 'application/json' })
        res.end(out.text ?? JSON.stringify(out.json ?? {}))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        server,
        received,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

/* ================================ 用例 ================================ */

console.log('\n\x1b[1m模型连通性：MiniMax 风格返回形状\x1b[0m')

/* ---- 1. 推理模型 + 小预算 → content 空（这是 bug 的现场） ---- */
{
  const mock = await startMock((body) => {
    const budget = body.max_completion_tokens ?? body.max_tokens ?? 0
    // 模拟真实推理模型：先思考，预算不够就只吐思考、content 为空
    const reasoning = '用户让我回复 OK。我应该只回复 OK 两个字母，不要多余解释。'
    const need = Math.ceil(reasoning.length / 2) + 4
    if (budget < need) {
      return {
        status: 200,
        json: {
          id: 'chatcmpl-mock',
          model: body.model,
          choices: [
            {
              index: 0,
              finish_reason: 'length',
              message: { role: 'assistant', content: '', reasoning_content: reasoning },
            },
          ],
          usage: { total_tokens: budget },
        },
      }
    }
    return {
      status: 200,
      json: {
        choices: [
          { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } },
        ],
      },
    }
  })

  // 小预算：应当**自愈**（自动加大预算重试），而不是报「内容为空」
  let out = ''
  try {
    const r = await callChat({
      cfg: { enabled: true, apiKey: 'sk-test', baseUrl: mock.baseUrl, model: 'MiniMax-M3.1-Flash' },
      messages: [{ role: 'user', content: 'OK' }],
      json: false,
      timeoutMs: 8000,
      temperature: 0,
      maxTokens: 16,
    })
    out = String(r).trim()
  } catch (err) {
    out = `THROWN: ${err.message}`
  }
  check(
    '小预算(16)被推理过程吃光 → 自动加预算重试成功',
    out.toUpperCase() === 'OK',
    out.slice(0, 80),
  )
  check(
    '  重试时用了 max_completion_tokens 参数名',
    mock.received.some((r) => r.body.max_completion_tokens !== undefined),
    `第 ${mock.received.length} 次请求`,
  )
  check(
    '  重试时预算已加大',
    mock.received.some((r) => (r.body.max_completion_tokens ?? 0) >= 1024),
  )
  await mock.close()
}

/* ---- 2. HTTP 200 + base_resp.status_code=1004（认证失败） ---- */
{
  const mock = await startMock(() => ({
    status: 200,
    json: {
      base_resp: { status_code: 1004, status_msg: 'invalid api key' },
      choices: [],
    },
  }))
  let msg = ''
  let providerCode = 0
  try {
    await callChat({
      cfg: { enabled: true, apiKey: 'sk-bad', baseUrl: mock.baseUrl, model: 'MiniMax-M3.1-Flash' },
      messages: [{ role: 'user', content: 'OK' }],
      json: false,
      timeoutMs: 8000,
    })
  } catch (err) {
    msg = err.message
    providerCode = err.providerCode ?? 0
  }
  check(
    'HTTP 200 但 base_resp.code=1004 → 报「认证失败」而不是「内容为空」',
    /认证失败/.test(msg) && !/内容为空/.test(msg),
    msg.slice(0, 60),
  )
  check('  providerCode 透传给调用方', providerCode === 1004, String(providerCode))
  await mock.close()
}

/* ---- 3. 不认识 max_completion_tokens 的老网关 → 回退 max_tokens ---- */
{
  const mock = await startMock((body) => {
    if (body.max_completion_tokens !== undefined) {
      return {
        status: 400,
        text: JSON.stringify({
          error: { message: "Unsupported parameter: 'max_completion_tokens' is not supported." },
        }),
      }
    }
    return {
      status: 200,
      json: { choices: [{ index: 0, finish_reason: 'stop', message: { content: 'OK' } }] },
    }
  })
  let out = ''
  try {
    out = String(
      await callChat({
        cfg: { enabled: true, apiKey: 'sk-test', baseUrl: mock.baseUrl, model: 'legacy-model' },
        messages: [{ role: 'user', content: 'OK' }],
        json: false,
        timeoutMs: 8000,
        maxTokens: 64,
      }),
    ).trim()
  } catch (err) {
    out = `THROWN: ${err.message}`
  }
  check('老网关不认 max_completion_tokens → 自动回退 max_tokens', out.toUpperCase() === 'OK', out.slice(0, 70))
  check(
    '  回退后的请求不再带 max_completion_tokens',
    mock.received.some((r) => r.body.max_completion_tokens === undefined && r.body.max_tokens !== undefined),
  )
  await mock.close()
}

/* ---- 4. content 里混着 <think> 思维链 → 要剥掉 ---- */
{
  const mock = await startMock(() => ({
    status: 200,
    json: {
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '<think>用户问的是颜色，我看到红色</think>红色',
          },
        },
      ],
    },
  }))
  let out = ''
  try {
    out = String(
      await callChat({
        cfg: { enabled: true, apiKey: 'sk-test', baseUrl: mock.baseUrl, model: 'think-model' },
        messages: [{ role: 'user', content: '什么颜色' }],
        json: false,
        timeoutMs: 8000,
      }),
    ).trim()
  } catch (err) {
    out = `THROWN: ${err.message}`
  }
  check('content 里的 <think> 思维链被剥掉', out === '红色', out.slice(0, 40))
  await mock.close()
}

/* ---- 5. 多模态数组型 content（{type:'text', text}） ---- */
{
  const mock = await startMock(() => ({
    status: 200,
    json: {
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: '红色' },
              { type: 'text', text: '。' },
            ],
          },
        },
      ],
    },
  }))
  let out = ''
  try {
    out = String(
      await callChat({
        cfg: { enabled: true, apiKey: 'sk-test', baseUrl: mock.baseUrl, model: 'mm-model' },
        messages: [{ role: 'user', content: '什么颜色' }],
        json: false,
        timeoutMs: 8000,
      }),
    ).trim()
  } catch (err) {
    out = `THROWN: ${err.message}`
  }
  check('多模态数组型 content 能正确拼接', out === '红色。', out.slice(0, 40))
  await mock.close()
}

/* ---- 6. JSON 模式：provider 不支持 response_format → 自动去掉重试 ---- */
{
  const mock = await startMock((body) => {
    if (body.response_format) {
      return {
        status: 400,
        text: JSON.stringify({ error: { message: "response_format is not supported" } }),
      }
    }
    return {
      status: 200,
      json: {
        choices: [{ index: 0, finish_reason: 'stop', message: { content: '{"ok":true}' } }],
      },
    }
  })
  let out = ''
  try {
    out = String(
      await callChat({
        cfg: { enabled: true, apiKey: 'sk-test', baseUrl: mock.baseUrl, model: 'no-json-model' },
        messages: [{ role: 'user', content: '返回 JSON' }],
        json: true,
        timeoutMs: 8000,
      }),
    ).trim()
  } catch (err) {
    out = `THROWN: ${err.message}`
  }
  check('不支持 response_format → 去掉后重试成功', out === '{"ok":true}', out.slice(0, 40))
  await mock.close()
}

/* ---- 7. content 为空且不是 length（比如被安全拦截）→ 报错要说人话 ---- */
{
  const mock = await startMock(() => ({
    status: 200,
    json: {
      choices: [
        { index: 0, finish_reason: 'content_filter', message: { role: 'assistant', content: '' } },
      ],
      output_sensitive: true,
    },
  }))
  let msg = ''
  try {
    await callChat({
      cfg: { enabled: true, apiKey: 'sk-test', baseUrl: mock.baseUrl, model: 'filter-model' },
      messages: [{ role: 'user', content: 'OK' }],
      json: false,
      timeoutMs: 8000,
    })
  } catch (err) {
    msg = err.message
  }
  check(
    'content 空且是安全拦截 → 提示里说清楚原因',
    /安全|拦截/.test(msg) || /内容为空/.test(msg),
    msg.slice(0, 60),
  )
  await mock.close()
}

/* ---- 8. 密钥不能出现在错误信息里 ---- */
{
  const mock = await startMock(() => ({
    status: 401,
    text: JSON.stringify({ error: { message: 'Incorrect API key provided: sk-supersecretkey123456' } }),
  }))
  let msg = ''
  try {
    await callChat({
      cfg: { enabled: true, apiKey: 'sk-supersecretkey123456', baseUrl: mock.baseUrl, model: 'm' },
      messages: [{ role: 'user', content: 'OK' }],
      json: false,
      timeoutMs: 8000,
    })
  } catch (err) {
    msg = err.message
  }
  check('错误信息里不泄露完整 API Key', !msg.includes('sk-supersecretkey123456'), msg.slice(0, 70))
  await mock.close()
}

/* ------------------------------- 结果 ------------------------------- */
console.log(
  `\n\x1b[1m结果：${passed} 通过 / ${failed} 失败\x1b[0m` +
    (failed ? `\n\x1b[31m失败项：\x1b[0m\n${failures.map((f) => `  - ${f}`).join('\n')}` : ''),
)

if (process.argv.includes('--assert') && failed) process.exit(1)
process.exit(failed ? 1 : 0)
