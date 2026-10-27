/**
 * features/settings/ProviderGrid —— 供应商预设卡片网格
 * ---------------------------------------------------------------------------
 * 手机单列、平板两列、桌面三列。点击卡片即选中该供应商，
 * 外层表单的 Base URL 与默认模型会跟着填好。
 */

import type { AIProviderPreset } from '@/lib/types'
import { Badge, Skeleton } from '@/components/ui'

export function ProviderGrid({
  providers,
  selectedId,
  loading = false,
  onSelect,
}: {
  providers: AIProviderPreset[]
  selectedId: string
  loading?: boolean
  onSelect: (provider: AIProviderPreset) => void
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {providers.map((p) => {
        const selected = p.id === selectedId
        return (
          <article
            key={p.id}
            className={`card card-hover flex min-w-0 flex-col gap-2 p-4 transition ${
              selected
                ? 'border-brand-400 bg-brand-50/60 ring-2 ring-brand-300'
                : 'bg-white'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(p)}
              aria-pressed={selected}
              className="w-full min-w-0 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-ink-900">{p.name}</p>
                {p.supportsVision && (
                  <Badge tone="cyan">👁 支持图片识别</Badge>
                )}
                {selected && <Badge tone="blue">已选中</Badge>}
              </div>

              <p className="mt-1.5 text-[11px] font-semibold text-ink-500">
                默认模型
                <span className="ml-1 font-mono text-ink-700">
                  {p.defaultModel || '未指定'}
                </span>
              </p>
              <p className="min-w-0 truncate font-mono text-[11px] text-ink-400">
                {p.baseUrl || '自行填写 Base URL'}
              </p>

              {p.note && (
                <p className="mt-2 text-xs leading-relaxed text-ink-500">{p.note}</p>
              )}
            </button>

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-ink-100 pt-2.5">
              <span className="text-[11px] text-ink-400">
                {p.models.length ? `${p.models.length} 个可选模型` : '自定义模型名'}
              </span>
              {p.docUrl && (
                <a
                  href={p.docUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[11px] font-semibold text-brand-600 underline-offset-2 hover:underline"
                >
                  文档 ↗
                </a>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default ProviderGrid
