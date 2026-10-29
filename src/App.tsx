import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppProvider } from '@/store/app'
import { ToastProvider } from '@/store/toast'
import { AuthProvider } from '@/store/auth'
import { ProtectedRoute, PermissionGate } from '@/features/auth'
import ReviewSession from '@/features/review/ReviewSession'
import Dashboard from '@/pages/Dashboard'
import Capture from '@/pages/Capture'
import Manual from '@/pages/Manual'
import WrongItems from '@/pages/WrongItems'
import ItemDetail from '@/pages/ItemDetail'
import Insights from '@/pages/Insights'
import Students from '@/pages/Students'
import System from '@/pages/System'
import Login from '@/pages/Login'

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <AuthProvider>
          {/* 渲染崩溃兜底：没有它，一次 render 异常就是整页白屏，
              用户只看到「自己跳到空白页」，完全对不上技术原因。 */}
          <ErrorBoundary title="页面渲染时出了点问题">
            <Routes>
              {/* 公开路由：登录窗口 */}
              <Route path="/login" element={<Login />} />

              {/* 受保护路由：统一套壳 + 权限门控 */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppShell>
                      <Outlet />
                    </AppShell>
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<Dashboard />} />
                <Route path="/capture" element={<Capture />} />
                <Route path="/manual" element={<Manual />} />
                <Route path="/questions" element={<WrongItems />} />
                <Route path="/questions/:id" element={<ItemDetail />} />
                <Route path="/review" element={<ReviewSession />} />
                <Route
                  path="/insights"
                  element={
                    <PermissionGate perm="report:read">
                      <Insights />
                    </PermissionGate>
                  }
                />
                <Route path="/students" element={<Students />} />

                {/* 系统设置：AI 模型 / 账号管理 / 系统更新 三合一 */}
                <Route
                  path="/system"
                  element={
                    <PermissionGate perm={['settings:ai', 'users:manage', 'system:update']}>
                      <System />
                    </PermissionGate>
                  }
                />

                {/* 旧路由兼容：重定向到新的系统设置标签页 */}
                <Route path="/settings" element={<Navigate to="/system?tab=ai" replace />} />
                <Route path="/users" element={<Navigate to="/system?tab=users" replace />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </AuthProvider>
      </ToastProvider>
    </AppProvider>
  )
}