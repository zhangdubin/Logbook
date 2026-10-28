/**
 * features/users/PermissionMatrixTable —— 权限矩阵配置
 * ---------------------------------------------------------------------------
 * 管理员在「账号管理」里直接勾选 / 取消某个角色的权限点，保存后**立即生效**
 * （后端存的是相对默认值的差集，因此后端以后新增权限点时，
 *   没有被显式关掉的权限会自动跟随默认值）。
 *
 * 三条硬约束（防自锁设计，后端也会再挡一次，前端先挡住）：
 *   1. `admin`（系统管理员）固定拥有全部权限、**不可配置** —— 那一列只读；
 *      否则管理员可能把自己锁在系统外面（没了 users:manage 就只能改数据库）；
 *   2. 只有 `users:manage` 的人能改，其它人只看到只读表格；
 *   3. 权限点不能新增 —— 表格的行以后端 `defaults` 的 key 为准，前端不发明权限点。
 *
 * 接口：
 *   GET  /api/auth/permissions        → { matrix, defaults, customized, editableRoles, roles }
 *   PUT  /api/auth/permissions        body { matrix: { 角色: [权限点] } } → { ok, matrix, customized }
 *   PUT  /api/auth/permissions/reset  → { ok, matrix, customized }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertBox, Badge, EmptyState, Modal, Skeleton } from '@/components/ui'
import api, { ApiRequestError } from '@/lib/api'
import { ROLES, ROLE_LABEL } from '@/lib/types'
import type { PermissionMatrix, PermissionMatrixConfig, Role } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useToast } from '@/store/toast'

/** 权限点的人类可读名 */
const PERM_LABEL: Record<string, string> = {
  'students:read': '查看学生档案',
  'students:create': '新增学生档案',
  'students:update': '编辑学生档案',
  'students:delete': '删除学生档案',
  'questions:read': '查看错题',
  'questions:create': '录入错题',
  'questions:update': '编辑错题',
  'questions:delete': '删除错题',
  'stats:read': '查看统计分析',
  'report:read': '查看学情报告',
  'export:run': '导出报表',
  'review:run': '今日复习',
  'settings:ai': 'AI 模型设置',
  'settings:ocr': 'OCR 设置',
  'system:update': '系统更新与版本管理',
  'users:manage': '账号与权限管理',
}

/** 权限点分组标题 */
function groupOf(perm: string): string {
  const [ns] = perm.split(':')
  const map: Record<string, string> = {
    students: '学生档案',
    questions: '错题管理',
    stats: '统计分析',
    report: '学情报告',
    export: '数据导出',
    review: '复习训练',
    settings: '系统设置',
    system: '系统维护',
    users: '账号管理',
  }
  return map[ns] ?? '其它'
}

/** 分组展示顺序（不在表里的排最后） */
const GROUP_ORDER = [
  '学生档案',
  '错题管理',
  '统计分析',
  '学情报告',
  '数据导出',
  '复习训练',
  '系统设置',
  '系统维护',
  '账号管理',
]

function groupRank(g: string): number {
  const i = GROUP_ORDER.indexOf(g)
  return i === -1 ? GROUP_ORDER.length : i
}

/** 角色 → 权限点全列表 */
type RolePerms = Record<string, string[]>

/** 把「权限点 → 角色」反转成「角色 → 权限点」 */
function invert(matrix: PermissionMatrix, roles: Role[]): RolePerms {
  const out: RolePerms = {}
  roles.forEach((r) => {
    out[r] = []
  })
  Object.entries(matrix ?? {}).forEach(([perm, allowed]) => {
    const list = Array.isArray(allowed) ? allowed : []
    list.forEach((r) => {
      if (!out[r]) out[r] = []
      out[r].push(perm)
    })
  })
  return out
}

