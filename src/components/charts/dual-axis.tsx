import { useMemo } from 'react'
import { useMeasure } from './use-measure'

/**
 * 双 Y 轴折线图
 * ---------------------------------------------------------------
 * 左轴：错题数量等「计数型」指标（如每日错题数）
 * 右轴：0-100 的「比率型」指标（如平均掌握度）
 *
 * 与 LineChart 的区别：LineChart 的所有序列共用一条 Y 轴，
 * 计数与百分比放在一起会被百分比压扁；本组件为两侧各提供独立刻度。
 */

export interface DualSeries {
  name: string
  color: string
  points: { label: string; value: number }[]
  /** 是否填充面积（仅建议给左轴序列使用） */
  fill?: boolean
  dashed?: boolean
}

export interface DualAxisLineChartProps {
  /** 左轴序列（计数型） */
  left: DualSeries
  /** 右轴序列（比率型） */
  right: DualSeries
  height?: number
  leftUnit?: string
  rightUnit?: string
  /** 右轴最大值，默认 100 */
  rightMax?: number
}

function niceMax(value: number): number {
  if (value <= 0) return 10
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  const n = value / base
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * base
}

export function DualAxisLineChart({
  left,
  right,
  height = 240,
  leftUnit = '',
  rightUnit = '',
  rightMax = 100,
}: DualAxisLineChartProps) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const w = Math.max(width, 280)
  const h = height
  const padL = 34
  const padR = 40
  const padT = 14
  const padB = 26
  const plotW = Math.max(w - padL - padR, 40)
  const plotH = Math.max(h - padT - padB, 40)

  const labels = left.points.length ? left.points.map((p) => p.label) : right.points.map((p) => p.label)
  const leftMax = niceMax(Math.max(...left.points.map((p) => p.value), 1))
  const rightScale = Math.max(rightMax, 1)

  const xAt = (i: number) =>
    padL + (labels.length > 1 ? (plotW / (labels.length - 1)) * i : plotW / 2)
  const yLeft = (v: number) => padT + plotH - (v / leftMax) * plotH
  const yRight = (v: number) => padT + plotH - (Math.max(0, Math.min(rightScale, v)) / rightScale) * plotH

  const leftPath = useMemo(
    () => left.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yLeft(p.value)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [left.points, w, h, leftMax],
  )
  const rightPath = useMemo(
    () => right.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yRight(p.value)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [right.points, w, h, rightScale],
  )
  const leftArea = useMemo(() => {
    if (!left.fill || !left.points.length) return ''
    return `${leftPath} L ${xAt(left.points.length - 1)} ${padT + plotH} L ${xAt(0)} ${padT + plotH} Z`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftPath, left.fill, left.points.length, w, h])

  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => r * leftMax)
  const rightTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => r * rightScale)
  const step = Math.ceil(labels.length / 7)

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={w} height={h} role="img">
          {leftTicks.map((t, i) => {
            const y = padT + plotH - (t / leftMax) * plotH
            return (
              <g key={`l-${i}`}>
                <line x1={padL} x2={w - padR + 6} y1={y} y2={y} stroke="#e2e8f0" />
                <text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">
                  {Math.round(t)}
                </text>
              </g>
            )
          })}
          {rightTicks.map((t, i) => {
            const y = padT + plotH - (t / rightScale) * plotH
            return (
              <text
                key={`r-${i}`}
                x={w - padR + 10}
                y={y + 3.5}
                textAnchor="start"
                fontSize={10}
                fill={right.color}
                opacity={0.75}
              >
                {Math.round(t)}
                {i === rightTicks.length - 1 ? rightUnit : ''}
              </text>
            )
          })}

          {leftArea && <path d={leftArea} fill={left.color} opacity={0.12} />}
          <path
            d={leftPath}
            fill="none"
            stroke={left.color}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={rightPath}
            fill="none"
            stroke={right.color}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={right.dashed === false ? undefined : '6 4'}
          />

          {left.points.map((p, i) => (
            <circle key={`lp-${i}`} cx={xAt(i)} cy={yLeft(p.value)} r={2.8} fill="#fff" stroke={left.color} strokeWidth={1.8}>
              <title>{`${left.name} · ${p.label}: ${p.value}${leftUnit}`}</title>
            </circle>
          ))}
          {right.points.map((p, i) => (
            <circle key={`rp-${i}`} cx={xAt(i)} cy={yRight(p.value)} r={2.8} fill="#fff" stroke={right.color} strokeWidth={1.8}>
              <title>{`${right.name} · ${p.label}: ${p.value}${rightUnit}`}</title>
            </circle>
          ))}

          {labels.map((l, i) =>
            i % step === 0 || i === labels.length - 1 ? (
              <text key={`${l}-${i}`} x={xAt(i)} y={h - 8} textAnchor="middle" fontSize={10} fill="#64748b">
                {l.length > 6 ? `${l.slice(0, 6)}…` : l}
              </text>
            ) : null,
          )}

          <line x1={padL} x2={w - padR + 6} y1={padT + plotH} y2={padT + plotH} stroke="#cbd5e1" />
        </svg>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ink-600">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full" style={{ background: left.color }} />
          {left.name}
          <span className="text-ink-400">（左轴{leftUnit}）</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full" style={{ background: right.color }} />
          {right.name}
          <span className="text-ink-400">（右轴{rightUnit}）</span>
        </span>
      </div>
    </div>
  )
}

export default DualAxisLineChart
