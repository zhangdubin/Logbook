import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { AlertBox, Card, EmptyState, Skeleton } from '@/components/ui'
import { ReportHeader } from '@/pages/insights/ReportHeader'
import { StrengthWeakness } from '@/pages/insights/Profile'
import { RiskSubjects } from '@/pages/insights/RiskSubjects'
import { Suggestions } from '@/pages/insights/Suggestions'
import { WeeklyPlan } from '@/pages/insights/WeeklyPlan'
import { ParentNotes } from '@/pages/insights/ParentNotes'
import { useReport } from '@/pages/insights/useReport'
import { useApp } from '@/store/app'
import { useToast } from '@/store/toast'

export default function Insights() {
  const { report, loading, error, usingMock, reload } = useReport()
  const { currentStudentId, currentStudent } = useApp()
  const navigate = useNavigate()
  const toast = useToast()

  const handleExport = useCallback(
    (format: 'xlsx' | 'csv') => {
      const url = api.exportUrl(currentStudentId || undefined, format)
      window.open(url, '_blank', 'noopener')
      toast.push(`正在生成 ${format.toUpperCase()} 统计报告…`, 'info')
    },
    [currentStudentId, toast],
  )

  if (loading && !report) return <ReportSkeleton />

  if (!report) {
    return (
      <div className="space-y-4">
        <AlertBox tone="error" title="诊断报告加载失败">
          <p>{error ?? '未知错误'}</p>
          <button type="button" onClick={reload} className="mt-1 font-bold underline">
            重新生成
          </button>
        </AlertBox>
        <Card>
          <EmptyState
            icon="🤖"
            title="暂时无法生成学情诊断"
            description="请确认后端服务已启动，并已为该学生录入至少一条错题。"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={reload} className="btn btn-primary btn-sm">
                  ↻ 重新生成报告
                </button>
                <button type="button" onClick={() => navigate('/capture')} className="btn btn-outline btn-sm">
                  📷 先去录入错题
                </button>
              </div>
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {error && usingMock && (
        <AlertBox tone="warning" title="接口暂未就绪，已展示演示版诊断报告">
          <p>{error}</p>
          <p className="mt-1">
            报告结构与真实接口完全一致，服务端恢复后点击
            <button type="button" onClick={reload} className="mx-1 font-bold underline">
              重新生成
            </button>
            即可获取真实分析结果。
          </p>
        </AlertBox>
      )}

      <ReportHeader
        report={report}
        studentName={report.studentName ?? currentStudent?.name}
        loading={loading}
        onRegenerate={reload}
        onExport={handleExport}
        usingMock={usingMock}
      />

      <StrengthWeakness strengths={report.strengths} weaknesses={report.weaknesses} />

      <div className="grid gap-4 xl:grid-cols-2">
        <RiskSubjects items={report.riskSubjects} />
        <WeeklyPlan plan={report.weeklyPlan} />
      </div>

      <Suggestions items={report.suggestions} />

      <ParentNotes notes={report.parentNotes} />
    </div>
  )
}

/** 加载骨架 */
function ReportSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-5">
      <Card>
        <div className="flex items-start gap-3">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-9/12" />
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <div className="space-y-3">
              <Skeleton className="h-4 w-28" />
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton key={j} className="h-16 w-full" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
