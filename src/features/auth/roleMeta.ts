/**
 * features/auth/roleMeta —— 角色展示元数据
 * ---------------------------------------------------------------------------
 * 角色徽章配色：admin=紫 / teacher=蓝 / parent=绿 / student=橙
 */

import type { Role } from '@/lib/types'

export type BadgeTone = 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'cyan' | 'pink'

export const ROLE_TONE: Record<Role, BadgeTone> = {
  admin: 'violet',
  teacher: 'blue',
  parent: 'green',
  student: 'amber',
}

/** 角色代表色（头像 / 图例用） */
export const ROLE_COLOR: Record<Role, string> = {
  admin: '#8b5cf6',
  teacher: '#3b63f6',
  parent: '#10b981',
  student: '#f59e0b',
}

export function roleTone(role: Role): BadgeTone {
  return ROLE_TONE[role] ?? 'slate'
}
