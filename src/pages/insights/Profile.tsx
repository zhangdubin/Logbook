import { Badge, Card } from '@/components/ui'

interface Item {
  title: string
  detail: string
  evidence: string
  subject?: string
}

function ItemList({ items, tone }: { items: Item[]; tone: 'good' | 'bad' }) {
  const isGood = tone === 'good'
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li
          key={item.title}
          className={`rounded-xl border p-3 ${
            isGood ? 'border-emerald-100 bg-emerald-50/50' : 'border-red-100 bg-red-50/50'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-ink-800">{item.title}</p>
            {item.subject && (
              <Badge tone={isGood ? 'green' : 'red'} className="shrink-0">
                {item.subject}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">{item.detail}</p>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
            <span aria-hidden className="mt-px">
              📌
            </span>
            <span>{item.evidence}</span>
          </p>
        </li>
      ))}
    </ul>
  )
}

export function StrengthWeakness({
  strengths,
  weaknesses,
}: {
  strengths: Item[]
  weaknesses: Item[]
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="优势画像"
        subtitle="保持并放大的部分"
        extra={<Badge tone="green">{strengths.length} 项</Badge>}
      >
        {strengths.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-400">暂无优势项</p>
        ) : (
          <ItemList items={strengths} tone="good" />
        )}
      </Card>

      <Card
        title="薄弱画像"
        subtitle="需要优先补强的部分"
        extra={<Badge tone="red">{weaknesses.length} 项</Badge>}
      >
        {weaknesses.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-400">暂无薄弱项</p>
        ) : (
          <ItemList items={weaknesses} tone="bad" />
        )}
      </Card>
    </div>
  )
}
