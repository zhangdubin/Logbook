/**
 * features/settings/types —— 设置页的内部类型
 * ---------------------------------------------------------------------------
 * 这里只定义「页面表单」用的类型；凡是和后端交互的字段，一律复用
 * src/lib/types.ts 里的 AISettings / AISettingsInput / AIProviderPreset，
 * 避免出现两套契约互相打架。
 */

import type { AIProviderPreset } from '@/lib/types'

/**
 * 表单状态。
 * 与后端 AISettings 的两点差异：
 *   1. timeoutSec —— 界面上按「秒」填写，提交时换算成毫秒（后端存 timeoutMs）；
 *   2. apiKey —— 始终是「本次要写入的新密钥」，留空表示不修改后端已保存的密钥。
 */
export interface SettingsForm {
  /** 预设 id，或 'custom' */
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  /** 视觉模型；留空表示复用 model */
  visionModel: string
  /** 0 ~ 2 */
  temperature: number
  /** 超时（秒） */
  timeoutSec: number
  /** 最大输出长度（token） */
  maxOutputTokens: number
  /** 是否启用大模型 */
  enableModel: boolean
  /** 本地 OCR 服务地址 */
  ocrBaseUrl: string
  /** 是否启用本地 OCR */
  ocrEnabled: boolean
}

/** 异步资源的加载状态 */
export type LoadState = 'loading' | 'ready' | 'fallback' | 'error'

/** 供应商预设列表的加载结果 */
export interface ProvidersState {
  state: LoadState
  items: AIProviderPreset[]
  /** 降级原因 / 提示文案 */
  message?: string
}

/** 连接测试的状态机 */
export type TestState = 'idle' | 'testing' | 'done'
