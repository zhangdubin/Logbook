/**
 * features/users/ResetPasswordModal —— 重置密码
 */

import { useEffect, useState } from 'react'
import { AlertBox, Field, Modal } from '@/components/ui'
import type { User } from '@/lib/types'

export interface ResetPasswordModalProps {
  open: boolean
  user: User | null
  saving: boolean
  error: string | null
  onClose: () => void
  onSubmit: (password: string) => void
}

export function ResetPasswordModal({
  open,
  user,
  saving,
  error,
  onClose,
  onSubmit,
}: ResetPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPassword('')
      setLocalError(null)
    }
  }, [open])

  const submit = () => {
    const p = password.trim()
    if (p.length < 6) {
      setLocalError('新密码至少 6 位')
      return
    }
    onSubmit(p)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`重置密码 · ${user?.name ?? ''}`}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? '提交中…' : '确认重置'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {(error || localError) && <AlertBox tone="error">{error || localError}</AlertBox>}
        <p className="text-xs leading-relaxed text-ink-500">
          正在为账号 <b className="text-ink-800">@{user?.username}</b> 设置新密码，
          重置后请及时告知本人。
        </p>
        <Field label="新密码" required hint="至少 6 位">
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="请输入新密码"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
