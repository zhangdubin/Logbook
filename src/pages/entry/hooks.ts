/**
 * entry/hooks —— 页面共用 Hook
 */

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/store/app'
import type { Student } from '@/lib/types'
import { dataClient, getDataMode, subscribeDataMode } from './client'
import type { DataMode } from './client'

/** 当前数据模式（live = 真实接口，mock = 演示数据） */
export function useDataMode(): DataMode {
  const [mode, setMode] = useState<DataMode>(() => getDataMode())
  useEffect(() => subscribeDataMode(setMode), [])
  return mode
}

/** 媒体查询（用于手机端 / PC 端差异化交互） */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * 学生列表：优先使用全局 store（AppShell 的学生选择器同源），
 * 后端未就绪导致 store 为空时，使用演示数据兜底，并把第一个学生设为当前学生。
 */
export function useStudents(): {
  students: Student[]
  currentStudentId: string
  currentStudent: Student | null
  setCurrentStudentId: (id: string) => void
  loading: boolean
  error: string | null
  reload: () => Promise<void>
} {
  const app = useApp()
  const [fallback, setFallback] = useState<Student[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mode = useDataMode()

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await dataClient.listStudents()
      setFallback(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载学生列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /* 后端恢复后，把全局学生列表（含 AppShell 的学生选择器）一起刷新 */
  useEffect(() => {
    if (mode !== 'mock') return
    const timer = window.setInterval(() => {
      void app.reloadStudents()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [mode, app])

  const students = app.students.length ? app.students : fallback

  useEffect(() => {
    if (!app.currentStudentId && students[0]) app.setCurrentStudentId(students[0].id)
  }, [app, students])

  return {
    students,
    currentStudentId: app.currentStudentId || students[0]?.id || '',
    currentStudent: students.find((s) => s.id === (app.currentStudentId || students[0]?.id)) ?? null,
    setCurrentStudentId: app.setCurrentStudentId,
    loading: app.loading || loading,
    // 演示数据模式下，全局 store 的报错不必打扰用户
    error: mode === 'mock' ? error : (app.error ?? error),
    reload: async () => {
      await reload()
      await app.reloadStudents()
    },
  }
}
