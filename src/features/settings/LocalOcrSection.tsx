/**
 * features/settings/LocalOcrSection —— 本地 OCR 服务配置
 * ---------------------------------------------------------------------------
 * 本地 OCR 是「不上传图片」的兜底方案：兼容 PaddleOCR Serving / RapidOCR
 * 这类 HTTP 服务，跑在家长自己的电脑上，图片不出校、不出网。
 */

import { Field, ToggleRow } from '@/components/ui'
import { OcrHealthCheck } from './OcrHealthCheck'
import type { SettingsForm } from './types'

export function LocalOcrSection({
  form,
  onChange,
}: {
  form: SettingsForm
  onChange: (patch: Partial<SettingsForm>) => void
}) {
  return (
    <div className="space-y-4">
      <ToggleRow
        checked={form.ocrEnabled}
        onChange={(v) => onChange({ ocrEnabled: v })}
        label="启用本地 OCR 服务"
        description="兼容 PaddleOCR Serving / RapidOCR 等 HTTP 服务，本地跑、数据不出校；未配置时仅使用视觉模型。"
      />

      <Field
        label="OCR 服务地址"
        hint="例如 http://127.0.0.1:8868；服务端点通常是 /predict/ocr 这类路径，具体看服务商的文档"
      >
        <input
          className="input font-mono text-[13px]"
          value={form.ocrBaseUrl}
          placeholder="http://127.0.0.1:8868"
          onChange={(e) => onChange({ ocrBaseUrl: e.target.value })}
          disabled={!form.ocrEnabled}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />
      </Field>

      {/* 服务健康自检 */}
      <OcrHealthCheck baseUrl={form.ocrBaseUrl} enabled={form.ocrEnabled} />

      <p className="rounded-xl bg-ink-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
        本地 OCR 只负责把图片里的文字抠出来，题干、选项、答案的结构化仍然由大模型或本地启发式引擎完成；
        没配置 OCR 时，拍照识别会直接交给视觉模型。
      </p>
    </div>
  )
}

export default LocalOcrSection
