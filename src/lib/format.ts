import type { Subject } from './types'

export const GRADES = [
  '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '初一', '初二', '初三', '高一', '高二', '高三',
]

export const SUBJECT_COLOR: Record<string, string> = {
  语文: '#ef4444',
  数学: '#3b82f6',
  英语: '#10b981',
  物理: '#8b5cf6',
  化学: '#f59e0b',
  生物: '#14b8a6',
  地理: '#0ea5e9',
  历史: '#a16207',
  政治: '#db2777',
  道法: '#db2777',
}

export const SUBJECT_BG: Record<string, string> = {
  语文: 'bg-red-50 text-red-700 ring-red-200',
  数学: 'bg-blue-50 text-blue-700 ring-blue-200',
  英语: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  物理: 'bg-violet-50 text-violet-700 ring-violet-200',
  化学: 'bg-amber-50 text-amber-700 ring-amber-200',
  生物: 'bg-teal-50 text-teal-700 ring-teal-200',
  地理: 'bg-sky-50 text-sky-700 ring-sky-200',
  历史: 'bg-yellow-50 text-yellow-800 ring-yellow-200',
  政治: 'bg-pink-50 text-pink-700 ring-pink-200',
  道法: 'bg-pink-50 text-pink-700 ring-pink-200',
}

export function subjectColor(subject: string): string {
  return SUBJECT_COLOR[subject] ?? '#64748b'
}

/** 2026-10-26 -> 10月26日 */
export function formatDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 2026-10-26 -> 2026-10-26 */
export function formatISODate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${formatISODate(value)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 相对时间：刚刚 / 3小时前 / 2天前 */
export function fromNow(value?: string | null): string {
  if (!value) return '—'
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day}天前`
  return formatDate(value)
}

/** 相对天数（艾宾浩斯式复习建议） */
export function nextReviewDate(mastery: number): Date {
  const days = mastery >= 80 ? 7 : mastery >= 50 ? 3 : 1
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function pct(n: number, digits = 0): string {
  return `${(clamp(n, 0, 100)).toFixed(digits)}%`
}

export function shortText(text?: string | null, len = 40): string {
  if (!text) return ''
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > len ? `${t.slice(0, len)}…` : t
}

export function initials(name: string): string {
  if (!name) return '?'
  return name.trim().slice(0, 2)
}

export const SUBJECT_LIST: Subject[] = [
  '语文', '数学', '英语', '物理', '化学', '生物', '地理', '历史', '政治', '道法',
]

/** 难度中文标签 */
export const DIFFICULTY_LABEL: Record<number, string> = {
  1: '很简单',
  2: '简单',
  3: '中等',
  4: '较难',
  5: '很难',
}
