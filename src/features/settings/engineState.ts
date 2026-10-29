/**
 * features/settings/engineState —— 「当前生效引擎」的类型判定
 * ---------------------------------------------------------------------------
 * ⚠️ 这里以前是「拿 activeEngine 文案正则匹配 /本地/」，而 activeEngine 是**复合句**：
 *
 *   走本地时：本地启发式引擎 + 本地 OCR 服务（未配置可用大模型）
 *   走大模型时：MiniMax-M3.1-Flash@MiniMax，视觉已启用 + 本地 OCR 服务
 *
 * 两种文案里都有「本地」两个字（本地 OCR 是独立信号源），
 * 所以 /本地/ **永远命中** → 前端把「已启用大模型」误判成本地引擎，
 * 页面显示成 ⚪️ 本地引擎 + 那条「没有可用的密钥或模型」的黄色警告。
 *
 * 现在改成：优先用后端给的结构化字段 activeEngineKind（'model' | 'local'）；
 * 老后端没这个字段时才解析文案，而且正则必须收紧 ——
 * 只认「本地启发式 / local-heuristic / heuristic」，**绝不匹配裸的「本地」**。
 *
 * 纯逻辑，不依赖 React，方便直接跑单测（见 engineState.test.ts）。
 */

import type { AISettings } from '@/lib/types'

/** 引擎类型：model = 大模型，local = 本地启发式 */
export type EngineKind = 'model' | 'local'

/**
 * 读出结构化的引擎类型。
 * activeEngineKind 是 AISettings 里的**可选**字段（老后端不会给），
 * 所以这里还要再做一次运行时校验：后端没给、或给了不认识的值时返回 undefined，
 * 由调用方退回文案兜底。
 */
export function readEngineKind(settings: AISettings): EngineKind | undefined {
  const raw = settings.activeEngineKind
  return raw === 'model' || raw === 'local' ? raw : undefined
}

export interface EngineState {
  /** 卡片上显示的引擎文案 */
  engineText: string
  /** 是不是「本地启发式引擎」（决定徽章与黄色警告） */
  engineIsLocal: boolean
}

/**
 * 算出引擎文案与引擎类型。
 *
 * 判定顺序：
 *   1. 后端给了 activeEngineKind 就直接用它（最准）；
 *   2. 老后端没有这个字段，才解析文案 —— 且正则必须收紧，
 *      只认「本地启发式 / local-heuristic / heuristic」。
 */
export function resolveEngineState(settings: AISettings): EngineState {
  const usingModel = Boolean(settings.enableModel)
  const hasEngineText = Boolean(settings.activeEngine?.trim())
  const engineText = hasEngineText
    ? (settings.activeEngine as string).trim()
    : usingModel
      ? '大模型引擎'
      : '本地启发式引擎'

  const kind = readEngineKind(settings)
  const engineIsLocal = kind
    ? kind === 'local'
    : hasEngineText
      ? /本地启发式|local-heuristic|heuristic/i.test(engineText)
      : !usingModel

  return { engineText, engineIsLocal }
}
