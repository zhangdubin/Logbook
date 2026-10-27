/**
 * pages/System —— 系统设置（AI 模型 / 账号管理 / 系统更新 三合一）
 * ---------------------------------------------------------------------------
 * 标签用 URL query 区分：?tab=ai（默认）/ ?tab=users / ?tab=update，
 * 刷新页面仍停在同一个标签。
 *
 * 关键实现：**三个面板始终保持挂载**，未选中的用 CSS `hidden` 隐藏，
 * 而不是条件渲染卸载 —— 否则用户在「AI 模型」标签里刚输入的 API Key、
 * 还没保存的改动，会在切标签时整个丢掉。
 */

import { useSearchParams } from 'react-router-dom'
import Settings from '@/pages/Settings'
import Users from '@/pages/Users'
import { SystemTabs, TAB_PERMISSION } from '@/features/system/SystemTabs'
import type { SystemTab } from '@/features/system/SystemTabs'
import { UpdateTab } from '@/features/system/UpdateTab'
import { useAuth } from '@/store/auth'

const VALID_TABS: SystemTab[] = ['ai', 'users', 'update']

export default function System() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasPermission } = useAuth()

  // 没有权限的标签直接不渲染，避免点进去必然 403
  const visibleTabs = VALID_TABS.filter((t) => hasPermission(TAB_PERMISSION[t]))

  const raw = searchParams.get('tab') ?? 'ai'
  const requested: SystemTab = (VALID_TABS as string[]).includes(raw) ? (raw as SystemTab) : 'ai'
  // URL 指向的标签若无权访问，退回到第一个有权限的标签
  const tab: SystemTab = visibleTabs.includes(requested) ? requested : visibleTabs[0] ?? 'ai'

  const switchTab = (next: SystemTab) => {
    if (next === tab) return
    setSearchParams({ tab: next })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="space-y-4 pb-6">
      <SystemTabs value={tab} onChange={switchTab} visibleTabs={visibleTabs} />

      {/* 三个面板都保持挂载，仅用 CSS 隐藏未选中的那个 */}
      <div
        className={tab === 'ai' ? 'block' : 'hidden'}
        aria-hidden={tab !== 'ai'}
      >
        <Settings />
      </div>

      <div
        className={tab === 'users' ? 'block' : 'hidden'}
        aria-hidden={tab !== 'users'}
      >
        <Users />
      </div>

      <div
        className={tab === 'update' ? 'block' : 'hidden'}
        aria-hidden={tab !== 'update'}
      >
        <UpdateTab />
      </div>
    </div>
  )
}
