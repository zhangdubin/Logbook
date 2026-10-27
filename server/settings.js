/**
 * server/settings.js —— AI 模型设置的持久化与校验
 * ---------------------------------------------------------------------------
 * 存储位置：SQLite `settings` 表，key = 'ai.config'，value = JSON。
 *
 * 关键约定：
 *  - API Key 明文入库，但**任何对外响应都不返回明文**（统一走 maskApiKey）。
 *  - 前端回显的是掩码串（如 `sk-****abcd`），保存时若传回掩码串或空串，
 *    则**保留数据库中已有密钥**，避免把真值覆盖成 '****'。
 */

import { db, nowISO, parseJSON } from './db.js'
import { getPreset } from './providers.js'

/** settings 表中的键 */
export const AI_SETTINGS_KEY = 'ai.config'

/** 无任何配置时的默认设置（provider=minimax，enableModel=true，其余为空/默认） */
export const DEFAULT_AI_SETTINGS = {
  provider: 'minimax',
  baseUrl: 'https://api.minimax.chat/v1',
  apiKey: '',
  model: 'MiniMax-M3.1-Flash',
  visionModel: '',
  temperature: 0.3,
  timeoutMs: 25000,
  enableModel: true,
  ocrBaseUrl: '',
  ocrEnabled: false,
}

/* -------------------------------------------------------------------------- */
/* 掩码                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 掩码密钥：
 *   - 空串 -> ''
 *   - 短密钥（≤ 8 位）-> '****'
 *   - 长密钥 -> 'sk-****abcd'（保留前 3 位与后 4 位）
 */
export function maskApiKey(key) {
  const k = String(key ?? '').trim()
  if (!k) return ''
  if (k.length <= 8) return '****'
  return `${k.slice(0, 3)}****${k.slice(-4)}`
}

/** 判断传入的密钥是否是掩码串（是则视为「不修改已有密钥」） */
export function isMaskedKey(key) {
  const k = String(key ?? '').trim()
  if (!k) return false
  return k.includes('****')
}

/* -------------------------------------------------------------------------- */
/* 读写                                                                        */
/* -------------------------------------------------------------------------- */

