/**
 * features/system/UpdateProgress —— 更新进度 + 运行日志
 * ---------------------------------------------------------------------------
 * 进度条用 components/ui 的 Progress；日志用等宽字体 + whitespace-pre-wrap，
 * 只显示最近 200 行，避免长任务把页面撑爆。
 */

import { AlertBox, Badge, Progress } from '@/components/ui'
import type { UpdateState, UpdateStatus } from '@/lib/types'

/** 日志最多显示的行数 */
export const MAX_LOG_LINES = 200

const STATE_META: Record<
  UpdateState,
  { label: string; tone: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'cyan'; color: string }
> = {
  idle: { label: '空闲', tone: 'slate', color: '#94a3b8' },
  checking: { label: '检查中', tone: 'blue', color: '#3b63f6' },
  downloading: { label: '下载中', tone: 'cyan', color: '#06b6d4' },
  applying: { label: '应用中', tone: 'violet', color: '#8b5cf6' },
  restarting: { label: '重启中', tone: 'amber', color: '#f59e0b' },
  done: { label: '已完成', tone: 'green', color: '#10b981' },
  failed: { label: '失败', tone: 'red', color: '#ef4444' },
}

export function UpdateProgress({
  status,
  error,
}: {
  status: UpdateStatus | null
  /** 请求层面的错误（后端接口挂了） */
  error?: string | null
}) {
  if (error) {
    return (
      <AlertBox tone="error" title="更新服务暂时不可用">
        <p>{error}</p>
      </AlertBox>
    )
  }

  if (!status) return null

  const meta = STATE_META[status.state] ?? STATE_META.idle
  const lines = Array.isArray(status.log) ? status.log : []
  const shown = lines.slice(-MAX_LOG_LINES)
  const trimmed = lines.length - shown.length

  return (
    <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-xs font-semibold text-ink-700">
            {status.message || '—'}
          </span>
        </div>
        <span className="text-[11px] font-bold text-ink-400">{Math.round(status.progress ?? 0)}%</span>
      </div>

      <Progress value={status.progress ?? 0} color={meta.color} height={8} />

      {status.state === 'failed' && status.error && (
        <AlertBox tone="error" title="更新失败">
          {/* whitespace-pre-wrap：排查指引是分行的（命令要一行一条），
              不加的话换行会被折叠成空格，用户没法照着敲命令 */}
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
            {status.error}
          </p>
        </AlertBox>
      )}

      {status.state === 'done' && status.requiresRestart && (
        <AlertBox tone="warning" title="更新完成，但还需要重启服务">
          <p>请重启服务后生效；如果在「更新来源仓库」里打开了「自动重启」，服务会自动拉起，页面可能会短暂断开。</p>
        </AlertBox>
      )}

      {status.state === 'done' && !status.requiresRestart && (
        <AlertBox tone="success" title="更新完成">
          <p>
            新版本{status.newVersion ? ` ${status.newVersion}` : ''}
            {status.previousVersion ? `（原 ${status.previousVersion}）` : ''}已经生效。
          </p>
        </AlertBox>
      )}

      {shown.length > 0 && (
        <div>
          {trimmed > 0 && (
            <p className="mb-1 text-[10px] text-ink-400">（已省略最早的 {trimmed} 行）</p>
          )}
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-ink-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-100">
            {shown.join('\n')}
          </pre>
        </div>
      )}
    </div>
  )
}

export default UpdateProgress
