import { AlertBox, Badge, Card } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import type { InsightReport } from '@/lib/types'

interface ReportHeaderProps {
  report: InsightReport
  studentName?: string
  loading: boolean
  onRegenerate: () => void
  onExport: (format: 'xlsx' | 'csv') => void
  usingMock: boolean
}

export function ReportHeader({
  report,
  studentName,
  loading,
  onRegenerate,
  onExport,
  usingMock,
}: ReportHeaderProps) {
  return (
    <Card>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-2xl shadow-lg shadow-brand-500/25">
            🤖
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-black tracking-tight text-ink-900">
                AI 学情诊断报告
              </h1>
              <Badge tone={report.byModel ? 'violet' : 'slate'}>
                {report.byModel ? `模型：${report.model ?? '未知模型'}` : '本地启发式分析引擎'}
              </Badge>
              {usingMock && <Badge tone="amber">演示数据</Badge>}
            </div>
            <p className="mt-1 text-xs text-ink-400">
              生成时间 {formatDateTime(report.createdAt)}
              {studentName ? ` · 面向 ${studentName}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={loading}
            className="btn btn-outline btn-sm"
          >
            {loading ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" />
                生成中…
              </>
            ) : (
              '↻ 重新生成报告'
            )}
          </button>
          <button type="button" onClick={() => onExport('xlsx')} className="btn btn-primary btn-sm">
            ⬇ 导出 xlsx
          </button>
          <button type="button" onClick={() => onExport('csv')} className="btn btn-outline btn-sm">
            ⬇ 导出 csv
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/70 p-4">
        <p className="mb-1 text-xs font-bold text-brand-700">学情总评</p>
        <p className="text-sm leading-relaxed text-ink-700">{report.summary}</p>
      </div>

      {!report.byModel && (
        <div className="mt-3">
          <AlertBox tone="info" title="当前由本地启发式分析引擎生成">
            服务端未检测到可用的大模型密钥（环境变量未配置），本次报告由内置规则引擎基于错题统计推导得出：
            结论稳定可复现，但缺少大模型对题目本身的语义理解。建议在服务端配置模型密钥后点击「重新生成报告」，
            以获得更贴合学生个体的分析结论。
          </AlertBox>
        </div>
      )}
    </Card>
  )
}
