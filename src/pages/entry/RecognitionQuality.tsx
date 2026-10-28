/**
 * entry/RecognitionQuality —— 识别质量展示
 * ---------------------------------------------------------------------------
 * 拍照识别后告诉用户「这次识别把握多大、走的是哪条链路、哪些字段要重点核对」，
 * 以及后端可选返回的「学科自动判定」提示。
 * 字段不存在时一律不显示、不报错（后端还没上这个功能也能正常工作）。
 */

import { Badge, Card, Progress } from '@/components/ui'
import type { PhotoAnalysisResponse } from '@/lib/types'
import type { ConfMap, FieldKey } from './formModel'

/* ------------------ 置信度分级与字段中文名 ------------------ */

/** ≥ 0.85 认为可信；0.6 ~ 0.85 建议核对；< 0.6 视为不确定 */
export const CONF_GOOD = 0.85
export const CONF_MID = 0.6

const FIELD_LABEL: Record<string, string> = {
  subject: '学科',
  questionType: '题型',
  knowledgePoints: '知识点',
  stem: '题干',
  options: '选项',
  myAnswer: '我的答案',
  correctAnswer: '正确答案',
  difficulty: '难度',
  errorType: '错因类型',
  errorDetail: '错因详述',
  ocrText: 'OCR 原文',
}

export function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key
}

export interface ConfLevel {
  text: string
  tone: 'green' | 'amber' | 'red'
  color: string
}

export function confLevel(value: number): ConfLevel {
  if (value >= CONF_GOOD) return { text: '可信', tone: 'green', color: '#10b981' }
  if (value >= CONF_MID) return { text: '建议核对', tone: 'amber', color: '#f59e0b' }
  return { text: '不确定', tone: 'red', color: '#ef4444' }
}

