/**
 * components/SolutionFigure —— 解题步骤的 SVG 示意图
 * ============================================================================
 * 图形数据由**后端确定性推导**（server/solutionFigure.js），前端只负责画。
 * 这样图形每次都一样、不会飘，也不会出现「画错的图比没图更糟」。
 *
 * 设计取向：
 *   - 手机优先：SVG 用 viewBox 自适应宽度，字号按比例走；
 *   - 动画克制：只做「入场 + 高亮」，不做花哨的路径动画（学生要看的是内容）；
 *   - 尊重系统设置：prefers-reduced-motion 时关掉动画。
 *
 * 图形类型：
 *   numberLine  数轴
 *   fraction    分数/百分数条
 *   bar         条形对比
 *   geometry    几何示意图（示意，不按比例）
 *   equation    等式变形链
 */

import { useEffect, useMemo, useState } from 'react'

export type FigureKind = 'numberLine' | 'geometry' | 'fraction' | 'bar' | 'equation'

export interface NumberLinePoint {
  at: number
  label?: string
  tone?: 'a' | 'b'
}

export interface FigureData {
  kind: FigureKind
  numberLine?: {
    from: number
    to: number
    step?: number
    points?: NumberLinePoint[]
  }
  fraction?: { numerator: number; denominator: number; label?: string }
  bar?: { items: { label: string; value: number }[]; unit?: string }
  geometry?: {
    shape: 'triangle' | 'rect' | 'circle' | 'parallel'
    labels?: { x: number; y: number; text: string }[]
  }
  equation?: { steps: string[] }
}

const TONE = {
  a: { stroke: '#e11d48', fill: '#fecdd3', text: '#9f1239' },
  b: { stroke: '#2563eb', fill: '#dbeafe', text: '#1d4ed8' },
} as const

/** 系统是否要求减少动画 */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/** 入场动画用的「已绘制进度」 */
function useDrawIn(reduced: boolean) {
  const [on, setOn] = useState(reduced)
  useEffect(() => {
    if (reduced) {
      setOn(true)
      return
    }
    const t = setTimeout(() => setOn(true), 60)
    return () => clearTimeout(t)
  }, [reduced])
  return on
}

/**
 * 逐个「画出来」的错峰动画。
 *
 * 为什么不只是整体淡入：整体淡入只说明「有张图」，
 * **逐个画出来**才说明「**这个数是怎么来的**」——
 * 条形图从 0 长到该有的长度、分数条填到该有的比例，
 * 学生眼睛跟着看一遍，就懂了「原来要填这么多」。
 *
 * @param reduced 系统要求减少动画 → 全部直接显示
 * @param count   要错峰显示的元素个数
 * @param step    每个之间的间隔（毫秒）
 */
function useStagger(reduced: boolean, count: number, step = 110) {
  const [shown, setShown] = useState<boolean[]>(() => new Array(count).fill(true))
  useEffect(() => {
    if (reduced) {
      setShown(new Array(count).fill(true))
      return
    }
    setShown(new Array(count).fill(false))
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => {
        setShown((prev) => {
          const next = [...prev]
          next[i] = true
          return next
        })
      }, 80 + i * step),
    )
    return () => timers.forEach(clearTimeout)
  }, [reduced, count, step])
  return shown
}

/* -------------------------------------------------------------------------
 * 数轴
 * ---------------------------------------------------------------------- */
