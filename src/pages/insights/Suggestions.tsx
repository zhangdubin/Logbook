import { Badge, Card } from '@/components/ui'

type Priority = '高' | '中' | '低'

const PRIORITY_META: Record<Priority, { tone: 'red' | 'amber' | 'green'; label: string }> = {
  高: { tone: 'red', label: '高优先级 · 立即执行' },
  中: { tone: 'amber', label: '中优先级 · 本周完成' },
  低: { tone: 'green', label: '低优先级 · 持续跟进' },
}

const ORDER: Priority[] = ['高', '中', '低']

export function Suggestions({
  items,
}: {
  items: { title: string; detail: string; priority: Priority }[]
}) {
  const grouped = ORDER.map((p) => ({
    priority: p,
    list: items.filter((s) => s.priority === p),
  })).filter((g) => g.list.length > 0)

  return (
    <Card title="行动建议" subtitle="按优先级分组，先做最关键的两三件事">
      {grouped.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-400">暂无行动建议</p>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <section key={group.priority}>
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={PRIORITY_META[group.priority].tone}>
                  {PRIORITY_META[group.priority].label}
                </Badge>
                <span className="text-[11px] text-ink-400">{group.list.length} 条</span>
              </div>
              <ol className="space-y-2.5">
                {group.list.map((s, i) => (
                  <li
                    key={`${s.title}-${i}`}
                    className="flex gap-3 rounded-xl border border-ink-100 bg-white p-3.5 transition hover:border-brand-200 hover:bg-brand-50/30"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-black text-brand-700">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink-800">{s.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-600">{s.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Card>
  )
}
