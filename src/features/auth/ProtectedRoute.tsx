/**
 * features/auth/ProtectedRoute —— 受保护路由
 * ---------------------------------------------------------------------------
 * - `loading`（启动时校验登录态中）→ 全屏品牌色 Spinner
 * - 未登录 → 跳转 `/login`，并带上 `state.from` 便于登录后回跳
 * - 已登录 → 渲染 children
 */

import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spinner } from '@/components/ui'
import { useAuth } from '@/store/auth'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="grid min-h-[60vh] w-full place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={32} />
          <p className="text-xs font-semibold text-ink-400">正在校验登录态…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}

export default ProtectedRoute
