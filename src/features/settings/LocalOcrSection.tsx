/**
 * features/settings/LocalOcrSection —— 本地 OCR 服务配置
 * ---------------------------------------------------------------------------
 * 本地 OCR 是「不上传图片」的兜底方案：兼容 PaddleOCR Serving / RapidOCR
 * 这类 HTTP 服务，跑在家长自己的电脑上，图片不出校、不出网。
 */

import { Field, ToggleRow } from '@/components/ui'
import { OcrHealthCheck } from './OcrHealthCheck'
import { ocrAddressHint, ocrPlaceholder } from './ocrPlaceholder'
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
  /* 占位符和说明文案都走纯函数 —— 断言和组件共用同一套逻辑 */
  const hint = ocrAddressHint(suggestedUrl)

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
          /* ⚠️ 没有后端推荐值时（老版后端），**不要**再给一个可能错的
             **具体地址** —— 那正是这次事故的根源：
             用户复制了一个在容器里必然失败的地址。
             给**中性占位符**，让 hint 去讲规则。 */
          placeholder={ocrPlaceholder(suggestedUrl)}
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
