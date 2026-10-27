/** 学情总览页共享的枚举与常量 */

/** 时间范围 */
export type RangeKey = '7d' | '30d' | '90d' | 'all'

export const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: '90d', label: '近 90 天' },
  { key: 'all', label: '全部' },
]

/** 各范围对应的天数（null = 不限制） */
export const RANGE_DAYS: Record<RangeKey, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
}

/** 传给后端 /api/stats/overview 的 range 取值 */
export const RANGE_API_VALUE: Record<RangeKey, string> = {
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  all: 'all',
}
