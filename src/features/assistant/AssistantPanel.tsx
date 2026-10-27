import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import { useApp } from '@/store/app'
import type { ChatMessage, ChatResponse } from '@/lib/types'
import { Spinner } from '@/components/ui'

const QUICK_ASKS = [
  '我最近哪些知识点最薄弱？',
  '帮我安排本周的复习计划',
  '为什么我总是丢分？错因集中在哪？',
  '给家长写一份本周学情汇报',
]

interface Turn extends ChatMessage {
  id: string
  meta?: ChatResponse
  pending?: boolean
}

let seq = 0
const nextId = () => `m${++seq}`

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentStudent, currentStudentId } = useApp()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || busy) return
    setInput('')
    setError(null)
    setBusy(true)
    const userTurn: Turn = { id: nextId(), role: 'user', content }
    const history: ChatMessage[] = turns
      .filter((t) => !t.pending && t.content)
      .map((t) => ({ role: t.role, content: t.content }))
    setTurns((prev) => [...prev, userTurn, { id: nextId(), role: 'assistant', content: '', pending: true }])
    try {
      const res = await api.chat({
        studentId: currentStudentId || undefined,
        message: content,
        history: history.slice(-8),
      })
      setTurns((prev) =>
        prev.map((t) =>
          t.pending
            ? { ...t, pending: false, content: res.answer, meta: res }
            : t,
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 助手暂时不可用')
      setTurns((prev) => prev.filter((t) => !t.pending))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end">
      <div className="absolute inset-0 bg-ink-900/30 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        className="animate-pop-in relative z-10 flex h-[86vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop sm:h-full sm:w-[420px] sm:rounded-none"
        role="dialog"
        aria-label="AI 智能分析助手"
      >
        <header className="flex items-center gap-3 bg-gradient-to-r from-brand-600 to-brand-800 px-4 py-3.5 text-white">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20 text-lg">🤖</span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-black">AI 智能分析机</p>
            <p className="truncate text-[11px] text-white/75">
              {currentStudent ? `正在分析 ${currentStudent.name} 的错题数据` : '暂未选择学生'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 text-sm hover:bg-white/25"
            aria-label="关闭助手"
          >
            ✕
          </button>
        </header>

        <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-ink-50/60 px-4 py-4">
          {turns.length === 0 && (
            <div className="rounded-2xl border border-ink-200 bg-white p-4">
              <p className="text-sm font-bold text-ink-800">问我任何关于学习的问题</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                我会读取你的错题统计（学科分布、错因构成、知识点掌握度）来回答，
                所有结论都基于真实录入的错题数据。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_ASKS.map((q) => (
                  <button
                    key={q}
                    onClick={() => void send(q)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t) =>
            t.role === 'user' ? (
              <div key={t.id} className="flex justify-end">
                <p className="max-w-[82%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm leading-relaxed text-white">
                  {t.content}
                </p>
              </div>
            ) : (
              <div key={t.id} className="flex justify-start gap-2">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-sm ring-1 ring-ink-200">
                  🤖
                </span>
                <div className="min-w-0 max-w-[86%] space-y-2">
                  <div className="rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink-700 shadow-sm">
                    {t.pending ? (
                      <span className="flex items-center gap-2 text-ink-400">
                        <Spinner size={14} /> 正在分析你的错题数据…
                      </span>
                    ) : (
                      <p className="whitespace-pre-wrap">{t.content}</p>
                    )}
                  </div>

                  {!t.pending && t.meta?.references?.length ? (
                    <div className="space-y-1.5">
                      {t.meta.references.map((r, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[11px] leading-relaxed"
                        >
                          <span className="font-bold text-ink-800">{r.label}</span>
                          <span className="ml-1 text-ink-500">{r.detail}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {!t.pending && t.meta?.followUps?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {t.meta.followUps.map((f) => (
                        <button
                          key={f}
                          onClick={() => void send(f)}
                          className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] font-medium text-ink-600 transition hover:border-brand-300 hover:text-brand-700"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {!t.pending && t.meta && !t.meta.byModel ? (
                    <p className="px-1 text-[10px] text-ink-400">
                      由本地启发式分析引擎生成 · 配置大模型可获得更细致的解答
                    </p>
                  ) : null}
                </div>
              </div>
            ),
          )}

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-ink-100 bg-white p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={1}
              placeholder="问问你的错题数据…（Enter 发送）"
              className="textarea max-h-28 min-h-[42px] flex-1 !min-h-[42px] text-sm"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="btn btn-primary h-[42px] px-4"
            >
              {busy ? <Spinner size={14} /> : '发送'}
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-ink-400">
            回答基于本机录入的错题数据生成，不上传图片原始文件。
          </p>
        </div>
      </aside>
    </div>
  )
}

export function AssistantLauncher() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 grid place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl shadow-lg shadow-brand-600/35 ring-4 ring-white transition hover:scale-105 lg:bottom-6 lg:right-6"
        style={{ width: 52, height: 52 }}
        aria-label="打开 AI 智能分析助手"
      >
        🤖
      </button>
      <AssistantPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
