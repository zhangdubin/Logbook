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
  suggestedUrl,
  onApplySuggested,
  refreshKey,
}: {
  form: SettingsForm
  onChange: (patch: Partial<SettingsForm>) => void
  /** 这套部署里应该填的地址（后端给的） */
  suggestedUrl?: string
  /** 一键采用推荐地址 */
  onApplySuggested?: (url: string) => void | Promise<void>
  /** 变了就重新探测 */
  refreshKey?: number
}) {
  /* ⚠️ 这里**不能**再写死「例如 http://127.0.0.1:8868」——
   *
   * 同一个地址在两种部署下含义完全相反：
   *   · 应用跑在宿主机上 → 127.0.0.1 ✓
   *   · 应用跑在 Docker 里 → 127.0.0.1 指的是**应用容器自己** ✗
   *     必须用**容器名**（cuoti-ocr / ocr）
   *
   * 用户**照着示例填就错**，然后看到「连不上」，
   * 于是得出「我明明启用了」的结论 —— 这正是用户反馈的现象。
   *
   * 前端不知道自己在哪种部署里 → 由后端给（GET /api/settings/ai 的 ocrSuggestedUrl）。
   */
  const suggestion = (suggestedUrl ?? '').trim()
  const hint = suggestion
    ? `这套部署里应该填 ${suggestion}（后端按部署方式给出的推荐值）。若用别的 OCR 服务商，按其文档改。`
    : '填 OCR 服务的地址。若应用跑在 Docker 容器里，用**容器名**而不是 127.0.0.1 —— 容器里的 127.0.0.1 指的是容器自己。'

  return (
    <div className="space-y-4">
      <ToggleRow
        checked={form.ocrEnabled}
        onChange={(v) => onChange({ ocrEnabled: v })}
        label="启用本地 OCR 服务"
        description="兼容 PaddleOCR Serving / RapidOCR 等 HTTP 服务，本地跑、数据不出校；未配置时仅使用视觉模型。"
      />

      <Field label="OCR 服务地址" hint={hint}>
        <input
          className="input font-mono text-[13px]"
          value={form.ocrBaseUrl}
          placeholder={suggestion || 'http://127.0.0.1:8868'}
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
      <OcrHealthCheck
        baseUrl={form.ocrBaseUrl}
        enabled={form.ocrEnabled}
        onApplySuggested={onApplySuggested}
        refreshKey={refreshKey}
      />

      <p className="rounded-xl bg-ink-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
        本地 OCR 只负责把图片里的文字抠出来，题干、选项、答案的结构化仍然由大模型或本地启发式引擎完成；
        没配置 OCR 时，拍照识别会直接交给视觉模型。
      </p>
    </div>
  )
}

export default LocalOcrSection
