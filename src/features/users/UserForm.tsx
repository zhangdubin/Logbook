/**
 * features/users/UserForm —— 新建 / 编辑账号
 * ---------------------------------------------------------------------------
 * 编辑时密码留空 = 不修改密码。
 */

import { useEffect, useState } from 'react'
import { AlertBox, Avatar, Field, Modal, ToggleRow } from '@/components/ui'
import { ROLES, ROLE_DESC, ROLE_LABEL } from '@/lib/types'
import type { Role, User, UserInput } from '@/lib/types'
import { ROLE_COLOR } from '@/features/auth/roleMeta'

const AVATAR_COLORS = [
  '#3b63f6',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#ef4444',
  '#64748b',
]

interface FormState {
  username: string
  name: string
  role: Role
  password: string
  status: 'active' | 'disabled'
  phone: string
  note: string
  avatarColor: string
}

const EMPTY: FormState = {
  username: '',
  name: '',
  role: 'teacher',
  password: '',
  status: 'active',
  phone: '',
  note: '',
  avatarColor: AVATAR_COLORS[0],
}

export interface UserFormProps {
  open: boolean
  /** null 表示新建 */
  user: User | null
  saving: boolean
  error: string | null
  onClose: () => void
  onSubmit: (input: UserInput) => void
}

export function UserForm({ open, user, saving, error, onClose, onSubmit }: UserFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    if (user) {
      setForm({
        username: user.username,
        name: user.name,
        role: user.role,
        password: '',
        status: user.status,
        phone: user.phone ?? '',
        note: user.note ?? '',
        avatarColor: user.avatarColor || ROLE_COLOR[user.role],
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, user])

  const submit = () => {
    const username = form.username.trim()
    const name = form.name.trim()
    if (!username) {
      setLocalError('请填写用户名')
      return
    }
    if (!name) {
      setLocalError('请填写姓名')
      return
    }
    if (!user && form.password.trim().length < 6) {
      setLocalError('初始密码至少 6 位')
      return
    }
    if (user && form.password.trim() && form.password.trim().length < 6) {
      setLocalError('新密码至少 6 位')
      return
    }

    const input: UserInput = {
      username,
      name,
      role: form.role,
      status: form.status,
      phone: form.phone.trim(),
      note: form.note.trim(),
      avatarColor: form.avatarColor,
    }
    if (form.password.trim()) input.password = form.password.trim()
    onSubmit(input)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? `编辑账号「${user.name}」` : '新建账号'}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {(error || localError) && <AlertBox tone="error">{error || localError}</AlertBox>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="用户名" required hint={user ? '如需修改请先在后台删除重建' : '登录时使用，建议小写字母'}>
            <input
              className="input"
              value={form.username}
              placeholder="例如 teacher"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>

          <Field label="姓名" required>
            <input
              className="input"
              value={form.name}
              placeholder="真实姓名 / 昵称"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
        </div>

        <Field
          label="角色"
          required
          hint={`${ROLE_LABEL[form.role]}：${ROLE_DESC[form.role]}`}
        >
          <select
            className="select"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]} — {ROLE_DESC[r]}
              </option>
            ))}
          </select>
        </Field>

        <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
          <p className="text-[11px] font-bold text-brand-700">
            {ROLE_LABEL[form.role]}的权限范围
          </p>
          <p className="mt-1 text-xs leading-relaxed text-brand-900/80">{ROLE_DESC[form.role]}</p>
        </div>

        <Field
          label={user ? '重置密码' : '初始密码'}
          required={!user}
          hint={user ? '留空表示不修改密码' : '至少 6 位，用户首次登录后建议自行修改'}
        >
          <input
            className="input"
            type="password"
            value={form.password}
            placeholder={user ? '留空 = 不修改' : '请输入初始密码'}
            autoComplete="new-password"
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="手机号" hint="选填">
            <input
              className="input"
              value={form.phone}
              inputMode="tel"
              placeholder="选填"
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>

          <Field label="账号状态">
            <ToggleRow
              checked={form.status === 'active'}
              onChange={(v) => setForm({ ...form, status: v ? 'active' : 'disabled' })}
              label={form.status === 'active' ? '启用中' : '已停用'}
              description="停用后该账号无法登录"
            />
          </Field>
        </div>

        <Field label="备注" hint="选填，例如任教班级、负责科目">
          <textarea
            className="textarea"
            rows={2}
            value={form.note}
            placeholder="例如：数学老师，负责三(1)班"
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </Field>

        <Field label="头像颜色">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar name={form.name || '新账号'} color={form.avatarColor} size={40} />
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, avatarColor: c })}
                  className={`h-8 w-8 rounded-full transition ${
                    form.avatarColor === c ? 'ring-2 ring-ink-900 ring-offset-2' : 'hover:scale-105'
                  }`}
                  style={{ background: c }}
                  aria-label={`选择颜色 ${c}`}
                />
              ))}
            </div>
          </div>
        </Field>
      </div>
    </Modal>
  )
}
