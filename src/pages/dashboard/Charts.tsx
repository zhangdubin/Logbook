import { useMemo } from 'react'
import { Badge, Card } from '@/components/ui'
import {
  BarChart,
  DonutChart,
  DualAxisLineChart,
  Heatmap,
  RadarChart,
  StackedBar,
} from '@/components/charts'
import { ERROR_TYPE_COLOR } from '@/lib/types'
import type { StatsOverview } from '@/lib/types'
import { subjectColor } from '@/lib/format'

export function DashboardCharts({ data }: { data: StatsOverview }) {
  const subjectBars = useMemo(
    () =>
      data.bySubject.map((b) => ({
        label: b.label,
        value: b.total,
        color: subjectColor(b.label),
        meta: `掌握度 ${b.mastery}%`,
      })),
    [data.bySubject],
  )

  const donutData = useMemo(
    () =>
      data.byErrorType.map((e) => ({
        label: e.label,
        value: e.count,
        color: ERROR_TYPE_COLOR[e.type],
      })),
    [data.byErrorType],
  )

  const trend = useMemo(() => {
    const points = data.trend.map((t) => ({ label: t.date.slice(5).replace('-', '/'), value: t.total }))
    // 当天没有录入错题时后端会返回 mastery = 0，这里沿用上一次的有效值，
    // 避免折线因为「空白日」出现无意义的下坠。
    const mastery: { label: string; value: number }[] = []
    let carried = 0
    data.trend.forEach((t) => {
      const label = t.date.slice(5).replace('-', '/')
      if (t.total > 0 && t.mastery > 0) carried = t.mastery
      mastery.push({ label, value: carried })
    })
    return { points, mastery }
  }, [data.trend])

  /** 热力图按实际数据跨度渲染，避免出现大片空白格 */
  const heatmapWeeks = useMemo(() => {
    const weeks = Math.ceil(data.heatmap.length / 7)
    return Math.max(2, Math.min(14, weeks || 14))
  }, [data.heatmap.length])

  const radarData = useMemo(
    () =>
      [...data.byKnowledge]
        .sort((a, b) => a.mastery - b.mastery)
        .slice(0, 8)
        .map((k) => ({ label: k.label, value: k.mastery, max: 100 })),
    [data.byKnowledge],
  )

  const typeBars = useMemo(
    () =>
      data.byQuestionType.map((b) => ({
        label: b.label,
        value: b.total,
        color: '#3b63f6',
        meta: `已订正 ${b.corrected}`,
      })),
    [data.byQuestionType],
  )

  const correctedSegments = [
    { label: '已订正', value: data.totals.corrected, color: '#10b981' },
    { label: '待复盘', value: Math.max(data.totals.questions - data.totals.corrected, 0), color: '#f59e0b' },
  ]

  const empty = data.totals.questions === 0

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 学科分布 */}
      <Card
        title="学科错题分布"
        subtitle="按错题数量排序，颜色对应学科主题色"
        extra={<Badge tone="blue">{data.bySubject.length} 个学科</Badge>}
      >
        {empty ? (
          <p className="py-8 text-center text-xs text-ink-400">暂无学科数据</p>
        ) : (
          <BarChart data={subjectBars} horizontal height={200} unit=" 道" />
        )}
      </Card>

      {/* 错因构成 */}
      <Card
        title="错因构成"
        subtitle="AI 智能归因占比，定位真正的失分环节"
        extra={<Badge tone="violet">{data.byErrorType.length} 类错因</Badge>}
      >
        {empty ? (
          <p className="py-8 text-center text-xs text-ink-400">暂无错因数据</p>
        ) : (
          <DonutChart
            data={donutData}
            size={190}
            thickness={28}
            centerLabel={`错因合计 ${data.totals.questions}`}
            centerValue={
              <span>
                {donutData[0]
                  ? `${Math.round((donutData[0].value / data.totals.questions) * 100)}%`
                  : '0%'}
              </span>
            }
          />
        )}
      </Card>

      {/* 趋势 */}
      <Card
        title="错题量与掌握度趋势"
        subtitle="左轴为每日错题数，右轴为当日平均掌握度"
        extra={<Badge tone="cyan">{data.trend.length} 天</Badge>}
      >
        {empty ? (
          <p className="py-8 text-center text-xs text-ink-400">暂无趋势数据</p>
        ) : (
          <DualAxisLineChart
            left={{ name: '每日错题数', color: '#3b63f6', points: trend.points, fill: true }}
            right={{ name: '平均掌握度', color: '#f59e0b', points: trend.mastery }}
            height={240}
            leftUnit=" 道"
            rightUnit="%"
          />
        )}
      </Card>

      {/* 雷达 */}
      <Card
        title="知识点掌握雷达"
        subtitle="掌握度最低的若干知识点，越靠近中心越需补强"
        extra={<Badge tone="amber">共 {data.byKnowledge.length} 个知识点</Badge>}
      >
        {radarData.length < 3 ? (
          <p className="py-8 text-center text-xs text-ink-400">知识点不足，无法生成雷达图</p>
        ) : (
          <RadarChart data={radarData} size={268} color="#2747eb" />
        )}
      </Card>

      {/* 热力图 */}
      <Card title="错题活跃热力图" subtitle="统计周期内每天的错题录入量，颜色越深表示当天记录越多">
        {empty ? (
          <p className="py-8 text-center text-xs text-ink-400">暂无活跃数据</p>
        ) : (
          <Heatmap data={data.heatmap} weeks={heatmapWeeks} />
        )}
      </Card>

      {/* 题型分布 */}
      <Card title="题型分布" subtitle="找出最常失分的题型，并查看整体订正进度">
        {empty ? (
          <p className="py-8 text-center text-xs text-ink-400">暂无题型数据</p>
        ) : (
          <>
            <BarChart data={typeBars} height={210} unit=" 道" />
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs text-ink-500">
                <span className="font-semibold">订正进度</span>
                <span>
                  已订正 {data.totals.corrected} / {data.totals.questions} 道
                </span>
              </div>
              <StackedBar segments={correctedSegments} height={12} />
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-500">
                {correctedSegments.map((s) => (
                  <span key={s.label} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                    {s.label} {s.value} 道
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
