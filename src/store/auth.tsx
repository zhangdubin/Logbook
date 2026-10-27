/**
 * store/auth —— 登录态与权限上下文（AuthProvider）
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 启动时调用 `api.me()` 校验 Cookie 中的会话；
 *   2. 监听 `UNAUTHORIZED_EVENT`（任意接口返回 401 时由 lib/api 广播），
 *      立即清空本地登录态；
 *   3. 对外暴露 `hasPermission` / `hasRole` 两个判定函数，供
 *      `PermissionGate` / `ProtectedRoute` / AppShell 导航使用。
 *
 * 设计约定：
 *   - `loading === true` 期间表示"尚未确认登录态"，受保护内容不应渲染；
 *   - `login()` 失败时**抛出**错误（由调用方展示），不在此吞掉；
 *   - `logout()` 无论后端成功与否都清空本地状态。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import api, { UNAUTHORIZED_EVENT } from '@/lib/api'
import type { Permission, Role, User } from '@/lib/types'

export interface AuthContextValue {
  user: User | null
  permissions: Permission[]
  /** 启动时校验登录态中 */
  loading: boolean
  login: (username: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  /** 传数组时按"任一满足"处理 */
  hasPermission: (p: Permission | Permission[]) => boolean
  /** 传数组时按"任一满足"处理 */
  hasRole: (r: Role | Role[]) => boolean
}

const Ctx = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)

  /** 登录请求进行中（避免登录期间的 401 把会话清掉） */
  const loginPendingRef = useRef(false)
  /** 401 处理的重入保护（避免 logout 自身 401 导致事件递归） */
  const unauthorizedRef = useRef(false)

  /** 统一的会话写入：登录成功 / api.me() 成功都走这里 */
  const applySession = useCallback((nextUser: User, nextPermissions: Permission[]) => {
    setUser(nextUser)
    setPermissions(nextPermissions)
  }, [])

  /** 清空本地会话（不调用后端） */
  const clearSession = useCallback(() => {
    setUser(null)
    setPermissions([])
  }, [])

  /** 拉取当前登录态；未登录时静默清空（不抛错） */
  const refresh = useCallback(async () => {
    try {
      const res = await api.me()
      applySession(res.user, res.permissions ?? [])
    } catch {
      // 未登录 / 后端未就绪 —— 静默清空，由 ProtectedRoute 决定跳转
      clearSession()
    } finally {
      setLoading(false)
    }
  }, [applySession, clearSession])

  /* 启动时校验一次登录态 */
  useEffect(() => {
    void refresh()
  }, [refresh])

  /* 任意接口 401 → 立即清空登录态
   * 说明：
   *   - 后端 `POST /api/auth/logout` 是幂等的（无会话也返回 204），这里顺带调一次，
   *     把服务端可能残留的 session 一并作废；失败不影响本地状态；
   *   - `unauthorizedRef` 做重入保护，避免 logout 自身返回 401 时造成事件递归；
   *   - `loginPendingRef` 保护登录流程：登录请求进行中收到的 401 属于"登录失败"，
   *     不应把刚刚建立（或正在建立）的会话清掉。 */
  useEffect(() => {
    const onUnauthorized = () => {
      if (loginPendingRef.current) return
      clearSession()
      setLoading(false)
      if (unauthorizedRef.current) return
      unauthorizedRef.current = true
      void api
        .logout()
        .catch(() => undefined)
        .finally(() => {
          unauthorizedRef.current = false
        })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [clearSession])

  const login = useCallback(
    async (username: string, password: string) => {
      loginPendingRef.current = true
      try {
        const res = await api.login({ username, password })
        applySession(res.user, res.permissions ?? [])
        return res.user
      } finally {
        loginPendingRef.current = false
      }
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // 后端不可用也要让用户能退出本地状态
    } finally {
      clearSession()
    }
  }, [clearSession])

  const hasPermission = useCallback(
    (p: Permission | Permission[]) => {
      if (!user) return false
      const list = Array.isArray(p) ? p : [p]
      if (!list.length) return true
      return list.some((item) => permissions.includes(item))
    },
    [user, permissions],
  )

  const hasRole = useCallback(
    (r: Role | Role[]) => {
      if (!user) return false
      const list = Array.isArray(r) ? r : [r]
      if (!list.length) return true
      return list.includes(user.role)
    },
    [user],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      loading,
      login,
      logout,
      refresh,
      hasPermission,
      hasRole,
    }),
    [user, permissions, loading, login, logout, refresh, hasPermission, hasRole],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export default AuthProvider
