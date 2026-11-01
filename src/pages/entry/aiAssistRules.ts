/**
 * entry/aiAssistRules —— 「AI 辅助卡片该显示哪几行」的**判定规则**
 * ---------------------------------------------------------------------------
 * 为什么把这些判断从组件里拆出来：
 *
 *   之前这些条件直接写在 `AiAssistBlock.tsx` 的 JSX 里，
 *   **改坏了没有任何测试会红** —— 比如把
 *     `if (assist.enhancedImage)` 改成 `if (assist.enhancedVariant)`，
 *   界面就会显示「看的是增强后的图」，
 *   而**实际上并没有模型看过增强图** —— 又在撒谎了。
 *
 *   拆成**纯函数**之后，就能被 `scripts/test-ai-assist-honesty.mjs` 直接断言：
 *   「没有模型时，增强图那一行必须不显示」——
 *   改坏了测试立刻红。
 *
 * ⚠️ **这个文件必须保持零依赖**（不 import 任何东西）：
 *    Node 的 `--experimental-strip-types` 只能直接导入**依赖无关**的 TS 文件
 *    （带扩展名的 import 才行，而项目里用的是 Vite 的无扩展名写法）。
 *
 * 【设计原则】AI 辅助信息必须**逐条对得上实际发生的事**，
 * 否则「可解释」就成了「自我宣传」——
 * **说谎的可解释性比没有可解释性更糟**：用户一旦发现被骗，连真的那部分也不信了。
 */

/** 判定用的最小字段集（不依赖具体的 AiAssist 类型，方便单独测试） */
export interface AssistDisplayInfo {
  /** 这次有没有真的调模型 */
  usedModel?: boolean
  /** 'model' = 视觉模型直读图片；'local' = 本地 OCR */
  engineKind?: 'model' | 'local'
  /** 视觉模型看的是不是增强后的图 */
  enhancedImage?: boolean
  /** 第二遍自校验有没有真的改了什么 */
  secondPass?: boolean
  /** 有没有做 OCR ↔ 模型交叉核对 */
  selfChecked?: boolean
  /** 两个引擎的一致度 0~1 */
  agreement?: number
  /** 冲突条数 */
  conflictCount?: number
}

/**
 * 是否显示「看的是增强后的图（…）」。
 *
 * ⚠️ 必须要求 **enhancedImage**（后端保证它蕴含「模型真的看过」），
 *    **不能**退而求其次看 `enhancedVariant` 有没有值 ——
 *    增强图**生成过**不等于**模型看过它**。
 */
export function shouldShowEnhanced(assist: AssistDisplayInfo): boolean {
  return assist.enhancedImage === true
}

/**
 * 是否显示「两个引擎的一致度 N%」。
 *
 * ⚠️ 必须要求 **selfChecked** —— 只有一个引擎时，
 *    「两个引擎的一致度」这句话**没意义**（不是显示 0，也不是显示 100%）。
 */
export function shouldShowAgreement(assist: AssistDisplayInfo): boolean {
  return assist.selfChecked === true && typeof assist.agreement === 'number'
}

/** 是否显示「模型又自己复查了一遍」 */
export function shouldShowSecondPass(assist: AssistDisplayInfo): boolean {
  return assist.secondPass === true || assist.selfChecked === true
}

/**
 * 是否显示「模型和本地引擎没有发现冲突，扫一眼就能保存」。
 *
 * ⚠️ 必须要求 **usedModel** —— 本地引擎路径下**没有两个引擎**，
 *    说「没有发现冲突」是**没意义但会误导**的话。
 */
export function shouldShowNoConflictHint(assist: AssistDisplayInfo): boolean {
  return assist.usedModel === true && (assist.conflictCount ?? 0) === 0
}

/** 是否显示「⚠️ N 处需要你核对一下」 */
export function shouldShowConflictList(assist: AssistDisplayInfo): boolean {
  return (assist.conflictCount ?? 0) > 0
}

/**
 * 副标题的完整文案（纯函数，便于断言「该出现的话都出现了」）。
 *
 * @param label 增强方式的中文说法（由调用方传入，避免这里依赖 enhanceVariantLabel）
 */
export function engineSublineParts(assist: AssistDisplayInfo, enhanceLabel: string): string[] {
  const parts: string[] = []
  if (assist.usedModel && assist.engineKind === 'model') parts.push('图片由模型直接理解')
  else parts.push('图片没有上传到云端')
  if (shouldShowEnhanced(assist)) parts.push(`看的是增强后的图（${enhanceLabel}）`)
  if (shouldShowSecondPass(assist)) parts.push('模型又自己复查了一遍')
  return parts
}


/* -------------------------------------------------------------------------
 * 冲突文案的来源映射
 * ---------------------------------------------------------------------- */

/** 一条冲突（OCR ↔ 模型读出来不一样） */
export interface AssistConflict {
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

/**
 * 「最终采信了谁」的中文说法。
 *
 * ⚠️ 这个映射**必须准确** —— 写错了就是把「采信 OCR」显示成「采信模型」，
 *    属于**方向都反了的错**，比不显示还糟。
 *    所以它被单独拆出来、被 scripts/test-ai-assist-honesty.mjs 直接断言。
 */
export const CHOSEN_SOURCE: Record<string, string> = {
  ocr: 'OCR',
  vision: '模型',
  model: '模型',
  local: '本地 OCR',
  human: '人工',
}

/** 来源的中文说法（不认识的值原样透出，不猜） */
export function chosenSourceText(chosen?: string): string {
  if (!chosen) return ''
  return CHOSEN_SOURCE[chosen] ?? `「${chosen}」`
}

/**
 * 冲突明细的一句话。
 *
 * @param labelOf 字段名 → 中文名
 */
export function conflictText(c: AssistConflict, labelOf: (f: string) => string): string {
  const label = labelOf(c.field)
  const chosenText = chosenSourceText(c.chosen)
  if (c.vision && c.ocr && c.vision !== c.ocr) {
    /* 后端的 reason 里通常已经写了「采信 OCR」，就别重复一遍 */
    const mentions = c.reason ? /采信|采用|保留/.test(c.reason) : false
    const base =
      `「${label}」模型读到「${c.vision}」，OCR 读到「${c.ocr}」` +
      (!mentions && chosenText ? `，最终采信${chosenText}` : '')
    return c.reason ? `${base}。${c.reason}` : base
  }
  if (c.reason) return `「${label}」${c.reason}`
  if (c.vision && c.ocr) return `「${label}」模型与 OCR 的结果不一致，请人工确认`
  return `「${label}」需要人工确认`
}
