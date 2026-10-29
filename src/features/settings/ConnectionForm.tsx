/**
 * features/settings/ConnectionForm —— 大模型连接配置表单
 * ---------------------------------------------------------------------------
 * 包含：Base URL / API Key / 模型 / 视觉模型 / 温度 / 超时 / 启用大模型开关。
 * 密钥的处理原则见 utils.ts：读取不回填、留空不修改、只有主动输入才下发。
 */

import type { AIProviderPreset } from '@/lib/types'
import { Badge, Field, ToggleRow } from '@/components/ui'
import type { SettingsForm } from './types'
import {
  MAX_OUTPUT_TOKENS_MAX,
  MAX_OUTPUT_TOKENS_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  TIMEOUT_MAX_SEC,
  TIMEOUT_MIN_SEC,
  clampNumber,
  isMaskedSecret,
  supportsVisionHint,
} from './utils'

const CUSTOM_MODEL = '__custom__'

export function ConnectionForm({
  form,
  onChange,
  preset,
  hasApiKey = false,
  maskedKey,
  onClearKey,
  clearing = false,
  disabled = false,
}: {
  form: SettingsForm
  onChange: (patch: Partial<SettingsForm>) => void
  preset?: AIProviderPreset
  hasApiKey?: boolean
  /** 后端回传的掩码串，只用于展示「已保存」，不会回填输入框 */
  maskedKey?: string
  onClearKey?: () => void
  clearing?: boolean
  disabled?: boolean
}) {
  const presetModels = preset?.models ?? []
  const modelIsManual =
    presetModels.length > 0 && form.model !== '' && !presetModels.includes(form.model)
  const vision = supportsVisionHint(Boolean(preset?.supportsVision), form.visionModel)
  const savedKeyHint = maskedKey && isMaskedSecret(maskedKey) ? maskedKey : ''

  return (
    <div className="space-y-4">
      {/* ------------------------------- Base URL ------------------------------- */}
      <Field
        label="Base URL"
        hint="兼容 OpenAI 协议的服务一般填到 /v1 为止，例如 https://api.example.com/v1"
      >
        <input
          className="input font-mono text-[13px]"
          value={form.baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />
      </Field>

      {/* ------------------------------- API Key ------------------------------- */}
      <Field
        label="API Key"
        hint={
          hasApiKey
            ? savedKeyHint
              ? `已保存密钥 ${savedKeyHint}，出于安全不会回显完整内容。`
              : '后端已保存密钥，出于安全不会回显完整内容。'
            : '从供应商控制台复制密钥粘贴进来，保存后不会再显示完整内容。'
        }
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input flex-1 font-mono text-[13px]"
              type="password"
              value={form.apiKey}
              placeholder={hasApiKey ? '已保存（留空则不修改）' : '粘贴 API Key，例如 sk-xxxxxxxx'}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              disabled={disabled}
              autoComplete="new-password"
              spellCheck={false}
            />
            {hasApiKey && (
              <Badge tone="green">✅ 已配置密钥</Badge>
            )}
          </div>

          <ul className="space-y-1 rounded-lg bg-ink-50/80 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
            <li>· 输入框<b className="text-ink-700">留空</b> = 不修改已保存的密钥</li>
            <li>· 输入框<b className="text-ink-700">填了新值</b> = 覆盖成这个新密钥</li>
            <li>· 点<b className="text-ink-700">「清除密钥」</b> = 立即清空（会再确认一次）</li>
          </ul>

          {hasApiKey && onClearKey && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onClearKey}
              disabled={clearing || disabled}
            >
              {clearing ? '清除中…' : '清除密钥'}
            </button>
          )}
        </div>
      </Field>

      {/* -------------------------------- 模型 -------------------------------- */}
      <Field label="模型" hint="下拉里选现成的，也可以直接手填模型名">
        <div className="space-y-2">
          {presetModels.length > 0 ? (
            <>
              <select
                className="select"
                value={modelIsManual ? CUSTOM_MODEL : form.model}
                onChange={(e) => {
                  const v = e.target.value
                  onChange({ model: v === CUSTOM_MODEL ? form.model : v })
                }}
                disabled={disabled}
              >
                <option value="">请选择模型</option>
                {presetModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={CUSTOM_MODEL}>✍️ 手动输入模型名…</option>
              </select>
              {modelIsManual && (
                <input
                  className="input font-mono text-[13px]"
                  value={form.model}
                  placeholder="输入模型名，例如 gpt-4o-2024-08-06"
                  onChange={(e) => onChange({ model: e.target.value })}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </>
          ) : (
            <input
              className="input font-mono text-[13px]"
              value={form.model}
              placeholder="输入模型名，例如 MiniMax-M2"
              onChange={(e) => onChange({ model: e.target.value })}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
            />
          )}
          <p
            className={`text-[11px] leading-relaxed ${vision.ok ? 'text-emerald-600' : 'text-ink-400'}`}
          >
            {vision.ok ? '👁 ' : 'ℹ️ '}
            {vision.text}
          </p>
        </div>
      </Field>

      {/* ------------------------------- 视觉模型 ------------------------------- */}
      <Field
        label="视觉模型（可选）"
        hint={`拍照识别专用。留空就复用上面的模型${form.model ? `（当前：${form.model}）` : ''}`}
      >
        <input
          className="input font-mono text-[13px]"
          value={form.visionModel}
          placeholder={form.model || '例如 qwen-vl-plus'}
          onChange={(e) => onChange({ visionModel: e.target.value })}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      {/* ------------------------------ 温度 / 超时 ------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`温度（${form.temperature.toFixed(1)}）`} hint="越低越稳定，越高越发散；错因分析建议 0~0.4">
          <div className="space-y-2">
            <input
              type="range"
              min={TEMPERATURE_MIN}
              max={TEMPERATURE_MAX}
              step={0.1}
              value={form.temperature}
              onChange={(e) => onChange({ temperature: Number(e.target.value) })}
              disabled={disabled}
              className="w-full accent-brand-600"
              aria-label="温度滑块"
            />
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={TEMPERATURE_MIN}
              max={TEMPERATURE_MAX}
              step={0.1}
              value={form.temperature}
              onChange={(e) =>
                onChange({
                  temperature: clampNumber(Number(e.target.value), TEMPERATURE_MIN, TEMPERATURE_MAX),
                })
              }
              disabled={disabled}
            />
          </div>
        </Field>

        <Field label="超时（秒）" hint="请求超过这个时间就判定失败，不会一直卡着">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={TIMEOUT_MIN_SEC}
            max={TIMEOUT_MAX_SEC}
            step={1}
            value={form.timeoutSec}
            onChange={(e) =>
              onChange({
                timeoutSec: clampNumber(Number(e.target.value), TIMEOUT_MIN_SEC, TIMEOUT_MAX_SEC),
              })
            }
            disabled={disabled}
          />
        </Field>

        <Field
          label="最大输出长度（token）"
          hint="推理模型（如 MiniMax M3.1）会先思考，思考内容也占这个预算；调太小会出现「模型返回内容为空」。"
        >
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={MAX_OUTPUT_TOKENS_MIN}
            max={MAX_OUTPUT_TOKENS_MAX}
            step={256}
            value={form.maxOutputTokens}
            onChange={(e) =>
              onChange({
                maxOutputTokens: clampNumber(
                  Number(e.target.value),
                  MAX_OUTPUT_TOKENS_MIN,
                  MAX_OUTPUT_TOKENS_MAX,
                ),
              })
            }
            disabled={disabled}
          />
        </Field>
      </div>

      {/* ------------------------------ 启用大模型 ------------------------------ */}
      <ToggleRow
        checked={form.enableModel}
        onChange={(v) => onChange({ enableModel: v })}
        label="启用大模型"
        description="关闭时将完全使用本地启发式引擎，不产生任何外部调用；打开后拍照识别与 AI 诊断才会请求上面配置的供应商。"
      />
    </div>
  )
}

export default ConnectionForm
