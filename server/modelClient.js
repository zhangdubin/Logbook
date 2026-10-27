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

/** 提取模型返回的文本内容（兼容多种返回形状） */
function extractContent(data) {
  const choice = data?.choices?.[0]
  const raw = choice?.message?.content ?? choice?.text ?? choice?.delta?.content ?? ''
  if (Array.isArray(raw)) {
    return raw
      .map((c) => (typeof c === 'string' ? c : typeof c?.text === 'string' ? c.text : ''))
      .join('')
  }
  if (typeof raw === 'object' && raw !== null) {
    return typeof raw.text === 'string' ? raw.text : JSON.stringify(raw)
  }
  return typeof raw === 'string' ? raw : ''
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

  const attempt = async (withJsonFormat) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const body = {
        model: targetModel,
        messages,
        temperature: useTemp,
        stream: false,
      }
      if (maxTokens) body.max_tokens = maxTokens
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
        throw err
      }

      const data = await res.json()
      const content = extractContent(data)
      if (!content) throw new Error('模型返回内容为空')
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
    // 某些供应商不支持 response_format=json_object -> 去掉后重试一次
    const status = Number(err?.status ?? 0)
    const looksLikeFormatIssue =
      status === 400 ||
      status === 404 ||
      status === 422 ||
      /response_format|json_object|unsupported|unknown[_ ]?(param|parameter)/i.test(String(err?.message ?? ''))
    if (json && looksLikeFormatIssue) {
      return await attempt(false)
    }
    throw err
  }
}

export default { callChat, sanitizeMessage, RED_PIXEL_DATA_URL, RED_PIXEL_PNG_BASE64 }
