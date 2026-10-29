/**
 * entry/AnalysisPanel —— AI 智能分析报告
 * ---------------------------------------------------------------------------
 * 拍照识别完成后（Capture）与错题详情页（ItemDetail）共用。
 * 移动端优先：分区 + <details> 折叠，默认展开归因结论。
 */

import { ERROR_TYPE_COLOR, ERROR_TYPE_LABEL } from '@/lib/types'
import type { AIAnalysis, PhotoAnalysisResponse } from '@/lib/types'
import { AlertBox, Badge, Progress, Spinner } from '@/components/ui'
import type { ReactNode } from 'react'
import { asArray, kpName, safeText, safeTexts } from './kpShape'

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <span className="tag ring-1" style={{ background: `${color}1a`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}>
      置信度 {pct}%
    </span>
  )
}

function Section({
  title,
  icon,
  children,
  open = false,
  badge,
}: {
  title: string
  icon: string
  children: ReactNode
  open?: boolean
  badge?: ReactNode
}) {
  return (
    <details open={open} className="group rounded-xl border border-ink-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-ink-700">
        <span className="flex items-center gap-2">
          <span aria-hidden>{icon}</span>
          {title}
          {badge}
        </span>
        <span className="text-xs text-ink-400 transition group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-ink-100 px-4 py-3">{children}</div>
    </details>
  )
}

