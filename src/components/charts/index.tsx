import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useMeasure } from './use-measure'

/* ------------------------------------------------------------------ hook */
export { useMeasure } from './use-measure'

function niceMax(value: number): number {
  if (value <= 0) return 10
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  const n = value / base
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * base
}

function ticks(max: number, count = 4): number[] {
  const out: number[] = []
  for (let i = 0; i <= count; i++) out.push((max / count) * i)
  return out
}

/* ------------------------------------------------------------- BarChart */
export interface BarDatum {
  label: string
  value: number
  color?: string
  meta?: string
}

export function BarChart({
  data,
  height = 220,
  unit = '',
  color = '#3b63f6',
  horizontal = false,
  valueFormat,
}: {
  data: BarDatum[]
  height?: number
  unit?: string
  color?: string
  horizontal?: boolean
  valueFormat?: (v: number) => string
}) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const fmt = valueFormat ?? ((v: number) => `${Math.round(v)}${unit}`)
  const w = Math.max(width, 240)
  const h = height

  if (horizontal) {
    const labelW = 76
    const valueW = 46
    const track = Math.max(w - labelW - valueW - 12, 40)
    const max = niceMax(Math.max(...data.map((d) => d.value), 1))
    return (
      <div ref={ref} className="w-full">
        <div className="flex flex-col gap-2.5">
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-2">
              <span className="w-[72px] shrink-0 truncate text-xs text-ink-600" title={d.label}>
                {d.label}
              </span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                <span
                  className="block h-full rounded-full transition-all duration-700"
                  style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? color }}
                />
              </span>
              <span className="w-[44px] shrink-0 text-right text-xs font-bold text-ink-700">
                {fmt(d.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const padL = 34
  const padB = 28
  const padT = 12
  const plotW = Math.max(w - padL - 8, 40)
  const plotH = Math.max(h - padB - padT, 40)
  const max = niceMax(Math.max(...data.map((d) => d.value), 1))
  const bw = data.length ? Math.min(42, (plotW / data.length) * 0.62) : 20

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={w} height={h} role="img">
          {ticks(max).map((t) => {
            const y = padT + plotH - (t / max) * plotH
            return (
              <g key={t}>
                <line x1={padL} x2={w - 4} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                <text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">
                  {Math.round(t)}
                </text>
              </g>
            )
          })}
          {data.map((d, i) => {
            const cx = padL + (plotW / data.length) * (i + 0.5)
            const bh = Math.max((d.value / max) * plotH, d.value > 0 ? 3 : 0)
            const y = padT + plotH - bh
            return (
              <g key={d.label}>
                <rect
                  x={cx - bw / 2}
                  y={y}
                  width={bw}
                  height={bh}
                  rx={Math.min(6, bw / 2)}
                  fill={d.color ?? color}
                  opacity={0.92}
                >
                  <title>{`${d.label}: ${fmt(d.value)}${d.meta ? ` · ${d.meta}` : ''}`}</title>
                </rect>
                {d.value > 0 && (
                  <text x={cx} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#475569">
                    {fmt(d.value)}
                  </text>
                )}
                <text x={cx} y={h - 9} textAnchor="middle" fontSize={10} fill="#64748b">
                  {d.label.length > 5 ? `${d.label.slice(0, 5)}…` : d.label}
                </text>
              </g>
            )
          })}
          <line x1={padL} x2={w - 4} y1={padT + plotH} y2={padT + plotH} stroke="#cbd5e1" />
        </svg>
      )}
    </div>
  )
}

/* ----------------------------------------------------------- DonutChart */
export interface DonutDatum {
  label: string
  value: number
  color: string
}