/** 读取已保存的配置（原始对象，含明文 apiKey）；无配置返回 null */
export function readStoredAiConfig() {
  const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(AI_SETTINGS_KEY)
  if (!row) return null
  const raw = parseJSON(row.value, null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return { ...raw, updatedAt: row.updated_at ?? undefined }
}

/** 写入配置（覆盖） */
export function writeStoredAiConfig(config) {
  const now = nowISO()
  const { updatedAt, ...rest } = config ?? {}
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(AI_SETTINGS_KEY, JSON.stringify(rest), now)
  return { ...rest, updatedAt: now }
}

/** 删除配置（恢复默认） */
export function deleteStoredAiConfig() {
  db.prepare('DELETE FROM settings WHERE key = ?').run(AI_SETTINGS_KEY)
}

/* -------------------------------------------------------------------------- */
/* 校验                                                                        */
/* -------------------------------------------------------------------------- */

const MAX_MODEL_LEN = 120
const MAX_URL_LEN = 500

function str(v) {
  return v === undefined || v === null ? '' : String(v).trim()
}

/** baseUrl 必须是 http/https */
export function normalizeBaseUrl(raw) {
  const u = str(raw).replace(/\/+$/, '')
  if (!u) return ''
  let parsed
  try {
    parsed = new URL(u)
  } catch {
    return u
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return u
  return u
}

/**
 * 校验前端提交的设置（部分字段）。
 * @returns {{errors: string[], value: object}}
 */
export function validateAiInput(input = {}) {
  const errors = []
  const value = {}

  if (input.provider !== undefined) {
    const p = str(input.provider)
    if (!p) errors.push('provider 不能为空')
    else value.provider = p
  }

  if (input.baseUrl !== undefined) {
    const u = str(input.baseUrl)
    if (u) {
      if (u.length > MAX_URL_LEN) errors.push('baseUrl 过长')
      let ok = false
      try {
        const parsed = new URL(u)
        ok = parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        ok = false
      }
      if (!ok) errors.push('baseUrl 必须是 http:// 或 https:// 开头的合法地址')
      else value.baseUrl = normalizeBaseUrl(u)
    } else {
      value.baseUrl = ''
    }
  }

  if (input.model !== undefined) {
    const m = str(input.model)
    if (m.length > MAX_MODEL_LEN) errors.push(`model 长度不能超过 ${MAX_MODEL_LEN}`)
    value.model = m
  }

  if (input.visionModel !== undefined) {
    const m = str(input.visionModel)
    if (m.length > MAX_MODEL_LEN) errors.push(`visionModel 长度不能超过 ${MAX_MODEL_LEN}`)
    value.visionModel = m
  }

  if (input.temperature !== undefined) {
    const t = Number(input.temperature)
    if (!Number.isFinite(t) || t < 0 || t > 2) errors.push('temperature 必须在 0 ~ 2 之间')
    else value.temperature = t
  }

  if (input.timeoutMs !== undefined) {
    const t = Number(input.timeoutMs)
    if (!Number.isFinite(t) || t < 1000 || t > 120000)
      errors.push('timeoutMs 必须在 1000 ~ 120000 毫秒之间')
    else value.timeoutMs = Math.round(t)
  }

  if (input.enableModel !== undefined) value.enableModel = Boolean(input.enableModel)

  if (input.ocrBaseUrl !== undefined) {
    const u = str(input.ocrBaseUrl)
    if (u) {
      let ok = false
      try {
        const parsed = new URL(u)
        ok = parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        ok = false
      }
      if (!ok) errors.push('ocrBaseUrl 必须是 http:// 或 https:// 开头的合法地址')
      else value.ocrBaseUrl = normalizeBaseUrl(u)
    } else {
      value.ocrBaseUrl = ''
    }
  }

  if (input.ocrEnabled !== undefined) value.ocrEnabled = Boolean(input.ocrEnabled)

  // 非契约字段，但允许前端声明「自定义供应商是否支持视觉」
  if (input.supportsVision !== undefined) value.supportsVision = Boolean(input.supportsVision)

  return { errors, value }
}

/* -------------------------------------------------------------------------- */
/* 保存 / 读取（对外形状）                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 保存设置。
 * - apiKey 传掩码串或空串 => 保留库中已有密钥
 * @returns {{errors: string[], public: object}|null}
 */
export function saveAiSettings(input = {}) {
  const existing = readStoredAiConfig()
  const { errors, value } = validateAiInput(input)
  if (errors.length) return { errors, public: null }

  const provider = value.provider ?? existing?.provider ?? DEFAULT_AI_SETTINGS.provider
  const preset = getPreset(provider)

  const baseUrlInput = value.baseUrl ?? existing?.baseUrl ?? ''
  const baseUrl = baseUrlInput || preset?.baseUrl || ''
  if (!baseUrl) {
    return { errors: ['baseUrl 不能为空，请填写接口地址或选择内置供应商'], public: null }
  }
  let ok = false
  try {
    const parsed = new URL(baseUrl)
    ok = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    ok = false
  }
  if (!ok) return { errors: ['baseUrl 必须是 http:// 或 https:// 开头的合法地址'], public: null }

  const model = value.model ?? existing?.model ?? preset?.defaultModel ?? ''
  const visionModel = value.visionModel ?? existing?.visionModel ?? ''

  // ---- 密钥处理：三态语义 ----
  //   undefined          -> 不修改（沿用库中已有密钥）
  //   ''（空串）          -> 清除密钥（hasApiKey 随之变 false）
  //   掩码串 sk-****abcd  -> 不修改（保留库中已有密钥）
  //   其它非空字符串      -> 覆盖为新密钥
  let apiKey
  if (input.apiKey === undefined) {
    apiKey = existing?.apiKey ?? ''
  } else {
    const incoming = str(input.apiKey)
    if (!incoming) apiKey = ''
    else if (isMaskedKey(incoming)) apiKey = existing?.apiKey ?? ''
    else apiKey = incoming
  }

  const next = {
    provider,
    baseUrl,
    apiKey,
    model,
    visionModel,
    temperature: value.temperature ?? existing?.temperature ?? DEFAULT_AI_SETTINGS.temperature,
    timeoutMs: value.timeoutMs ?? existing?.timeoutMs ?? DEFAULT_AI_SETTINGS.timeoutMs,
    enableModel:
      value.enableModel !== undefined
        ? value.enableModel
        : existing?.enableModel !== undefined
          ? existing.enableModel
          : DEFAULT_AI_SETTINGS.enableModel,
    ocrBaseUrl: value.ocrBaseUrl ?? existing?.ocrBaseUrl ?? '',
    ocrEnabled:
      value.ocrEnabled !== undefined
        ? value.ocrEnabled
        : existing?.ocrEnabled !== undefined
          ? existing.ocrEnabled
          : DEFAULT_AI_SETTINGS.ocrEnabled,
    ...(value.supportsVision !== undefined
      ? { supportsVision: value.supportsVision }
      : existing?.supportsVision !== undefined
        ? { supportsVision: existing.supportsVision }
        : {}),
  }

  const saved = writeStoredAiConfig(next)
  return { errors: [], public: toPublicSettings(saved), stored: saved }
}

/** 删除设置（恢复默认） */
export function resetAiSettings() {
  deleteStoredAiConfig()
  return toPublicSettings({ ...DEFAULT_AI_SETTINGS })
}

/**
 * 对外暴露的设置对象（API Key 已掩码）。
 * @param {object} [raw] 原始配置；缺省读库
 */
export function toPublicSettings(raw) {
  const stored = raw ?? readStoredAiConfig()
  const s = stored ?? DEFAULT_AI_SETTINGS
  const apiKey = String(s.apiKey ?? '')
  return {
    provider: String(s.provider ?? DEFAULT_AI_SETTINGS.provider),
    baseUrl: String(s.baseUrl ?? ''),
    apiKey: maskApiKey(apiKey),
    model: String(s.model ?? ''),
    visionModel: String(s.visionModel ?? ''),
    temperature: Number(s.temperature ?? DEFAULT_AI_SETTINGS.temperature),
    timeoutMs: Number(s.timeoutMs ?? DEFAULT_AI_SETTINGS.timeoutMs),
    enableModel: s.enableModel !== false,
    ocrBaseUrl: String(s.ocrBaseUrl ?? ''),
    ocrEnabled: Boolean(s.ocrEnabled),
    hasApiKey: Boolean(apiKey),
    ...(s.updatedAt ? { updatedAt: String(s.updatedAt) } : {}),
  }
}

/** 读取对外设置（读库；无配置时返回默认值） */
export function getAiSettingsPublic() {
  return toPublicSettings(readStoredAiConfig())
}

export default {
  AI_SETTINGS_KEY,
  DEFAULT_AI_SETTINGS,
  maskApiKey,
  isMaskedKey,
  readStoredAiConfig,
  writeStoredAiConfig,
  deleteStoredAiConfig,
  validateAiInput,
  saveAiSettings,
  resetAiSettings,
  toPublicSettings,
  getAiSettingsPublic,
}
