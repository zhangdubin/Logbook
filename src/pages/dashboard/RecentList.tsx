import { useNavigate } from 'react-router-dom'
import { Badge, Card } from '@/components/ui'
import { kpNames } from '@/pages/entry/kpShape'
import { ERROR_TYPE_COLOR, ERROR_TYPE_LABEL } from '@/lib/types'
import { SUBJECT_BG, formatDate } from '@/lib/format'
import type { Question } from '@/lib/types'

export function RecentQuestions({ items }: { items: Question[] }) {
  const navigate = useNavigate()

  return (
    <Card
      title="最近录入的错题"
      subtitle="点击任意一条查看题目详情与 AI 解析"
      extra={
        <button
          type="button"
          onClick={() => navigate('/questions')}
          className="btn btn-ghost btn-sm text-brand-700"
        >
          查看全部 →
        </button>
      }
    >
      {items.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-400">该时间段内还没有录入错题</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {items.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => navigate(`/questions/${q.id}`)}
                className="group w-full rounded-lg px-1 py-3 text-left transition hover:bg-ink-50"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`tag shrink-0 ring-1 ${SUBJECT_BG[q.subject] ?? 'bg-ink-50 text-ink-600 ring-ink-200'}`}
                  >
                    {q.subject}
                  </span>
                  <span className="truncate text-sm font-bold text-ink-800 group-hover:text-brand-700">
                    {kpNames(q.knowledgePoints)[0] ?? '未归类知识点'}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-ink-400">
                    {formatDate(q.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-500">{q.stem}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone="slate" className="gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: ERROR_TYPE_COLOR[q.errorType] }}
                    />
                    {ERROR_TYPE_LABEL[q.errorType]}
                  </Badge>
                  <Badge tone={q.mastery >= 70 ? 'green' : q.mastery >= 50 ? 'amber' : 'red'}>
                    掌握度 {q.mastery}%
                  </Badge>
                  {q.corrected ? (
                    <Badge tone="green">已订正</Badge>
                  ) : (
                    <Badge tone="amber">待复盘</Badge>
                  )}
                  <span className="text-[11px] text-ink-400">{q.questionType}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
