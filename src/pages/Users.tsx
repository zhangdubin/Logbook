/**
 * pages/Users —— 账号管理（仅系统管理员）
 * ---------------------------------------------------------------------------
 * 「分级权限管理」的落地界面：
 *   - 账号列表（PC 表格 / 手机卡片）
 *   - 新建 / 编辑 / 停用启用 / 重置密码 / 删除
 *   - 关联学生（家长→多孩子、教师→多学生、学生→本人）
 *   - 底部权限矩阵配置（权限点 × 角色，可直接勾选保存，立即生效）
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertBox, Card, EmptyState, Modal, Skeleton, StatTile } from '@/components/ui'
import api, { ApiRequestError } from '@/lib/api'
import { ROLES, ROLE_LABEL } from '@/lib/types'
import type { Student, User, UserInput } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useToast } from '@/store/toast'
import { ROLE_COLOR } from '@/features/auth/roleMeta'
import { UserTable } from '@/features/users/UserTable'
import { UserForm } from '@/features/users/UserForm'
import { UserLinksModal } from '@/features/users/UserLinksModal'
import { ResetPasswordModal } from '@/features/users/ResetPasswordModal'
import { PermissionMatrixTable } from '@/features/users/PermissionMatrixTable'

export default function Users() {
  const { user: currentUser, hasPermission, hasRole } = useAuth()
  const { push } = useToast()

  const [users, setUsers] = useState<User[]>([])
  const [students, setStudents] = useState<Student[]>([])

  const [usersLoading, setUsersLoading] = useState(true)
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  /* 新建 / 编辑 */
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /* 关联学生 */
  const [linksOpen, setLinksOpen] = useState(false)
  const [linksUser, setLinksUser] = useState<User | null>(null)
  const [linksSaving, setLinksSaving] = useState(false)
  const [linksError, setLinksError] = useState<string | null>(null)

  /* 重置密码 */
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwdUser, setPwdUser] = useState<User | null>(null)
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdError, setPwdError] = useState<string | null>(null)

  /* 删除确认 */
  const [removing, setRemoving] = useState<User | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  const allowed = hasPermission('users:manage') || hasRole('admin')

  /* ------------------------------ 数据加载 ------------------------------ */

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      const list = await api.listUsers()
      setUsers(list)
    } catch (e) {
      setUsersError(errorText(e, '账号列表加载失败'))
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true)
    try {
      const list = await api.listStudents()
      setStudents(list)
    } catch {
      setStudents([])
    } finally {
      setStudentsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    void loadUsers()
    void loadStudents()
  }, [allowed, loadUsers, loadStudents])

  /* ------------------------------ 统计 ------------------------------ */

  const stats = useMemo(() => {
    const base = { total: users.length, admin: 0, teacher: 0, parent: 0, student: 0 }
    users.forEach((u) => {
      if (u.role === 'admin') base.admin += 1
      else if (u.role === 'teacher') base.teacher += 1
      else if (u.role === 'parent') base.parent += 1
      else if (u.role === 'student') base.student += 1
    })
    return base
  }, [users])

  const disabledCount = useMemo(() => users.filter((u) => u.status !== 'active').length, [users])

  /* ------------------------------ 操作 ------------------------------ */

  const openCreate = () => {
    setEditing(null)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (u: User) => {
    setEditing(u)
    setFormError(null)
    setFormOpen(true)
  }

  const saveUser = async (input: UserInput) => {
    setFormSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await api.updateUser(editing.id, input)
        push(`已更新账号「${input.name}」 ✅`, 'success')
      } else {
        await api.createUser(input)
        push(`已创建账号「${input.name}」 ✅`, 'success')
      }
      setFormOpen(false)
      setEditing(null)
      await loadUsers()
    } catch (e) {
      setFormError(errorText(e, '保存失败'))
    } finally {
      setFormSaving(false)
    }
  }

  const toggleStatus = async (u: User) => {
    setBusyId(u.id)
    try {
      const next = u.status === 'active' ? 'disabled' : 'active'
      await api.updateUser(u.id, { status: next })
      push(next === 'active' ? `已启用「${u.name}」` : `已停用「${u.name}」`, 'success')
      await loadUsers()
    } catch (e) {
      push(errorText(e, '操作失败'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const resetPassword = async (password: string) => {
    if (!pwdUser) return
    setPwdSaving(true)
    setPwdError(null)
    try {
      await api.resetUserPassword(pwdUser.id, password)
      push(`已重置「${pwdUser.name}」的密码 ✅`, 'success')
      setPwdOpen(false)
      setPwdUser(null)
      await loadUsers()
    } catch (e) {
      setPwdError(errorText(e, '重置密码失败'))
    } finally {
      setPwdSaving(false)
    }
  }

  const removeUser = async () => {
    if (!removing) return
    if (removing.id === currentUser?.id) {
      setRemoving(null)
      push('不能删除当前登录的账号', 'error')
      return
    }
    setRemoveBusy(true)
    try {
      await api.deleteUser(removing.id)
      push(`已删除账号「${removing.name}」`, 'success')
      setRemoving(null)
      await loadUsers()
    } catch (e) {
      push(errorText(e, '删除失败'), 'error')
    } finally {
      setRemoveBusy(false)
    }
  }

  const saveLinks = async (studentIds: string[]) => {
    if (!linksUser) return
    setLinksSaving(true)
    setLinksError(null)
    try {
      const before = new Set(linksUser.linkedStudentIds ?? [])
      const after = new Set(studentIds)
      const tasks: Promise<unknown>[] = []
      after.forEach((sid) => {
        if (!before.has(sid)) tasks.push(api.linkStudent(linksUser.id, sid, true))
      })
      before.forEach((sid) => {
        if (!after.has(sid)) tasks.push(api.linkStudent(linksUser.id, sid, false))
      })
      await Promise.all(tasks)
      push(`已更新「${linksUser.name}」的关联学生 ✅`, 'success')
      setLinksOpen(false)
      setLinksUser(null)
      await loadUsers()
    } catch (e) {
      setLinksError(errorText(e, '保存关联失败'))
    } finally {
      setLinksSaving(false)
    }
  }

  /* ------------------------------ 渲染 ------------------------------ */

  if (!allowed) {
    return (
      <div className="space-y-4 pb-6">
        <div className="card p-5">
          <AlertBox tone="warning" title="当前角色无权查看此内容">
            <p>
              「账号管理」仅对系统管理员开放。当前角色为
              {currentUser ? ROLE_LABEL[currentUser.role] : '未登录用户'}，
              如需开通请联系系统管理员。
            </p>
          </AlertBox>
        </div>
        {/* 权限矩阵对所有登录用户透明可见，但没有 users:manage 只能只读 */}
        <PermissionMatrixTable />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      {/* ---------------- 统计条 ---------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="总账号数"
          value={stats.total}
          unit="个"
          hint={disabledCount ? `${disabledCount} 个已停用` : '全部启用'}
          accent="#3b63f6"
          icon="👥"
        />
        {ROLES.map((r) => (
          <StatTile
            key={r}
            label={ROLE_LABEL[r]}
            value={stats[r]}
            unit="人"
            accent={ROLE_COLOR[r]}
            icon={r === 'admin' ? '🛡️' : r === 'teacher' ? '👩‍🏫' : r === 'parent' ? '👨‍👩‍👧' : '🎒'}
          />
        ))}
      </div>

      {/* ---------------- 账号列表 ---------------- */}
      <Card
        title="账号列表"
        subtitle="按角色分配权限范围：管理员管全部，教师管所授学生，家长管自己孩子，学生只看本人"
        extra={
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            ＋ 新建账号
          </button>
        }
      >
        {usersError && (
          <div className="mb-3">
            <AlertBox tone="error" title="加载失败">
              <p>{usersError}</p>
              <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => void loadUsers()}>
                重试
              </button>
            </AlertBox>
          </div>
        )}

        {usersLoading && !users.length ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            icon="👥"
            title="还没有账号"
            description="新建教师 / 家长 / 学生账号，并关联对应的学生档案，角色即可看到自己的数据。"
            action={
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                ＋ 新建账号
              </button>
            }
          />
        ) : (
          <UserTable
            users={users}
            currentUserId={currentUser?.id}
            busyId={busyId}
            onEdit={openEdit}
            onToggleStatus={(u) => void toggleStatus(u)}
            onResetPassword={(u) => {
              setPwdUser(u)
              setPwdError(null)
              setPwdOpen(true)
            }}
            onLinkStudents={(u) => {
              setLinksUser(u)
              setLinksError(null)
              setLinksOpen(true)
            }}
            onDelete={(u) => setRemoving(u)}
          />
        )}
      </Card>

      {/* ---------------- 权限矩阵 ---------------- */}
      <PermissionMatrixTable />

      {/* ---------------- 弹窗 ---------------- */}
      <UserForm
        open={formOpen}
        user={editing}
        saving={formSaving}
        error={formError}
        onClose={() => setFormOpen(false)}
        onSubmit={(input) => void saveUser(input)}
      />

      <UserLinksModal
        open={linksOpen}
        user={linksUser}
        students={students}
        loading={studentsLoading}
        saving={linksSaving}
        error={linksError}
        onClose={() => setLinksOpen(false)}
        onSubmit={(ids) => void saveLinks(ids)}
      />

      <ResetPasswordModal
        open={pwdOpen}
        user={pwdUser}
        saving={pwdSaving}
        error={pwdError}
        onClose={() => setPwdOpen(false)}
        onSubmit={(pwd) => void resetPassword(pwd)}
      />

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="确认删除账号？"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setRemoving(null)}>
              再想想
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void removeUser()}
              disabled={removeBusy}
            >
              {removeBusy ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          将删除账号「{removing?.name}（@{removing?.username}）」。
          该账号的关联关系也会一并解除，且无法恢复。
        </p>
        {removing?.id === currentUser?.id && (
          <div className="mt-3">
            <AlertBox tone="warning">不能删除当前登录的账号。</AlertBox>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* --------------------------- 错误信息友好化 --------------------------- */

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 403) return '当前账号没有账号管理权限'
    if (e.status === 404) return '后端接口尚未就绪（账号管理服务未启动）'
    if (e.status === 502 || e.status === 503 || e.status === 504) {
      return '后端未启动或接口不可用，请确认服务已运行后重试'
    }
    return e.message || fallback
  }
  if (e instanceof TypeError) return '后端未启动或接口不可用'
  if (e instanceof Error) return e.message || fallback
  return fallback
}
