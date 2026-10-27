/**
 * features/users/UserLinksModal —— 关联学生
 * ---------------------------------------------------------------------------
 * 家长 → 可关联多个孩子；教师 → 可关联多个学生；学生 → 仅关联自己（单选）。
 * 勾选后由父组件批量调用 `api.linkStudent`。
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertBox, Avatar, EmptyState, Modal, Skeleton } from '@/components/ui'
import { ROLE_LABEL } from '@/lib/types'
import type { Student, User } from '@/lib/types'

export interface UserLinksModalProps {
  open: boolean
  user: User | null
  students: Student[]
  loading: boolean
  saving: boolean
  error: string | null
  onClose: () => void
  /** 提交选中的学生 id 列表 */
  onSubmit: (studentIds: string[]) => void
}

export function UserLinksModal({
  open,
  user,
  students,
  loading,
  saving,
  error,
  onClose,
  onSubmit,
}: UserLinksModalProps) {
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setSelected(user?.linkedStudentIds ? [...user.linkedStudentIds] : [])
  }, [open, user])

  const single = user?.role === 'student'
  const hint = useMemo(() => {
    if (!user) return ''
    if (user.role === 'parent') return '家长可以关联多个孩子的档案，登录后只看得到这些孩子的数据。'
    if (user.role === 'teacher') return '教师可以关联多个学生，登录后管理这些学生的错题与统计。'
    if (user.role === 'student') return '学生账号只能关联一个学生档案（通常就是本人）。'
    return '管理员通常无需关联学生，但也可以指定数据查看范围。'
  }, [user])

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (single) return prev.includes(id) ? [] : [id]
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    })
  }

  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? id

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`关联学生 · ${user?.name ?? ''}`}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || loading}
            onClick={() => onSubmit(selected)}
          >
            {saving ? '保存中…' : `保存关联（${selected.length}）`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <AlertBox tone="error">{error}</AlertBox>}

        {user && (
          <AlertBox tone="info" title={`${ROLE_LABEL[user.role]} · 关联范围`}>
            {hint}
          </AlertBox>
        )}

        {user && user.linkedStudentIds && user.linkedStudentIds.length > 0 && (
          <p className="text-[11px] text-ink-500">
            当前已关联：
            {user.linkedStudentIds.map((id) => nameOf(id)).join('、')}
          </p>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <EmptyState
            icon="👦"
            title="暂无学生档案"
            description="请先在「学生档案」中创建学生，再回来建立账号与学生的关联。"
          />
        ) : (
          <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
            {students.map((s) => {
              const checked = selected.includes(s.id)
              return (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                    checked
                      ? 'border-brand-300 bg-brand-50/70'
                      : 'border-ink-200 bg-white hover:border-brand-200'
                  }`}
                >
                  <input
                    type={single ? 'radio' : 'checkbox'}
                    name={single ? `link-${user?.id ?? ''}` : undefined}
                    checked={checked}
                    onChange={() => toggle(s.id)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <Avatar name={s.name} color={s.avatarColor} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink-900">{s.name}</p>
                    <p className="truncate text-[11px] text-ink-500">
                      年级：{s.grade}
                      {s.school ? ` · 班级：${s.school}` : ''}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>
        )}

        {!loading && students.length > 0 && !single && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(students.map((s) => s.id))}
            >
              全选
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>
              清空
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