export function DonutChart({
  data,
  size = 200,
  thickness = 30,
  centerLabel,
  centerValue,
  legend = true,
}: {
  data: DonutDatum[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: ReactNode
  legend?: boolean
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = (size - thickness) / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
      <svg width={size} height={size} className="shrink-0" role="img">
        <g transform={`rotate(-90 ${c} ${c})`}>
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={thickness}
          />
          {total > 0 &&
            data.map((d) => {
              const len = (d.value / total) * circumference
              const el = (
                <circle
                  key={d.label}
                  cx={c}
                  cy={c}
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${len} ${circumference - len}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </circle>
              )
              offset += len
              return el
            })}
        </g>
        {centerValue !== undefined && (
          <>
            <text
              x={c}
              y={c - 2}
              textAnchor="middle"
              fontSize={size * 0.16}
              fontWeight={800}
              fill="#0f172a"
            >
              {centerValue}
            </text>
            {centerLabel && (
              <text x={c} y={c + size * 0.11} textAnchor="middle" fontSize={11} fill="#94a3b8">
                {centerLabel}
              </text>
            )}
          </>
        )}
      </svg>
      {legend && (
        <ul className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-1">
          {data.map((d) => (
            <li key={d.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
              <span className="flex-1 truncate text-ink-600">{d.label}</span>
              <span className="font-bold text-ink-800">{d.value}</span>
              <span className="w-11 text-right text-ink-400">
                {total ? ((d.value / total) * 100).toFixed(0) : 0}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ LineChart */
export interface LineSeries {
  name: string
  color: string
  points: { label: string; value: number }[]
  fill?: boolean
  dashed?: boolean
}

export function LineChart({
  series,
  height = 240,
  unit = '',
  yMax,
}: {
  series: LineSeries[]
  height?: number
  unit?: string
  yMax?: number
}) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const w = Math.max(width, 280)
  const h = height
  const padL = 34
  const padB = 26
  const padT = 14
  const plotW = Math.max(w - padL - 10, 40)
  const plotH = Math.max(h - padB - padT, 40)
  const labels = series[0]?.points.map((p) => p.label) ?? []
  const max = yMax ?? niceMax(Math.max(...series.flatMap((s) => s.points.map((p) => p.value)), 1))

  const xAt = (i: number) => padL + (labels.length > 1 ? (plotW / (labels.length - 1)) * i : plotW / 2)
  const yAt = (v: number) => padT + plotH - (v / max) * plotH

  const paths = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        d: s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' '),
        area:
          s.fill && s.points.length
            ? `${s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' ')} L ${xAt(s.points.length - 1)} ${padT + plotH} L ${xAt(0)} ${padT + plotH} Z`
            : '',
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, w, h, max],
  )

  const step = Math.ceil(labels.length / 7)
  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={w} height={h} role="img">
          {ticks(max).map((t) => {
            const y = yAt(t)
            return (
              <g key={t}>
                <line x1={padL} x2={w - 6} y1={y} y2={y} stroke="#e2e8f0" />
                <text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">
                  {Math.round(t)}
                </text>
              </g>
            )
          })}
          {paths.map((p) => (
            <g key={p.name}>
              {p.area && <path d={p.area} fill={p.color} opacity={0.12} />}
              <path
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={p.dashed ? '5 4' : undefined}
              />
              {p.points.map((point, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(point.value)} r={3} fill="#fff" stroke={p.color} strokeWidth={2}>
                  <title>{`${p.name} · ${point.label}: ${point.value}${unit}`}</title>
                </circle>
              ))}
            </g>
          ))}
          {labels.map((l, i) =>
            i % step === 0 || i === labels.length - 1 ? (
              <text key={`${l}-${i}`} x={xAt(i)} y={h - 8} textAnchor="middle" fontSize={10} fill="#64748b">
                {l.length > 6 ? `${l.slice(0, 6)}…` : l}
              </text>
            ) : null,
          )}
          <line x1={padL} x2={w - 6} y1={padT + plotH} y2={padT + plotH} stroke="#cbd5e1" />
        </svg>
      )}
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-xs text-ink-600">
              <span className="h-1.5 w-4 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------- RadarChart */
export interface RadarDatum {
  label: string
  value: number
  max?: number
}

export function RadarChart({
  data,
  size = 260,
  color = '#3b63f6',
  compare,
  compareColor = '#f59e0b',
}: {
  data: RadarDatum[]
  size?: number
  color?: string
  compare?: RadarDatum[]
  compareColor?: string
}) {
  const c = size / 2
  const r = size / 2 - 38
  const n = data.length
  if (n < 3) return <p className="text-xs text-ink-400">知识点不足，无法生成雷达图</p>

  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const pointAt = (i: number, ratio: number) => [c + Math.cos(angle(i)) * r * ratio, c + Math.sin(angle(i)) * r * ratio]
  const polygon = (items: RadarDatum[]) =>
    items.map((d, i) => pointAt(i, Math.max(0, Math.min(1, d.value / (d.max ?? 100)))).join(',')).join(' ')

  return (
    <svg width={size} height={size} className="mx-auto" role="img">
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <polygon
          key={ratio}
          points={data.map((_, i) => pointAt(i, ratio).join(',')).join(' ')}
          fill="none"
          stroke="#e2e8f0"
        />
      ))}
      {data.map((_, i) => {
        const [x, y] = pointAt(i, 1)
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="#e2e8f0" />
      })}
      {compare && (
        <polygon points={polygon(compare)} fill={compareColor} fillOpacity={0.12} stroke={compareColor} strokeWidth={1.6} strokeDasharray="4 3" />
      )}
      <polygon points={polygon(data)} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2.2} />
      {data.map((d, i) => {
        const [x, y] = pointAt(i, Math.max(0, Math.min(1, d.value / (d.max ?? 100))))
        return <circle key={d.label} cx={x} cy={y} r={3} fill={color} />
      })}
      {data.map((d, i) => {
        const [x, y] = pointAt(i, 1.2)
        const anchor = Math.abs(x - c) < 6 ? 'middle' : x > c ? 'start' : 'end'
        return (
          <text key={d.label} x={x} y={y + 3} textAnchor={anchor} fontSize={10.5} fill="#64748b">
            {d.label.length > 6 ? `${d.label.slice(0, 6)}` : d.label}
          </text>
        )
      })}
    </svg>
  )
}

