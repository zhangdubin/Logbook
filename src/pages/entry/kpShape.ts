/**
 * entry/kpShape —— 知识点「数据形状」防御
 * ---------------------------------------------------------------------------
 * 后端 draft 的契约是 string[]，analysis 的契约是对象数组（{name, confidence,
 * level, evidence}）—— 同一个字段在不同来源下形状可能不同，
 * 消费方必须按「两者都可能是」来写。
 *
 * 为什么这么较真：把普通对象当 React 子节点渲染会抛 React error #31，
 * 而整个 App 没有错误边界，一次渲染崩溃就是**整页白屏**（用户只看到「跳到空白页」）。
 * 所以这里所有取名 / 取文本的入口都做兜底：拿不到字符串就返回空串，绝不把对象交给 React。
 */

/** 知识点可能是字符串，也可能是 {name, confidence, level, evidence} 对象 */
export function kpName(kp: unknown): string {
  if (typeof kp === 'string') return kp.trim()
  if (kp && typeof kp === 'object') {
    const n = (kp as { name?: unknown }).name
    if (typeof n === 'string' && n.trim()) return n.trim()
    /* name 也可能是对象 —— 继续往下挖一层 */
    if (n && typeof n === 'object') {
      const deep = (n as { name?: unknown }).name
      if (typeof deep === 'string' && deep.trim()) return deep.trim()
    }
  }
  return ''
}

/** 知识点数组 → 去重后的字符串数组 */
export function kpNames(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const kp of list) {
    const name = kpName(kp)
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * 任意「本该是文本」的值 → 字符串；对象一律返回空串。
 * 用于题干、选项、依据、建议等所有直接渲染成子节点的地方。
 */
export function safeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  return ''
}

/** 任意「本该是字符串数组」的值 → 只保留非空字符串 */
export function safeTexts(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.map((x) => safeText(x)).filter((x) => x.length > 0)
}

/** 任何「本该是数组」的值 → 数组（不是数组就当空数组，避免 .map 直接抛异常） */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
