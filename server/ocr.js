/**
 * server/ocr.js —— 本地 OCR 服务适配器（PaddleOCR Serving v2 兼容）
 * ---------------------------------------------------------------------------
 * 用途：作为**并行信号源**，与视觉模型互为佐证。
 *
 * 主路径： POST {ocrBaseUrl}/predict  body {"images":["<base64>"]}
 *   → {"result":{"ocrResults":[{"prunedResult":{"rec_texts":[...],"rec_scores":[...]}}]}}
 *
 * 次选： POST {ocrBaseUrl}/ocr  body {"image":"<base64>"}
 *   → {"text":"...","confidence":0.98}
 *
 * 容错：解析时兼容下列常见返回形状
 *   {rec_texts, rec_scores} / {texts, scores} / {text, confidence} /
 *   {results:[...]} / {result:{ocrResults:[...]}} / [[box,(text,score)],...]
 *
 * 约定：任何失败都**不抛出到主流程**，调用方自行捕获并记一条 warning。
 */

import { RED_PIXEL_PNG_BASE64 } from './modelClient.js'

/** 去掉 data:image/xxx;base64, 前缀，只保留裸 base64 */
export function stripDataUrl(dataUrl) {
  const s = String(dataUrl ?? '').trim()
  if (!s) return ''
  const idx = s.indexOf(',')
  if (s.startsWith('data:') && idx > 0) return s.slice(idx + 1).trim()
  return s
}

/**
 * 从任意形状的响应里抽取 { texts, scores }。
 * @returns {{texts: string[], scores: number[]}|null}
 */
export function extractOcrPairs(node) {
  if (!node) return null

  if (Array.isArray(node)) {
    // [[box, [text, score]], ...] 或 [[text, score], ...]
    const texts = []
    const scores = []
    for (const item of node) {
      if (typeof item === 'string') {
        texts.push(item)
        scores.push(0.9)
        continue
      }
      if (Array.isArray(item)) {
        const last = item[item.length - 1]
        if (Array.isArray(last) && last.length >= 2 && typeof last[0] === 'string') {
          texts.push(last[0])
          scores.push(Number(last[1]) || 0.9)
        } else if (typeof last === 'string') {
          texts.push(last)
          scores.push(0.9)
        }
      }
    }
    if (texts.length) return { texts, scores }
    for (const item of node) {
      const found = extractOcrPairs(item)
      if (found) return found
    }
    return null
  }

  if (typeof node !== 'object') return null

  // 1) PaddleOCR Serving v2: {rec_texts, rec_scores}
  if (Array.isArray(node.rec_texts)) {
    const scores = Array.isArray(node.rec_scores)
      ? node.rec_scores.map((s) => (Number.isFinite(Number(s)) ? Number(s) : 0.9))
      : node.rec_texts.map(() => 0.9)
    return { texts: node.rec_texts.map((t) => String(t ?? '')), scores }
  }

  // 2) {texts, scores}
  if (Array.isArray(node.texts)) {
    const scores = Array.isArray(node.scores)
      ? node.scores.map((s) => (Number.isFinite(Number(s)) ? Number(s) : 0.9))
      : node.texts.map(() => 0.9)
    return { texts: node.texts.map((t) => String(t ?? '')), scores }
  }

  // 3) {text, confidence}
  if (typeof node.text === 'string' && node.text) {
    const conf = Number(node.confidence ?? node.score ?? node.avg_score ?? 0.9)
    return { texts: [node.text], scores: [Number.isFinite(conf) ? conf : 0.9] }
  }

  // 4) 递归查找
  for (const key of ['result', 'results', 'data', 'output', 'ocrResults', 'prunedResult']) {
    if (node[key] !== undefined) {
      const found = extractOcrPairs(node[key])
      if (found) return found
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = extractOcrPairs(value)
      if (found) return found
    }
  }
  return null
}

/**
 * 调用本地 OCR 服务。
 *
 * @param {object} p
 * @param {string} p.baseUrl       OCR 服务地址（不含 /predict）
 * @param {string} p.imageBase64   图片 base64（可带 data: 前缀，会自动剥离）
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{text: string, texts: string[], scores: number[], avgScore: number, lines: {text:string,score:number}[], engine: string}>}
 */
