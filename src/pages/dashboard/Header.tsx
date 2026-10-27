import { useNavigate } from 'react-router-dom'
import { Avatar, Badge, Spinner, Tabs } from '@/components/ui'
import { useAuth } from '@/store/auth'
import type { Student } from '@/lib/types'
import { RANGE_TABS } from '@/pages/dashboard/types'
import type { RangeKey } from '@/pages/dashboard/types'

interface HeaderProps {
  student: Student | null
  range: RangeKey
  onRangeChange: (r: RangeKey) => void
  onExport: () => void
  questionCount: number
  usingMock: boolean
  /** 已有数据时的后台刷新状态 */
  refreshing?: boolean
}

export function DashboardHeader({
  student,
  range,
  onRangeChange,
  onExport,
  questionCount,
  usingMock,
  refreshing = false,
}: HeaderProps) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  return (
    <header className="card overflow-hidden">
      <div className="flex flex-col gap-4 bg-gradient-to-br from-brand-600 via-brand-600 to-brand-800 p-4 text-white sm:p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-lg font-black ring-1 ring-white/25">
            {student ? student.name.slice(0, 1) : '—'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-black tracking-tight">
                {student ? `${student.name} 的学情总览` : '学情总览'}
              </h1>
              {usingMock && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold ring-1 ring-white/30">
                  演示数据
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-white/75">
              {student
                ? [student.grade, student.school].filter(Boolean).join(' · ')
                : '尚未选择学生档案'}
              {questionCount > 0 && ` · 统计范围内共 ${questionCount} 道错题`}
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <Avatar name={student?.name ?? '未'} color="rgba(255,255,255,0.25)" size={34} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPermission('export:run') && (
            <button
              type="button"
              onClick={onExport}
              className="btn btn-sm border-white/25 bg-white/10 text-white hover:bg-white/20"
            >
              ⬇ 导出报告 (xlsx)
            </button>
          )}
          {hasPermission('report:read') && (
            <button
              type="button"
              onClick={() => navigate('/insights')}
              className="btn btn-sm bg-white text-brand-700 shadow-lg shadow-brand-900/20 hover:bg-brand-50"
            >
              🤖 查看 AI 诊断
            </button>
          )}
          {hasPermission('questions:create') && (
            <button
              type="button"
              onClick={() => navigate('/capture')}
              className="btn btn-sm border-white/25 bg-transparent text-white hover:bg-white/10"
            >
              📷 拍照录入
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-ink-100 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Tabs tabs={RANGE_TABS} value={range} onChange={onRangeChange} className="max-w-full" />
          {refreshing && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-brand-600">
              <Spinner size={13} /> 更新中
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-400">
          <Badge tone="blue">统计口径：按录入时间</Badge>
          <span>切换范围后图表与列表同步刷新</span>
        </div>
      </div>
    </header>
  )
}
