import { Badge, Card } from '@/components/ui'
import type { AIPracticeTask } from '@/lib/types'

export function WeeklyPlan({ plan }: { plan: AIPracticeTask[] }) {
  const totalMinutes = plan.reduce((s, t) => s + (t.minutes || 0), 0)

  return (
    <Card
      title="7 天学习计划"
      subtitle="每天一个主攻方向，任务量已按学生当前水平估算"
      extra={<Badge tone="blue">共 {totalMinutes} 分钟</Badge>}
    >
      {plan.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-400">暂无学习计划</p>
      ) : (
        <div className="relative">
          <div className="pointer-events-none absolute left-6 right-6 top-[18px] hidden h-0.5 bg-ink-200 lg:block" />
          <ol className="grid gap-3 lg:grid-cols-7">
            {plan.map((t) => (
              <li key={t.day} className="relative flex gap-3 lg:block">
                <div className="flex flex-col items-center">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-black text-white shadow-md shadow-brand-600/25">
                    D{t.day}
                  </span>
                  <span className="w-0.5 flex-1 bg-ink-200 lg:hidden" />
                </div>
                <div className="min-w-0 flex-1 pb-4 lg:pb-0">
                  <div className="h-full rounded-xl border border-ink-100 bg-ink-50/50 p-3 transition hover:border-brand-200 hover:bg-brand-50/40">
                    <p className="text-sm font-bold leading-snug text-ink-800">{t.focus}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-600">{t.task}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-700">
                      ⏱ {t.minutes} 分钟
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  )
}
