import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useApp } from '@/store/app'
import { useAuth } from '@/store/auth'
import { Avatar } from '@/components/ui'
import { AssistantLauncher } from '@/features/assistant/AssistantPanel'
import { UserMenu } from '@/features/auth/UserMenu'
import type { Permission } from '@/lib/types'

interface NavItem {
  to: string
  label: string
  short: string
  icon: ReactNode
  /** 访问该页面所需的权限点；缺省表示所有已登录用户可见。传数组时按「任一满足」处理 */
  perm?: Permission | Permission[]
}

const NAV: NavItem[] = [
  { to: '/', label: '学情总览', short: '总览', icon: '📊', perm: 'stats:read' },
  { to: '/capture', label: '拍照录入', short: '拍照', icon: '📷', perm: 'questions:create' },
  { to: '/manual', label: '手动补录', short: '补录', icon: '✍️', perm: 'questions:create' },
  { to: '/questions', label: '错题本', short: '错题', icon: '📚', perm: 'questions:read' },
  { to: '/review', label: '今日复习', short: '复习', icon: '🎯', perm: 'review:run' },
  { to: '/insights', label: 'AI 诊断', short: '诊断', icon: '🤖', perm: 'report:read' },
  { to: '/students', label: '学生档案', short: '档案', icon: '👦', perm: 'students:read' },
  {
    to: '/system',
    label: '系统设置',
    short: '设置',
    icon: '⚙️',
    perm: ['settings:ai', 'users:manage', 'system:update'],
  },
]

/** 移动端底部导航候选（拍照入口固定在中间，按权限动态挑选 4 个） */
const MOBILE_CANDIDATES = [NAV[0], NAV[3], NAV[4], NAV[5], NAV[6]]

export function AppShell({ children }: { children: ReactNode }) {
  const { students, currentStudent, currentStudentId, setCurrentStudentId } = useApp()
  const { user, hasPermission } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  /** 按当前角色权限过滤导航；服务端仍会强制校验，前端过滤只是体验优化 */
  const visibleNav = NAV.filter((n) => !n.perm || hasPermission(n.perm))
  const mobileNav = MOBILE_CANDIDATES.filter(
    (n) => !n.perm || hasPermission(n.perm),
  ).slice(0, 4)

  /** 学生角色只能看到自己的记录，不提供切换器 */
  const canSwitchStudent = hasPermission('students:read') && user?.role !== 'student'

  return (
    <div className="min-h-full lg:flex">
      {/* ---------------- 桌面侧边栏 ---------------- */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-200/70 bg-white/80 px-3 py-5 backdrop-blur lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-black text-white shadow-lg shadow-brand-500/25">
            错
          </div>
          <div className="leading-tight">
            <p className="text-sm font-black tracking-tight text-ink-900">错题本</p>
            <p className="text-[11px] text-ink-400">学情智能分析系统</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
                    : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {canSwitchStudent && (
          <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
            <p className="text-[11px] font-bold text-ink-400">当前学生</p>
            <select
              className="select mt-1.5 !py-1.5 text-xs"
              value={currentStudentId}
              onChange={(e) => setCurrentStudentId(e.target.value)}
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.grade}
                </option>
              ))}
              {!students.length && <option value="">暂无学生</option>}
            </select>
          </div>
        )}
      </aside>

      {/* ---------------- 主区域 ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-base font-black text-white lg:hidden">
              错
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-black tracking-tight text-ink-900 sm:text-base">
                {visibleNav.find((n) =>
                  n.to === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(n.to),
                )?.label ?? '错题本'}
              </h1>
              <p className="hidden text-[11px] text-ink-400 sm:block">
                拍照录入 · AI 智能分析 · 多维学情统计
              </p>
            </div>

            <div className="flex items-center gap-2">
              <NavLink
                to="/review"
                className="btn btn-outline btn-sm hidden md:inline-flex"
              >
                🎯 今日复习
              </NavLink>
              {hasPermission('questions:create') && (
                <button
                  onClick={() => navigate('/capture')}
                  className="btn btn-primary btn-sm hidden sm:inline-flex"
                >
                  📷 拍照录入
                </button>
              )}
              {canSwitchStudent && (
                <NavLink
                  to="/students"
                  className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white py-1 pl-1 pr-2 transition hover:border-brand-300"
                  title="学生档案"
                >
                  <Avatar
                    name={currentStudent?.name ?? '—'}
                    color={currentStudent?.avatarColor ?? '#3b63f6'}
                    size={28}
                  />
                  <div className="hidden leading-tight sm:block">
                    <p className="text-xs font-bold text-ink-800">{currentStudent?.name ?? '未选择'}</p>
                    <p className="text-[10px] text-ink-400">{currentStudent?.grade ?? ''}</p>
                  </div>
                </NavLink>
              )}
              <UserMenu compact />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>

      {/* ---------------- 移动端底部导航 ---------------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 pb-[var(--safe-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2 pt-1.5">
          {mobileNav.slice(0, 2).map((item) => (
            <MobileNavLink key={item.to} item={item} />
          ))}
          <div className="flex justify-center">
            <button
              onClick={() => navigate('/capture')}
              className="-mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-2xl shadow-lg shadow-brand-600/35 ring-4 ring-white"
              aria-label="拍照录入"
            >
              📷
            </button>
          </div>
          {mobileNav.slice(2).map((item) => (
            <MobileNavLink key={item.to} item={item} />
          ))}
        </div>
      </nav>

      {/* AI 智能分析助手悬浮入口（PC / 手机通用） */}
      <AssistantLauncher />
    </div>
  )
}

function MobileNavLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex flex-col items-center gap-0.5 rounded-lg py-1 text-[10px] font-bold transition ${
          isActive ? 'text-brand-600' : 'text-ink-400'
        }`
      }
    >
      <span className="text-lg">{item.icon}</span>
      {item.short}
    </NavLink>
  )
}
