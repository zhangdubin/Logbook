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
import fs from 'node:fs'

/** 去掉 data:image/xxx;base64, 前缀，只保留裸 base64 */
export function stripDataUrl(dataUrl) {
  const s = String(dataUrl ?? '').trim()
  if (!s) return ''
  const idx = s.indexOf(',')
  if (s.startsWith('data:') && idx > 0) return s.slice(idx + 1).trim()
  return s
}

/**
 * 从任意形状的响应里抽取 { texts, scores, boxes }。
 *
 * boxes 是可选的坐标信息（外接矩形 [x0,y0,x1,y1]），来自新版的
 * `rec_boxes` / `text_lines`；旧服务没有这个字段时返回空数组。
 *
 * @returns {{texts: string[], scores: number[], boxes: number[][]}|null}
 */
export function extractOcrPairs(node) {
  if (!node) return null

  if (Array.isArray(node)) {
    // [[box, [text, score]], ...] 或 [[text, score], ...]
    const texts = []
    const scores = []
    const boxes = []
    for (const item of node) {
      if (typeof item === 'string') {
        texts.push(item)
        scores.push(0.9)
        boxes.push(null)
        continue
      }
      if (Array.isArray(item)) {
        const last = item[item.length - 1]
        const box = item.length >= 2 && Array.isArray(item[0]) ? item[0] : null
        if (Array.isArray(last) && last.length >= 2 && typeof last[0] === 'string') {
          texts.push(last[0])
          scores.push(Number(last[1]) || 0.9)
          boxes.push(box)
        } else if (typeof last === 'string') {
          texts.push(last)
          scores.push(0.9)
          boxes.push(box)
        }
      }
    }
    if (texts.length) return { texts, scores, boxes }
    for (const item of node) {
      const found = extractOcrPairs(item)
      if (found) return found
    }
    return null
  }

  if (typeof node !== 'object') return null

  // 0) 坐标信息：text_lines（新版侧车，带 box/score/text）或 rec_boxes
  const boxes = extractBoxes(node)

  // 1) PaddleOCR Serving v2: {rec_texts, rec_scores}
  if (Array.isArray(node.rec_texts)) {
    const scores = Array.isArray(node.rec_scores)
      ? node.rec_scores.map((s) => (Number.isFinite(Number(s)) ? Number(s) : 0.9))
      : node.rec_texts.map(() => 0.9)
    return { texts: node.rec_texts.map((t) => String(t ?? '')), scores, boxes }
  }

  // 2) {texts, scores}
  if (Array.isArray(node.texts)) {
    const scores = Array.isArray(node.scores)
      ? node.scores.map((s) => (Number.isFinite(Number(s)) ? Number(s) : 0.9))
      : node.texts.map(() => 0.9)
    return { texts: node.texts.map((t) => String(t ?? '')), scores, boxes }
  }

  // 3) {text, confidence}
  if (typeof node.text === 'string' && node.text) {
    const conf = Number(node.confidence ?? node.score ?? node.avg_score ?? 0.9)
    return { texts: [node.text], scores: [Number.isFinite(conf) ? conf : 0.9], boxes: [] }
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
 * 从响应里抽取文字框坐标（外接矩形 [x0,y0,x1,y1]）。
 * 兼容 `rec_boxes`（4点多边形或矩形）与 `text_lines[].box`。
 */
export function extractBoxes(node) {
  if (!node || typeof node !== 'object') return []

  // text_lines: [{text, score, box:[x0,y0,x1,y1], center:[cx,cy]}]
  if (Array.isArray(node.text_lines)) {
    const out = []
    for (const line of node.text_lines) {
      const rect = normalizeRect(line?.box)
      if (rect) out.push(rect)
    }
    if (out.length) return out
  }

  // rec_boxes: [[ [x,y],[x,y],[x,y],[x,y] ], ...] 或 [[x0,y0,x1,y1], ...]
  if (Array.isArray(node.rec_boxes)) {
    const out = []
    for (const box of node.rec_boxes) {
      const rect = normalizeRect(box)
      if (rect) out.push(rect)
    }
    if (out.length) return out
  }

  return []
}

/** 把多边形 / 矩形统一成 [x0,y0,x1,y1] */
function normalizeRect(box) {
  if (!Array.isArray(box) || !box.length) return null
  // 已经是 [x0,y0,x1,y1]
  if (box.length === 4 && box.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return [box[0], box[1], box[2], box[3]]
  }
  // 4 点多边形
  if (box.length >= 4 && box.every((p) => Array.isArray(p) && p.length >= 2)) {
    const xs = box.map((p) => Number(p[0])).filter(Number.isFinite)
    const ys = box.map((p) => Number(p[1])).filter(Number.isFinite)
    if (!xs.length || !ys.length) return null
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
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
/**
 * 本地 OCR 的超时上限。
 *
 * 实测（scripts/ocr-bench，NAS 上跑 CPU 版 RapidOCR）：
 *   干净图 / 仿真手机照 / 真实分辨率 —— 1.3 ~ 1.7 秒
 *   远距离小字（hard 档）           —— 11 ~ 15 秒（移动版模型）
 *                                     25 ~ 35 秒（server 级模型，会自动降级重试）
 *
 * 原来写死 15 秒，**刚好卡在 hard 档的边缘** —— 拍得远一点就超时，
 * 用户看到的却是「OCR 服务超时」，而不是「这张图太糊」。
 * 60 秒能覆盖最坏情况；正常照片 1 秒多就返回了，不影响体感。
 */
export const OCR_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.OCR_TIMEOUT_MS ?? 60000) || 60000,
)

/**
 * **这次部署**里，本地 OCR 应该填哪个地址。
 *
 * ⚠️ 为什么必须由后端给：
 *    同一个地址在两种部署下含义完全相反 ——
 *      · 应用直接跑在宿主机上 → `http://127.0.0.1:8868` ✓
 *      · 应用跑在 Docker 容器里 → `127.0.0.1` 指的是**应用容器自己** ✗
 *        必须用**容器名**（`cuoti-ocr` / `ocr`）
 *    前端**不知道**自己在哪种部署里，所以由后端说。
 *
 * 之前设置页的提示写死了「例如 http://127.0.0.1:8868」——
 * 用户**照着填就错**，然后看到「连不上」，
 * 于是得出「我明明启用了」的结论。
 *
 * 优先用安装脚本写进来的 `OCR_SERVICE_URL`（两种安装方式都写了**正确的**那个）：
 *   离线安装 → http://cuoti-ocr:8868
 *   在线安装 → http://ocr:8868
 *
 * @param env   环境变量（默认 process.env）
 * @param isContainer  是否跑在容器里（默认自动判断）
 */
export function suggestOcrUrl(env = process.env, isContainer = null) {
  const fromEnv = String(env.OCR_SERVICE_URL ?? '').trim()
  if (fromEnv) return { url: fromEnv, source: 'env' }
  const inContainer =
    isContainer === null
      ? Boolean(env.container) || fs.existsSync('/.dockerenv')
      : Boolean(isContainer)
  if (inContainer) return { url: 'http://cuoti-ocr:8868', source: 'container-default' }
  return { url: 'http://127.0.0.1:8868', source: 'host-default' }
}

/**
 * 把「连不上」翻译成**用户能直接照做的下一步**。
 *
 * ⚠️ 为什么要专门写这个函数：
 *    原来只报「无法连接本地 OCR 服务（ECONNREFUSED），请确认 OCR 服务已启动」——
 *    **既没说试的是哪个地址，也没说 ECONNREFUSED 到底意味着什么**。
 *    用户看到这句话只能瞎试：
 *    「我明明启用了」「我明明连上了」——
 *    因为「连上了」和「地址对」**根本不是一回事**。
 *
 *    ECONNREFUSED 的准确含义是：**域名解析成功了，但那个地址上没有进程在监听**。
 *    所以问题只可能是两个：
 *      ① 那个地址上确实没有服务（侧车没起 / 端口写错）
 *      ② 地址指向了**错误的那台机器**（最常见：容器里写 127.0.0.1）
 *
 * @param root  实际试过的地址
 * @param code  错误码
 */
export function explainOcrUnreachable(root, code) {
  const host = (() => {
    try {
      return new URL(root).hostname
    } catch {
      return ''
    }
  })()
  const where = root ? `（试的是 ${root}）` : ''

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return (
      `本地 OCR 服务地址解析不了（${code}）${where}：` +
      `这个域名在**当前进程所在的环境里不存在**。` +
      `如果应用跑在 Docker 里，域名要用**容器名**（如 cuoti-ocr / ocr），` +
      `不能用宿主机上的名字或 127.0.0.1。` +
      `（ECONNREFUSED = 地址能解析，但**上面没人接**；` +
      `ENOTFOUND = 地址本身解析不出来。两者别搞混。）`
    )
  }

  if (code === 'ECONNREFUSED') {
    const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
    return (
      `连不上本地 OCR 服务（ECONNREFUSED）${where}：` +
      `**域名解析成功了，但那个地址上没有进程在监听。**` +
      (isLoopback
        ? `⚠️ 你填的是**本机地址**——` +
          `如果应用跑在 **Docker 容器**里，127.0.0.1 指的是**应用容器自己**，` +
          `不是宿主机、也不是 OCR 容器。` +
          `请改成**容器名**：http://cuoti-ocr:8868（离线安装）或 http://ocr:8868（在线安装）。`
        : `请确认 OCR 容器在跑、端口对得上：docker ps 看容器、docker logs 看它的日志。`) +
      `（ECONNREFUSED = 地址能解析，但**上面没人接**；` +
      `ENOTFOUND = 地址本身解析不出来。两者别搞混。）`
    )
  }

  return `本地 OCR 服务连不上（${code}）${where}`
}

export async function runLocalOcr({ baseUrl, imageBase64, timeoutMs = OCR_TIMEOUT_MS } = {}) {
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
      ...(pairs.boxes?.[i] ? { box: pairs.boxes[i] } : {}),
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
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new Error(explainOcrUnreachable(root, code))
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 让 OCR 侧车把图片**预处理**后返回（EXIF 矫正 + 尺寸归一化 + LAB-CLAHE）。
 *
 * 用途：视觉模型看的是**增强后的图**，而不是手机原图。
 * 侧车这套处理是它把 real 档 CER 从 4.50% 打到 0.85% 的原因
 * （阴影 / 光照不均 / 字小），但以前处理完就把图扔了，模型一点没享受到。
 *
 * ⚠️ **任何失败都返回 null，绝不抛**：预处理是「锦上添花」，
 * 侧车没起 / 超时 / 版本旧（没有这个端点）都应该静默回退到原图，
 * 不能因为预处理失败把整条识别链路带崩。
 *
 * @param {object} p
 * @param {string} p.baseUrl       OCR 服务地址（不含 /preprocess）
 * @param {string} p.imageBase64   图片 base64（可带 data: 前缀，会自动剥离）
 * @param {number} [p.timeoutMs]
 * @param {Function} [p.fetchImpl] 注入的 fetch（单测用；默认用全局 fetch）
 * @returns {Promise<{image:string, variant:string, width:number, height:number, ms:number}|null>}
 */
export async function preprocessImage({
  baseUrl,
  imageBase64,
  timeoutMs = OCR_TIMEOUT_MS,
  fetchImpl = null,
} = {}) {
  const root = String(baseUrl ?? '').replace(/\/+$/, '')
  if (!root) return null
  const bare = stripDataUrl(imageBase64)
  if (!bare) return null

  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof doFetch !== 'function') return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await doFetch(`${root}/preprocess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: bare }),
      signal: controller.signal,
    })
    if (!res || !res.ok) return null
    const data = await res.json().catch(() => null)
    const image = typeof data?.image === 'string' ? data.image : ''
    if (!image) return null
    return {
      image,
      variant: String(data?.variant ?? ''),
      width: Number(data?.width) || 0,
      height: Number(data?.height) || 0,
      ms: Number(data?.ms) || 0,
    }
  } catch {
    // 侧车不可用 / 超时 / 返回体不是 JSON —— 一律降级成 null，调用方用原图
    return null
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
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return { reachable: false, detail: explainOcrUnreachable(root, code) }
    }
    return { reachable: false, detail: String(err?.message ?? err).slice(0, 120) }
  } finally {
    clearTimeout(timer)
  }
}

export default {
  suggestOcrUrl,
  runLocalOcr,
  extractOcrPairs,
  stripDataUrl,
  probeOcrService,
  preprocessImage,
  explainOcrUnreachable,
}
