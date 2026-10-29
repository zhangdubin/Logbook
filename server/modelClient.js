/**
 * server/modelClient.js —— OpenAI 兼容协议请求封装
 * ---------------------------------------------------------------------------
 * 统一处理：
 *   - 超时（AbortController）
 *   - response_format=json_object 不被支持时自动降级重试一次
 *   - 错误信息脱敏（绝不回显完整 API Key）
 *   - 多模态 content 数组（text / image_url）
 *
 * 不引入任何第三方依赖，使用 Node 内置 fetch。
 */

/** 1×1 纯红 PNG（base64 内嵌），用于视觉能力自检 */
export const RED_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** 1×1 纯红 PNG 的 data url */
export const RED_PIXEL_DATA_URL = `data:image/png;base64,${RED_PIXEL_PNG_BASE64}`

/** 清洗错误信息：去掉可能出现的完整密钥 */
export function sanitizeMessage(text, apiKey) {
  let s = String(text ?? '')
  const key = String(apiKey ?? '').trim()
  if (key) {
    s = s.split(key).join('****')
    // 部分服务会在响应体里回显带引号或转义的 key
    s = s.split(key.slice(0, 6)).join('****')
  }
  s = s.replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1****')
  s = s.replace(/("?(?:api[-_]?key|authorization)"?\s*[:=]\s*"?)[^"',}\s]+/gi, '$1****')
  return s.length > 400 ? `${s.slice(0, 400)}…` : s
}

/**
 * 去掉推理模型塞在正文里的思维链。
 *
 * 有些服务（MiniMax 的 reasoning_split=false 模式、部分国产模型）会把思考过程
 * 以 `<think>…</think>` 的形式**混在 content 里**返回。不剥掉的话，
 * 下游解析 JSON 就会因为思维链里的散文而失败。
 */
export function stripThinkTags(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*$/i, '')
    .trim()
}

/**
 * 提取模型返回的文本内容（兼容多种返回形状）。
 *
 * ⚠️ 这里必须能处理「content 为空但不是故障」的情况：
 *
 * **推理模型（reasoning model）默认会先思考**，思考内容单独放在
 * `reasoning_content` / `reasoning` 字段里，最终答案才在 `content`。
 * 如果输出预算（max_completion_tokens）被思考过程吃光，content 就会是**空字符串**，
 * 但请求本身是成功的（HTTP 200）—— 这时候不能笼统地报「连接失败」，
 * 得说清楚「输出预算被推理过程吃完了」。
 *
 * 兼容的返回形状：
 *   choices[0].message.content            （标准）
 *   choices[0].message.content[]           （多模态数组，形如 {type:'text', text}）
 *   choices[0].text                       （老式补全）
 *   choices[0].delta.content              （流式片段）
 *   choices[0].message.reasoning_content  （推理内容，最后兜底用）
 *   output.choices[0].message.content      （部分网关多包一层）
 */
function extractContent(data) {
  const choice = data?.choices?.[0] ?? data?.output?.choices?.[0]
  const msg = choice?.message ?? choice
  const raw = msg?.content ?? choice?.text ?? choice?.delta?.content ?? ''

  let text = ''
  if (Array.isArray(raw)) {
    text = raw
      .map((c) => {
        if (typeof c === 'string') return c
        if (typeof c?.text === 'string') return c.text
        if (typeof c?.content === 'string') return c.content
        return ''
      })
      .join('')
  } else if (typeof raw === 'object' && raw !== null) {
    text = typeof raw.text === 'string' ? raw.text : JSON.stringify(raw)
  } else if (typeof raw === 'string') {
    text = raw
  }

  text = stripThinkTags(text)

  // ⚠️ **不要**把 reasoning_content 当成答案返回。
  //
  // 推理模型的 reasoning_content 是**思考过程**，不是最终答案。
  // 把它当成答案返回，下游解析 JSON 会失败，用户还会看到模型的内心独白。
  //
  // 正确的处理是：content 为空但有 reasoning_content ⇒
  // **模型思考了，但没来得及输出答案**（输出预算被思考吃光了）。
  // 这是一个**可自愈**的情况：加大预算重试即可。
  // 这里只把「有没有思考过」这个信号带出去。
  const reasoningRaw =
    msg?.reasoning_content ?? msg?.reasoning ?? choice?.reasoning_content ?? ''
  const hadReasoning =
    typeof reasoningRaw === 'string' ? reasoningRaw.trim().length > 0 : Boolean(reasoningRaw)

  return { content: text, hadReasoning }
}

/**
 * 服务端在 HTTP 200 的响应体里带回的错误码。
 *
 * 不少国产服务（MiniMax 是典型）**认证失败、余额不足、限流都返回 HTTP 200**，
 * 真正的错误码放在 body 的 `base_resp.status_code` 里。
 * 不解析它的话，用户看到的会是「模型返回内容为空」这种毫无指向性的提示 ——
 * 而实际问题可能是 API Key 错了、余额没了。
 */
const PROVIDER_ERRORS = {
  1000: '服务端未分类错误',
  1001: '服务端超时',
  1002: '触发限流，请稍后重试',
  1003: '请求参数不合法',
  1004: '认证失败：API Key 无效或已过期',
  1008: '账户余额不足',
  1013: '服务端内部错误',
  1027: '输出内容被安全策略拦截',
  1039: 'Token 数超过模型上限',
  2013: '请求参数错误',
}

function providerBodyError(data) {
  const br = data?.base_resp
  if (!br || typeof br !== 'object') return null
  const code = Number(br.status_code ?? br.statusCode ?? 0)
  if (!code) return null
  // status_code 0 表示成功
  if (code === 0) return null
  const message = String(br.status_msg ?? br.statusMsg ?? '').trim()
  const known = PROVIDER_ERRORS[code]
  const text = known ? `${known}${message && message !== known ? `（${message}）` : ''}` : message || `错误码 ${code}`
  const err = new Error(`模型服务返回错误：${text}`)
  err.status = 0
  err.providerCode = code
  return err
}

/**
 * 调用一次 OpenAI 兼容的 chat/completions。
 *
 * @param {object} p
 * @param {object} p.cfg          { enabled, baseUrl, apiKey, model, temperature, timeoutMs }
 * @param {Array}  p.messages     OpenAI 风格消息数组（content 可为字符串或 content 数组）
 * @param {boolean} [p.json]      是否要求 JSON 输出（附带 response_format）
 * @param {number}  [p.timeoutMs]
 * @param {number}  [p.temperature]
 * @param {number}  [p.maxTokens]
 * @param {string}  [p.model]     覆盖 cfg.model（例如拍照识别用 visionModel）
 * @returns {Promise<string>} 模型返回的文本
 */
export async function callChat({
  cfg,
  messages,
  json = false,
  timeoutMs = 25000,
  temperature,
  maxTokens,
  model,
} = {}) {
  if (!cfg?.enabled) throw new Error('未配置可用的 API Key')
  const baseUrl = String(cfg.baseUrl ?? '').replace(/\/+$/, '')
  if (!baseUrl) throw new Error('未配置模型接口地址（baseUrl）')
  const targetModel = model || cfg.model
  if (!targetModel) throw new Error('未配置模型名（model）')

  const useTemp = Number.isFinite(Number(temperature)) ? Number(temperature) : Number(cfg.temperature ?? 0.3)

  /**
   * 发一次请求。
   *
   * @param {boolean} withJsonFormat  是否带 response_format=json_object
   * @param {number}  budget          本次给的输出预算（token）
   * @param {'auto'|'new'|'legacy'} tokenParam  用哪个参数名传预算
   */
  const attempt = async (withJsonFormat, budget = maxTokens, tokenParam = 'auto') => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const body = {
        model: targetModel,
        messages,
        temperature: useTemp,
        stream: false,
      }
      // 输出预算的参数名：
      //   max_completion_tokens —— 新标准（OpenAI o 系列 / MiniMax 推理模型都认这个）
      //   max_tokens           —— 老标准（很多老网关只认这个）
      // MiniMax 官方文档已把 max_tokens 标为 deprecated，并建议改用 max_completion_tokens；
      // 推理模型（M3.1-Flash 默认思考深度就是 max）尤其吃这个预算 ——
      // 预算给小了会被思考过程吃光，content 变成空串。
      // 所以：默认发 max_completion_tokens；被拒（400 点了这个参数名）再退回 max_tokens。
      // （不要两个一起发：有的网关会因多余参数直接 400。）
      if (budget) {
        if (tokenParam === 'legacy') body.max_tokens = budget
        else body.max_completion_tokens = budget
      }
      if (withJsonFormat) body.response_format = { type: 'json_object' }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey ?? ''}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err = new Error(
          `模型服务返回 ${res.status}: ${sanitizeMessage(text.slice(0, 300), cfg.apiKey)}`,
        )
        err.status = res.status
        err.rawBody = text
        throw err
      }

      const data = await res.json().catch(() => null)
      if (!data) throw new Error('模型返回的不是合法 JSON')

      // HTTP 200 但 body 里带错误码（MiniMax 认证失败/余额不足都是这样）
      const bodyErr = providerBodyError(data)
      if (bodyErr) throw bodyErr

      const { content, hadReasoning } = extractContent(data)
      if (!content) {
        // 推理模型把输出预算吃光了 —— 这是可自愈的：加大预算再来一次
        const choice = data?.choices?.[0] ?? data?.output?.choices?.[0]
        const finish = String(choice?.finish_reason ?? data?.finish_reason ?? '')
        const budgetEaten = finish === 'length' || hadReasoning
        const err = new Error(
          budgetEaten
            ? `模型输出预算被推理过程用完了` +
              `${finish === 'length' ? `（finish_reason=length，最多 ${budget ?? '?'} token）` : ''}。` +
              `请调大「最大输出长度」，或换一个不思考的模型。`
            : '模型返回内容为空（可能是内容被安全策略拦截，或该模型不支持这种请求）',
        )
        err.status = 0
        err.emptyContent = true
        err.finishReason = finish
        err.hadReasoning = hadReasoning
        err.budget = budget
        // 敏感内容拦截：MiniMax 会给 input_sensitive / output_sensitive 标记
        const sensitive =
          data?.input_sensitive === true ||
          data?.output_sensitive === true ||
          data?.base_resp?.output_sensitive_type > 0
        if (sensitive) {
          err.message = '模型返回内容为空：请求或模型输出触发了内容安全策略拦截'
          err.sensitive = true
        }
        throw err
      }
      return content
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error(`模型请求超时（${timeoutMs}ms）`)
        e.status = 0
        throw e
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await attempt(json)
  } catch (err) {
    const status = Number(err?.status ?? 0)
    const msg = String(err?.message ?? '')

    // 某些供应商不支持 response_format=json_object -> 去掉后重试一次
    const looksLikeFormatIssue =
      status === 400 ||
      status === 404 ||
      status === 422 ||
      /response_format|json_object|unsupported|unknown[_ ]?(param|parameter)/i.test(msg)

    // 不认识 max_completion_tokens（老网关）-> 退回 max_tokens
    // 注意要**看报错点的是哪个参数名**：
    //   报「不认识 max_completion_tokens」-> 老网关，只认 max_tokens
    //   报「max_tokens 不被支持」      -> OpenAI o 系列这类，只认 max_completion_tokens
    const rawErrText = String(err?.rawBody ?? '') + ' ' + msg
    const mentionsNew = /max_completion_tokens/i.test(rawErrText)
    const mentionsLegacy = /max_tokens/i.test(rawErrText) && !mentionsNew
    const looksLikeTokenParamIssue =
      status === 400 &&
      (mentionsNew || mentionsLegacy) &&
      /unsupported|unknown|extra_forbidden|unexpected|not supported|invalid/i.test(rawErrText)

    // 输出预算被推理过程吃光 -> 加大预算自动重试一次（自愈，不用用户手动改）
    if (err?.emptyContent && (err?.finishReason === 'length' || err?.hadReasoning)) {
      const bigger = Math.max(1024, Number(err?.budget ?? 0) * 4)
      try {
        return await attempt(json, bigger)
      } catch (err2) {
        if (err2?.emptyContent) {
          const e = new Error(
            `模型连续两次都把输出预算用完（已自动加到 ${bigger} token）。` +
              `请在「系统设置 → AI 引擎」里调大「最大输出长度」，或换一个不思考的模型。`,
          )
          e.status = 0
          throw e
        }
        throw err2
      }
    }

    if (json && looksLikeFormatIssue) {
      try {
        return await attempt(false)
      } catch (err2) {
        if (err2?.emptyContent && (err2?.finishReason === 'length' || err2?.hadReasoning)) {
          return await attempt(false, Math.max(1024, Number(err2?.budget ?? 0) * 4))
        }
        throw err2
      }
    }

    if (looksLikeTokenParamIssue) {
      // 报错点名了哪个参数，就换成**另一个**：老网关只认 max_tokens，
      // o 系列只认 max_completion_tokens
      const fallbackParam = mentionsNew ? 'legacy' : 'new'
      try {
        return await attempt(json, maxTokens, fallbackParam)
      } catch (err2) {
        if (err2?.emptyContent && (err2?.finishReason === 'length' || err2?.hadReasoning)) {
          return await attempt(
            json,
            Math.max(1024, Number(err2?.budget ?? 0) * 4),
            fallbackParam,
          )
        }
        throw err2
      }
    }

    throw err
  }
}

export default { callChat, sanitizeMessage, RED_PIXEL_DATA_URL, RED_PIXEL_PNG_BASE64 }
