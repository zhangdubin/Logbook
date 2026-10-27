import { useCallback, useRef, useState } from 'react'
import { Card } from '@/components/ui'
import { useToast } from '@/store/toast'

export function ParentNotes({ notes }: { notes: string[] }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  const toast = useToast()

  const text = notes.join('\n')

  const handleCopy = useCallback(async () => {
    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      toast.push('家长沟通要点已复制到剪贴板', 'success')
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 2000)
    } else {
      toast.push('复制失败，请手动选择文本复制', 'error')
    }
  }, [text, toast])

  return (
    <Card
      title="家长沟通要点"
      subtitle="可直接复制发送到家长群或与老师沟通"
      extra={
        <button type="button" onClick={handleCopy} className="btn btn-outline btn-sm">
          {copied ? '✅ 已复制' : '📋 复制全部'}
        </button>
      }
    >
      {notes.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-400">暂无沟通要点</p>
      ) : (
        <>
          <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-4">
            <ul className="space-y-2.5">
              {notes.map((n, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-700">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-black text-brand-700">
                    {i + 1}
                  </span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-[11px] text-ink-400">
            共 {notes.length} 条 · 建议家长先看第 1-2 条，再决定是否需要约谈老师
          </p>
        </>
      )}
    </Card>
  )
}

/** 优先使用 Clipboard API，旧浏览器降级为 execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 降级处理 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
