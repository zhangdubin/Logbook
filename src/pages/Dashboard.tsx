import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { AlertBox, Card, EmptyState, Skeleton } from '@/components/ui'
import { DashboardHeader } from '@/pages/dashboard/Header'
import { KpiRow, KpiSkeleton } from '@/pages/dashboard/Kpis'
import { DashboardCharts } from '@/pages/dashboard/Charts'
import { WeakPoints } from '@/pages/dashboard/WeakPoints'
import { RecentQuestions } from '@/pages/dashboard/RecentList'
import { useDisplayStudent, useOverview } from '@/pages/dashboard/useOverview'
import type { RangeKey } from '@/pages/dashboard/types'
import { useApp } from '@/store/app'
import { useToast } from '@/store/toast'

export default function Dashboard() {
  const [range, setRange] = useState<RangeKey>('30d')
  const { data, loading, error, usingMock, reload } = useOverview(range)
  const student = useDisplayStudent()
  const { currentStudentId } = useApp()
  const navigate = useNavigate()
  const toast = useToast()

  const handleExport = useCallback(() => {
    const url = api.exportUrl(currentStudentId || undefined, 'xlsx')
    window.open(url, '_blank', 'noopener')
    toast.push('正在生成 xlsx 统计报告…', 'info')
  }, [currentStudentId, toast])

  const isEmpty = !!data && data.totals.questions === 0

  return (
    <div className="space-y-4 sm:space-y-5">
      <DashboardHeader
        student={student}
        range={range}
        onRangeChange={setRange}
        onExport={handleExport}
        questionCount={data?.totals.questions ?? 0}
        usingMock={usingMock}
        refreshing={loading && !!data}
      />

      {error && (
        <AlertBox tone={usingMock ? 'warning' : 'error'} title={usingMock ? '接口暂未就绪，已切换为演示数据' : '统计数据加载失败'}>
          <p>{error}</p>
          {usingMock ? (
            <p className="mt-1">
              下方展示的是本地演示数据（结构与真实接口完全一致）。后端服务恢复后点击
              <button type="button" onClick={reload} className="mx-1 font-bold underline">
                重新加载
              </button>
              即可切换回真实数据。
            </p>
          ) : (
            <button type="button" onClick={reload} className="mt-1 font-bold underline">
              重新加载
            </button>
          )}
        </AlertBox>
      )}

      {loading && !data ? (
        <DashboardSkeleton />
      ) : isEmpty ? (
        <Card>
          <EmptyState
            icon="📷"
            title="还没有错题数据"
            description="拍照录入或手动补录错题后，这里会展示学科分布、错因构成、掌握度趋势与优先突破知识点。"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => navigate('/capture')} className="btn btn-primary btn-sm">
                  📷 拍照录入错题
                </button>
                <button type="button" onClick={() => navigate('/manual')} className="btn btn-outline btn-sm">
                  ✍️ 手动补录
                </button>
              </div>
            }
          />
        </Card>
      ) : data ? (
        <>
          <KpiRow data={data} />

          <DashboardCharts data={data} />

          <div className="grid gap-4 lg:grid-cols-2">
            <WeakPoints data={data} />
            <RecentQuestions items={data.recent} />
          </div>
        </>
      ) : null}
    </div>
  )
}

/** 加载中的骨架屏 */
function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-5">
      <KpiSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <div className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-32 w-full" />
            </div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <div className="space-y-3">
              <Skeleton className="h-4 w-28" />
              {Array.from({ length: 4 }).map((__, j) => (
                <Skeleton key={j} className="h-9 w-full" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
