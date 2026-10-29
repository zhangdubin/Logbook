/**
 * features/settings/TestResult —— 连接测试结果展示
 * ---------------------------------------------------------------------------
 * 三种结局：
 *   1. 测试中  —— Spinner +「正在连接…」
 *   2. 成功    —— 绿色卡片：供应商、模型、延迟；vision 为真时说明图片输入已验证
 *   3. 失败    —— 红色卡片：后端给出的具体原因 + 针对该原因的排查建议 + 可折叠的原始信息
 *
 * 失败分支为什么不再统一套「连接失败 + 4 条通用清单」：
 * 后端已经把原因分类好了（认证失败 / 余额不足 / 限流 / 超时 / 内容为空 / 连不上…），
 * 统一清单全是猜测，一条都指不到真正的原因。详见 ./failureHints.ts。
 */

import type { AIConnectionTestResult } from '@/lib/types'
import { AlertBox, Badge, Spinner } from '@/components/ui'
import type { TestState } from './types'
import { classifyFailure, failureTitle, FAILURE_HINTS } from './failureHints'
import { formatLatency, sanitizeDetail } from './utils'

export function TestResult({
  state,
  result,
  error,
  apiKey,
}: {
  state: TestState
  result: AIConnectionTestResult | null
  error: string | null
  apiKey?: string
}) {
  if (state === 'idle') return null

  if (state === 'testing') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/70 px-4 py-3 text-sm font-semibold text-brand-700">
        <Spinner /> 正在连接…（会用当前表单里还没保存的值去试）
      </div>
    )
  }

  /* 请求本身失败（后端接口不可用 / 网络错误） */
  if (error) {
    const msg = sanitizeDetail(error, apiKey) || '连接测试失败'
    return (
      <AlertBox tone="error" title="连接测试没跑起来">
        <p className="break-words">{msg}</p>
        <p className="mt-1 opacity-80">
          确认后端服务已启动，并实现了 <span className="font-mono">POST /api/settings/ai/test</span> 接口。
        </p>
      </AlertBox>
    )
  }

  if (!result) return null

  /* 成功 */
  if (result.ok) {
    const detail = sanitizeDetail(result.detail, apiKey)
    /* 视觉校验失败不影响文字对话，但拍照识别可能用不了 —— 单独提示，别混在成功里 */
    const visionBroken = detail.includes('视觉校验失败')
    return (
      <AlertBox tone="success" title="连接成功">
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge tone="green">{result.provider}</Badge>
          <Badge tone="blue">{result.model || '未指定模型'}</Badge>
          <span className="text-[11px] opacity-80">延迟 {formatLatency(result.latencyMs)}</span>
        </div>
        <p className="mt-1.5">{result.message || '服务响应正常，可以直接保存设置。'}</p>
        {/* result.vision 只说明「这个模型支持图片输入」，真正校验通过才能说「已验证」 */}
        {result.vision && !visionBroken && (
          <p className="mt-1 font-semibold">👁 已验证图片输入可用，拍照识别可以直接用这个模型。</p>
        )}
        {visionBroken && (
          <p className="mt-1.5 break-words rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
            {detail} —— 文字对话没问题，但这个模型没能通过图片输入校验，拍照识别可能不可用；
            可以单独指定一个视觉模型再测。
          </p>
        )}
        {!visionBroken && detail && (
          <p className="mt-1 break-words text-[11px] opacity-80">{detail}</p>
        )}
      </AlertBox>
    )
  }

  /* 失败：标题用后端给出的具体原因，下面给该原因对应的排查建议 */
  const detail = sanitizeDetail(result.detail, apiKey)
  const hint = FAILURE_HINTS[classifyFailure(result.message, detail)]
  return (
    <AlertBox tone="error" title={failureTitle(result.message)}>
      <p className="font-semibold">{hint.lead}</p>
      <p className="mt-2 font-bold">可以这样排查：</p>
      <ul className="mt-1 space-y-1">
        {hint.tips.map((tip) => (
          <li key={tip} className="flex gap-1.5">
            <span aria-hidden>•</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
      {detail && (
        <details className="mt-2 text-[11px] leading-relaxed opacity-80">
          <summary className="cursor-pointer select-none">查看原始返回信息</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{detail}</p>
        </details>
      )}
    </AlertBox>
  )
}

export default TestResult