/* --------------------------------------------------------------- Gauge */
export function Gauge({
  value,
  label,
  sublabel,
  size = 150,
  color = '#3b63f6',
}: {
  value: number
  label?: string
  sublabel?: string
  size?: number
  color?: string
}) {
  const v = Math.max(0, Math.min(100, value))
  const stroke = 12
  const r = size / 2 - stroke / 2 - 2
  const c = size / 2
  const circumference = Math.PI * r
  const arc = (v / 100) * circumference

  return (
    <svg width={size} height={size * 0.62} role="img">
      <path
        d={`M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`}
        fill="none"
        stroke="#eef2f7"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <path
        d={`M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${arc} ${circumference}`}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x={c} y={c - 4} textAnchor="middle" fontSize={size * 0.19} fontWeight={800} fill="#0f172a">
        {Math.round(v)}
      </text>
      {label && (
        <text x={c} y={c + 15} textAnchor="middle" fontSize={11} fill="#64748b">
          {label}
        </text>
      )}
      {sublabel && (
        <text x={c} y={size * 0.62 - 2} textAnchor="middle" fontSize={10} fill="#94a3b8">
          {sublabel}
        </text>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------- Heatmap */
export function Heatmap({
  data,
  weeks = 14,
  onSelect,
}: {
  data: { date: string; count: number }[]
  weeks?: number
  onSelect?: (date: string) => void
}) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const map = useMemo(() => new Map(data.map((d) => [d.date, d.count])), [data])
  const max = Math.max(...data.map((d) => d.count), 1)

  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const days: { date: string; count: number }[] = []
  const start = new Date(end)
  start.setDate(start.getDate() - (weeks * 7 - 1))
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ date: key, count: map.get(key) ?? 0 })
  }

  const cell = 13
  const gap = 3
  const cols = weeks
  const w = Math.max(width, 200)
  const gridW = Math.min(cols * (cell + gap), w)
  const actualCell = Math.max(8, (gridW - (cols - 1) * gap) / cols)

  return (
    <div ref={ref} className="w-full overflow-x-auto">
      <svg width={gridW} height={actualCell * 7 + gap * 6 + 18}>
        {days.map((d, i) => {
          const col = Math.floor(i / 7)
          const row = i % 7
          const intensity = d.count / max
          const fill =
            d.count === 0 ? '#eef2f7' : `rgba(59, 99, 246, ${0.18 + intensity * 0.82})`
          return (
            <rect
              key={d.date}
              x={col * (actualCell + gap)}
              y={row * (actualCell + gap)}
              width={actualCell}
              height={actualCell}
              rx={3}
              fill={fill}
              className={onSelect ? 'cursor-pointer' : ''}
              onClick={onSelect ? () => onSelect(d.date) : undefined}
            >
              <title>{`${d.date}: ${d.count} 道错题`}</title>
            </rect>
          )
        })}
        <g transform={`translate(0, ${actualCell * 7 + gap * 6 + 6})`}>
          {['一', '三', '五'].map((m, idx) => (
            <text key={m} x={idx * (actualCell + gap) * 3} fontSize={9} fill="#94a3b8">
              {m}
            </text>
          ))}
        </g>
      </svg>
    </div>
  )
}

/* ------------------------------------------------------- StackedBar */
export function StackedBar({
  segments,
  height = 14,
}: {
  segments: { label: string; value: number; color: string }[]
  height?: number
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-ink-100" style={{ height }}>
      {segments.map((s) => (
        <div
          key={s.label}
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          title={`${s.label}: ${s.value}`}
        />
      ))}
    </div>
  )
}

/* ---------------------------------------------------- 双轴折线（新增导出） */
export { DualAxisLineChart } from './dual-axis'
export type { DualSeries, DualAxisLineChartProps } from './dual-axis'
