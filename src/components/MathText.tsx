/**
 * components/MathText —— 把带 LaTeX 的文本渲染成「看得懂的公式」
 * ============================================================================
 * 为什么需要它：
 *
 * 视觉模型识别数学/物理题时，公式会用 LaTeX 表示（行内 `$x^2$`）。
 * 如果前端**原样输出**，学生看到的就是 `x^2 + 2x + 1 = 0` 这种带美元符号的
 * 源码 —— 看起来就像「识别坏了」。这是「识别有问题」体验的一大来源，
 * 但根子不在识别，而在**渲染**。
 *
 * 用的什么：KaTeX（MIT，业界标准，GitHub / Notion / Wikipedia 都在用）。
 * 选它而不是自己写：公式排版要处理分数线、根号、上下标、矩阵、希腊字母，
 * 自己写的效果一定不如现成的；而 KaTeX 是纯前端渲染，没有服务端依赖，
 * 离线部署也不受影响。
 *
 * 设计取舍：
 *   - **解析失败就原样输出**，绝不吞内容 —— 公式渲染不出来时，
 *     学生至少还能看到原文，总比空白强；
 *   - 只在**只读展示**处用；可编辑的输入框里保持纯文本（用户要改的是源码）。
 */

import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

export type MathSegment =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; display: boolean }

/**
 * 把一段文本切成「普通文字 / 公式」若干段。
 *
 * 支持的分隔符：
 *   $$...$$   行间公式（独立成行）
 *   $...$     行内公式
 *   \(...\)   行内公式（另一种习惯写法）
 *   \[...\]   行间公式
 */
export function splitMathSegments(text: string): MathSegment[] {
  const src = String(text ?? '')
  if (!src) return []

  const out: MathSegment[] = []
  let buf = ''
  let i = 0

  const flush = () => {
    if (buf) {
      out.push({ type: 'text', value: buf })
      buf = ''
    }
  }

  while (i < src.length) {
    // $$...$$
    if (src.startsWith('$$', i)) {
      const end = src.indexOf('$$', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ type: 'math', value: src.slice(i + 2, end), display: true })
        i = end + 2
        continue
      }
    }
    // \[...\]
    if (src.startsWith('\\[', i)) {
      const end = src.indexOf('\\]', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ type: 'math', value: src.slice(i + 2, end), display: true })
        i = end + 2
        continue
      }
    }
    // \(...\)
    if (src.startsWith('\\(', i)) {
      const end = src.indexOf('\\)', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ type: 'math', value: src.slice(i + 2, end), display: false })
        i = end + 2
        continue
      }
    }
    // $...$
    if (src[i] === '$') {
      const end = src.indexOf('$', i + 1)
      // 必须非空，且换行前必须闭合（否则多半是误写的美元符号）
      if (end > i + 1 && !src.slice(i + 1, end).includes('\n')) {
        flush()
        out.push({ type: 'math', value: src.slice(i + 1, end), display: false })
        i = end + 1
        continue
      }
    }

    buf += src[i]
    i += 1
  }
  flush()
  return out
}

/** 渲染一段公式；失败则返回 null（调用方回退到原文） */
export function renderMath(latex: string, display: boolean): string | null {
  try {
    return katex.renderToString(latex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: 'html',
      trust: false,
    })
  } catch {
    return null
  }
}

export function MathText({
  text,
  className = '',
}: {
  text?: string | null
  className?: string
}) {
  const segments = useMemo(() => splitMathSegments(text ?? ''), [text])

  if (segments.length === 0) return null

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.value}</span>
        }
        const html = renderMath(seg.value, seg.display)
        // 渲染不出来就原样显示 —— 宁可丑，也不能把内容吞了
        if (html === null) {
          return (
            <span key={i} className="font-mono text-[0.92em] text-ink-600">
              {`$${seg.value}$`}
            </span>
          )
        }
        return (
          <span
            key={i}
            className={seg.display ? 'block my-2 overflow-x-auto' : 'inline-block align-middle'}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </span>
  )
}

export default MathText
