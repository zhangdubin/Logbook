import { StatTile } from '@/components/ui'
import type { StatsOverview } from '@/lib/types'

/**
 * 错题量的环比提示
 * ---------------------------------------------------------------
 * 错题属于「越少越好」的指标：减少应当显示绿色，减少用 ▼ 表示。
 * StatTile 内置的 delta 只按正负着色（正=绿），因此这里用 hint 自绘，
 * 保证箭头方向与颜色语义同时正确。
 */
function QuestionDeltaHint({ delta }: { delta: number }) {
  if (!Number.isFinite(delta) || delta === 0) {
    return <span className="text-ink-400">与上周期持平</span>
  }
  const down = delta < 0
  return (
    <span className={down ? 'font-bold text-emerald-600' : 'font-bold text-red-500'}>
      {down ? '▼' : '▲'} {Math.abs(delta).toFixed(0)}% · 较上周期{down ? '减少' : '增加'}
    </span>
  )
}

export function KpiRow({ data }: { data: StatsOverview }) {
  const { totals } = data
  const correctedRate = totals.questions ? Math.round((totals.corrected / totals.questions) * 100) : 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="错题总数"
        value={totals.questions}
        unit="道"
        hint={<QuestionDeltaHint delta={totals.questionDelta} />}
        icon="📚"
        accent="#3b63f6"
      />
      <StatTile
        label="整体掌握度"
        value={totals.mastery}
        unit="%"
        delta={totals.masteryDelta}
        hint="较上周期"
        icon="🎯"
        accent="#10b981"
      />
      <StatTile
        label="已订正率"
        value={correctedRate}
        unit="%"
        hint={`待复盘 ${totals.pending} 道`}
        icon="✅"
        accent="#8b5cf6"
      />
      <StatTile
        label="活跃学习天数"
        value={totals.activeDays}
        unit="天"
        hint={`已掌握 ${totals.mastered} 道`}
        icon="🔥"
        accent="#f59e0b"
      />
    </div>
  )
}

export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card space-y-3 p-4">
          <div className="shimmer h-3 w-20 rounded bg-ink-100" />
          <div className="shimmer h-8 w-16 rounded bg-ink-100" />
          <div className="shimmer h-3 w-24 rounded bg-ink-100" />
        </div>
      ))}
    </div>
  )
}
