import { useNavigate } from 'react-router-dom'
import { Badge, Card, Progress } from '@/components/ui'
import { SUBJECT_BG, subjectColor } from '@/lib/format'
import type { StatsOverview } from '@/lib/types'

const SEVERITY_TONE: Record<'高' | '中' | '低', 'red' | 'amber' | 'green'> = {
  高: 'red',
  中: 'amber',
  低: 'green',
}

const SEVERITY_COLOR: Record<'高' | '中' | '低', string> = {
  高: '#ef4444',
  中: '#f59e0b',
  低: '#10b981',
}

export function WeakPoints({ data }: { data: StatsOverview }) {
  const navigate = useNavigate()
  const points = data.weakPoints

  return (
    <Card
      title="优先突破知识点"
      subtitle="按严重程度排序，点击可查看该知识点的全部错题"
      extra={<Badge tone="red">{points.length} 个待突破</Badge>}
    >
      {points.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-400">暂无需优先突破的知识点，保持住！</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {points.map((p) => (
            <li key={`${p.subject}-${p.name}`}>
              <button
                type="button"
                onClick={() => navigate(`/questions?knowledgePoint=${encodeURIComponent(p.name)}`)}
                className="group w-full rounded-lg px-1 py-3 text-left transition hover:bg-ink-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink-800 group-hover:text-brand-700">
                      {p.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                      <span className={`tag ring-1 ${SUBJECT_BG[p.subject] ?? 'bg-ink-50 text-ink-600 ring-ink-200'}`}>
                        {p.subject}
                      </span>
                      <span>错题 {p.total} 道</span>
                      <span className="text-ink-300">·</span>
                      <span>掌握度 {p.mastery}%</span>
                    </div>
                  </div>
                  <Badge tone={SEVERITY_TONE[p.severity]}>{p.severity}优先</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Progress
                    value={p.mastery}
                    color={SEVERITY_COLOR[p.severity]}
                    height={7}
                    className="flex-1"
                  />
                  <span
                    className="w-9 shrink-0 text-right text-[11px] font-bold"
                    style={{ color: subjectColor(p.subject) }}
                  >
                    {p.mastery}%
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
