/**
 * features/auth/PermissionGate —— 权限点级别的内容门控
 * ---------------------------------------------------------------------------
 * 有权限 → 渲染 children；无权限 → 渲染 fallback（默认给一张说明卡）。
 * 权限判定来自 `useAuth().hasPermission`，支持单个权限点或权限点数组（任一满足）。
 */

import type { ReactNode } from 'react'
import { AlertBox } from '@/components/ui'
import { useAuth } from '@/store/auth'
import { ROLE_LABEL } from '@/lib/types'
import type { Permission } from '@/lib/types'

export function PermissionGate({
  perm,
  fallback,
  children,
}: {
  perm: Permission | Permission[]
  fallback?: ReactNode
  children: ReactNode
}) {
  const { user, hasPermission } = useAuth()

  if (hasPermission(perm)) return <>{children}</>

  if (fallback !== undefined) return <>{fallback}</>

  const roleName = user ? ROLE_LABEL[user.role] : '当前用户'
  return (
    <div className="card p-5">
      <AlertBox tone="warning" title="当前角色无权查看此内容">
        <p>
          {roleName}没有访问该模块的权限。如需开通，请联系系统管理员在「账号管理」中调整角色权限。
        </p>
      </AlertBox>
    </div>
  )
}

export default PermissionGate
