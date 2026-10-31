/**
 * components/SolutionSteps —— 解题步骤（文字 + SVG 示意图）
 * ============================================================================
 * 用法：
 *   <SolutionSteps steps={analysis.correctSteps} subject={question.subject} />
 *
 * steps 里每一步的形状：
 *   { title: string, detail: string, figure?: FigureData }
 *
 * `figure` 由**后端确定性推导**（server/solutionFigure.js）——
 * 推导不出来就没有图，宁缺毋滥。
 *
 * 交互：
 *   - 步骤默认全部展开（学生复盘时不想多点一次）；
 *   - 图在步骤展开时**入场动画**出现；
 *   - 支持点某一步只聚焦那一步的图（移动端上方的图不会太远）。
 */

import { useEffect, useState } from 'react'
import { SolutionFigure, type FigureData } from './SolutionFigure'

export interface SolutionStep {
  title?: string
  detail?: string
  figure?: FigureData | null
}

export function SolutionSteps({
  steps,
  subject,
}: {
  steps?: SolutionStep[] | null
  subject?: string
}) {
  const list = Array.isArray(steps) ? steps : []
  const [active, setActive] = useState<number | null>(null)

  // 步骤变了就把焦点收回第一步
  useEffect(() => {
    setActive(list.length ? 0 : null)
  }, [list.length])

  if (list.length === 0) {
    return <p className="text-[13px] text-ink-400">暂无解题步骤。</p>
  }

  return (
    <ol className="space-y-2.5">
      {list.map((step, i) => {
        const isActive = active === i
        const hasFigure = Boolean(step.figure)
        return (
          <li
            key={i}
            className={`rounded-xl border px-3 py-2.5 transition-colors ${
              isActive ? 'border-indigo-200 bg-indigo-50/40' : 'border-ink-100 bg-white'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {/* 步骤序号 */}
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  isActive ? 'bg-indigo-500 text-white' : 'bg-ink-100 text-ink-500'
                }`}
              >
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-[13.5px] font-bold text-ink-900">{step.title ?? `第 ${i + 1} 步`}</h4>
                  {hasFigure && (
                    <button
                      type="button"
                      className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-100"
                      onClick={() => setActive(isActive ? null : i)}
                      title={isActive ? '收起示意图' : '展开示意图'}
                    >
                      {isActive ? '收起图' : '看图'}
                    </button>
                  )}
                </div>

                {step.detail && (
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-700">
                    {step.detail}
                  </p>
                )}

                {hasFigure && isActive && <SolutionFigure figure={step.figure} />}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default SolutionSteps