export function pctText(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

/** 把后端返回的逐字段置信度转成表单用的字段 -> 置信度映射 */
export function buildConfMap(
  draft: PhotoAnalysisResponse['draft'],
  diagnosisConfidence?: number,
): ConfMap {
  const fc = draft.fieldConfidence ?? {}
  const overall = typeof draft.confidence === 'number' ? draft.confidence : 0
  const pick = (key: FieldKey): number => {
    const v = fc[key]
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.min(1, Math.max(0, v))
      : overall
  }
  const errorTypeConfidence =
    typeof fc.errorType === 'number' && Number.isFinite(fc.errorType)
      ? fc.errorType
      : (diagnosisConfidence ?? overall)
  return {
    subject: pick('subject'),
    questionType: pick('questionType'),
    knowledgePoints: pick('knowledgePoints'),
    stem: pick('stem'),
    options: pick('options'),
    myAnswer: pick('myAnswer'),
    correctAnswer: pick('correctAnswer'),
    difficulty: pick('difficulty'),
    errorType: errorTypeConfidence,
  }
}

/**
 * 逐字段置信度：后端给了就用；额外把「错因诊断」的把握程度补进 errorType，
 * 让表单里也能看到这一项的置信度。后端没给逐字段数据时返回 undefined，
 * 表单会自动退回旧的整体置信度展示方式。
 */
export function mergeFieldConfidence(result: PhotoAnalysisResponse): Record<string, number> | undefined {
  const fc = result.draft.fieldConfidence
  if (!fc) return undefined
  const merged: Record<string, number> = { ...fc }
  const diag = result.analysis.diagnosis?.confidence
  if (merged.errorType === undefined && typeof diag === 'number' && Number.isFinite(diag)) {
    merged.errorType = diag
  }
  return merged
}


export interface AnalysisExtras {
  /** 自动判定出来的学科（如果后端单独给了这个字段） */
  inferSubject?: string
  /** 学科判定置信度 0~1 */
  subjectConfidence?: number
  /** 学科判定的依据（string[]） */
  subjectEvidence: string[]
  /** 题型判定置信度 0~1 */
  questionTypeConfidence?: number
}

function pickNumber(...values: (number | undefined)[]): number | undefined {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

function pickStrings(...values: (string[] | undefined)[]): string[] {
  for (const v of values) {
    if (Array.isArray(v) && v.length) {
      return v.filter((x) => typeof x === 'string' && x.trim().length > 0)
    }
  }
  return []
}

/** 读取后端可选字段（契约：都在 draft 里） */
export function readExtras(result: PhotoAnalysisResponse | null): AnalysisExtras {
  const empty: AnalysisExtras = { subjectEvidence: [] }
  if (!result) return empty
  const d = result.draft as PhotoAnalysisResponse['draft'] & Partial<AnalysisExtras>
  return {
    inferSubject: typeof d.inferSubject === 'string' && d.inferSubject ? d.inferSubject : undefined,
    subjectConfidence: pickNumber(d.subjectConfidence),
    subjectEvidence: pickStrings(d.subjectEvidence),
    questionTypeConfidence: pickNumber(d.questionTypeConfidence),
  }
}

/** 学科下拉框旁的「已自动判断」提示；后端没给这些字段就完全不显示 */
export function SubjectAutoNotice({
  subject,
  confidence,
  evidence,
}: {
  subject?: string
  confidence?: number
  evidence: string[]
}) {
  if (!subject && confidence === undefined && evidence.length === 0) return null
  /* 把握度 < 50% 用警示色，≥ 50% 用普通灰字 */
  const weak = typeof confidence === 'number' && confidence < 0.5
  return (
    <p
      className={`mt-1 text-[11px] leading-relaxed ${
        weak ? 'font-semibold text-amber-700' : 'text-ink-500'
      }`}
    >
      {weak && <span aria-hidden>⚠️ </span>}
      已自动判断为「{subject ?? '未知'}」
      {confidence !== undefined && `（把握 ${pctText(confidence)}）`}
      {evidence.length > 0 && `，依据：${evidence.join('、')}`}
      ，请确认
    </p>
  )
}

/* ------------------ 识别质量卡片 ------------------ */

function engineHint(engine: string): string {
  switch (engine) {
    case 'vision-model':
      return '这次是视觉模型直接看图识别，题干、公式和作图一般比较完整。'
    case 'local-ocr':
      return '这次先用本地 OCR 提取文字，再由引擎结构化成题目，图片没有上传到云端。'
    case 'hint-fallback':
      return '这次没有可用的视觉模型，只按你填的提示词推导，识别结果请务必人工核对。'
    default:
      return '识别引擎已把识别过程拆解成下面几个信号，权重越高说明对结果影响越大。'
  }
}

export function RecognitionQualityCard({ result }: { result: PhotoAnalysisResponse }) {
  const draft = result.draft
  const pipeline = result.pipeline
  const confidence = typeof draft.confidence === 'number' ? draft.confidence : 0
  const level = confLevel(confidence)

  return (
    <Card title="识别质量" subtitle="这次识别走的是哪条链路、把握有多大">
      <div className="space-y-4">
        {/* 整体置信度 */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-ink-500">整体置信度</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-ink-900">
              {pctText(confidence)}
            </p>
          </div>
          <Badge tone={level.tone}>{level.text}</Badge>
        </div>
        <Progress value={confidence * 100} color={level.color} height={10} />
        <p className="text-[11px] leading-relaxed text-ink-400">
          {confidence >= CONF_GOOD
            ? '整体识别质量不错，简单扫一眼就能保存。'
            : confidence >= CONF_MID
              ? '有些地方可能认错了，重点看看标了「建议核对」的字段。'
              : '这次识别把握不大，建议逐字对照原图检查一遍再保存。'}
        </p>

        {/* 识别链路 */}
        <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <p className="text-xs font-bold text-ink-700">🔗 识别链路</p>
          {pipeline ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">{pipeline.ocrEngineLabel}</Badge>
                {pipeline.model && <Badge tone="violet">{pipeline.model}</Badge>}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                {engineHint(pipeline.ocrEngine)}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
              后端还没有返回链路信息；识别引擎升级后，这里会显示具体用了视觉模型还是本地 OCR。
            </p>
          )}
        </div>

        {/* 置信度构成 */}
        {pipeline?.signals && pipeline.signals.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold text-ink-700">📊 置信度构成</p>
            <div className="space-y-2.5">
              {pipeline.signals.map((s, i) => {
                const sLevel = confLevel(s.value)
                return (
                  <div key={`${s.name}-${i}`}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-ink-600">{s.name}</span>
                      <span className="shrink-0 text-ink-400">
                        {pctText(s.value)} · 权重 {Math.round(s.weight * 100)}%
                      </span>
                    </div>
                    <Progress value={s.value * 100} color={sLevel.color} height={6} />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 需要注意 */}
        {pipeline?.warnings && pipeline.warnings.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold text-ink-700">⚠️ 需要注意</p>
            <ul className="space-y-1.5">
              {pipeline.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800"
                >
                  <span aria-hidden>⚠️</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ------------------ 逐字段置信度：可疑字段清单 ------------------ */

export function FieldConfidenceNotice({ result }: { result: PhotoAnalysisResponse }) {
  const fc = result.draft.fieldConfidence

  if (!fc || Object.keys(fc).length === 0) {
    return (
      <p className="rounded-xl bg-ink-50/80 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
        后端这次没有提供逐字段置信度，先按整体置信度 {pctText(result.draft.confidence)} 参考。
      </p>
    )
  }

  const items = Object.entries(fc)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v < CONF_GOOD)
    .sort((a, b) => a[1] - b[1])

  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-emerald-50/70 px-3 py-2 text-[11px] leading-relaxed text-emerald-700">
        ✅ 所有字段的识别置信度都在 {pctText(CONF_GOOD)} 以上，快速扫一眼就能保存。
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-red-100 bg-red-50/60 p-3">
      <p className="text-xs font-bold text-red-700">🔍 建议重点核对的字段</p>
      <ul className="mt-2 space-y-1.5">
        {items.map(([key, value]) => {
          const level = confLevel(value)
          const risky = value < CONF_MID
          return (
            <li
              key={key}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-white/85 px-3 py-2"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: level.color }}
                aria-hidden
              />
              <span className="text-xs font-bold text-ink-800">{fieldLabel(key)}</span>
              <Badge tone={level.tone}>{pctText(value)}</Badge>
              <span className="text-[11px] text-ink-500">
                {risky ? '此项识别不确定，请人工核对' : '这一项把握不大，建议核对一下'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

