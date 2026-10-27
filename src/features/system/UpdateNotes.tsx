/**
 * features/system/UpdateNotes —— 更新说明（Release body）
 * ---------------------------------------------------------------------------
 * 安全约定：Release body 是从 GitHub 拉来的**外部内容**，只按纯文本渲染 ——
 *   - 不使用 dangerouslySetInnerHTML，避免 XSS；
 *   - 不执行其中的任何内容（脚本、链接一律当普通文字）；
 *   - 超长文本做折叠，避免把页面撑爆。
 */

import { useState } from 'react'

const PREVIEW_LIMIT = 1200

export function UpdateNotes({
  notes,
  loading = false,
}: {
  notes: string
  loading?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const text = (notes ?? '').trim()

  if (loading) {
    return (
      <div className="space-y-2 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
        <div className="h-3 w-1/3 animate-pulse rounded bg-ink-200" />
        <div className="h-3 w-full animate-pulse rounded bg-ink-200" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-ink-200" />
      </div>
    )
  }

  if (!text) {
    return (
      <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-3 py-3 text-[11px] leading-relaxed text-ink-400">
        这次发布没有写更新说明。
      </p>
    )
  }

  const long = text.length > PREVIEW_LIMIT
  const shown = long && !expanded ? text.slice(0, PREVIEW_LIMIT) : text

  return (
    <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
      {/* 纯文本渲染：保留换行，不解析任何 HTML */}
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-ink-600">
        {shown}
      </pre>
      {long && (
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-1"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起说明' : `展开全部（还有 ${text.length - PREVIEW_LIMIT} 字）`}
        </button>
      )}
    </div>
  )
}

export default UpdateNotes
