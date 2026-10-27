import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import type { StatsOverview } from '@/lib/types'
import { useApp } from '@/store/app'
import { MOCK_STUDENT, USE_MOCK, mockOverview } from '@/pages/__mock__/stats'
import { RANGE_API_VALUE } from '@/pages/dashboard/types'
import type { RangeKey } from '@/pages/dashboard/types'

export interface OverviewState {
  data: StatsOverview | null
  loading: boolean
  /** 真实接口的错误信息 */
  error: string | null
  /** 当前展示的是本地演示数据 */
  usingMock: boolean
  reload: () => void
}

/**
 * 学情总览数据源
 * ---------------------------------------------------------------
 * 策略：优先请求真实接口；当接口不可用（后端尚未就绪 / 网络异常）且
 * `USE_MOCK` 为 true 时，回落到本地演示数据并给出提示。
 */
export function useOverview(range: RangeKey): OverviewState {
  const { currentStudentId } = useApp()
  const [data, setData] = useState<StatsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usingMock, setUsingMock] = useState(false)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let alive = true
    const studentId = currentStudentId || undefined

    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const res = await api.getOverview({
          studentId,
          range: RANGE_API_VALUE[range],
        })
        if (!alive) return
        setData(res)
        setUsingMock(false)
        setError(null)
      } catch (e) {
        if (!alive) return
        const message = e instanceof Error ? e.message : '统计数据加载失败'
        if (USE_MOCK) {
          setData(mockOverview(range))
          setUsingMock(true)
          setError(message)
        } else {
          setData(null)
          setUsingMock(false)
          setError(message)
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [currentStudentId, range, tick])

  return { data, loading, error, usingMock, reload }
}

/** 演示模式下用于页头展示的学生档案 */
export function useDisplayStudent() {
  const { currentStudent } = useApp()
  if (currentStudent) return currentStudent
  return USE_MOCK ? MOCK_STUDENT : null
}
