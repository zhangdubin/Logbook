/**
 * features/system/PublishPanel —— 把本机源码发布成 GitHub 版本
 * ---------------------------------------------------------------------------
 * 用途：把本机源码打包成 tar.gz，作为 GitHub Release 发布出去，
 * 其它机器就能在「系统更新」里一键更新拉到它。
 *
 * 约定：
 *   - 打包**不包含**数据库、上传的图片、.env、node_modules（后端负责排除）；
 *   - 发布结果完全以后端返回为准，前端不做乐观更新；
 *   - 后端返回的中文 error / message 原样展示，不吞掉。
 */

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import type { PublishInput, PublishResult } from '@/lib/types'
import { AlertBox, Badge, Card, Field, Modal, Spinner, ToggleRow } from '@/components/ui'
import { useToast } from '@/store/toast'

/** 版本号格式校验：1.2.3 或 1.2.3-beta.1 */
export const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]+)?$/

export function isValidVersion(version: string): boolean {
  return VERSION_PATTERN.test(version.trim())
}

/** 由当前版本推算下一个 patch 版本，例如 1.0.0 → 1.0.1 */
export function nextPatchVersion(current: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current.trim())
  if (!match) return '1.0.1'
  const [, major, minor, patch] = match
  return `${major}.${minor}.${Number(patch) + 1}`
}

function formatSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/* ------------------------------ 发布确认弹窗 ------------------------------ */

function PublishConfirmModal({
  open,
  onClose,
  onConfirm,
  busy,
  version,
  repo,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  busy?: boolean
  version: string
  repo?: string
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="确认发布新版本？"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            再想想
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? '发布中…' : '确认发布'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-600">
          将把本机源码打包上传到 GitHub{repo ? `（仓库：${repo}）` : ''}，并创建版本{' '}
          <span className="font-mono font-bold text-ink-900">{version}</span> 的 Release。
        </p>

        <ul className="space-y-1.5 rounded-xl bg-ink-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-ink-600">
          <li>📦 <b className="text-ink-800">会上传</b>：本机源码打包（tar.gz）并作为 Release 附件</li>
          <li>🔒 <b className="text-ink-800">不会打包</b>：数据库、上传的图片、<span className="font-mono">.env</span>、
            <span className="font-mono">node_modules</span> —— 你的数据不会被带走</li>
          <li>🔑 需要令牌有 <span className="font-mono">contents:write</span> 权限，否则发布会失败</li>
          <li>🚫 同一个版本号不能重复发布</li>
          <li>🌐 公开仓库的话，<b className="text-ink-800">任何人都能看到</b>这份源码</li>
        </ul>

        <AlertBox tone="warning">
          <span className="text-[11px]">发布前请确认仓库地址没填错 —— 发到公开仓库就收不回来了。</span>
        </AlertBox>
      </div>
    </Modal>
  )
}

/* -------------------------------- 主面板 -------------------------------- */

