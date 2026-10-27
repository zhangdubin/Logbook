import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { initials } from '@/lib/format'

/* ------------------------------------------------------------------ Card */
export function Card({
  title,
  subtitle,
  extra,
  children,
  className = '',
  bodyClassName = 'p-4 sm:p-5',
  icon,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  extra?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  icon?: ReactNode
}) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-800">
              {icon}
              <span className="truncate">{title}</span>
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/* ----------------------------------------------------------------- Badge */
export function Badge({
  children,
  tone = 'slate',
  className = '',
}: {
  children: ReactNode
  tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'cyan' | 'pink'
  className?: string
}) {
  const tones: Record<string, string> = {
    slate: 'bg-ink-50 text-ink-600 ring-ink-200',
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
    cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
    pink: 'bg-pink-50 text-pink-700 ring-pink-200',
  }
  return <span className={`tag ring-1 ${tones[tone]} ${className}`}>{children}</span>
}

/* -------------------------------------------------------------- StatTile */
export function StatTile({
  label,
  value,
  unit,
  delta,
  hint,
  icon,
  accent = '#3b63f6',
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  delta?: number
  hint?: ReactNode
  icon?: ReactNode
  accent?: string
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-ink-500">{label}</p>
        {icon && (
          <span
            className="grid h-8 w-8 place-items-center rounded-lg text-sm"
            style={{ background: `${accent}1a`, color: accent }}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-black tracking-tight text-ink-900">{value}</span>
        {unit && <span className="text-sm font-semibold text-ink-400">{unit}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {typeof delta === 'number' && Number.isFinite(delta) && (
          <span
            className={`font-bold ${delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}
          >
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
          </span>
        )}
        {hint && <span className="text-ink-400">{hint}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- Progress */
export function Progress({
  value,
  color = '#3b63f6',
  height = 8,
  className = '',
}: {
  value: number
  color?: string
  height?: number
  className?: string
}) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-ink-100 ${className}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${v}%`, background: color }}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- Avatar */
export function Avatar({
  name,
  color = '#3b63f6',
  size = 36,
}: {
  name: string
  color?: string
  size?: number
}) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

/* ------------------------------------------------------------ EmptyState */
export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-4xl">{icon}</div>
      <p className="text-sm font-bold text-ink-700">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-ink-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------- Skeleton */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`shimmer rounded-lg bg-ink-100 ${className}`} />
}

/* ---------------------------------------------------------------- Spinner */
export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-ink-200 border-t-brand-600 ${className}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="加载中"
    />
  )
}

/* ----------------------------------------------------------------- Modal */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`animate-pop-in relative z-10 w-full ${width} max-h-[92vh] overflow-auto rounded-t-2xl bg-white shadow-pop sm:rounded-2xl`}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ink-100 bg-white/95 px-5 py-3 backdrop-blur">
            <h3 className="text-sm font-bold text-ink-800">{title}</h3>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-ink-100 bg-white/95 px-5 py-3 backdrop-blur">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Tabs */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: { key: T; label: ReactNode; count?: number }[]
  value: T
  onChange: (key: T) => void
  className?: string
}) {
  return (
    <div className={`flex gap-1 overflow-x-auto rounded-xl bg-ink-100/70 p-1 ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
            value === t.key
              ? 'bg-white text-brand-700 shadow-sm'
              : 'text-ink-500 hover:text-ink-700'
          }`}
        >
          {t.label}
          {typeof t.count === 'number' && (
            <span
              className={`rounded-full px-1.5 py-px text-[10px] ${
                value === t.key ? 'bg-brand-100 text-brand-700' : 'bg-ink-200 text-ink-500'
              }`}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------- AlertBox */
export function AlertBox({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'error' | 'warning' | 'success'
  title?: ReactNode
  children?: ReactNode
}) {
  const map = {
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    error: 'bg-red-50 text-red-800 border-red-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  }
  const icon = { info: 'ℹ️', error: '⚠️', warning: '💡', success: '✅' }
  return (
    <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${map[tone]}`}>
      <div className="flex gap-2">
        <span aria-hidden>{icon[tone]}</span>
        <div className="min-w-0 flex-1">
          {title && <p className="font-bold">{title}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- Field */
export function Field({
  label,
  hint,
  required,
  children,
  className = '',
}: {
  label?: ReactNode
  hint?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-400">{hint}</p>}
    </div>
  )
}

/* --------------------------------------------------------------- Section */
export function SectionTitle({
  children,
  extra,
  className = '',
}: {
  children: ReactNode
  extra?: ReactNode
  className?: string
}) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <h3 className="text-sm font-bold text-ink-700">{children}</h3>
      {extra}
    </div>
  )
}

/* ------------------------------------------------------------- ToggleRow */
export function ToggleRow({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  description?: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-ink-200 bg-white px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-800">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{description}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-brand-600' : 'bg-ink-200'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  )
}
