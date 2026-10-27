/**
 * features/auth/UserMenu —— 顶栏用户菜单
 * ---------------------------------------------------------------------------
 * 供 AppShell 接入（AppShell 由其他同事修改，此处只提供组件）：
 *   <UserMenu />            完整形态：头像 + 姓名 + 角色徽章
 *   <UserMenu compact />    紧凑形态：仅头像 + 角色徽章
 *
 * 下拉菜单：我的账号 / 修改密码 / [管理员] 重置他人密码 / 退出登录。
 * 点击外部或按 Esc 关闭下拉。
 *
 * 修改密码走**自助改密**端点 `POST /api/auth/password`（需旧密码），
 * 仅管理员额外可见「重置他人密码」（`POST /api/users/:id/password`）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertBox, Avatar, Badge, Field, Modal } from '@/components/ui'
import { ROLE_LABEL } from '@/lib/types'
import type { User } from '@/lib/types'
import api, { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/store/auth'
import { useToast } from '@/store/toast'
import { roleTone } from './roleMeta'
import { formatVersion, useAppVersion } from './useVersion'

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout, refresh, hasPermission, hasRole } = useAuth()
  const { push } = useToast()
  /** 版本号（装饰性信息，拿不到就静默不显示；与 user 是否加载完无关） */
  const appVersion = useAppVersion()
  const versionLabel = formatVersion(appVersion)

  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)

  const isAdmin = hasPermission('users:manage') || hasRole('admin')

  /* 点击外部关闭 */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  /* Esc 关闭 */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const doLogout = useCallback(async () => {
    setLoggingOut(true)
    try {
      await logout()
      push('已退出登录', 'success')
    } finally {
      setLoggingOut(false)
      setOpen(false)
    }
  }, [logout, push])

  if (!user) return null

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white py-1 pl-1 pr-2 transition hover:border-brand-300"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.name}（${ROLE_LABEL[user.role]}）`}
      >
        <Avatar name={user.name} color={user.avatarColor} size={28} />
        {!compact && (
          <div className="hidden leading-tight sm:block">
            <p className="text-xs font-bold text-ink-800">{user.name}</p>
            <p className="text-[10px] text-ink-400">{ROLE_LABEL[user.role]}</p>
          </div>
        )}
        <Badge tone={roleTone(user.role)} className="hidden md:inline-flex">
          {ROLE_LABEL[user.role]}
        </Badge>
        <span className="text-[10px] text-ink-400" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          className="animate-fade-up absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop"
          role="menu"
        >
          <div className="flex items-center gap-2.5 border-b border-ink-100 bg-ink-50/70 px-3 py-2.5">
            <Avatar name={user.name} color={user.avatarColor} size={34} />
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-ink-900">{user.name}</p>
              <p className="truncate text-[11px] text-ink-400">@{user.username}</p>
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-ink-700 transition hover:bg-ink-50"
            onClick={() => {
              setOpen(false)
              setProfileOpen(true)
            }}
          >
            👤 我的账号
          </button>

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-ink-700 transition hover:bg-ink-50"
            onClick={() => {
              setOpen(false)
              setPwdOpen(true)
            }}
          >
            🔑 修改密码
          </button>

          {isAdmin && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-ink-700 transition hover:bg-ink-50"
              onClick={() => {
                setOpen(false)
                setResetOpen(true)
              }}
            >
              🛠️ 重置他人密码
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            disabled={loggingOut}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
            onClick={() => void doLogout()}
          >
            {loggingOut ? '正在退出…' : '🚪 退出登录'}
          </button>

          {/* 版本号（低调的一行，取不到则不渲染） */}
          {versionLabel && (
            <p className="break-all border-t border-ink-100 px-3 py-2 text-[10px] text-ink-400">
              {versionLabel}
            </p>
          )}
        </div>
      )}

      {/* ---------------- 我的账号 ---------------- */}
      <Modal open={profileOpen} onClose={() => setProfileOpen(false)} title="我的账号" size="sm">
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-ink-50/80 p-3">
            <Avatar name={user.name} color={user.avatarColor} size={44} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-900">{user.name}</p>
              <p className="text-xs text-ink-500">@{user.username}</p>
            </div>
            <Badge tone={roleTone(user.role)} className="ml-auto">
              {ROLE_LABEL[user.role]}
            </Badge>
          </div>
          <dl className="space-y-2 text-xs">
            <Row label="用户名" value={user.username} />
            <Row label="角色" value={ROLE_LABEL[user.role]} />
            <Row label="状态" value={user.status === 'active' ? '启用' : '停用'} />
            <Row label="上次登录" value={formatTime(user.lastLoginAt)} />
            {user.mustChangePassword && (
              <div className="pt-1">
                <AlertBox tone="warning" title="首次登录需要修改密码">
                  为保障账号安全，请尽快在「修改密码」中更新初始密码。
                </AlertBox>
              </div>
            )}
          </dl>
        </div>
      </Modal>

      {/* ---------------- 修改密码（自助） ---------------- */}
      <ChangePasswordModal
        open={pwdOpen}
        user={user}
        onClose={() => setPwdOpen(false)}
        onSuccess={async () => {
          setPwdOpen(false)
          await refresh()
        }}
      />

      {/* ---------------- 重置他人密码（仅管理员） ---------------- */}
      {isAdmin && (
        <ResetOtherPasswordModal
          open={resetOpen}
          onClose={() => setResetOpen(false)}
        />
      )}
    </div>
  )
}

