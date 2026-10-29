/**
 * entry/KnowledgePointInput —— 知识点标签输入
 * ---------------------------------------------------------------------------
 * 支持：回车 / 逗号添加、点 × 删除、点击 AI 推荐直接采纳、从已有关知识点下拉选择。
 *
 * 防御：value 的对外契约是 string[]，但上游（后端字段形状漂移）可能塞进来
 * {name, confidence, ...} 对象 —— 直接渲染会抛 React #31 导致整页白屏。
 * 所以渲染前统一用 kpNames() 规整成字符串数组。
 */

import { useMemo, useState } from 'react'
import { kpNames } from './kpShape'

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

  /** 渲染前统一规整：对象也只会显示它的 name，绝不把对象交给 React */
  const safeValue = useMemo(() => kpNames(value), [value])
  const safeSuggestions = useMemo(() => kpNames(suggestions), [suggestions])

  const add = (raw: string) => {
    const name = raw.trim().replace(/[,，;；]/g, '')
    if (!name) return
    if (safeValue.includes(name)) {
      setText('')
      return
    }
    onChange([...safeValue, name])
    setText('')
  }

  const remove = (name: string) => onChange(safeValue.filter((v) => v !== name))

  const pendingSuggestions = safeSuggestions.filter((s) => !safeValue.includes(s)).slice(0, 6)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-white p-2 focus-within:border-brand-400 focus-within:ring-[3px] focus-within:ring-brand-500/15">
        {safeValue.map((kp) => (
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
          placeholder={safeValue.length ? '继续添加…' : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && safeValue.length) {
              remove(safeValue[safeValue.length - 1])
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
