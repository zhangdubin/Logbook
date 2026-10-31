/**
 * features/settings/OcrHealthCheck —— 本地 OCR 服务健康自检
 * ---------------------------------------------------------------------------
 * ⚠️ 探测由**后端**发起（GET /api/settings/ocr-health），前端不再直连 OCR 服务。
 *
 * 为什么：Docker 部署时 OCR 地址常常是容器名（http://cuoti-ocr:8868），
 * 那是 Docker 内部网络里的名字，浏览器在宿主机 / 用户设备上根本解析不了 ——
 * 服务好好地在跑，页面却永远显示「未检测到」，用户就看到
 * 「我明明启用了，为什么说我没启用」。真相只能由后端给（后端在网络内部）。
 *
 * 状态：
 *   idle           没启用本地 OCR 服务
 *   checking       正在等后端探测
 *   ok             后端探到了：可达 + 引擎 + 耗时（耗时是「真的在跑」的强信号）
 *   unreachable    配了地址但探不到：显示后端给的原因，可展开看原文
 *   not-configured 没配地址（和「配了但连不上」是两回事，措辞也不同）
 *   error          健康检查接口本身没跑起来
 *
 * 组件的导出名与 props（baseUrl / enabled）保持不变，调用方不用改。
 */

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'
import { getOcrHealth, ocrHealthErrorText } from './ocrHealthApi'
import type { OcrHealthResponse } from './ocrHealthApi'

export type OcrHealthState =
  | 'idle'
  | 'checking'
  | 'ok'
  | 'unreachable'
  | 'not-configured'
  | 'error'

export interface OcrHealthInfo {
  state: OcrHealthState
  /** 服务自报的引擎名（rapidocr / paddleocr, ...） */
  engine?: string | null
  /** 后端给的原始返回 / 失败原因 */
  detail?: string | null
  /** 探测耗时（毫秒） */
  latencyMs?: number | null
  /** 实际被探测的地址（后端那边生效的） */
  baseUrl?: string
  /** 探测时间 */
  checkedAt?: string
  /** 健康检查接口本身失败时的错误 */
  error?: string | null
}

/** 把后端返回映射成界面状态 */
export function mapOcrHealth(res: OcrHealthResponse): OcrHealthInfo {
  const common = {
    engine: res.engine,
    detail: res.detail,
    latencyMs: res.latencyMs,
    baseUrl: res.baseUrl,
    checkedAt: res.checkedAt,
  }
  if (!res.configured) {
    /* 没配地址 —— 和「配了但连不上」要分开说 */
    return { ...common, state: 'not-configured' }
  }
  if (res.reachable) {
    return { ...common, state: 'ok' }
  }
  return { ...common, state: 'unreachable' }
}

/** 毫秒显示：142 -> "142ms" */
function formatLatency(ms?: number | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  return `${Math.round(ms)}ms`
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
    if (!enabled) {
      setInfo({ state: 'idle' })
      return
    }
    let alive = true
    setInfo({ state: 'checking' })
    /* 稍微延一点，避免刚打开页面就立刻打后端 */
    const timer = setTimeout(() => {
      void getOcrHealth()
        .then((res) => {
          if (alive) setInfo(mapOcrHealth(res))
        })
        .catch((e: unknown) => {
          if (alive) setInfo({ state: 'error', error: ocrHealthErrorText(e) })
        })
    }, 400)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    /* 注意：baseUrl 不进依赖 —— 后端探测的是「已保存」的地址，
       用户每敲一个字就重探一次既费又把「已保存」和「正在输入」搅在一起。
       表单地址与实际探测地址不一致时，界面会单独提示。 */
  }, [enabled, nonce])

  const recheck = useCallback(() => setNonce((n) => n + 1), [])

  /* 徽章 */
  const tone =
    info.state === 'ok'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : info.state === 'unreachable'
        ? 'bg-red-50 text-red-700 ring-red-200'
        : info.state === 'checking'
          ? 'bg-blue-50 text-blue-700 ring-blue-200'
          : info.state === 'error'
            ? 'bg-amber-50 text-amber-700 ring-amber-200'
            : 'bg-ink-50 text-ink-500 ring-ink-200'

  const badgeText =
    info.state === 'ok'
      ? '🟢 服务在线'
      : info.state === 'unreachable'
        ? '🔴 探测失败'
        : info.state === 'not-configured'
          ? '⚪️ 未配置'
          : info.state === 'error'
            ? '⚫️ 接口异常'
            : '⚪️ 未启用'

  /* 正文 */
  const latency = formatLatency(info.latencyMs)
  const text =
    info.state === 'idle'
      ? '未启用本地 OCR 服务 —— 打开上面的开关才会去探测。'
      : info.state === 'checking'
        ? '正在让后端探测本地 OCR 服务…'
        : info.state === 'ok'
          ? [
              '本地 OCR 服务可达',
              info.engine ? `引擎 ${info.engine}` : null,
              latency ? `耗时 ${latency}` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : info.state === 'not-configured'
            ? '未配置本地 OCR 服务地址 —— 填上地址并保存，这里会自动探测。'
            : info.state === 'error'
              ? `健康检查接口没跑起来：${info.error || '未知错误'}`
              : `探测失败${info.detail ? `：${info.detail}` : ''}`

  /* 表单里改了地址但还没保存 —— 探测的其实是已保存的地址，说清楚 */
  const probed = (info.baseUrl ?? '').trim()
  const stale = enabled && url && probed && url !== probed

  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${tone}`}
        >
          {info.state === 'checking' ? (
            <>
              <Spinner size={12} />
              探测中
            </>
          ) : (
            badgeText
          )}
        </span>
        <span className="text-[11px] leading-relaxed text-ink-600">{text}</span>
        {enabled && (
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={recheck}>
            ↻ 重新检测
          </button>
        )}
      </div>

      {/* 失败原因原文：折叠起来，用户要查时能展开 */}
      {info.state === 'unreachable' && info.detail && (
        <details className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
          <summary className="cursor-pointer select-none">查看后端返回的原始信息</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-ink-400">{info.detail}</p>
        </details>
      )}

      {stale && (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
          你改了地址但还没保存 —— 现在探测的是已保存的地址 <span className="font-mono">{probed}</span>；
          保存后再点「重新检测」即可。
        </p>
      )}

      {enabled && probed && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-400">
          探测地址：<span className="font-mono">{probed}</span> · 由后端发起探测（后端在服务器 / Docker 网络内，
          能连到容器名地址；浏览器直连会解析不了）。
        </p>
      )}
    </div>
  )
}

export default OcrHealthCheck
