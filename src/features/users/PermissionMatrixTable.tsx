/**
 * features/users/PermissionMatrixTable —— 权限矩阵预览
 * ---------------------------------------------------------------------------
 * 用后端 `api.permissionMatrix()` 的返回值渲染「权限点 × 角色」对照表，
 * admin 列高亮，体现分级权限的透明性。
 */

import { useState } from 'react'
import { AlertBox, Badge, EmptyState, Skeleton } from '@/components/ui'
import { ROLES, ROLE_LABEL } from '@/lib/types'
import type { Permission, PermissionMatrix, Role } from '@/lib/types'
import { roleTone } from '@/features/auth/roleMeta'

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
    users: '账号管理',
  }
  return map[ns] ?? '其它'
}

export interface PermissionMatrixTableProps {
  matrix: PermissionMatrix | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

export function PermissionMatrixTable({ matrix, loading, error, onRetry }: PermissionMatrixTableProps) {
  const [open, setOpen] = useState(false)

  const perms = Object.keys(matrix ?? {}).sort((a, b) => {
    const ga = groupOf(a)
    const gb = groupOf(b)
    if (ga !== gb) return ga.localeCompare(gb, 'zh-CN')
    return a.localeCompare(b)
  })

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-ink-50/60 sm:px-5"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-800">权限矩阵预览</p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            权限点 × 角色 的完整对照，数据来自后端 `GET /api/auth/permissions`
          </p>
        </div>
        <span className="shrink-0 text-xs font-bold text-brand-700">{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {open && (
        <div className="border-t border-ink-100 p-4 sm:p-5">
          {error && (
            <AlertBox tone="error" title="权限矩阵加载失败">
              <p>{error}</p>
              <button type="button" className="btn btn-outline btn-sm mt-2" onClick={onRetry}>
                重试
              </button>
            </AlertBox>
          )}

          {loading && !matrix && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}

          {!loading && !error && (!matrix || perms.length === 0) && (
            <EmptyState
              icon="🔐"
              title="暂无权限矩阵数据"
              description="后端尚未返回权限矩阵，或当前账号无权查看。"
            />
          )}

          {matrix && perms.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-ink-200 text-[11px] font-bold text-ink-400">
                    <th className="px-3 py-2">权限点</th>
                    {ROLES.map((r) => (
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
                  {perms.map((p) => (
                    <tr key={p} className="border-b border-ink-100 last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-semibold text-ink-800">{PERM_LABEL[p] ?? p}</p>
                        <p className="text-[10px] text-ink-400">
                          {groupOf(p)} · <code className="font-mono">{p}</code>
                        </p>
                      </td>
                      {ROLES.map((r) => (
                        <td
                          key={r}
                          className={`px-3 py-2 text-center ${r === 'admin' ? 'bg-violet-50/50' : ''}`}
                        >
                          {allowed(matrix, p, r) ? (
                            <span
                              className={`font-black ${r === 'admin' ? 'text-violet-600' : 'text-emerald-600'}`}
                              aria-label="允许"
                            >
                              ✓
                            </span>
                          ) : (
                            <span className="text-ink-200" aria-label="不允许">
                              —
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-ink-400">
                提示：权限点由后端 <code className="font-mono">server/auth.js</code> 的 PERMISSIONS 定义，
                前端只负责展示，角色调整后请刷新页面。
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function allowed(matrix: PermissionMatrix, perm: string, role: Role): boolean {
  const roles = matrix[perm]
  if (!roles) return false
  return roles.includes(role)
}

export type { Permission }