export function AnalysisPanel({
  analysis,
  pipeline,
  loading = false,
  onAnalyze,
}: {
  analysis?: AIAnalysis | null
  /** 识别链路信息（拍照识别时由后端返回） */
  pipeline?: PhotoAnalysisResponse['pipeline']
  loading?: boolean
  onAnalyze?: () => void
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-600">
          <Spinner /> AI 正在分析错因、知识点和解题步骤…
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="shimmer h-16 rounded-xl bg-ink-100" />
        ))}
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-4 py-8 text-center">
        <div className="text-3xl">🤖</div>
        <p className="text-sm font-bold text-ink-700">AI 尚未分析这道题</p>
        <p className="max-w-sm text-xs leading-relaxed text-ink-500">
          点击下面的按钮，AI 会给出错因归类、根因链、正确解法分步讲解和一周练习计划。
        </p>
        {onAnalyze && (
          <button type="button" className="btn btn-primary" onClick={onAnalyze}>
            ✨ 开始 AI 分析
          </button>
        )}
      </div>
    )
  }

  const diagnosis = (analysis.diagnosis ?? {}) as AIAnalysis['diagnosis']
  const color = ERROR_TYPE_COLOR[diagnosis?.type] ?? '#3b63f6'

  return (
    <div className="space-y-3">
      {/* 识别链路（拍照识别时才有） */}
      {pipeline && (
        <div className="rounded-xl border border-ink-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-ink-700">🔗 识别链路</span>
            <Badge tone="blue">{pipeline.ocrEngineLabel}</Badge>
            {pipeline.model && <Badge tone="violet">{pipeline.model}</Badge>}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
            {pipeline.ocrEngine === 'vision-model'
              ? '这次是视觉模型直接看图识别的，题干和公式一般比较完整。'
              : pipeline.ocrEngine === 'local-ocr'
                ? '这次先用本地 OCR 提取文字，再由引擎结构化成题目，图片没有上传到云端。'
                : pipeline.ocrEngine === 'hint-fallback'
                  ? '这次没有可用的视觉模型，只按提示词推导。'
                  : '识别引擎把识别过程拆成了几个信号，权重越高说明对结果影响越大。'}
          </p>

          {pipeline.ocrEngine === 'hint-fallback' && (
            <div className="mt-2">
              <AlertBox tone="warning" title="当前未配置视觉模型，已按提示词推导，建议手动校对">
                题干、选项很可能是「按提示词猜」出来的，保存前请逐字对照原图核对一遍。
              </AlertBox>
            </div>
          )}

          {safeTexts(pipeline.warnings).length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {safeTexts(pipeline.warnings).map((w, i) => (
                <li
                  key={i}
                  className="flex gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800"
                >
                  <span aria-hidden>⚠️</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 一句话总结 */}
      <div className="rounded-xl bg-gradient-to-br from-brand-50 to-white p-4 ring-1 ring-brand-100">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-brand-700">一句话总结</span>
          {analysis.byModel ? (
            <span className="tag bg-brand-100 text-brand-700 ring-1 ring-brand-200">{analysis.model ?? '大模型'}</span>
          ) : (
            <span className="tag bg-ink-100 text-ink-500 ring-1 ring-ink-200">本地引擎</span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-ink-800">{safeText(analysis.summary)}</p>
      </div>

      {/* 归因结论 */}
      <Section title="归因结论" icon="🎯" open>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="tag ring-1"
              style={{ background: `${color}1a`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
            >
              {ERROR_TYPE_LABEL[diagnosis?.type] ?? '错因待定'}
            </span>
            <ConfidencePill value={Number(diagnosis?.confidence ?? 0)} />
          </div>
          <p className="text-sm leading-relaxed text-ink-700">{safeText(diagnosis?.reason)}</p>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-ink-400">
              <span>判断把握</span>
              <span>{Math.round((Number(diagnosis?.confidence ?? 0) || 0) * 100)}%</span>
            </div>
            <Progress value={(Number(diagnosis?.confidence ?? 0) || 0) * 100} color={color} />
          </div>
          {safeTexts(diagnosis?.evidence).length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-bold text-ink-500">判断依据</p>
              <ul className="space-y-1">
                {safeTexts(diagnosis?.evidence).map((ev, i) => (
                  <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-600">
                    <span className="text-ink-400">•</span>
                    <span>{ev}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* 知识点（含把握度与判定依据） */}
      {asArray(analysis.knowledgePoints).length > 0 && (
        <Section title="考点定位" icon="📌" open>
          <ul className="space-y-2">
            {asArray(analysis.knowledgePoints).map((raw, i) => {
              /* kp 可能是对象，也可能是字符串；name 再套一层 kpName 兜底 */
              const kp = (raw ?? {}) as {
                name?: unknown
                confidence?: unknown
                level?: unknown
                evidence?: unknown
                model?: unknown
              }
              const name = kpName(raw)
              const conf = Number(kp.confidence ?? 0)
              const pct = Number.isFinite(conf) ? Math.round(conf * 100) : 0
              const weak = conf > 0 && conf < 0.5
              const evidence = safeTexts(kp.evidence)
              const level = safeText(kp.level)
              return (
                <li key={`${name || 'kp'}-${i}`} className="rounded-xl bg-ink-50/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-ink-800">{name}</span>
                    {level && (
                      <span className="tag ring-1 text-[11px]">{level}</span>
                    )}
                    {safeText(kp.model) && (
                      <span className="tag bg-brand-50 text-[11px] text-brand-700 ring-1 ring-brand-200">
                        题型模型
                      </span>
                    )}
                    {conf > 0 && (
                      <span
                        className={`text-[11px] font-semibold ${weak ? 'text-amber-600' : 'text-ink-400'}`}
                      >
                        把握 {pct}%
                      </span>
                    )}
                  </div>
                  {conf > 0 && (
                    <div className="mt-1.5">
                      <Progress value={pct} color={weak ? '#d97706' : '#3b63f6'} />
                    </div>
                  )}
                  {weak && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700">
                      这个考点把握不大，可能是同类题里套着别的模型 —— 请对照原题确认。
                    </p>
                  )}
                  {evidence.length > 0 && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                      依据：{evidence.slice(0, 3).join('、')}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* 根因链 */}
      {asArray(analysis.rootCauses).length > 0 && (
        <Section title="根因链" icon="🔗" open>
          <ol className="space-y-2">
            {asArray(analysis.rootCauses).map((rc, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-900 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-ink-700">{safeText(rc)}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* 正确解法分步 */}
      {asArray(analysis.correctSteps).length > 0 && (
        <Section title="正确解法（分步讲解）" icon="🪜" open badge={<span className="text-[11px] text-ink-400">{asArray(analysis.correctSteps).length} 步</span>}>
          <ol className="space-y-3">
            {asArray(analysis.correctSteps).map((raw, i) => {
              const step = (raw ?? {}) as { title?: unknown; detail?: unknown }
              return (
                <li key={i} className="rounded-xl bg-ink-50/70 p-3">
                  <p className="flex items-center gap-2 text-sm font-bold text-ink-800">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-600 text-[11px] text-white">
                      {i + 1}
                    </span>
                    {safeText(step.title)}
                  </p>
                  <p className="mt-1 pl-7 text-xs leading-relaxed text-ink-600">{safeText(step.detail)}</p>
                </li>
              )
            })}
          </ol>
        </Section>
      )}

      {/* 知识点补强 */}
      {asArray(analysis.knowledgeGaps).length > 0 && (
        <Section title="需要补强的知识点" icon="📚">
          <div className="flex flex-wrap gap-1.5">
            {asArray(analysis.knowledgeGaps).map((k, i) => (
              <span key={`${kpName(k) || 'kp'}-${i}`} className="tag bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                {kpName(k)}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* 学习建议 */}
      {asArray(analysis.tips).length > 0 && (
        <Section title="学习建议" icon="💡">
          <ul className="space-y-2">
            {asArray(analysis.tips).map((tip, i) => (
              <li key={i} className="flex gap-2 rounded-lg bg-emerald-50/70 px-3 py-2 text-xs leading-relaxed text-emerald-900">
                <span aria-hidden>✓</span>
                <span>{safeText(tip)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 同类题 */}
      {asArray(analysis.similarQuestions).length > 0 && (
        <Section title="同类题推荐" icon="🧩" badge={<span className="text-[11px] text-ink-400">{asArray(analysis.similarQuestions).length} 题</span>}>
          <div className="space-y-2">
            {asArray(analysis.similarQuestions).map((raw, i) => {
              const q = (raw ?? {}) as { stem?: unknown; answer?: unknown; analysis?: unknown }
              return (
                <div key={i} className="rounded-xl border border-ink-200 p-3">
                  <p className="text-sm font-semibold text-ink-800">{safeText(q.stem)}</p>
                  <p className="mt-1.5 text-xs text-ink-500">
                    <span className="font-bold text-emerald-600">答案：</span>
                    {safeText(q.answer)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">{safeText(q.analysis)}</p>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* 练习计划 */}
      {asArray(analysis.practicePlan).length > 0 && (
        <Section title="7 天练习计划" icon="📅" open>
          <div className="space-y-2">
            {asArray(analysis.practicePlan).map((raw, i) => {
              const task = (raw ?? {}) as { day?: unknown; focus?: unknown; task?: unknown; minutes?: unknown }
              const minutes = Number(task.minutes)
              return (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-ink-200 px-3 py-2">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-[11px] font-bold text-brand-700">
                    D{safeText(task.day) || i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink-800">
                      {safeText(task.focus)}
                      {Number.isFinite(minutes) && (
                        <span className="ml-2 text-[11px] font-semibold text-ink-400">{minutes} 分钟</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{safeText(task.task)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}

export default AnalysisPanel
