import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import type { InsightReport } from '@/lib/types'
import { useApp } from '@/store/app'
import { MOCK_REPORT, USE_MOCK } from '@/pages/__mock__/stats'

export interface ReportState {
  report: InsightReport | null
  loading: boolean
  /** 真实接口错误信息 */
  error: string | null
  /** 当前展示的是本地演示数据 */
  usingMock: boolean
  reload: () => void
}

/**
 * AI 诊断报告数据源
 * ---------------------------------------------------------------
 * 与学情总览一致：优先真实接口，失败且 USE_MOCK 为 true 时回落到演示报告。
 */
export function useReport(): ReportState {
  const { currentStudentId } = useApp()
  const [report, setReport] = useState<InsightReport | null>(null)
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
        const res = await api.getReport(studentId)
        if (!alive) return
        setReport(res)
        setUsingMock(false)
        setError(null)
      } catch (e) {
        if (!alive) return
        const message = e instanceof Error ? e.message : '诊断报告生成失败'
        if (USE_MOCK) {
          setReport({ ...MOCK_REPORT, studentId })
          setUsingMock(true)
          setError(message)
        } else {
          setReport(null)
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
  }, [currentStudentId, tick])

  return { report, loading, error, usingMock, reload }
}
