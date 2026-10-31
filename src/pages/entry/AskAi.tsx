/**
 * entry/AskAi —— 「🤖 问 AI」就地展开的提问入口
 * ---------------------------------------------------------------------------
 * 用户反馈：「AI 辅助的也不明显」—— 除了显示「这次用了 AI」，
 * 还得给用户一个**看得见、点得动**的地方去问 AI。
 *
 * 设计取舍：
 *   · 就地展开，不跳页面 ——「看错题 → 问老师」的动线不能被打断；
 *   · 预置几个快捷问题，降低提问门槛；
 *   · 提问时自动带上题目上下文（题干、选项、孩子的答案、知识点），
 *     不用用户自己描述「哪道题」；
 *   · 回答要标明是「AI 生成」还是「本地规则整理」，和前面的来源标签一致。
 */

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui'
import { MathText } from '@/components/MathText'
import { dataClient } from './client'
import { kpNames } from './kpShape'
import type { ChatMessage } from '@/lib/types'

export interface AskAiContext {
  subject?: string
  stem?: string
  options?: string[]
  myAnswer?: string
  correctAnswer?: string
  knowledgePoints?: string[]
  errorType?: string
}

/** 把题目上下文拼进提问里，用户不用自己描述是哪道题 */
export function buildAskMessage(question: string, ctx: AskAiContext): string {
  const lines: string[] = []
  if (ctx.subject) lines.push(`【学科】${ctx.subject}`)
  if (ctx.stem) lines.push(`【题目】${ctx.stem}`)
  if (ctx.options && ctx.options.length) lines.push(`【选项】${ctx.options.join(' / ')}`)
  if (ctx.myAnswer) lines.push(`【孩子的答案】${ctx.myAnswer}`)
  if (ctx.correctAnswer) lines.push(`【正确答案】${ctx.correctAnswer}`)
  if (ctx.knowledgePoints && ctx.knowledgePoints.length) {
    lines.push(`【涉及知识点】${ctx.knowledgePoints.join('、')}`)
  }
  lines.push(`【问题】${question}`)
  return lines.join('\n')
}

/** 根据学科和知识点生成快捷问题 */
export function quickQuestions(ctx: AskAiContext): string[] {
  const kp = kpNames(ctx.knowledgePoints)[0]
  const list = ['这道题我为什么做错了？', '给我讲一遍这道题']
  if (kp) list.push(`「${kp}」这类题有什么通用方法？`)
  else list.push('这类题有什么通用方法？')
  list.push('给我出一道类似的题')
  return list
}

interface Answer {
  text: string
  byModel: boolean
  model?: string
  references: { label: string; detail: string }[]
  followUps: string[]
}

export function AskAi({
  context,
  studentId,
}: {
  context: AskAiContext
  /** 当前学生 id：后端按学生维度取学情，回答才贴合这个孩子 */
  studentId?: string
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [error, setError] = useState<string | null>(null)

  const quick = useMemo(() => quickQuestions(context), [context])

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || pending) return
    setPending(true)
    setError(null)
    setInput('')
    const nextHistory: ChatMessage[] = [...history, { role: 'user' as const, content: q }].slice(-8)
    setHistory(nextHistory)
    try {
      const res = await dataClient.chat({
        studentId,
        message: buildAskMessage(q, context),
        history: nextHistory.slice(0, -1),
      })
      setAnswer({
        text: res.answer ?? '',
        byModel: res.byModel === true,
        model: res.model,
        references: Array.isArray(res.references) ? res.references : [],
        followUps: Array.isArray(res.followUps) ? res.followUps : [],
      })
      setHistory([...nextHistory, { role: 'assistant' as const, content: res.answer ?? '' }].slice(-8))
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误'
      if (/403|权限|无权/.test(msg)) {
        setError('当前账号没有使用 AI 助手的权限，请联系管理员开通。')
      } else if (/网络|fetch|Network|Failed to fetch/i.test(msg)) {
        setError('连不上服务器，检查一下网络再试一次。')
      } else {
        setError(msg || 'AI 没有回应，请稍后再试一次。')
      }
      /* 提问失败就把这句撤回历史，避免下一轮带着这句重复上下文 */
      setHistory(history)
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-primary w-full justify-center gap-1.5 sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden>🤖</span> 问 AI
        <span className="text-[11px] font-normal opacity-80">讲得再细一点</span>
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink-800">
          <span aria-hidden>🤖</span> 问 AI
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          收起
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
        带上这道题一起问，回答会结合这个孩子的错题记录。
      </p>

      {/* 快捷问题 */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q}
            type="button"
            className="tag bg-white text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-100"
            onClick={() => void send(q)}
            disabled={pending}
          >
            {q}
          </button>
        ))}
      </div>

      {/* 提问框 */}
      <div className="mt-2.5 flex items-end gap-2">
        <textarea
          className="textarea min-h-[2.5rem] flex-1 text-sm"
          rows={2}
          value={input}
          placeholder="想问什么就写什么，比如「为什么用乘法分配律更快？」"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send(input)
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary shrink-0"
          onClick={() => void send(input)}
          disabled={pending || !input.trim()}
        >
          {pending ? '思考中…' : '发送'}
        </button>
      </div>

      {/* 回答 */}
      {pending && (
        <div className="mt-3 rounded-xl bg-white/80 px-3 py-2.5 text-xs text-ink-500 ring-1 ring-brand-100">
          AI 正在想…
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
          ⚠️ {error}
        </div>
      )}

      {answer && !pending && (
        <div className="mt-3 rounded-xl bg-white/90 p-3 ring-1 ring-brand-100">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {answer.byModel ? (
              <Badge tone="blue">🤖 AI 生成{answer.model ? `（${answer.model}）` : ''}</Badge>
            ) : (
              <Badge tone="slate">📋 本地规则整理（没有调用大模型）</Badge>
            )}
          </div>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-700">
            <MathText text={answer.text} />
          </p>

          {answer.references.length > 0 && (
            <div className="mt-2.5 border-t border-ink-100 pt-2">
              <p className="mb-1 text-[11px] font-bold text-ink-500">引用的数据</p>
              <ul className="space-y-1">
                {answer.references.map((r, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-ink-600">
                    · <span className="font-semibold text-ink-700">{r.label}</span>：{r.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {answer.followUps.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-ink-100 pt-2">
              {answer.followUps.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  className="tag bg-brand-50 text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-100"
                  onClick={() => void send(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AskAi
