import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type ToastTone = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

const Ctx = createContext<{ push: (message: string, tone?: ToastTone) => void } | null>(null)

let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++seq
    setItems((prev) => [...prev, { id, message, tone }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200)
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-8">
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-pop-in pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm font-semibold shadow-pop ${
              t.tone === 'success'
                ? 'bg-emerald-600 text-white'
                : t.tone === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-ink-900 text-white'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
