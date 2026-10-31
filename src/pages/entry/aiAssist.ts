/**
 * entry/aiAssist —— 「这次识别到底有没有用上 AI」的契约解析
 * ---------------------------------------------------------------------------
 * 用户反馈：「AI 辅助的也不明显」—— AI 明明在干活，界面上看不出来。
 * 这一层负责把后端 pipeline 里新增的 aiAssist 字段翻译成人话：
 *   · 这次是模型识别的，还是本地 OCR 识别的？
 *   · 哪些字段来自模型、哪些来自 OCR、哪些要人工确认？
 *   · 模型和 OCR 在哪儿打架了、最终采用了谁？
 *
 * 约定：
 *   1. 后端还没上线 aiAssist 字段时，不能报错、也不能装作「用了 AI」；
 *      这时退回到 pipeline.ocrEngine / analysis.byModel 做保守推断。
 *   2. 所有字段都可能缺失或形状不对，取值一律走防御式解析。
 */

import { safeText, safeTexts } from './kpShape'

/** 字段来源：模型 / 本地 OCR / 人工填的 / 不知道 */
export type FieldSource = 'ai' | 'ocr' | 'human' | 'unknown'

export interface AiAssistConflict {
  /** 冲突的字段（stem / options / myAnswer …） */
  field: string
  /** 模型认出来的内容 */
  vision?: string
  /** OCR 认出来的内容 */
  ocr?: string
  /** 最终采用了谁的内容 */
  chosen?: string
  /** 原因 */
  reason?: string
}

export interface AiAssistCorrection {
  field: string
  from?: string
  to?: string
  reason?: string
}