export function PermissionMatrixTable() {
  const { hasPermission, refresh } = useAuth()
  const { push } = useToast()

  /**
   * 后端拒绝（403）后降级为只读 —— 前端显示的权限可能已经过期，
   * 这时不能继续让用户勾选（否则点了保存只会报错）。
   */
  const [denied, setDenied] = useState(false)

  /** 只有 users:manage 的人能改 */
  const canEdit = hasPermission('users:manage') && !denied

  const [config, setConfig] = useState<PermissionMatrixConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** 未保存的草稿：角色 → 权限点。null = 没有未保存的改动 */
  const [draft, setDraft] = useState<RolePerms | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    },
    [],
  )

  /* ------------------------------ 加载 ------------------------------ */

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await api.permissionMatrix()
      setConfig(cfg)
      setDraft(null)
    } catch (e) {
      setError(matrixErrorText(e, '权限矩阵加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /* ------------------------------ 派生数据 ------------------------------ */

  const roles: Role[] = useMemo(() => {
    const list = config?.roles?.length ? config.roles : ROLES
    // admin 永远排第一
    return [...list].sort((a, b) => (a === 'admin' ? -1 : b === 'admin' ? 1 : 0))
  }, [config])

  const editableRoles: Role[] = useMemo(() => {
    const list = config?.editableRoles?.length ? config.editableRoles : ROLES.filter((r) => r !== 'admin')
    return list.filter((r) => r !== 'admin')
  }, [config])

  /** 行 = 后端 defaults 的 key（以后端为准，前端不发明权限点） */
  const perms = useMemo(() => {
    const source = config?.defaults ?? config?.matrix ?? {}
    return Object.keys(source).sort((a, b) => {
      const ga = groupOf(a)
      const gb = groupOf(b)
      if (ga !== gb) return groupRank(ga) - groupRank(gb)
      return a.localeCompare(b)
    })
  }, [config])

  /** 分组后的行 */
  const groups = useMemo(() => {
    const map = new Map<string, string[]>()
    perms.forEach((p) => {
      const g = groupOf(p)
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(p)
    })
    return [...map.entries()].sort((a, b) => groupRank(a[0]) - groupRank(b[0]))
  }, [perms])

  /** 已保存的矩阵（角色 → 权限点） */
  const savedPerms = useMemo(
    () => (config ? invert(config.matrix, roles) : null),
    [config, roles],
  )

  /** 当前生效（草稿优先） */
  const effective = draft ?? savedPerms

  /** 未保存的改动数量（按「格子」计：一个角色的一个权限点算一处） */
  const changedCells = useMemo(() => {
    if (!draft || !savedPerms) return 0
    let n = 0
    Object.keys(draft).forEach((role) => {
      const a = new Set(draft[role] ?? [])
      const b = new Set(savedPerms[role] ?? [])
      new Set([...a, ...b]).forEach((p) => {
        if (a.has(p) !== b.has(p)) n += 1
      })
    })
    return n
  }, [draft, savedPerms])

  /** 该格子相对**默认值**是否有差异 */
  const differsFromDefault = useCallback(
    (perm: string, role: Role) => {
      if (!config) return false
      // 用**当前生效**的状态（草稿优先）去比默认值。
      // 如果拿「已保存的」来比，用户刚勾/刚取消时表格里已经是新状态了、
      // 标记却还没变，两者对不上；草稿优先能保证看到的和标出来的一致。
      const cur = effective
        ? (effective[role] ?? []).includes(perm)
        : (config.matrix?.[perm]?.includes(role) ?? false)
      const def = config.defaults?.[perm]?.includes(role) ?? false
      return cur !== def
    },
    [config, effective],
  )

  /* ------------------------------ 操作 ------------------------------ */

  const toggle = useCallback(
    (perm: string, role: Role) => {
      if (!canEdit) return
      if (role === 'admin') return // 固定全权限，不给改
      const base = effective ?? {}
      const current = new Set(base[role] ?? [])
      if (current.has(perm)) current.delete(perm)
      else current.add(perm)
      const next: RolePerms = { ...base, [role]: [...current] }
      setDraft(next)
      setActionError(null)
    },
    [canEdit, effective],
  )

  const save = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    setActionError(null)
    try {
      // 只提交可配置角色；admin 由后端固定为全权限，**不要传**
      const payload: Record<string, string[]> = {}
      editableRoles.forEach((r) => {
        payload[r] = draft[r] ?? []
      })
      const res = await api.updatePermissionMatrix(payload)
      setConfig((prev) => (prev ? { ...prev, matrix: res.matrix, customized: res.customized } : prev))
      setDraft(null)
      setJustSaved(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setJustSaved(false), 2600)
      push('权限矩阵已保存，立即生效 ✅', 'success')
      // 当前账号的权限也可能变了（被授予/回收 users:manage），刷新会话
      await refresh()
    } catch (e) {
      const msg = matrixErrorText(e, '保存失败')
      setActionError(msg)
      push(msg, 'error')
      // 后端说这个账号没权限 → 降级成只读，别再让用户勾选
      if (e instanceof ApiRequestError && e.status === 403) setDenied(true)
      // 失败时**保留草稿**，用户可以改完再试
    } finally {
      setSaving(false)
    }
  }, [draft, editableRoles, push, refresh])

  const discard = useCallback(() => {
    setDraft(null)
    setActionError(null)
  }, [])

  const resetDefaults = useCallback(async () => {
    setResetting(true)
    setActionError(null)
    try {
      const res = await api.resetPermissionMatrix()
      setConfig((prev) => (prev ? { ...prev, matrix: res.matrix, customized: res.customized } : prev))
      setDraft(null)
      setResetOpen(false)
      push('已恢复为系统默认权限配置 ✅', 'success')
      await refresh()
    } catch (e) {
      const msg = matrixErrorText(e, '恢复默认失败')
      setActionError(msg)
      push(msg, 'error')
      if (e instanceof ApiRequestError && e.status === 403) setDenied(true)
    } finally {
      setResetting(false)
    }
  }, [push, refresh])

  /* ------------------------------ 渲染 ------------------------------ */

  return (
    <section className="card overflow-hidden" data-testid="perm-matrix">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-ink-50/60 sm:px-5"
        aria-expanded={open}
        data-testid="perm-matrix-toggle"
      >
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-800">权限矩阵配置</p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            勾选后立即生效，无需重启服务
            {canEdit ? ' · 系统管理员固定拥有全部权限，不可修改' : ' · 只读'}
          </p>
        </div>
        <span className="shrink-0 text-xs font-bold text-brand-700">{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {open && (
        <div className="border-t border-ink-100 p-4 sm:p-5">
          {error && (
            <AlertBox tone="error" title="权限矩阵加载失败">
              <p className="break-words">{error}</p>
              <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => void load()}>
                重试
              </button>
            </AlertBox>
          )}

          {loading && !config && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}

          {!loading && !error && !config && (
            <EmptyState
              icon="🔐"
              title="暂无权限矩阵数据"
              description="后端尚未返回权限矩阵，或当前账号无权查看。"
            />
          )}

          {config && perms.length > 0 && (
            <div className="space-y-3">
              {/* ---------------- 工具区 ---------------- */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {config.customized ? (
                    <Badge tone="amber">已自定义</Badge>
                  ) : (
                    <Badge tone="slate">默认配置</Badge>
                  )}
                  {justSaved && (
                    <span className="text-[11px] font-bold text-emerald-600">✅ 已保存并生效</span>
                  )}
                  {!config.customized && (
                    <span className="text-[11px] text-ink-400">当前是默认配置</span>
                  )}
                </div>

                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setResetOpen(true)}
                    disabled={!config.customized || saving || resetting}
                    data-testid="perm-reset"
                    title={
                      config.customized ? '把权限配置恢复成系统内置默认值' : '当前是默认配置，没有需要恢复的改动'
                    }
                  >
                    ↺ 恢复默认
                  </button>
                )}
              </div>

              {/* ---------------- 未保存提示 ---------------- */}
              {changedCells > 0 && (
                <AlertBox tone="warning" title={`有 ${changedCells} 处未保存的修改`}>
                  <p>改动还没有生效，点「保存」后立刻对所有角色生效。</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void save()}
                      disabled={saving}
                      data-testid="perm-save"
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={discard}
                      disabled={saving}
                      data-testid="perm-undo"
                    >
                      撤销修改
                    </button>
                  </div>
                </AlertBox>
              )}

              {actionError && (
                <AlertBox tone="error" title="操作失败">
                  <p className="break-words">{actionError}</p>
                </AlertBox>
              )}

              {/* ---------------- 表格 ---------------- */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-ink-200 text-[11px] font-bold text-ink-400">
                      <th className="px-3 py-2">权限点</th>
                      {roles.map((r) => (
                        <th
                          key={r}
                          className={`px-3 py-2 text-center ${r === 'admin' ? 'text-violet-600' : ''}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {ROLE_LABEL[r]}
                            {r === 'admin' && <Badge tone="violet">全部</Badge>}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([group, items]) => (
                      <GroupRows
                        key={group}
                        group={group}
                        perms={items}
                        roles={roles}
                        canEdit={canEdit}
                        effective={effective}
                        differsFromDefault={differsFromDefault}
                        onToggle={toggle}
                        colSpan={roles.length + 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] leading-relaxed text-ink-400">
                提示：权限点由后端白名单定义，前端不能新增；未显式调整的权限会跟随系统默认
                （后端以后新增权限点时会自动带上）。带
                <span className="mx-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
                的格子表示与默认值不同。
              </p>
            </div>
          )}
        </div>
      )}

      {/* ---------------- 恢复默认二次确认 ---------------- */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="确认恢复默认权限配置？"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setResetOpen(false)}
              disabled={resetting}
            >
              再想想
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void resetDefaults()}
              disabled={resetting}
            >
              {resetting ? '恢复中…' : '确认恢复'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          将把教师 / 家长 / 学生三个角色的权限点恢复成系统内置的默认值，当前所有自定义改动都会丢失。
          系统管理员始终拥有全部权限，不受影响。
        </p>
      </Modal>
    </section>
  )
}

/* ------------------------------ 分组行 ------------------------------ */

function GroupRows({
  group,
  perms,
  roles,
  canEdit,
  effective,
  differsFromDefault,
  onToggle,
  colSpan,
}: {
  group: string
  perms: string[]
  roles: Role[]
  canEdit: boolean
  effective: RolePerms | null
  differsFromDefault: (perm: string, role: Role) => boolean
  onToggle: (perm: string, role: Role) => void
  colSpan: number
}) {
  return (
    <>
      <tr className="border-b border-ink-100 bg-ink-50/60">
        <td colSpan={colSpan} className="px-3 py-1.5 text-[11px] font-bold text-ink-500">
          {group}
        </td>
      </tr>
      {perms.map((p) => (
        <tr key={p} className="border-b border-ink-100 last:border-0">
          <td className="px-3 py-2">
            <p className="font-semibold text-ink-800">{PERM_LABEL[p] ?? p}</p>
            <p className="text-[10px] text-ink-400">
              <code className="font-mono">{p}</code>
            </p>
          </td>
          {roles.map((r) => {
            const checked = effective?.[r]?.includes(p) ?? false
            const diff = differsFromDefault(p, r)
            const locked = r === 'admin'
            return (
              <td
                key={r}
                className={[
                  'px-3 py-2 text-center',
                  locked ? 'bg-violet-50/50' : '',
                  !locked && diff ? 'bg-amber-50/70' : '',
                  !locked && canEdit ? 'transition hover:bg-brand-50/70' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {locked ? (
                  /* 系统管理员固定全权限：只读 */
                  <input
                    type="checkbox"
                    checked
                    disabled
                    readOnly
                    aria-label={`${ROLE_LABEL[r]} 固定拥有全部权限`}
                    className="h-4 w-4 cursor-not-allowed accent-violet-600 opacity-70"
                  />
                ) : canEdit ? (
                  <span className="relative inline-flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(p, r)}
                      aria-label={`${ROLE_LABEL[r]} · ${PERM_LABEL[p] ?? p}`}
                      className="h-4 w-4 accent-brand-600"
                    />
                    {diff && (
                      <span
                        className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
                        aria-hidden
                        title="与默认值不同"
                      />
                    )}
                  </span>
                ) : checked ? (
                  <span className="font-black text-emerald-600" aria-label="允许">
                    ✓
                  </span>
                ) : (
                  <span className="text-ink-200" aria-label="不允许">
                    —
                  </span>
                )}
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

/* --------------------------- 错误信息友好化 --------------------------- */

function matrixErrorText(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 403) return '当前账号没有账号与权限管理权限（users:manage）'
    if (e.status === 404) return '后端接口尚未就绪（权限矩阵服务未启动）'
    if (e.status === 502 || e.status === 503 || e.status === 504) {
      return '后端未启动或接口不可用，请确认服务已运行后重试'
    }
    return e.message || fallback
  }
  if (e instanceof TypeError) return '后端未启动或接口不可用'
  if (e instanceof Error) return e.message || fallback
  return fallback
}

export default PermissionMatrixTable
