/**
 * features/system/UpdateTab —— 「系统更新」标签页
 * ---------------------------------------------------------------------------
 * 持有这一页的全部状态：
 *   - 仓库配置（读 /api/system/config，写 /api/system/config）
 *   - 更新信息（GET /api/system/update/info）
 *   - 更新任务（POST apply / rollback + 每 1.5s 轮询 GET status）
 *
 * 轮询说明：用 setInterval 轮询，组件卸载时 clearInterval，避免泄漏；
 * 状态变成 done / failed 就立刻停。服务重启期间请求会失败，此时静默重试，
 * 等服务起来后继续拿到最终状态。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import api, { ApiRequestError } from '@/lib/api'
import type { SystemConfigInput, UpdateInfo, UpdateStatus } from '@/lib/types'
import { AlertBox, Modal } from '@/components/ui'
import { useAuth } from '@/store/auth'
import { useToast } from '@/store/toast'
import { PublishPanel } from './PublishPanel'
import { RepoConfigCard } from './RepoConfigCard'
import { UpdateConfirmModal } from './UpdateConfirmModal'
import { UpdatePanel } from './UpdatePanel'

/** 轮询间隔（毫秒） */
export const POLL_INTERVAL_MS = 1500
/** 最多轮询次数（约 10 分钟），避免服务一直没起来时无限轮询 */
const MAX_POLLS = 400
/**
 * 后端约定的「显式清除令牌」标记。
 * 注意：token 传空串会被后端当成「不修改」（和 AI 密钥的语义不同），
 * 要清除必须传这个字符串。
 */
const CLEAR_TOKEN = '__CLEAR__'

/** 把后端错误翻译成人话 */
function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 401) return '登录状态已失效，请重新登录后再试'
    if (e.status === 403) return '当前账号没有「系统更新」权限'
    if (e.status === 404) return '后端接口尚未就绪（系统更新服务未启动）'
    if (e.status >= 500) return '后端服务异常，请稍后再试'
    return e.message || fallback
  }
  if (e instanceof TypeError) return '后端未启动或接口不可用'
  if (e instanceof Error) return e.message || fallback
  return fallback
}

