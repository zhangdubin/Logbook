/**
 * features/settings/OcrHealthCheck —— 本地 OCR 服务健康自检
 * ---------------------------------------------------------------------------
 * 规则：
 *   - 地址拼接：去掉末尾的 /，再拼 /health；
 *   - 超时 3 秒，失败一律静默（不打断用户）；
 *   - 200 等正常响应  → 「本地 OCR 服务可达 · 引擎 xxx」；
 *   - 404              → 服务在跑，只是没有 /health 接口（PaddleOCR Serving 就是
 *                        这种），同样算「可达」，不算错误；
 *   - 网络错误 / 超时 → 「未检测到本地 OCR 服务」。
 *
 * 注意：这是浏览器直连，受跨域策略限制——本地 OCR 服务没放开 CORS 时会检测不到，
 * 这不代表服务没启动，所以界面上会额外给一句提示。
 */

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'

export type OcrHealthState = 'idle' | 'checking' | 'ok' | 'ok-no-endpoint' | 'unreachable'

export interface OcrHealthInfo {
  state: OcrHealthState
  /** 服务自报的引擎名（rapidocr / paddleocr / ...） */
  engine?: string
}

/** 拼出健康检查地址 */
export function healthUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/health`
}

/** 真正发一次探测请求 */
export async function probeOcrHealth(baseUrl: string): Promise<OcrHealthInfo> {
  const url = healthUrl(baseUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    if (res.status === 404) {
      /* 服务在监听，只是没有健康接口 */
      return { state: 'ok-no-endpoint' }
    }
    let engine: string | undefined
    try {
      const data = (await res.json()) as Record<string, unknown> | null
      const candidates = ['engine', 'ocr_engine', 'backend', 'model', 'service', 'name', 'type']
      for (const key of candidates) {
        const v = data?.[key]
        if (typeof v === 'string' && v.trim()) {
          engine = v.trim()
          break
        }
      }
    } catch {
      /* 返回的不是 JSON，算了，只要服务有响应就行 */
    }
    return { state: 'ok', engine }
  } catch {
    return { state: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

export function OcrHealthCheck({
  baseUrl,
  enabled,
}: {
  baseUrl: string
  enabled: boolean
}) {
  const [info, setInfo] = useState<OcrHealthInfo>({ state: 'idle' })
  const [nonce, setNonce] = useState(0)

  const url = baseUrl.trim()

  useEffect(() => {
    if (!enabled || !url) {
      setInfo({ state: 'idle' })
      return
    }
    let alive = true
    setInfo({ state: 'checking' })
    const timer = setTimeout(() => {
      void probeOcrHealth(url).then((res) => {
        if (alive) setInfo(res)
      })
    }, 400)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [enabled, url, nonce])

  const recheck = useCallback(() => setNonce((n) => n + 1), [])

  const tone =
    info.state === 'ok'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : info.state === 'ok-no-endpoint'
        ? 'bg-blue-50 text-blue-700 ring-blue-200'
        : 'bg-ink-50 text-ink-500 ring-ink-200'

  const text =
    info.state === 'idle'
      ? '未配置本地 OCR 服务，拍照识别将使用视觉模型'
      : info.state === 'checking'
        ? '正在检测本地 OCR 服务…'
        : info.state === 'ok'
          ? `本地 OCR 服务可达${info.engine ? ` · 引擎 ${info.engine}` : ''}`
          : info.state === 'ok-no-endpoint'
            ? '本地 OCR 服务可达（该服务没有 /health 接口，不影响使用）'
            : '未检测到本地 OCR 服务，拍照识别将退化为提示词推导'

  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${tone}`}>
          {info.state === 'checking' ? (
            <>
              <Spinner size={12} />
              检测中
            </>
          ) : info.state === 'ok' ? (
            '🟢 服务在线'
          ) : info.state === 'ok-no-endpoint' ? (
            '🔵 服务在线'
          ) : (
            '⚪️ 未检测到'
          )}
        </span>
        <span className="text-[11px] leading-relaxed text-ink-600">{text}</span>
        {enabled && url && (
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={recheck}>
            ↻ 重新检测
          </button>
        )}
      </div>
      {enabled && url && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-400">
          检测地址：{healthUrl(url)} · 浏览器直连受跨域策略限制，服务没放开 CORS 时会显示「未检测到」，不代表服务没启动。
        </p>
      )}
    </div>
  )
}

export default OcrHealthCheck