export function PublishPanel({
  currentVersion = '',
  repo = '',
  hasToken = false,
}: {
  /** 当前安装版本，用来自动带出下一个 patch 版本号 */
  currentVersion?: string
  /** 目标仓库（仅用于确认弹窗提示） */
  repo?: string
  /** 是否已配置 GitHub 令牌 */
  hasToken?: boolean
}) {
  const { push } = useToast()

  const [version, setVersion] = useState(() => nextPatchVersion(currentVersion))
  const [versionTouched, setVersionTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [prerelease, setPrerelease] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* 已知/待查的当前安装版本 */
  const [serverVersion, setServerVersion] = useState(currentVersion)

  /* 外部拿到当前版本就用它 */
  useEffect(() => {
    if (currentVersion) setServerVersion(currentVersion)
  }, [currentVersion])

  /* 外部还没给（例如还没点过「检查更新」）就自己问一次，保证默认版本号是准的 */
  useEffect(() => {
    if (serverVersion) return
    let alive = true
    void api
      .getUpdateInfo()
      .then((info) => {
        if (alive && info && typeof info.currentVersion === 'string' && info.currentVersion) {
          setServerVersion(info.currentVersion)
        }
      })
      .catch(() => {
        /* 拿不到就沿用兜底版本号，不打扰用户 */
      })
    return () => {
      alive = false
    }
  }, [serverVersion])

  /* 当前版本变化时，自动带出下一个 patch 版本（用户没手动改过才动） */
  useEffect(() => {
    if (!versionTouched) setVersion(nextPatchVersion(serverVersion))
  }, [serverVersion, versionTouched])

  const handlePublishClick = () => {
    const value = version.trim()
    if (!value) {
      setLocalError('请填写版本号，例如 1.1.0')
      return
    }
    if (!isValidVersion(value)) {
      setLocalError('版本号格式不对，应该是「主版本.次版本.修订号」，例如 1.1.0 或 1.1.0-beta.1')
      return
    }
    setLocalError(null)
    setConfirmOpen(true)
  }

  const doPublish = async () => {
    const input: PublishInput = {
      version: version.trim(),
      notes: notes.trim(),
      prerelease,
    }
    setPublishing(true)
    setError(null)
    try {
      const res = await api.publishRelease(input)
      if (res && typeof res === 'object') {
        setResult(res)
        if (res.ok) {
          push(`已发布 ${res.version}`, 'success')
          setConfirmOpen(false)
        } else {
          /* 后端已经给了中文原因，原样展示 */
          const reason = res.error || res.message || '发布失败，请稍后再试'
          setError(reason)
          push(reason, 'error')
        }
      } else {
        setError('发布接口返回了非预期的内容')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '发布失败，请稍后再试'
      setError(message)
      push(message, 'error')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Card
      title="发布新版本"
      subtitle="把本机源码打包成 tar.gz 发布到 GitHub Release，其它机器就能一键更新拉到它"
      extra={prerelease ? <Badge tone="violet">预发布</Badge> : null}
    >
      <div className="space-y-4">
        <Field
          label="版本号"
          hint={
            serverVersion
              ? `当前安装版本 ${serverVersion}，默认带出下一个修订号。不带 v 前缀，例如 1.1.0；同一版本号不能重复发布。`
              : '不带 v 前缀，例如 1.1.0；预发布可以写 1.1.0-beta.1。同一版本号不能重复发布。'
          }
        >
          <input
            className="input min-w-0 font-mono text-[13px]"
            value={version}
            placeholder="1.1.0"
            onChange={(e) => {
              setLocalError(null)
              setVersionTouched(true)
              setVersion(e.target.value)
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Field label="更新说明" hint="会作为 GitHub Release 的正文，支持换行（纯文本）。">
          <textarea
            className="textarea min-h-28 min-w-0 text-[13px]"
            value={notes}
            placeholder={'例如：\n- 修复拍照识别丢字\n- 新增一键更新与回滚'}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
          />
        </Field>

        <ToggleRow
          checked={prerelease}
          onChange={setPrerelease}
          label="作为预发布（prerelease）"
          description="打开后会发布成 GitHub 的预发布版本，不会计入正式版更新提示。"
        />

        {!hasToken && (
          <AlertBox tone="warning" title="还没有配置 GitHub 令牌">
            <p>发布需要 GitHub 令牌（contents:write 权限），请先在上方「更新来源仓库」里填写并保存。</p>
          </AlertBox>
        )}

        {localError && (
          <AlertBox tone="error" title="版本号填得不太对">
            <p>{localError}</p>
          </AlertBox>
        )}

        {error && (
          <AlertBox tone="error" title="发布失败">
            <p className="break-words">{error}</p>
          </AlertBox>
        )}

        {result?.ok && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">发布成功</Badge>
              <span className="text-sm font-black text-emerald-900">
                {result.version}
              </span>
              {result.tag && (
                <span className="font-mono text-[11px] text-emerald-700">{result.tag}</span>
              )}
            </div>
            <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-emerald-800">
              {result.assetName && (
                <li>
                  📦 附件：<span className="font-mono">{result.assetName}</span>
                  {result.assetSize ? ` · ${formatSize(result.assetSize)}` : ''}
                </li>
              )}
              {result.message && <li>ℹ️ {result.message}</li>}
            </ul>
            {result.releaseUrl && (
              <a
                href={result.releaseUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-block text-[11px] font-bold text-brand-600 underline-offset-2 hover:underline"
              >
                在 GitHub 上查看这个 Release ↗
              </a>
            )}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePublishClick}
          disabled={publishing}
        >
          {publishing ? (
            <>
              <Spinner size={14} /> 发布中…
            </>
          ) : (
            '🚀 发布新版本'
          )}
        </button>
      </div>

      <PublishConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void doPublish()}
        busy={publishing}
        version={version.trim()}
        repo={repo.trim() || undefined}
      />
    </Card>
  )
}

export default PublishPanel