export function UpdateTab() {
  const { push } = useToast()
  const { hasPermission } = useAuth()
  const canUpdate = hasPermission('system:update')

  /* --------------------------- 仓库配置 --------------------------- */
  const [repo, setRepo] = useState('')
  const [autoRestart, setAutoRestart] = useState(false)
  /** 访问 GitHub 的代理，空串 = 直连 */
  const [proxy, setProxy] = useState('')
  /** 令牌输入框内容（空 = 不修改已保存的令牌） */
  const [token, setToken] = useState('')
  /** 令牌动作：none=不动 / set=覆盖（清除走独立的 __CLEAR__ 通道） */
  const [tokenAction, setTokenAction] = useState<'none' | 'set'>('none')
  const [hasToken, setHasToken] = useState(false)
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [clearingToken, setClearingToken] = useState(false)
  const [clearTokenOpen, setClearTokenOpen] = useState(false)

  /* --------------------------- 更新信息 --------------------------- */
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [configNotice, setConfigNotice] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(false)

  /* --------------------------- 更新任务 --------------------------- */
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)

  const configCardRef = useRef<HTMLDivElement | null>(null)

  /* ---------------------------- 读取配置 ---------------------------- */
  const loadConfig = useCallback(async () => {
    setConfigLoading(true)
    setConfigError(null)
    try {
      const cfg = await api.getSystemConfig()
      if (!cfg || typeof cfg !== 'object') throw new Error('配置接口返回了非预期的内容')
      setRepo(cfg.repo ?? '')
      setAutoRestart(Boolean(cfg.autoRestart))
      setProxy(cfg.proxy ?? '')
      setHasToken(Boolean(cfg.hasToken))
      /* 令牌永不明文回显：输入框清空，重置为「不修改」 */
      setToken('')
      setTokenAction('none')
    } catch (e) {
      setConfigError(errorText(e, '读取系统配置失败'))
    } finally {
      setConfigLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  /* ---------------------------- 令牌输入 ---------------------------- */
  const onTokenChange = useCallback((value: string) => {
    setToken(value)
    /* 用户一旦动过输入框，就按「覆盖」处理 */
    setTokenAction(value.trim() ? 'set' : 'none')
  }, [])

  /* ---------------------------- 保存配置 ---------------------------- */
  const saveConfig = useCallback(async () => {
    setConfigSaving(true)
    setConfigError(null)
    try {
      const input: SystemConfigInput = { repo: repo.trim(), autoRestart, proxy: proxy.trim() }
      /* 只有用户真的动过令牌，才把 token 放进请求体（留空 = 不修改） */
      if (tokenAction === 'set' && token.trim()) input.token = token.trim()

      const saved = await api.saveSystemConfig(input)
      if (saved && typeof saved === 'object') {
        setRepo(saved.repo ?? repo.trim())
        setAutoRestart(Boolean(saved.autoRestart))
        setProxy(saved.proxy ?? proxy.trim())
        setHasToken(Boolean(saved.hasToken))
      }
      /* 令牌永不明文回显：保存后输入框清空 */
      setToken('')
      setTokenAction('none')
      setConfigNotice(null)
      push('仓库配置已保存 ✅', 'success')
    } catch (e) {
      const msg = errorText(e, '保存失败')
      setConfigError(msg)
      push(msg, 'error')
    } finally {
      setConfigSaving(false)
    }
  }, [repo, autoRestart, proxy, token, tokenAction, push])

  /* ---------------------------- 清除令牌 ---------------------------- */
  const clearToken = useCallback(async () => {
    setClearingToken(true)
    try {
      /* 后端约定：token 传 '__CLEAR__' = 显式清除（空串会被当成「不修改」） */
      const saved = await api.saveSystemConfig({
        repo: repo.trim(),
        autoRestart,
        proxy: proxy.trim(),
        token: CLEAR_TOKEN,
      })
      if (saved && typeof saved === 'object') {
        setHasToken(Boolean(saved.hasToken))
      } else {
        setHasToken(false)
      }
      setToken('')
      setTokenAction('none')
      setClearTokenOpen(false)
      push('GitHub 令牌已清除', 'success')
    } catch (e) {
      const msg = errorText(e, '清除令牌失败')
      setConfigError(msg)
      push(msg, 'error')
    } finally {
      setClearingToken(false)
    }
  }, [repo, autoRestart, proxy, push])

  /* ------------------------ 把提示打在配置卡片上 ------------------------ */
  const focusConfig = useCallback((message: string) => {
    setConfigNotice(message)
    setHighlight(true)
    window.setTimeout(() => setHighlight(false), 3000)
    configCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  /* ---------------------------- 检查更新 ---------------------------- */
  const checkUpdate = useCallback(async () => {
    /* 仓库没配就别发无意义的请求 */
    if (!repo.trim()) {
      focusConfig('请先在上方配置 GitHub 仓库，然后再检查更新。')
      return
    }
    setInfoLoading(true)
    setInfoError(null)
    setConfigNotice(null)
    try {
      const res = await api.getUpdateInfo()
      if (!res || typeof res !== 'object') throw new Error('更新接口返回了非预期的内容')
      setInfo(res)
      if (!res.configured) {
        focusConfig(res.message || '后端还没有配置 GitHub 仓库，请先在上方保存仓库地址。')
      } else if (res.hasUpdate) {
        push(`发现新版本 ${res.latestVersion || res.latestTag}`, 'info')
      } else {
        push('当前已经是最新版本', 'success')
      }
    } catch (e) {
      setInfoError(errorText(e, '检查更新失败'))
    } finally {
      setInfoLoading(false)
    }
  }, [repo, focusConfig, push])

  /* ---------------------------- 轮询任务状态 ---------------------------- */
  useEffect(() => {
    if (!polling) return
    let alive = true
    let attempts = 0

    const timer = window.setInterval(() => {
      attempts += 1
      if (attempts > MAX_POLLS) {
        setPolling(false)
        return
      }
      void api
        .getUpdateStatus()
        .then((s) => {
          if (!alive || !s) return
          setStatus(s)
          if (s.state === 'done' || s.state === 'failed') {
            setPolling(false)
            if (s.state === 'done') {
              push(
                s.requiresRestart ? '更新完成，请重启服务后生效' : '更新完成 ✅',
                'success',
              )
            } else {
              push('更新失败，请查看下方日志', 'error')
            }
          }
        })
        .catch(() => {
          /* 服务重启期间请求会失败，静默重试即可 */
        })
    }, POLL_INTERVAL_MS)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [polling, push])

  /* ---------------------------- 执行更新 ---------------------------- */
  const runUpdate = useCallback(async () => {
    setApplying(true)
    try {
      const s = await api.runUpdate()
      setStatus(s ?? null)
      setStatusError(null)
      setConfirmOpen(false)
      setPolling(true)
      push('更新任务已启动，正在下载新版本…', 'info')
    } catch (e) {
      const msg = errorText(e, '启动更新失败')
      setStatusError(msg)
      push(msg, 'error')
    } finally {
      setApplying(false)
    }
  }, [push])

  /* ---------------------------- 回滚上一版本 ---------------------------- */
  const rollback = useCallback(async () => {
    setRollingBack(true)
    try {
      const s = await api.rollbackUpdate()
      setStatus(s ?? null)
      setStatusError(null)
      setPolling(true)
      push('回滚任务已启动…', 'info')
    } catch (e) {
      const msg = errorText(e, '回滚失败')
      setStatusError(msg)
      push(msg, 'error')
    } finally {
      setRollingBack(false)
    }
  }, [push])

  const configured = Boolean(repo.trim())
  const busy =
    polling ||
    applying ||
    rollingBack ||
    status?.state === 'downloading' ||
    status?.state === 'applying' ||
    status?.state === 'restarting'

  if (!canUpdate) {
    return (
      <div className="card p-5">
        <AlertBox tone="warning" title="当前角色没有系统更新权限">
          <p>「一键更新」会替换服务器上的程序文件，只有系统管理员可以操作。</p>
        </AlertBox>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div ref={configCardRef}>
        <RepoConfigCard
          repo={repo}
          onRepoChange={setRepo}
          proxy={proxy}
          onProxyChange={setProxy}
          token={token}
          onTokenChange={onTokenChange}
          hasToken={hasToken}
          onClearToken={() => setClearTokenOpen(true)}
          clearingToken={clearingToken}
          autoRestart={autoRestart}
          onAutoRestartChange={setAutoRestart}
          loading={configLoading}
          saving={configSaving}
          error={configError}
          notice={configNotice}
          highlighted={highlight}
          onSave={() => void saveConfig()}
          onRetry={() => void loadConfig()}
        />
      </div>

      <UpdatePanel
        info={info}
        infoLoading={infoLoading}
        infoError={infoError}
        configured={configured}
        configNotice={configNotice}
        status={status}
        statusError={statusError}
        busy={busy}
        onCheck={() => void checkUpdate()}
        onApply={() => setConfirmOpen(true)}
        onRollback={() => void rollback()}
      />

      {/* 发布新版本：把本机源码打包成 GitHub Release */}
      <PublishPanel
        currentVersion={info?.currentVersion ?? ''}
        repo={repo.trim()}
        hasToken={hasToken}
      />

      <UpdateConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void runUpdate()}
        busy={applying}
        version={info?.latestVersion || info?.latestTag || undefined}
        repo={repo.trim() || undefined}
        autoRestart={autoRestart}
      />

      {/* 清除 GitHub 令牌：二次确认 */}
      <Modal
        open={clearTokenOpen}
        onClose={() => setClearTokenOpen(false)}
        title="确认清除 GitHub 令牌？"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setClearTokenOpen(false)}>
              再想想
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void clearToken()}
              disabled={clearingToken}
            >
              {clearingToken ? '清除中…' : '确认清除'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-600">
            清除后，已保存的 GitHub 令牌会立刻从服务器数据库里删掉，页面上的输入框也会清空。
          </p>
          <AlertBox tone="warning">
            <span className="text-[11px]">
              清除后「发布新版本」和访问私有仓库都会失败，直到你重新填一个令牌。
            </span>
          </AlertBox>
        </div>
      </Modal>
    </div>
  )
}

export default UpdateTab
