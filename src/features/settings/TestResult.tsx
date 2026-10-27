/**
 * features/settings/TestResult —— 连接测试结果展示
 * ---------------------------------------------------------------------------
 * 三种结局：
 *   1. 测试中  —— Spinner +「正在连接…」
 *   2. 成功    —— 绿色卡片：供应商、模型、延迟；vision 为真时说明图片输入已验证
 *   3. 失败    —— 红色卡片：错误文案 + 脱敏后的原始详情 + 排查建议清单
 */

import type { AIConnectionTestResult } from '@/lib/types'
import { AlertBox, Badge, Spinner } from '@/components/ui'
import type { TestState } from './types'
import { formatLatency, sanitizeDetail } from './utils'

const TROUBLESHOOTING = [
  'Base URL 是否写全了 —— 多数兼容服务要带 /v1，例如 https://api.example.com/v1',
  'API Key 是否有效、是否复制完整（首尾空格也会导致 401）',
  '模型名是否存在 —— 部分服务大小写敏感，先用控制台里的原始名称',
  '当前网络能不能访问这个地址 —— 校园网 / 公司网可能拦截境外域名',
]

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
    return (
      <AlertBox tone="error" title="连接测试没跑起来">
        <p>{error}</p>
        <p className="mt-1 opacity-80">
          确认后端服务已启动，并实现了 <span className="font-mono">POST /api/settings/ai/test</span> 接口。
        </p>
      </AlertBox>
    )
  }

  if (!result) return null

  /* 成功 */
  if (result.ok) {
    return (
      <AlertBox tone="success" title="连接成功">
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge tone="green">{result.provider}</Badge>
          <Badge tone="blue">{result.model || '未指定模型'}</Badge>
          <span className="text-[11px] opacity-80">延迟 {formatLatency(result.latencyMs)}</span>
        </div>
        <p className="mt-1.5">{result.message || '服务响应正常，可以直接保存设置。'}</p>
        {result.vision && (
          <p className="mt-1 font-semibold">👁 已验证图片输入可用，拍照识别可以直接用这个模型。</p>
        )}
        {result.detail && (
          <p className="mt-1 break-words text-[11px] opacity-80">{sanitizeDetail(result.detail, apiKey)}</p>
        )}
      </AlertBox>
    )
  }

  /* 失败 */
  const detail = sanitizeDetail(result.detail, apiKey)
  return (
    <AlertBox tone="error" title="连接失败">
      <p className="font-semibold">{result.message || '服务没有返回可用的结果。'}</p>
      {detail && (
        <p className="mt-1 break-words text-[11px] opacity-90">原始信息：{detail}</p>
      )}
      <p className="mt-2 font-bold">可以这样排查：</p>
      <ul className="mt-1 space-y-1">
        {TROUBLESHOOTING.map((tip) => (
          <li key={tip} className="flex gap-1.5">
            <span aria-hidden>•</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </AlertBox>
  )
}

export default TestResult