/* ================================================================== */
/* 自助改密                                                             */
/* ================================================================== */

function ChangePasswordModal({
  open,
  user,
  onClose,
  onSuccess,
}: {
  open: boolean
  user: User
  onClose: () => void
  onSuccess: () => Promise<void>
}) {
  const { push } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCurrent('')
      setNext('')
      setConfirm('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    /* ---- 前置校验，不满足就不发请求 ---- */
    if (!current) {
      setError('请输入当前密码')
      return
    }
    if (!next) {
      setError('请输入新密码')
      return
    }
    if (next.length < 6) {
      setError('新密码至少 6 位')
      return
    }
    if (next !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    if (next === current) {
      setError('新密码不能与旧密码相同')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await api.changePassword(current, next)
      push('密码已修改 ✅', 'success')
      await onSuccess()
    } catch (e) {
      setError(changePasswordError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="修改密码"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? '提交中…' : '确认修改'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <AlertBox tone="error">{error}</AlertBox>}

        <Field label="当前密码" required>
          <input
            className="input"
            type="password"
            value={current}
            autoComplete="current-password"
            placeholder="请输入当前密码"
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>

        <Field label="新密码" required hint="至少 6 位">
          <input
            className="input"
            type="password"
            value={next}
            autoComplete="new-password"
            placeholder="请输入新密码"
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>

        <Field label="确认新密码" required>
          <input
            className="input"
            type="password"
            value={confirm}
            autoComplete="new-password"
            placeholder="请再次输入新密码"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>

        <p className="text-[11px] leading-relaxed text-ink-400">
          修改后，该账号在其它设备上的登录会失效。
        </p>
        <p className="text-[11px] text-ink-400">
          当前账号：<b className="text-ink-600">@{user.username}</b>
        </p>
      </div>
    </Modal>
  )
}

/* ================================================================== */
/* 管理员：重置他人密码                                                  */
/* ================================================================== */

function ResetOtherPasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { push } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [targetId, setTargetId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTargetId('')
    setPassword('')
    setError(null)
    setLoading(true)
    setLoadError(null)
    api
      .listUsers()
      .then((list) => setUsers(list))
      .catch((e) => setLoadError(e instanceof Error ? e.message : '账号列表加载失败'))
      .finally(() => setLoading(false))
  }, [open])

  const submit = async () => {
    if (!targetId) {
      setError('请选择要重置的账号')
      return
    }
    if (password.trim().length < 6) {
      setError('新密码至少 6 位')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.resetUserPassword(targetId, password.trim())
      const target = users.find((u) => u.id === targetId)
      push(`已重置「${target?.name ?? '该账号'}」的密码 ✅`, 'success')
      setPassword('')
      onClose()
    } catch (e) {
      setError(resetPasswordError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="为其它账号重置密码"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? '提交中…' : '确认重置'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <AlertBox tone="error">{error}</AlertBox>}
        {loadError && <AlertBox tone="warning">账号列表加载失败：{loadError}</AlertBox>}

        <Field label="目标账号" required>
          <select
            className="select"
            value={targetId}
            disabled={loading}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">{loading ? '加载中…' : '请选择账号'}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（@{u.username}）· {ROLE_LABEL[u.role]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="新密码" required hint="至少 6 位，重置后请及时告知本人">
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="请输入新密码"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <p className="text-[11px] leading-relaxed text-ink-400">
          该操作仅系统管理员可用，重置后不会作废该用户的其它会话。
        </p>
      </div>
    </Modal>
  )
}

/* ================================================================== */
/* 辅助                                                                  */
/* ================================================================== */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2">
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-semibold text-ink-800">{value}</dd>
    </div>
  )
}

function formatTime(value?: string | null): string {
  if (!value) return '从未登录'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '从未登录'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 自助改密错误友好化 */
function changePasswordError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    switch (e.status) {
      case 401:
        return '当前密码不正确'
      case 400:
        return e.message || '新密码不合法'
      case 403:
        return '该账号已被停用，请联系管理员'
      case 429:
        return '尝试次数过多，请 15 分钟后再试'
      case 404:
        return '后端尚未提供自助改密接口，请联系管理员'
      case 502:
      case 503:
      case 504:
        return '后端未启动或接口不可用，请确认服务已运行后重试'
      default:
        return e.message || '修改失败，请稍后重试'
    }
  }
  if (e instanceof TypeError) return '后端未启动或接口不可用，请确认服务已运行后重试'
  if (e instanceof Error) return e.message || '修改失败，请稍后重试'
  return '修改失败，请稍后重试'
}

/** 管理员重置他人密码错误友好化 */
function resetPasswordError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 403) return '当前账号没有账号管理权限'
    if (e.status === 404) return '账号不存在或接口未开放'
    if (e.status === 502 || e.status === 503 || e.status === 504) {
      return '后端未启动或接口不可用，请确认服务已运行后重试'
    }
    return e.message || '重置失败'
  }
  if (e instanceof TypeError) return '后端未启动或接口不可用'
  if (e instanceof Error) return e.message || '重置失败'
  return '重置失败'
}

export default UserMenu
