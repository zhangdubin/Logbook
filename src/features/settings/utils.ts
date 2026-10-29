/**
 * features/settings/utils —— 设置页的纯函数工具
 * ---------------------------------------------------------------------------
 * 放在这里是为了让「后端已保存密钥」这种敏感信息只有一个出入口：
 *   - 读取时：掩码串只用来提示「已保存」，永远不回填进输入框；
 *   - 写入时：留空 = 不修改；只有用户真的敲了新密钥才会下发；
 *   - 展示时：任何回显的错误详情都要先过一遍脱敏。
 */

import type { AISettings, AISettingsInput } from '@/lib/types'
import type { SettingsForm } from './types'

/** 温度取值范围 */
export const TEMPERATURE_MIN = 0
export const TEMPERATURE_MAX = 2
/** 超时（秒）取值范围 */
export const TIMEOUT_MIN_SEC = 1
export const TIMEOUT_MAX_SEC = 120
/** 默认超时（秒） */
export const DEFAULT_TIMEOUT_SEC = 30

/** 最大输出长度（token）的取值范围。
 *  下限 256：低于这个值连一句完整的话都说不完；
 *  上限 32768：再大就该用分步/流式了，单次请求没必要。 */
export const MAX_OUTPUT_TOKENS_MIN = 256
export const MAX_OUTPUT_TOKENS_MAX = 32768
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/** 把数字夹在区间内 */
export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * 判断后端返回的密钥是不是掩码串。
 * 典型形态：sk-****abcd、sk-…abcd、******。
 */
export function isMaskedSecret(value?: string | null): boolean {
  if (!value) return false
  return /[*•·]/.test(value)
}

/**
 * 脱敏错误详情：把可能出现的密钥片段替换掉，避免整段错误日志被截图外传。
 */
export function sanitizeDetail(detail?: string | null, apiKey?: string | null): string {
  let text = (detail ?? '').trim()
  if (!text) return ''
  const key = (apiKey ?? '').trim()
  if (key.length >= 6) {
    text = text.split(key).join('sk-****')
  }
  text = text.replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-****')
  text = text.replace(/(api[_-]?key"?\s*[:=]\s*"?)([A-Za-z0-9_\-.]{6,})/gi, '$1****')
  return text
}

/** 后端设置 -> 表单（密钥永不回填，留空即「不修改」） */
export function formFromSettings(settings: AISettings): SettingsForm {
  const timeoutSec = settings.timeoutMs
    ? Math.round(settings.timeoutMs / 1000)
    : Math.round(DEFAULT_TIMEOUT_SEC)
  return {
    provider: settings.provider || 'custom',
    baseUrl: settings.baseUrl ?? '',
    apiKey: '',
    model: settings.model ?? '',
    visionModel: settings.visionModel ?? '',
    temperature: clampNumber(settings.temperature ?? 0.2, TEMPERATURE_MIN, TEMPERATURE_MAX),
    timeoutSec: clampNumber(timeoutSec, TIMEOUT_MIN_SEC, TIMEOUT_MAX_SEC),
    maxOutputTokens: clampNumber(
      settings.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS_MIN,
      MAX_OUTPUT_TOKENS_MAX,
    ),
    enableModel: Boolean(settings.enableModel),
    ocrBaseUrl: settings.ocrBaseUrl ?? '',
    ocrEnabled: Boolean(settings.ocrEnabled),
  }
}

/** 表单 -> 后端载荷（apiKey 留空则不下发，语义是「不修改」） */
export function toSettingsInput(form: SettingsForm): AISettingsInput {
  const apiKey = form.apiKey.trim()
  return {
    provider: form.provider,
    baseUrl: form.baseUrl.trim(),
    ...(apiKey ? { apiKey } : {}),
    model: form.model.trim(),
    visionModel: form.visionModel.trim(),
    temperature: clampNumber(form.temperature, TEMPERATURE_MIN, TEMPERATURE_MAX),
    timeoutMs: Math.round(clampNumber(form.timeoutSec, TIMEOUT_MIN_SEC, TIMEOUT_MAX_SEC) * 1000),
    maxOutputTokens: clampNumber(
      form.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS_MIN,
      MAX_OUTPUT_TOKENS_MAX,
    ),
    enableModel: form.enableModel,
    ocrBaseUrl: form.ocrBaseUrl.trim(),
    ocrEnabled: form.ocrEnabled,
  }
}

/** 清除密钥用的载荷：显式下发空串，后端据此清空 */
export function clearApiKeyInput(): AISettingsInput {
  return { apiKey: '' }
}

/** 延迟展示：1234 -> "1.23s" */
export function formatLatency(ms?: number | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * 根据当前配置判断「模型是否可能支持图片输入」。
 * 只用于展示一句提示，不参与任何功能判断。
 */
export function supportsVisionHint(presetSupportsVision: boolean, visionModel: string): {
  ok: boolean
  text: string
} {
  if (visionModel.trim()) {
    return presetSupportsVision
      ? { ok: true, text: '已单独指定视觉模型，拍照识别优先用它。' }
      : { ok: false, text: '已指定视觉模型，但该供应商未声明支持图片输入，拍照识别可能失败。' }
  }
  return presetSupportsVision
    ? { ok: true, text: '该供应商支持图片识别，拍照录入会直接用这个模型看图。' }
    : { ok: false, text: '该供应商不支持图片输入，拍照识别会回退到本地 OCR 或按提示词推导。' }
}
