/**
 * entry/AiAssistBlock —— 「本次识别是怎么做出来的」
 * ---------------------------------------------------------------------------
 * 用户反馈：「AI 辅助的也不明显」。
 * 这一块回答用户最关心的三个问题：
 *   1. 这次到底有没有用上 AI？（用了模型 / 只有本地 OCR）
 *   2. 哪些字是 AI 认的、哪些是 OCR 认的？
 *   3. 哪里 AI 和 OCR 不一致，要不要我人工核对？
 *
 * 后端还没上线 aiAssist 字段时，这里会退回到 pipeline.ocrEngine 的保守说法，
 * 不会谎称用了 AI，也不会报错。
 */

import { Badge } from '@/components/ui'
import { conflictText, correctionText, SOURCE_META, sourceOf } from './aiAssist'
import type { AiAssist } from './aiAssist'
import { fieldLabel } from './RecognitionQuality'

function engineHeadline(assist: AiAssist): string {
  if (assist.usedModel && assist.engineKind === 'model') {
    return '🧠 视觉模型直读图片'
  }
  if (assist.usedModel) {
    return '🧠 大模型参与识别'
  }
  if (assist.engineKind === 'local') {
    return '🔤 本地引擎识别'
  }
  return '🔤 本地引擎识别'
}

function engineSubline(assist: AiAssist): string {
  const parts: string[] = []
  if (assist.modelName) parts.push(assist.modelName)
  if (assist.usedModel && assist.engineKind === 'model') parts.push('图片由模型直接理解')
  else parts.push('图片没有上传到云端')
  if (assist.secondPass || assist.selfChecked) parts.push('模型又自己复查了一遍')
  return parts.join(' · ')
}

/** 字段来源小徽章 */
export function SourceChip({ field, assist }: { field: string; assist: AiAssist }) {
  const src = sourceOf(field, assist)
  const meta = SOURCE_META[src]
  return (
    <span
      className={`tag ring-1 ${meta.cls}`}
      title={`${fieldLabel(field)}：${meta.label}`}
    >
      <span aria-hidden>{meta.icon}</span>
      <span className="ml-0.5">{fieldLabel(field)}</span>
      <span className="ml-0.5 opacity-70">
        {src === 'ai' ? 'AI' : src === 'ocr' ? 'OCR' : src === 'human' ? '人工' : '?'}
      </span>
    </span>
  )
}

export function AiAssistBlock({
  assist,
  onShowOcrText,
}: {
  assist: AiAssist
  /** 点「查看 OCR 原始文字」时由外层负责展开原文 */
  onShowOcrText?: () => void
}) {
  const modelFields = assist.fieldsFromModel
  const ocrFields = assist.fieldsFromOcr
  const allFields = [...new Set([...modelFields, ...ocrFields])]
  const needCheck = assist.conflicts.length > 0

  return (
    <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50/80 to-white p-3">
      {/* 这次是怎么识别的 */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-ink-800">{engineHeadline(assist)}</p>
        {assist.usedModel ? (
          <Badge tone="blue">用上了 AI</Badge>
        ) : (
          <Badge tone="slate">没有用 AI</Badge>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{engineSubline(assist)}</p>

      {/* 字段来源 */}
      {allFields.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold text-ink-600">每个字段是谁认出来的</p>
          <div className="flex flex-wrap gap-1.5">
            {modelFields.map((f) => (
              <SourceChip key={`m-${f}`} field={f} assist={assist} />
            ))}
            {ocrFields.map((f) => (
              <SourceChip key={`o-${f}`} field={f} assist={assist} />
            ))}
          </div>
        </div>
      )}

      {/* 需要人工核对的地方 */}
      {needCheck && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-2.5">
          <p className="text-[11px] font-bold text-amber-800">
            ⚠️ {assist.conflicts.length} 处需要你核对一下
          </p>
          <ul className="mt-1.5 space-y-1">
            {assist.conflicts.map((c, i) => (
              <li key={`${c.field}-${i}`} className="text-[11px] leading-relaxed text-amber-900">
                · {conflictText(c, fieldLabel)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 第二遍自校验改了什么 */}
      {assist.corrections.length > 0 && (
        <div className="mt-2.5 rounded-xl border border-blue-100 bg-blue-50/70 p-2.5">
          <p className="text-[11px] font-bold text-blue-800">🔁 模型复查后自己改了这几处</p>
          <ul className="mt-1.5 space-y-1">
            {assist.corrections.map((c, i) => (
              <li key={`${c.field}-${i}`} className="text-[11px] leading-relaxed text-blue-900">
                · {correctionText(c, fieldLabel)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 没有任何冲突时给一句「可以放心扫一眼」 */}
      {!needCheck && assist.usedModel && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-emerald-700">
          ✅ 模型和本地引擎没有发现冲突，扫一眼就能保存。
        </p>
      )}

      {/* 快速查看原文 */}
      {onShowOcrText && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline btn-sm" onClick={onShowOcrText}>
            📄 查看 OCR 原始文字
          </button>
        </div>
      )}
    </div>
  )
}

export default AiAssistBlock