function NumberLineFigure({ data }: { data: NonNullable<FigureData['numberLine']> }) {
  const reduced = useReducedMotion()
  const W = 640
  const H = 120
  const PAD = 34
  const { from, to, step, points = [] } = data
  const span = to - from || 1
  const x = (v: number) => PAD + ((v - from) / span) * (W - PAD * 2)
  const axisY = 74

  // 刻度
  const ticks: number[] = []
  const stepValue = step && step > 0 ? step : Math.max(1, Math.ceil(span / 8))
  for (let v = Math.ceil(from / stepValue) * stepValue; v <= to; v += stepValue) {
    ticks.push(Number(v.toFixed(6)))
  }

  /* 标记错峰出现：先画正确答案，再画我的答案 —— 差在哪儿一眼就看出来 */
  const shown = useStagger(reduced, points.length, 240)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="数轴示意图">
      <line x1={PAD - 12} y1={axisY} x2={W - PAD + 12} y2={axisY} stroke="#94a3b8" strokeWidth={1.6} />
      <polygon
        points={`${W - PAD + 12},${axisY} ${W - PAD + 2},${axisY - 5} ${W - PAD + 2},${axisY + 5}`}
        fill="#94a3b8"
      />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={axisY - 5} x2={x(t)} y2={axisY + 5} stroke="#cbd5e1" strokeWidth={1.4} />
          <text x={x(t)} y={axisY + 20} textAnchor="middle" fontSize={11} fill="#94a3b8">
            {t}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const tone = TONE[p.tone ?? (i === 0 ? 'a' : 'b')]
        const px = x(p.at)
        return (
          <g
            key={`${p.at}-${i}`}
            style={{
              opacity: shown[i] ? 1 : 0,
              transform: shown[i] ? 'translateY(0)' : 'translateY(-6px)',
              transition: reduced
                ? 'none'
                : 'opacity .34s ease, transform .34s cubic-bezier(.22,1,.36,1)',
            }}
          >
            <circle cx={px} cy={axisY} r={5.5} fill={tone.fill} stroke={tone.stroke} strokeWidth={2.2} />
            <text
              x={px}
              y={axisY - 14}
              textAnchor="middle"
              fontSize={13}
              fontWeight={700}
              fill={tone.text}
            >
              {p.label ?? p.at}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* -------------------------------------------------------------------------
 * 分数条
 * ---------------------------------------------------------------------- */
function FractionFigure({ data }: { data: NonNullable<FigureData['fraction']> }) {
  const reduced = useReducedMotion()
  const shown = useStagger(reduced, 1, 0)
  const { numerator, denominator, label } = data
  const W = 520
  const H = 74
  const PAD = 16
  const total = denominator === 0 ? 1 : denominator
  const filled = Math.max(0, Math.min(total, numerator))
  const barW = W - PAD * 2
  const fillW = (filled / total) * barW

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="分数示意图">
      <rect x={PAD} y={26} width={barW} height={26} rx={6} fill="#e2e8f0" />
      {/* 填充部分**从 0 长到该有的比例** —— 眼睛跟着看一遍就知道「要填这么多」 */}
      <rect
        x={PAD}
        y={26}
        height={26}
        rx={6}
        fill="#f97316"
        style={{
          width: shown[0] ? fillW : 0,
          transition: reduced ? 'none' : 'width .6s cubic-bezier(.22,1,.36,1)',
        }}
      />
      <text x={PAD + barW / 2} y={45} textAnchor="middle" fontSize={14} fontWeight={700} fill="#ffffff">
        {label ?? `${numerator}/${denominator}`}
      </text>
      <text x={PAD} y={18} fontSize={12} fill="#64748b">
        {numerator}
      </text>
      <text x={PAD + barW} y={18} textAnchor="end" fontSize={12} fill="#64748b">
        {denominator}
      </text>
    </svg>
  )
}

/* -------------------------------------------------------------------------
 * 条形对比
 * ---------------------------------------------------------------------- */
function BarFigure({ data }: { data: NonNullable<FigureData['bar']> }) {
  const reduced = useReducedMotion()
  const { items, unit } = data
  const shown = useStagger(reduced, items.length ?? 0, 160)
  const W = 520
  const rowH = 40
  const PAD = 12
  const labelW = 76
  const H = PAD * 2 + rowH * items.length
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1)
  const barArea = W - labelW - PAD - 56

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="对比示意图">
      {items.map((it, i) => {
        const w = (Math.abs(it.value) / max) * barArea
        const y = PAD + i * rowH
        return (
          <g key={it.label + i}>
            <text x={0} y={y + 20} fontSize={13} fill="#334155">
              {it.label}
            </text>
            <rect x={labelW} y={y + 4} width={barArea} height={20} rx={4} fill="#f1f5f9" />
            {/* 每根条**从 0 长到该有的长度**，一根一根来 */}
            <rect
              x={labelW}
              y={y + 4}
              height={20}
              rx={4}
              fill="#0ea5e9"
              style={{
                width: shown[i] ? Math.max(w, 2) : 0,
                transition: reduced ? 'none' : 'width .55s cubic-bezier(.22,1,.36,1)',
              }}
            />
            <text x={labelW + w + 8} y={y + 19} fontSize={13} fontWeight={700} fill="#0369a1">
              {it.value}
              {unit ?? ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* -------------------------------------------------------------------------
 * 几何示意图（示意，不按真实比例）
 * ---------------------------------------------------------------------- */
function GeometryFigure({ data }: { data: NonNullable<FigureData['geometry']> }) {
  const { shape, labels = [] } = data
  const W = 420
  const H = 260
  const stroke = '#475569'
  const fill = 'rgba(99,102,241,0.10)'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="几何示意图">
      {shape === 'triangle' && (
        <polygon points={`210,30 60,215 360,215`} fill={fill} stroke={stroke} strokeWidth={2.2} />
      )}
      {shape === 'rect' && (
        <rect x={70} y={55} width={280} height={150} fill={fill} stroke={stroke} strokeWidth={2.2} />
      )}
      {shape === 'circle' && (
        <circle cx={210} cy={130} r={90} fill={fill} stroke={stroke} strokeWidth={2.2} />
      )}
      {shape === 'parallel' && (
        <g stroke={stroke} strokeWidth={2.2}>
          <line x1={40} y1={90} x2={380} y2={90} />
          <line x1={40} y1={170} x2={380} y2={170} />
        </g>
      )}
      {labels.map((l, i) => (
        <text key={i} x={l.x} y={l.y} fontSize={14} fontWeight={700} fill="#334155">
          {l.text}
        </text>
      ))}
    </svg>
  )
}

/* -------------------------------------------------------------------------
 * 等式变形链
 * ---------------------------------------------------------------------- */
function EquationFigure({ data }: { data: NonNullable<FigureData['equation']> }) {
  const { steps } = data
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="rounded-lg bg-indigo-50 px-2.5 py-1 font-mono text-[13px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
            {s}
          </span>
          {i < steps.length - 1 && <span className="text-ink-300">→</span>}
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------
 * 对外组件
 * ---------------------------------------------------------------------- */
export function SolutionFigure({ figure }: { figure?: FigureData | null }) {
  const reduced = useReducedMotion()
  const drawn = useDrawIn(reduced)

  const body = useMemo(() => {
    if (!figure) return null
    switch (figure.kind) {
      case 'numberLine':
        return figure.numberLine ? <NumberLineFigure data={figure.numberLine} /> : null
      case 'fraction':
        return figure.fraction ? <FractionFigure data={figure.fraction} /> : null
      case 'bar':
        return figure.bar ? <BarFigure data={figure.bar} /> : null
      case 'geometry':
        return figure.geometry ? <GeometryFigure data={figure.geometry} /> : null
      case 'equation':
        return figure.equation ? <EquationFigure data={figure.equation} /> : null
      default:
        return null
    }
  }, [figure])

  if (!figure || !body) return null

  return (
    <div
      className="mt-2 overflow-hidden rounded-xl border border-ink-100 bg-white/90 px-3 py-2"
      style={{
        opacity: drawn ? 1 : 0,
        transform: drawn ? 'translateY(0)' : 'translateY(4px)',
        transition: reduced ? 'none' : 'opacity .32s ease, transform .32s ease',
      }}
    >
      {body}
    </div>
  )
}

export default SolutionFigure
