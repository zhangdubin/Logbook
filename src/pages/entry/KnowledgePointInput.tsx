/**
 * entry/KnowledgePointInput —— 知识点标签输入
 * ---------------------------------------------------------------------------
 * 支持：回车 / 逗号添加、点 × 删除、点击 AI 推荐直接采纳、从已有关知识点下拉选择。
 */

import { useMemo, useState } from 'react'

export function KnowledgePointInput({
  value,
  onChange,
  suggestions = [],
  options = [],
  placeholder = '输入知识点后回车，例如「小数乘法」',
}: {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  options?: string[]
  placeholder?: string
}) {
  const [text, setText] = useState('')

  const listId = useMemo(() => `kp_${Math.random().toString(36).slice(2, 8)}`, [])

  const add = (raw: string) => {
    const name = raw.trim().replace(/[,，;；]/g, '')
    if (!name) return
    if (value.includes(name)) {
      setText('')
      return
    }
    onChange([...value, name])
    setText('')
  }

  const remove = (name: string) => onChange(value.filter((v) => v !== name))

  const pendingSuggestions = suggestions.filter((s) => !value.includes(s)).slice(0, 6)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-white p-2 focus-within:border-brand-400 focus-within:ring-[3px] focus-within:ring-brand-500/15">
        {value.map((kp) => (
          <span key={kp} className="tag bg-brand-50 text-brand-700 ring-1 ring-brand-200">
            {kp}
            <button
              type="button"
              onClick={() => remove(kp)}
              className="ml-0.5 rounded-full px-1 text-brand-600 hover:bg-brand-100"
              aria-label={`移除知识点 ${kp}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-ink-400"
          value={text}
          list={options.length ? listId : undefined}
          placeholder={value.length ? '继续添加…' : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && value.length) {
              remove(value[value.length - 1])
            }
          }}
          onBlur={() => add(text)}
        />
      </div>

      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}

      {pendingSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-ink-400">AI 推荐</span>
          {pendingSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="tag bg-violet-50 text-violet-700 ring-1 ring-violet-200 transition hover:bg-violet-100"
            >
              ＋ {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default KnowledgePointInput
