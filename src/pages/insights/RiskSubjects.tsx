import { Card, Progress } from '@/components/ui'
import { subjectColor } from '@/lib/format'

export function RiskSubjects({
  items,
}: {
  items: { subject: string; reason: string; score: number }[]
}) {
  return (
    <Card title="高风险学科" subtitle="分数越高代表风险越集中，需要优先介入">
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-400">暂无高风险学科，各科发展较为均衡</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => {
            const color = r.score >= 60 ? '#ef4444' : r.score >= 35 ? '#f59e0b' : '#10b981'
            return (
              <div
                key={r.subject}
                className="rounded-xl border border-ink-100 bg-ink-50/40 p-3.5 transition hover:border-ink-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-sm font-bold"
                    style={{ color: subjectColor(r.subject) }}
                  >
                    {r.subject}
                  </span>
                  <span className="text-lg font-black" style={{ color }}>
                    {r.score}
                    <span className="text-[11px] font-bold text-ink-400"> 分</span>
                  </span>
                </div>
                <Progress value={r.score} color={color} height={7} className="mt-2" />
                <p className="mt-2 text-[11px] leading-relaxed text-ink-500">{r.reason}</p>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