export async function runLocalOcr({ baseUrl, imageBase64, timeoutMs = 15000 } = {}) {
  const root = String(baseUrl ?? '').replace(/\/+$/, '')
  if (!root) throw new Error('未配置 OCR 服务地址')
  const bare = stripDataUrl(imageBase64)
  if (!bare) throw new Error('没有可送识别的图片数据')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const post = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) throw new Error(`OCR 服务返回 ${res.status}: ${text.slice(0, 160)}`)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('OCR 服务返回的不是合法 JSON')
    }
  }

  try {
    let data = null
    let engine = 'predict'
    try {
      // 注意：发给本地 OCR 服务的是**裸 base64**（已剥离 data: 前缀）
      data = await post(`${root}/predict`, { images: [bare] })
    } catch (err) {
      // /predict 不可用时退到 /ocr 便捷接口
      if (err?.status === 404 || err?.status === 405) {
        data = await post(`${root}/ocr`, { image: bare })
        engine = 'ocr'
      } else {
        throw err
      }
    }

    const pairs = extractOcrPairs(data)
    if (!pairs || !pairs.texts.length) throw new Error('OCR 服务未返回可识别的文本')

    const lines = pairs.texts.map((t, i) => ({
      text: String(t ?? ''),
      score: Number.isFinite(Number(pairs.scores[i])) ? Number(pairs.scores[i]) : 0.9,
    }))
    const valid = lines.filter((l) => l.text)
    const scores = valid.map((l) => l.score)
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

    return {
      text: valid.map((l) => l.text).join('\n'),
      texts: valid.map((l) => l.text),
      scores,
      avgScore,
      lines: valid,
      engine,
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`OCR 服务超时（${timeoutMs}ms）`)
    const code = err?.cause?.code || err?.code
    if (code === 'ECONNREFUSED') throw new Error('无法连接本地 OCR 服务（ECONNREFUSED），请确认 OCR 服务已启动')
    if (code === 'ENOTFOUND') throw new Error('本地 OCR 服务地址无法解析（ENOTFOUND）')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 探测本地 OCR 服务是否可达（用于「只配了本地 OCR、没配大模型」时的连通性测试）。
 * 先试 GET /health，再退回 POST /predict（塞一张 1×1 红 PNG，开销极小）。
 *
 * @returns {Promise<{reachable: boolean, detail: string}>}
 */
export async function probeOcrService({ baseUrl, timeoutMs = 8000 } = {}) {
  const root = String(baseUrl ?? '').replace(/\/+$/, '')
  if (!root) return { reachable: false, detail: '未配置 OCR 服务地址' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    try {
      const res = await fetch(`${root}/health`, { signal: controller.signal })
      if (res.ok) {
        const body = await res.text().catch(() => '')
        return { reachable: true, detail: body ? body.slice(0, 160) : 'OCR 服务健康检查通过' }
      }
    } catch {
      /* 继续尝试 /predict */
    }

    const res = await fetch(`${root}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [RED_PIXEL_PNG_BASE64] }),
      signal: controller.signal,
    })
    if (res.ok) return { reachable: true, detail: 'OCR 服务 /predict 探测通过' }
    const text = await res.text().catch(() => '')
    return { reachable: false, detail: `OCR 服务返回 ${res.status}: ${text.slice(0, 120)}` }
  } catch (err) {
    if (err?.name === 'AbortError') return { reachable: false, detail: `OCR 服务超时（${timeoutMs}ms）` }
    const code = err?.cause?.code || err?.code
    if (code === 'ECONNREFUSED') return { reachable: false, detail: '无法连接本地 OCR 服务（ECONNREFUSED）' }
    if (code === 'ENOTFOUND') return { reachable: false, detail: '本地 OCR 服务地址无法解析（ENOTFOUND）' }
    return { reachable: false, detail: String(err?.message ?? err).slice(0, 120) }
  } finally {
    clearTimeout(timer)
  }
}

export default { runLocalOcr, extractOcrPairs, stripDataUrl, probeOcrService }
