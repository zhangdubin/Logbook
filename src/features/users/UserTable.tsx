/**
 * features/users/UserTable —— 账号列表
 * ---------------------------------------------------------------------------
 * PC（md+）使用表格；手机端使用卡片列表。两种视图共用同一组操作回调。
 */

import { Avatar, Badge } from '@/components/ui'
import { ROLE_LABEL } from '@/lib/types'
import type { Role, User } from '@/lib/types'
import { roleTone } from '@/features/auth/roleMeta'

export interface UserTableProps {
  users: User[]
  /** 当前登录用户 id —— 用于禁用"删除自己" */
  currentUserId?: string
  /** 正在执行操作的账号 id */
  busyId?: string | null
  onEdit: (u: User) => void
  onToggleStatus: (u: User) => void
  onResetPassword: (u: User) => void
  onLinkStudents: (u: User) => void
  onDelete: (u: User) => void
}

export function UserTable(props: UserTableProps) {
  const { users, currentUserId, busyId } = props

  return (
    <>
      {/* ---------------- PC 表格 ---------------- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink-200 text-[11px] font-bold uppercase tracking-wide text-ink-400">
              <th className="px-3 py-2.5">姓名 / 用户名</th>
              <th className="px-3 py-2.5">角色</th>
              <th className="px-3 py-2.5">状态</th>
              <th className="px-3 py-2.5 text-center">关联学生</th>
              <th className="px-3 py-2.5">最后登录</th>
              <th className="px-3 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId
              const busy = busyId === u.id
              return (
                <tr
                  key={u.id}
                  className={`border-b border-ink-100 transition last:border-0 hover:bg-ink-50/60 ${
                    isSelf ? 'bg-brand-50/40' : ''
                  }`}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} color={u.avatarColor} size={34} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
                          <span className="truncate">{u.name}</span>
                          {isSelf && (
                            <span className="tag bg-brand-100 text-brand-700 ring-1 ring-brand-200">
                              当前
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-ink-400">@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={roleTone(u.role)}>{ROLE_LABEL[u.role]}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="text-sm font-bold text-ink-800">
                      {u.linkedStudentIds?.length ?? 0}
                    </span>
                    <span className="ml-1 text-[11px] text-ink-400">人</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-500">{formatTime(u.lastLoginAt)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={busy}
                        onClick={() => props.onEdit(u)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={busy}
                        onClick={() => props.onLinkStudents(u)}
                      >
                        关联学生
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={busy}
                        onClick={() => props.onResetPassword(u)}
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={busy}
                        onClick={() => props.onToggleStatus(u)}
                      >
                        {u.status === 'active' ? '停用' : '启用'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busy || isSelf}
                        title={isSelf ? '不能删除当前登录的账号' : '删除账号'}
                        onClick={() => props.onDelete(u)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ---------------- 手机卡片 ---------------- */}
      <div className="space-y-3 md:hidden">
        {users.map((u) => {
          const isSelf = u.id === currentUserId
          const busy = busyId === u.id
          return (
            <article key={u.id} className="card p-4">
              <div className="flex items-start gap-3">
                <Avatar name={u.name} color={u.avatarColor} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink-900">
                    <span className="truncate">{u.name}</span>
                    {isSelf && (
                      <span className="tag bg-brand-100 text-brand-700 ring-1 ring-brand-200">
                        当前
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-ink-400">@{u.username}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={roleTone(u.role)}>{ROLE_LABEL[u.role]}</Badge>
                  <StatusBadge status={u.status} />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-ink-500">
                <div className="rounded-lg bg-ink-50/80 px-2.5 py-1.5">
                  关联学生：<b className="text-ink-800">{u.linkedStudentIds?.length ?? 0}</b> 人
                </div>
                <div className="rounded-lg bg-ink-50/80 px-2.5 py-1.5">
                  最后登录：<b className="text-ink-800">{formatTime(u.lastLoginAt)}</b>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => props.onEdit(u)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => props.onLinkStudents(u)}
                >
                  关联学生
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => props.onResetPassword(u)}
                >
                  重置密码
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => props.onToggleStatus(u)}
                >
                  {u.status === 'active' ? '停用' : '启用'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy || isSelf}
                  title={isSelf ? '不能删除当前登录的账号' : '删除账号'}
                  onClick={() => props.onDelete(u)}
                >
                  删除
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}

export function StatusBadge({ status }: { status: User['status'] }) {
  return status === 'active' ? (
    <Badge tone="green">启用</Badge>
  ) : (
    <Badge tone="red">停用</Badge>
  )
}

export function formatTime(value?: string | null): string {
  if (!value) return '从未登录'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '从未登录'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 角色说明文案（表格提示用） */
export const ROLE_HINT: Record<Role, string> = {
  admin: '全部权限',
  teacher: '所授学生',
  parent: '自己孩子',
  student: '本人',
}
