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
  /** 这套部署里**应该**填的地址（后端给的） */
  suggestedUrl?: string
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
    suggestedUrl: res.suggestedUrl,
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
  onApplySuggested,
  refreshKey,
}: {
  baseUrl: string
  enabled: boolean
  /**
   * 一键采用后端推荐的地址。
   *
   * 为什么要有这个按钮：光说「你应该用容器名」是不够的 ——
   * 用户得**改地址 → 保存 → 再点检测**，三步。
   * 而这里能**点一下就改好并重测**。
   * 「告诉用户哪里错了」和「让用户一键修好」是两件事。
   */
  onApplySuggested?: (url: string) => void | Promise<void>
  /**
   * 变了就重新探测。
   *
   * 为什么需要它：原来组件**只在 enabled 变化时探测**，
   * 于是「一键改好并重测」保存完之后 —— 地址确实改对了、后端也确实连上了，
   * **页面徽章却还停在「🔴 探测失败」**。
   *
   * 保存是个**明确的动作**，不是「用户正在敲键盘」——
   * 所以保存完就该重探一次。
   * （用户每敲一个字就重探一次仍然不要 —— 那会把「正在输入」和「已保存」搅在一起。）
   */
  refreshKey?: number
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
  }, [enabled, nonce, refreshKey])

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
  /* 后端推荐的地址 */
  const suggested = (info.suggestedUrl ?? '').trim()
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

      {/* 失败原因：**默认展开** ——
          后端现在给的是「试的是哪个地址 + 这意味着什么 + 下一步做什么」，
          折起来等于白写。折叠只是留给以后可能出现的长文本。 */}
      {info.state === 'unreachable' && info.detail && (
        <details open className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
          <summary className="cursor-pointer select-none">为什么连不上 · 点这里看后端的原始信息</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-ink-500">{info.detail}</p>
        </details>
      )}

      {/* 一键修正：后端知道这套部署该用哪个地址，别让用户自己猜 */}
      {info.state === 'unreachable' &&
        onApplySuggested &&
        suggested &&
        suggested !== probed && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-2 py-1.5 text-[11px] leading-relaxed text-blue-900 ring-1 ring-blue-200">
            <span>
              这套部署里，OCR 地址应该用
              <span className="ml-1 font-mono font-semibold">{suggested}</span>
            </span>
            <button
              type="button"
              className="btn btn-sm rounded-md bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700"
              onClick={() => void onApplySuggested(suggested)}
            >
              一键改好并重测
            </button>
          </div>
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
