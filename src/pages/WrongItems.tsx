/**
 * pages/WrongItems —— 错题本（列表 + 多条件筛选 + 批量操作）
 * ---------------------------------------------------------------------------
 * 筛选条件支持 URL 同步：Dashboard 的「优先突破知识点」会跳到
 * /questions?knowledgePoint=xxx，用户手动改筛选也会写回地址栏（可分享 / 可回退）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ERROR_TYPES,
  ERROR_TYPE_COLOR,
  ERROR_TYPE_LABEL,
  REVIEW_STATUS_LABEL,
  SUBJECTS,
} from '@/lib/types'
import type { Question, ReviewStatus } from '@/lib/types'
import { DIFFICULTY_LABEL, SUBJECT_BG, formatDate, shortText } from '@/lib/format'
import { AlertBox, Badge, Card, EmptyState, Field, Modal, Progress, Skeleton } from '@/components/ui'
import { useToast } from '@/store/toast'
import { ModeBanner } from './entry/ModeBanner'
import { dataClient } from './entry/client'
import { useMediaQuery, useStudents } from './entry/hooks'

const PAGE_SIZE = 20

interface Filters {
  subject: string
  errorType: string
  status: string
  corrected: string
  knowledgePoint: string
  keyword: string
  startDate: string
  endDate: string
  studentId: string
}

const EMPTY_FILTERS: Filters = {
  subject: '',
  errorType: '',
  status: '',
  corrected: '',
  knowledgePoint: '',
  keyword: '',
  startDate: '',
  endDate: '',
  studentId: '',
}

function filtersFromParams(params: URLSearchParams): Filters {
  return {
    subject: params.get('subject') ?? '',
    errorType: params.get('errorType') ?? '',
    status: params.get('status') ?? '',
    corrected: params.get('corrected') ?? '',
    knowledgePoint: params.get('knowledgePoint') ?? '',
    keyword: params.get('keyword') ?? '',
    startDate: params.get('startDate') ?? '',
    endDate: params.get('endDate') ?? '',
    studentId: params.get('studentId') ?? '',
  }
}

function filtersToParams(filters: Filters): URLSearchParams {
  const sp = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v) sp.set(k, v)
  })
  return sp
}

export default function WrongItems() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { push } = useToast()
  const { students } = useStudents()
  const isMobile = useMediaQuery('(max-width: 767px)')

  const urlKey = searchParams.toString()
  const lastWritten = useRef<string | null>(null)

  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(searchParams))
  const [items, setItems] = useState<Question[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [knowledgeOptions, setKnowledgeOptions] = useState<string[]>([])
  const [stats, setStats] = useState({ total: 0, corrected: 0, mastery: 0, sampled: 0 })

  /* URL -> 筛选（外部跳转，如 Dashboard 的「优先突破知识点」） */
  useEffect(() => {
    if (lastWritten.current === urlKey) return
    lastWritten.current = urlKey
    setFilters(filtersFromParams(searchParams))
    setPage(1)
    setSelected([])
  }, [urlKey, searchParams])

  /* 知识点候选 */
  useEffect(() => {
    let alive = true
    void dataClient
      .getKnowledgePoints()
      .then((list) => {
        if (alive) setKnowledgeOptions(list.map((k) => k.name))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const queryParams = useMemo(
    () => ({
      subject: filters.subject || undefined,
      errorType: filters.errorType || undefined,
      status: filters.status || undefined,
      corrected: filters.corrected || undefined,
      knowledgePoint: filters.knowledgePoint || undefined,
      keyword: filters.keyword || undefined,
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      studentId: filters.studentId || undefined,
    }),
    [filters],
  )

  const loadPage = useCallback(
    async (target: number, append: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const res = await dataClient.listQuestions({
          ...queryParams,
          page: target,
          pageSize: PAGE_SIZE,
        })
        setItems((prev) => (append ? [...prev, ...res.items] : res.items))
        setTotal(res.total)
        setPage(target)
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载错题失败')
      } finally {
        setLoading(false)
      }
    },
    [queryParams],
  )

  /* 筛选变化 -> 重新拉第一页（文字输入做了防抖） */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPage(1, false)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [loadPage])

  /* 统计条：基于当前筛选的前 200 条 */
  useEffect(() => {
    let alive = true
    void dataClient
      .listQuestions({ ...queryParams, page: 1, pageSize: 200 })
      .then((res) => {
        if (!alive) return
        const corrected = res.items.filter((q) => q.corrected).length
        const mastery = res.items.length
          ? Math.round(res.items.reduce((sum, q) => sum + q.mastery, 0) / res.items.length)
          : 0
        setStats({ total: res.total, corrected, mastery, sampled: res.items.length })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [queryParams])

  const apply = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    setSelected([])
    const sp = filtersToParams(next)
    lastWritten.current = sp.toString()
    setSearchParams(sp, { replace: true })
  }

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS)
    setSelected([])
    lastWritten.current = ''
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  const activeCount = Object.entries(filters).filter(([, v]) => v).length

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  /* ------------------------------ 批量操作 ------------------------------ */
  const bulkMarkCorrected = async () => {
    setBulkBusy(true)
    try {
      await Promise.all(selected.map((id) => dataClient.markCorrected(id, true)))
      push(`已标记 ${selected.length} 道题为「已订正」 ✅`, 'success')
      setSelected([])
      await loadPage(1, false)
    } catch (e) {
      push(e instanceof Error ? e.message : '批量标记失败', 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  const bulkDelete = async () => {
    setBulkBusy(true)
    try {
      await Promise.all(selected.map((id) => dataClient.deleteQuestion(id)))
      push(`已删除 ${selected.length} 道题`, 'success')
      setSelected([])
      setConfirmDelete(false)
      await loadPage(1, false)
    } catch (e) {
      push(e instanceof Error ? e.message : '批量删除失败', 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4 pb-24">
      <ModeBanner />

      {/* ---------------- 统计条 ---------------- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold text-ink-400">筛选结果</p>
          <p className="mt-1 text-2xl font-black text-ink-900">{stats.total}</p>
          <p className="text-[11px] text-ink-400">道错题{activeCount > 0 ? ` · ${activeCount} 个条件` : ''}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold text-ink-400">已订正</p>
          <p className="mt-1 text-2xl font-black text-emerald-600">{stats.corrected}</p>
          <p className="text-[11px] text-ink-400">
            占比 {stats.sampled ? Math.round((stats.corrected / stats.sampled) * 100) : 0}%
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[11px] font-bold text-ink-400">平均掌握度</p>
          <p className="mt-1 text-2xl font-black text-brand-600">{stats.mastery}%</p>
          <div className="mt-1.5">
            <Progress value={stats.mastery} />
          </div>
        </div>
      </div>

      {/* ---------------- 筛选栏 ---------------- */}
      <Card
        title="筛选条件"
        subtitle="多个条件之间是「并且」关系，可以叠加使用"
        extra={
          activeCount > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
              清空（{activeCount}）
            </button>
          ) : null
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="学科">
            <select
              className="select"
              value={filters.subject}
              onChange={(e) => apply({ subject: e.target.value })}
            >
              <option value="">全部学科</option>
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>

          <Field label="错因类型">
            <select
              className="select"
              value={filters.errorType}
              onChange={(e) => apply({ errorType: e.target.value })}
            >
              <option value="">全部错因</option>
              {ERROR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ERROR_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="掌握状态">
            <select
              className="select"
              value={filters.status}
              onChange={(e) => apply({ status: e.target.value })}
            >
              <option value="">全部状态</option>
              {(Object.keys(REVIEW_STATUS_LABEL) as ReviewStatus[]).map((s) => (
                <option key={s} value={s}>
                  {REVIEW_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="订正状态">
            <select
              className="select"
              value={filters.corrected}
              onChange={(e) => apply({ corrected: e.target.value })}
            >
              <option value="">不限</option>
              <option value="true">已订正</option>
              <option value="false">未订正</option>
            </select>
          </Field>

          <Field label="知识点" hint="可以直接输入，也可以从下拉里选">
            <input
              className="input"
              list="kp-options"
              value={filters.knowledgePoint}
              placeholder="如 小数乘法"
              onChange={(e) => apply({ knowledgePoint: e.target.value })}
            />
            <datalist id="kp-options">
              {knowledgeOptions.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </Field>

          <Field label="关键词" hint="搜索题干、答案、来源">
            <input
              className="input"
              value={filters.keyword}
              placeholder="如 通分 / 计算"
              onChange={(e) => apply({ keyword: e.target.value })}
            />
          </Field>

          <Field label="开始日期">
            <input
              type="date"
              className="input"
              value={filters.startDate}
              onChange={(e) => apply({ startDate: e.target.value })}
            />
          </Field>

          <Field label="结束日期">
            <input
              type="date"
              className="input"
              value={filters.endDate}
              onChange={(e) => apply({ endDate: e.target.value })}
            />
          </Field>
        </div>

        {students.length > 1 && (
          <div className="mt-3">
            <Field label="学生">
              <select
                className="select sm:max-w-xs"
                value={filters.studentId}
                onChange={(e) => apply({ studentId: e.target.value })}
              >
                <option value="">全部学生</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.grade}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Card>

      {/* ---------------- 批量操作条 ---------------- */}
      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-[76px] z-40 px-4 lg:bottom-6">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl bg-ink-900/95 px-4 py-3 shadow-pop backdrop-blur">
            <span className="text-xs font-bold text-white">已选 {selected.length} 道</span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="btn btn-sm border-0 bg-white/15 text-white hover:bg-white/25"
                onClick={() => void bulkMarkCorrected()}
                disabled={bulkBusy}
              >
                ✓ 标记已订正
              </button>
              <button
                type="button"
                className="btn btn-sm border-0 bg-red-500/90 text-white hover:bg-red-500"
                onClick={() => setConfirmDelete(true)}
                disabled={bulkBusy}
              >
                🗑 删除
              </button>
              <button type="button" className="btn btn-sm border-0 text-white/70" onClick={() => setSelected([])}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 列表 ---------------- */}
      {error && (
        <AlertBox tone="error" title="加载失败">
          <p>{error}</p>
          <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => void loadPage(page, false)}>
            重试
          </button>
        </AlertBox>
      )}

      {loading && items.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card space-y-3 p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="📭"
            title="这里还没有错题"
            description={
              activeCount > 0
                ? '当前筛选条件下没有匹配的错题，换个条件试试，或者清空筛选。'
                : '拍一张错题照片，AI 会帮你识别题目、分析错因，并自动整理到错题本。'
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {activeCount > 0 && (
                  <button type="button" className="btn btn-outline" onClick={resetFilters}>
                    清空筛选
                  </button>
                )}
                <button type="button" className="btn btn-primary" onClick={() => navigate('/capture')}>
                  📷 拍照录入第一道题
                </button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((q) => {
              const errorColor = ERROR_TYPE_COLOR[q.errorType] ?? '#64748b'
              const checked = selected.includes(q.id)
              return (
                <article
                  key={q.id}
                  onClick={() => navigate(`/questions/${q.id}`)}
                  className={`card card-hover cursor-pointer p-4 transition ${checked ? 'ring-2 ring-brand-400' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(q.id)}
                      className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
                      aria-label="选择这道题"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`tag ring-1 ${SUBJECT_BG[q.subject] ?? 'bg-ink-50 text-ink-600 ring-ink-200'}`}>
                          {q.subject}
                        </span>
                        <Badge tone="slate">{q.questionType}</Badge>
                        <span
                          className="tag ring-1"
                          style={{
                            background: `${errorColor}14`,
                            color: errorColor,
                            boxShadow: `inset 0 0 0 1px ${errorColor}33`,
                          }}
                        >
                          {ERROR_TYPE_LABEL[q.errorType]}
                        </span>
                        {q.corrected && <Badge tone="green">已订正</Badge>}
                      </div>

                      <p className="mt-2 line-clamp-2 text-sm font-semibold leading-relaxed text-ink-800">
                        {shortText(q.stem, 70) || '（未填写题干）'}
                      </p>

                      {q.knowledgePoints.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {q.knowledgePoints.slice(0, 3).map((kp) => (
                            <span key={kp} className="tag bg-ink-50 text-ink-600 ring-1 ring-ink-200">
                              {kp}
                            </span>
                          ))}
                          {q.knowledgePoints.length > 3 && (
                            <span className="tag bg-ink-50 text-ink-400 ring-1 ring-ink-200">
                              +{q.knowledgePoints.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="mt-3 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-ink-400">
                            <span>掌握度 {q.mastery}%</span>
                            <span>难度 {DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty}</span>
                          </div>
                          <Progress value={q.mastery} color={errorColor} height={6} />
                        </div>
                        {q.images?.[0]?.url && (
                          <img
                            src={q.images[0].url}
                            alt="错题照片"
                            className="h-12 w-16 shrink-0 rounded-lg border border-ink-200 object-cover"
                          />
                        )}
                      </div>

                      <p className="mt-2 text-[11px] text-ink-400">
                        {formatDate(q.createdAt)}
                        {q.studentName ? ` · ${q.studentName}` : ''}
                        {q.source ? ` · ${q.source}` : ''}
                      </p>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          {/* 分页 / 加载更多 */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-ink-400">
              已显示 {items.length} / {total} 道
            </p>
            {isMobile ? (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void loadPage(page + 1, true)}
                disabled={loading || items.length >= total}
              >
                {loading ? '加载中…' : items.length >= total ? '没有更多了' : '加载更多'}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={page <= 1 || loading}
                  onClick={() => void loadPage(page - 1, false)}
                >
                  上一页
                </button>
                <span className="text-xs font-semibold text-ink-500">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => void loadPage(page + 1, false)}
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 批量删除二次确认 */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="确认删除？"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setConfirmDelete(false)}>
              再想想
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void bulkDelete()} disabled={bulkBusy}>
              {bulkBusy ? '删除中…' : `删除 ${selected.length} 道题`}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          即将删除选中的 <span className="font-bold text-ink-900">{selected.length}</span> 道错题，
          删除后无法恢复。
        </p>
        <p className="mt-2 text-xs text-ink-400">如果只是想标记完成，建议用「标记已订正」。</p>
      </Modal>
    </div>
  )
}
