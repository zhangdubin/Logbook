/**
 * features/settings/EngineStatusCard —— 当前生效引擎
 * ---------------------------------------------------------------------------
 * 页面顶部那块「现在到底用的是哪套引擎」的状态卡：
 *   - 引擎名称来自后端的 activeEngine 文案；
 *   - 本地引擎用灰色徽章，启用大模型用绿色徽章；
 *   - 顺带展示最后更新时间，让人知道配置是不是刚改过。
 */

import type { AISettings } from '@/lib/types'
import { Badge, Skeleton } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import type { LoadState } from './types'

export function EngineStatusCard({
  settings,
  state,
  loading = false,
  onReload,
}: {
  settings: AISettings
  state: LoadState
  loading?: boolean
  onReload?: () => void
}) {
  if (loading) {
    return (
      <div className="card space-y-3 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    )
  }

  const usingModel = Boolean(settings.enableModel)
  const hasEngineText = Boolean(settings.activeEngine?.trim())
  const engineText = hasEngineText
    ? (settings.activeEngine as string).trim()
    : usingModel
      ? '大模型引擎'
      : '本地启发式引擎'
  /* 以后端给的 activeEngine 文案为准：它说走本地就是本地（可能压根没配密钥） */
  const engineIsLocal = hasEngineText
    ? /本地|local|heuristic/i.test(engineText)
    : !usingModel
  const degraded = state === 'fallback' || state === 'error'

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-500">当前生效引擎</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-black tracking-tight text-ink-900">{engineText}</h2>
            {engineIsLocal ? (
              <Badge tone="slate">⚪️ 本地引擎</Badge>
            ) : (
              <Badge tone="green">🟢 大模型已启用</Badge>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-400">
            模型：{settings.model || '未指定'}
            {settings.visionModel ? ` · 视觉模型：${settings.visionModel}` : ''}
            {settings.updatedAt ? ` · 更新于 ${formatDateTime(settings.updatedAt)}` : ''}
          </p>
        </div>

        {onReload && (
          <button type="button" className="btn btn-outline btn-sm" onClick={onReload}>
            ↻ 刷新状态
          </button>
        )}
      </div>

      {usingModel && engineIsLocal && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
          「启用大模型」已经打开，但当前没有可用的密钥或模型，识别与诊断仍然走本地引擎；
          在下面填好密钥并保存就会自动切过去。
        </p>
      )}

      {degraded && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
          设置接口暂时不可用，这里展示的是默认值。等后端 <span className="font-mono">/api/settings/ai</span>{' '}
          就绪后再刷新一次即可。
        </p>
      )}
    </section>
  )
}

export default EngineStatusCard
