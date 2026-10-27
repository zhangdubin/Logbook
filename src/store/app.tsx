import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import api from '@/lib/api'
import type { Student } from '@/lib/types'

interface AppState {
  students: Student[]
  currentStudentId: string
  currentStudent: Student | null
  loading: boolean
  error: string | null
  setCurrentStudentId: (id: string) => void
  reloadStudents: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)
const STORAGE_KEY = 'cuoti.currentStudentId'

export function AppProvider({ children }: { children: ReactNode }) {
  const [students, setStudents] = useState<Student[]>([])
  const [currentStudentId, setCurrent] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? '',
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reloadStudents = useCallback(async () => {
    try {
      setError(null)
      const list = await api.listStudents()
      setStudents(list)
      setCurrent((prev) => {
        const stillThere = list.some((s) => s.id === prev)
        const next = stillThere ? prev : list[0]?.id ?? ''
        if (next) localStorage.setItem(STORAGE_KEY, next)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载学生列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadStudents()
  }, [reloadStudents])

  const setCurrentStudentId = useCallback((id: string) => {
    setCurrent(id)
    if (id) localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const value = useMemo<AppState>(
    () => ({
      students,
      currentStudentId,
      currentStudent: students.find((s) => s.id === currentStudentId) ?? null,
      loading,
      error,
      setCurrentStudentId,
      reloadStudents,
    }),
    [students, currentStudentId, loading, error, setCurrentStudentId, reloadStudents],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