export interface AiAssist {
  /** 后端是否明确给了 aiAssist（false = 前端自己推断的保守结果） */
  detailed: boolean
  /** 这次有没有真的调模型 */
  usedModel: boolean
  /** 'model' = 视觉模型直读图片；'local' = 本地 OCR */
  engineKind: 'model' | 'local'
  modelName?: string
  /** 哪些字段来自模型 */
  fieldsFromModel: string[]
  /** 哪些字段来自本地 OCR */
  fieldsFromOcr: string[]
  /** 有没有做第二遍自校验 */
  secondPass?: boolean
  selfChecked?: boolean
  /** 两个引擎不一致的地方 */
  conflicts: AiAssistConflict[]
  /** 第二遍改了什么 */
  corrections: AiAssistCorrection[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  const t = safeText(value)
  return t ? t : undefined
}

function parseConflicts(list: unknown): AiAssistConflict[] {
  if (!Array.isArray(list)) return []
  const out: AiAssistConflict[] = []
  for (const raw of list) {
    const c = asRecord(raw)
    const field = str(c.field)
    if (!field) continue
    out.push({
      field,
      vision: str(c.vision),
      ocr: str(c.ocr),
      chosen: str(c.chosen),
      reason: str(c.reason),
    })
  }
  return out
}

function parseCorrections(list: unknown): AiAssistCorrection[] {
  if (!Array.isArray(list)) return []
  const out: AiAssistCorrection[] = []
  for (const raw of list) {
    const c = asRecord(raw)
    const field = str(c.field)
    if (!field) continue
    out.push({
      field,
      from: str(c.from),
      to: str(c.to),
      reason: str(c.reason),
    })
  }
  return out
}

/**
 * 读取 pipeline.aiAssist；后端没给就退回到保守推断。
 * @param pipeline 识别链路信息（可能为空）
 * @param analysis 分析结果（用来判断讲解是不是模型生成的）
 */
export function readAiAssist(
  pipeline: unknown,
  analysis?: { byModel?: boolean; model?: string } | null,
): AiAssist {
  const p = asRecord(pipeline)
  const raw = asRecord(p.aiAssist)

  const hasDetail = Object.keys(raw).length > 0
  const engineKind: 'model' | 'local' =
    raw.engineKind === 'local' ? 'local' : raw.engineKind === 'model' ? 'model' : inferEngineKind(p, analysis)

  return {
    detailed: hasDetail,
    /* 注意：这里说的是「**识别**环节有没有用模型」，不能拿「分析是模型写的」来推断，
       否则会出现「识别其实是本地 OCR，界面却说识别用了 AI」的夸大。 */
    usedModel:
      typeof raw.usedModel === 'boolean'
        ? raw.usedModel
        : engineKind === 'model' || !!str(p.model),
    engineKind,
    modelName: str(raw.modelName) ?? str(p.model) ?? (analysis?.byModel ? str(analysis.model) : undefined),
    fieldsFromModel: safeTexts(raw.fieldsFromModel),
    fieldsFromOcr: safeTexts(raw.fieldsFromOcr),
    secondPass: typeof raw.secondPass === 'boolean' ? raw.secondPass : undefined,
    selfChecked: typeof raw.selfChecked === 'boolean' ? raw.selfChecked : undefined,
    conflicts: parseConflicts(raw.conflicts),
    corrections: parseCorrections(raw.corrections),
  }
}

/** 没有 aiAssist 时的保守推断：宁可说「本地引擎」，也不要谎称用了 AI */
function inferEngineKind(
  pipeline: Record<string, unknown>,
  _analysis?: { byModel?: boolean; model?: string } | null,
): 'model' | 'local' {
  const engine = str(pipeline.ocrEngine)
  if (engine === 'vision-model') return 'model'
  if (engine === 'local-ocr' || engine === 'hint-fallback') return 'local'
  if (str(pipeline.model)) return 'model'
  /* 宁可说本地，也不要谎称用了 AI */
  return 'local'
}

/** 字段来源标签：模型 / OCR / 人工 */
export const SOURCE_META: Record<
  FieldSource,
  { label: string; icon: string; tone: 'blue' | 'cyan' | 'slate' | 'amber'; cls: string }
> = {
  ai: {
    label: 'AI 识别',
    icon: '🤖',
    tone: 'blue',
    cls: 'bg-blue-50 text-blue-700 ring-blue-200',
  },
  ocr: {
    label: '本地 OCR',
    icon: '🔤',
    tone: 'cyan',
    cls: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  },
  human: {
    label: '人工填写',
    icon: '✍️',
    tone: 'slate',
    cls: 'bg-ink-50 text-ink-600 ring-ink-200',
  },
  unknown: {
    label: '来源未知',
    icon: '❓',
    tone: 'amber',
    cls: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
}

/** 根据字段名猜来源（后端只给了两个字段列表时用得上） */
export function sourceOf(field: string, assist: AiAssist): FieldSource {
  if (assist.fieldsFromModel.includes(field)) return 'ai'
  if (assist.fieldsFromOcr.includes(field)) return 'ocr'
  return 'unknown'
}

/** 冲突的一句话说明：模型和 OCR 到底哪儿不一样 */
export function conflictText(c: AiAssistConflict, labelOf: (f: string) => string): string {
  const label = labelOf(c.field)
  if (c.vision && c.ocr && c.vision !== c.ocr) {
    const base = `「${label}」模型认作「${c.vision}」，OCR 认作「${c.ocr}」，这里采用了「${c.chosen ?? c.ocr}」`
    return c.reason ? `${base}（${c.reason}）` : base
  }
  if (c.reason) return `「${label}」${c.reason}`
  if (c.vision && c.ocr) return `「${label}」模型与 OCR 的结果不一致，请人工确认`
  return `「${label}」需要人工确认`
}

/** 订正的一句话说明 */
export function correctionText(c: AiAssistCorrection, labelOf: (f: string) => string): string {
  const label = labelOf(c.field)
  if (c.from && c.to) {
    const base = `「${label}」从「${c.from}」改成了「${c.to}」`
    return c.reason ? `${base}（${c.reason}）` : base
  }
  if (c.to) return `「${label}」修正为「${c.to}」`
  return c.reason ? `「${label}」${c.reason}` : `「${label}」被修正过`
}
