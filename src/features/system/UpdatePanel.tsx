/**
 * features/system/UpdatePanel —— 系统更新主面板
 * ---------------------------------------------------------------------------
 * 展示当前版本 / 最新版本 / 发布时间 / 有无更新，并提供
 * 「检查更新」「一键更新」「回滚上一版本」三个动作。
 * 本组件只负责展示与派发动作，状态由 UpdateTab 持有。
 */

import { AlertBox, Badge, Card, Skeleton, Spinner } from '@/components/ui'
import type { UpdateInfo, UpdateStatus } from '@/lib/types'
import { UpdateNotes } from './UpdateNotes'
import { UpdateProgress } from './UpdateProgress'

function formatTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function UpdatePanel({
  info,
  infoLoading,
  infoError,
  configured,
  configNotice,
  status,
  statusError,
  busy,
  onCheck,
  onApply,
  onRollback,
}: {
  info: UpdateInfo | null
  infoLoading: boolean
  infoError: string | null
  /** 仓库是否已配置（决定「一键更新」能不能点） */
  configured: boolean
  /** 需要用户先处理配置时的提示 */
  configNotice: string | null
  status: UpdateStatus | null
  statusError: string | null
  /** 下载中 / 应用中：禁用重复点击 */
  busy: boolean
  onCheck: () => void
  onApply: () => void
  onRollback: () => void
}) {
  const hasUpdate = Boolean(info?.hasUpdate)

  return (
    <Card
      title="系统更新"
      subtitle="从 GitHub 拉取最新版本，一键替换程序文件"
      extra={
        info?.hasUpdate ? (
          <Badge tone="amber">发现新版本</Badge>
        ) : info ? (
          <Badge tone="green">已是最新</Badge>
        ) : null
      }
    >
      <div className="space-y-4">
        {/* 版本信息 */}
        {infoLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : infoError ? (
          <AlertBox tone="error" title="检查更新失败">
            <p>{infoError}</p>
          </AlertBox>
        ) : info ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2.5">
              <dt className="text-[11px] font-semibold text-ink-500">当前版本</dt>
              <dd className="mt-0.5 text-sm font-black text-ink-900">
                {info.currentVersion || '—'}
              </dd>
            </div>
            <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2.5">
              <dt className="text-[11px] font-semibold text-ink-500">最新版本</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-sm font-black text-ink-900">
                {info.latestVersion || '—'}
                {info.prerelease && <Badge tone="violet">预发布</Badge>}
              </dd>
            </div>
            <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2.5">
              <dt className="text-[11px] font-semibold text-ink-500">发布时间</dt>
              <dd className="mt-0.5 text-sm font-black text-ink-900">
                {formatTime(info.publishedAt)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-3 py-4 text-center text-[11px] text-ink-400">
            还没检查过更新，点下面的「检查更新」看看有没有新版本。
          </p>
        )}

        {/* 附加信息 */}
        {info && !info.configured && info.message && (
          <AlertBox tone="warning" title="仓库还没配置">
            <p>{info.message}</p>
          </AlertBox>
        )}
        {info?.assetName && (
          <p className="text-[11px] text-ink-400">
            发布附件：<span className="font-mono">{info.assetName}</span>
            {info.assetSize ? ` · ${formatSize(info.assetSize)}` : ''}
          </p>
        )}
        {info?.latestTag && (
          <p className="text-[11px] text-ink-400">
            最新标签：<span className="font-mono">{info.latestTag}</span>
          </p>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
          <button
            type="button"
            className="btn btn-outline"
            onClick={onCheck}
            disabled={infoLoading || busy}
          >
            {infoLoading ? (
              <>
                <Spinner size={14} /> 检查中…
              </>
            ) : (
              '🔍 检查更新'
            )}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onApply}
            disabled={busy || !configured || !hasUpdate}
            title={!configured ? '请先配置 GitHub 仓库' : !hasUpdate ? '当前没有可安装的新版本' : undefined}
          >
            ⬆️ 一键更新
          </button>
          <button type="button" className="btn btn-outline" onClick={onRollback} disabled={busy}>
            ↩️ 回滚上一版本
          </button>
        </div>

        {configNotice && (
          <AlertBox tone="warning" title="还差一步">
            <p>{configNotice}</p>
          </AlertBox>
        )}

        {/* 更新说明 */}
        {info && (
          <div>
            <p className="mb-1.5 text-xs font-bold text-ink-700">📝 更新说明</p>
            <UpdateNotes notes={info.notes ?? ''} loading={infoLoading} />
          </div>
        )}

        {/* 进度 + 日志 */}
        <UpdateProgress status={status} error={statusError} />
      </div>
    </Card>
  )
}

export default UpdatePanel
