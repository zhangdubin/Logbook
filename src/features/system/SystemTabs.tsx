/**
 * features/system/SystemTabs —— 系统设置页的标签切换条
 * ---------------------------------------------------------------------------
 * 三个标签：AI 模型 / 账号管理 / 系统更新。
 * 切换时只改 URL 的 query（?tab=xxx），刷新后仍停在同一个标签。
 *
 * 每个标签绑定一个权限点，**没有权限的标签不渲染** —— 否则将来把权限拆开
 * （比如让教师也能看模型配置）时，用户会点进一个必然 403 的标签。
 */

import { Tabs } from '@/components/ui'
import type { Permission } from '@/lib/types'

export type SystemTab = 'ai' | 'users' | 'update'

export const SYSTEM_TABS: SystemTab[] = ['ai', 'users', 'update']

/** 标签 → 所需权限点 */
export const TAB_PERMISSION: Record<SystemTab, Permission> = {
  ai: 'settings:ai',
  users: 'users:manage',
  update: 'system:update',
}

/** 标签的展示信息 */
export const TAB_META: Record<SystemTab, { label: string; title: string }> = {
  ai: { label: '🤖 AI 模型', title: '模型供应商 · 密钥 · 本地 OCR' },
  users: { label: '👥 账号管理', title: '账号 · 角色 · 学生关联' },
  update: { label: '⬆️ 系统更新', title: 'GitHub 仓库 · 一键更新 · 回滚' },
}

export function SystemTabs({
  value,
  onChange,
  visibleTabs,
}: {
  value: SystemTab
  onChange: (tab: SystemTab) => void
  /** 允许展示的标签；缺省表示全部展示 */
  visibleTabs?: SystemTab[]
}) {
  const shown = visibleTabs?.length ? visibleTabs : SYSTEM_TABS
  return (
    <Tabs
      value={value}
      onChange={onChange}
      tabs={shown.map((key) => ({ key, label: TAB_META[key].label }))}
    />
  )
}

export default SystemTabs
