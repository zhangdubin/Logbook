/**
 * features/system/RepoConfigCard —— 更新来源仓库配置
 * ---------------------------------------------------------------------------
 * 配置一个 GitHub 仓库（owner/repo）、访问 GitHub 用的代理、以及 GitHub 令牌。
 * 仓库格式不对、代理格式不对时都只在本地提示，不发请求。
 *
 * 令牌语义（与 AI 密钥一致）：
 *   - 输入框留空 = 不修改已保存的令牌
 *   - 输入框填了新值 = 覆盖
 *   - 点「清除令牌」 = 立即清空（需二次确认）
 */

import { useState } from 'react'
import { AlertBox, Badge, Field, Skeleton, ToggleRow } from '@/components/ui'

/** owner/repo 格式校验 */
export const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/

export function isValidRepo(repo: string): boolean {
  return REPO_PATTERN.test(repo.trim())
}

/**
 * 代理地址校验：空串合法（直连）；非空必须是 http/https 且有主机名。
 */
export function isValidProxy(proxy: string): boolean {
  const value = proxy.trim()
  if (!value) return true
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function RepoConfigCard({
  repo,
  onRepoChange,
  proxy,
  onProxyChange,
  token,
  onTokenChange,
  hasToken,
  onClearToken,
  clearingToken = false,
  autoRestart,
  onAutoRestartChange,
  loading = false,
  saving = false,
  error = null,
  notice = null,
  highlighted = false,
  onSave,
  onRetry,
}: {
  repo: string
  onRepoChange: (value: string) => void
  /** 访问 GitHub 的代理地址，空串 = 直连 */
  proxy: string
  onProxyChange: (value: string) => void
  /** 令牌输入框内容；空 = 不修改已保存的令牌 */
  token: string
  onTokenChange: (value: string) => void
  /** 后端是否已保存令牌（令牌本身永不明文回显） */
  hasToken: boolean
  /** 点「清除令牌」→ 由外层弹二次确认后调用 */
  onClearToken: () => void
  clearingToken?: boolean
  autoRestart: boolean
  onAutoRestartChange: (value: boolean) => void
  loading?: boolean
  saving?: boolean
  /** 后端返回的错误 */
  error?: string | null
  /** 需要用户先处理这里的提示（例如「请先配置仓库」） */
  notice?: string | null
  /** 高亮：引导用户回到这张卡片 */
  highlighted?: boolean
  onSave: () => void
  onRetry?: () => void
}) {
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSave = () => {
    const value = repo.trim()
    if (!value) {
      setLocalError('请填写仓库地址，例如 owner/repo')
      return
    }
    if (!isValidRepo(value)) {
      setLocalError('仓库地址格式不对，应该是「用户名/仓库名」，例如 owner/repo')
      return
    }
    if (!isValidProxy(proxy)) {
      setLocalError('代理地址格式不对，应该像 http://127.0.0.1:7890 或 https://127.0.0.1:7890')
      return
    }
    setLocalError(null)
    onSave()
  }

  return (
    <section
      className={`card transition ${highlighted ? 'ring-2 ring-brand-400' : ''}`}
      aria-label="更新来源仓库"
    >
      <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-ink-800">更新来源仓库</h2>
          <p className="mt-0.5 text-xs text-ink-500">指定一个 GitHub 仓库，一键更新就从这里拉取最新版本</p>
        </div>
        {repo.trim() && (
          <Badge tone="green">已配置</Badge>
        )}
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            <Field
              label="GitHub 仓库"
              hint="格式为「用户名/仓库名」，必须是公开仓库或已配置访问令牌的私有仓库"
            >
              <div className="space-y-2">
                <input
                  className="input min-w-0 font-mono text-[13px]"
                  value={repo}
                  placeholder="owner/repo"
                  onChange={(e) => {
                    setLocalError(null)
                    onRepoChange(e.target.value)
                  }}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="url"
                />
                {!repo.trim() && (
                  <p className="text-[11px] text-ink-400">
                    还没填仓库？可以点下面的示例看看格式：
                    <button
                      type="button"
                      className="ml-1 rounded-md bg-ink-100 px-1.5 py-0.5 font-mono font-bold text-ink-600 hover:bg-ink-200"
                      onClick={() => {
                        setLocalError(null)
                        onRepoChange('owner/repo')
                      }}
                    >
                      owner/repo
                    </button>
                  </p>
                )}
              </div>
            </Field>

            <Field
              label="代理地址"
              hint="仅用于访问 GitHub（检查更新 / 一键更新 / 发布版本），留空表示直连。国内网络访问 GitHub 比较慢时，可以填一个本地代理。"
            >
              <input
                className="input min-w-0 font-mono text-[13px]"
                value={proxy}
                placeholder="http://127.0.0.1:7890"
                onChange={(e) => {
                  setLocalError(null)
                  onProxyChange(e.target.value)
                }}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
              />
            </Field>

            <Field
              label="GitHub 令牌"
              hint="发布新版本必需，令牌需要 contents:write 权限。留空表示不修改已保存的令牌。"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input min-w-0 flex-1 font-mono text-[13px]"
                    type="password"
                    value={token}
                    placeholder={hasToken ? '已保存（留空则不修改）' : '粘贴 GitHub 个人访问令牌'}
                    onChange={(e) => {
                      setLocalError(null)
                      onTokenChange(e.target.value)
                    }}
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  {hasToken && (
                    <>
                      <Badge tone="green">已配置</Badge>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={onClearToken}
                        disabled={clearingToken}
                      >
                        {clearingToken ? '清除中…' : '清除令牌'}
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-ink-400">
                  · 输入框留空 = 不修改已保存的令牌
                  <br />· 输入框填了新值 = 覆盖成这个新令牌
                  <br />· 点「清除令牌」 = 立即清空（会再确认一次）
                </p>
              </div>
            </Field>

            <ToggleRow
              checked={autoRestart}
              onChange={onAutoRestartChange}
              label="更新完成后自动重启服务"
              description="打开后，更新流程结束后会自动拉起服务（需要由 pm2 / systemd / docker 等守护进程托管）；关闭的话你需要手动重启一次才会生效。"
            />

            {localError && (
              <AlertBox tone="error" title="填得有点不太对">
                <p>{localError}</p>
              </AlertBox>
            )}
            {error && (
              <AlertBox tone="error" title="读取/保存配置失败">
                <p className="break-words">{error}</p>
                {onRetry && (
                  <button type="button" className="btn btn-outline btn-sm mt-2" onClick={onRetry}>
                    ↻ 重试
                  </button>
                )}
              </AlertBox>
            )}
            {notice && !error && (
              <AlertBox tone="warning" title="还差一步">
                <p>{notice}</p>
              </AlertBox>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中…' : '💾 保存配置'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}

export default RepoConfigCard
