/**
 * pages/ItemDetail —— 错题详情 + AI 智能分析报告
 * ---------------------------------------------------------------------------
 * 上半部分：题目本身（照片、题干、选项对照、知识点）
 * 下半部分：AI 归因报告（归因结论 / 根因链 / 正确解法 / 补强点 / 建议 / 同类题 / 7 天计划）
 * 底部：订正、编辑、删除、再拍一张同类题
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ERROR_TYPE_COLOR, ERROR_TYPE_LABEL, REVIEW_STATUS_LABEL } from '@/lib/types'
import type { Question } from '@/lib/types'
import { DIFFICULTY_LABEL, SUBJECT_BG, formatDateTime, nextReviewDate } from '@/lib/format'
import { AlertBox, Badge, Card, Modal, Progress, Spinner } from '@/components/ui'
import { useToast } from '@/store/toast'
import { AnalysisPanel } from './entry/AnalysisPanel'
import { ModeBanner } from './entry/ModeBanner'
import { dataClient } from './entry/client'

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function splitAnswers(value?: string): string[] {
  return (value ?? '')
    .split(/[,，、\s]+/)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
}

export default function ItemDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { push } = useToast()

  const [question, setQuestion] = useState<Question | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const q = await dataClient.getQuestion(id)
      setQuestion(q)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载错题失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  /* ------------------------------ 操作 ------------------------------ */
  const runAnalyze = async () => {
    if (!question) return
    setAnalyzing(true)
    try {
      const analysis = await dataClient.analyzeQuestion(question.id)
      setQuestion((prev) => (prev ? { ...prev, aiAnalysis: analysis } : prev))
      push('AI 分析完成 ✅', 'success')
    } catch (e) {
      push(e instanceof Error ? e.message : 'AI 分析失败，请稍后再试', 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  const toggleCorrected = async () => {
    if (!question) return
    setBusy(true)
    try {
      const next = await dataClient.markCorrected(question.id, !question.corrected)
      setQuestion(next)
      push(next.corrected ? '已标记为「已订正」 ✅' : '已取消订正标记', 'success')
    } catch (e) {
      push(e instanceof Error ? e.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!question) return
    setBusy(true)
    try {
      await dataClient.deleteQuestion(question.id)
      push('已删除该错题', 'success')
      setConfirmDelete(false)
      navigate('/questions')
    } catch (e) {
      push(e instanceof Error ? e.message : '删除失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------------ 渲染 ------------------------------ */
  if (loading) {
    return (
      <Card title="错题详情">
        <div className="flex items-center gap-2 py-10 text-sm text-ink-500">
          <Spinner /> 正在加载…
        </div>
      </Card>
    )
  }

  if (error || !question) {
    return (
      <div className="space-y-4">
        <AlertBox tone="error" title="没找到这道错题">
          <p>{error ?? '可能已经被删除，或者链接有误。'}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void load()}>
              重试
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/questions')}>
              回到错题本
            </button>
          </div>
        </AlertBox>
      </div>
    )
  }

  const q = question
  const errorColor = ERROR_TYPE_COLOR[q.errorType] ?? '#64748b'
  const correctLetters = splitAnswers(q.correctAnswer)
  const myLetters = splitAnswers(q.myAnswer)
  const reviewAt = q.nextReviewAt ? new Date(q.nextReviewAt) : nextReviewDate(q.mastery)

  return (
    <div className="space-y-4 pb-6">
      <ModeBanner />

      {/* ---------------- 顶部操作条 ---------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/questions')}>
          ← 返回错题本
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className={q.corrected ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm'}
            onClick={() => void toggleCorrected()}
            disabled={busy}
          >
            {q.corrected ? '↩ 取消订正标记' : '✓ 标记已订正'}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`/manual?edit=${q.id}`)}>
            ✏️ 编辑
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`/manual?copyFrom=${q.id}`)}>
            📋 复制为新题
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/capture')}>
            📷 再拍一张
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
            🗑 删除
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* ---------------- 左栏：题目 ---------------- */}
        <div className="space-y-4">
          <Card
            title={`${q.subject} · ${q.questionType}`}
            subtitle={q.source ? `来源：${q.source}` : undefined}
            extra={
              <div className="flex flex-wrap gap-1.5">
                <span className={`tag ring-1 ${SUBJECT_BG[q.subject] ?? 'bg-ink-50 text-ink-600 ring-ink-200'}`}>
                  {q.subject}
                </span>
                <Badge tone="slate">{REVIEW_STATUS_LABEL[q.status]}</Badge>
              </div>
            }
          >
            <div className="space-y-4">
              {/* 照片 */}
              {q.images?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {q.images.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setPreview(img.url || img.dataUrl || '')}
                      className="overflow-hidden rounded-xl border border-ink-200 transition hover:border-brand-300"
                    >
                      <img
                        src={img.url || img.dataUrl}
                        alt="错题照片"
                        className="h-28 w-auto max-w-[220px] object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* 题干 */}
              <div>
                <p className="label">题干</p>
                <p className="whitespace-pre-wrap rounded-xl bg-ink-50/70 p-3 text-sm leading-relaxed text-ink-800">
                  {q.stem || '（未填写题干）'}
                </p>
              </div>

              {/* 选项对照 */}
              {q.options && q.options.length > 0 && (
                <div>
                  <p className="label">选项对照</p>
                  <div className="space-y-1.5">
                    {q.options.map((opt, idx) => {
                      const letter = OPTION_LETTERS[idx] ?? String(idx + 1)
                      const isCorrect =
                        correctLetters.includes(letter) || q.correctAnswer?.trim() === opt.trim()
                      const isMine = myLetters.includes(letter) || q.myAnswer?.trim() === opt.trim()
                      return (
                        <div
                          key={idx}
                          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
                            isCorrect
                              ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
                              : isMine
                                ? 'border-red-200 bg-red-50/80 text-red-900'
                                : 'border-ink-200 bg-white text-ink-700'
                          }`}
                        >
                          <span className="font-bold">{letter}.</span>
                          <span className="min-w-0 flex-1">{opt}</span>
                          <span className="flex shrink-0 gap-1">
                            {isCorrect && <span className="tag bg-emerald-100 text-emerald-700">正确答案</span>}
                            {isMine && !isCorrect && <span className="tag bg-red-100 text-red-700">你的选择</span>}
                            {isMine && isCorrect && <span className="tag bg-ink-100 text-ink-600">你也选了</span>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 答案对比 */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-red-100 bg-red-50/70 p-3">
                  <p className="text-[11px] font-bold text-red-500">我的答案</p>
                  <p className="mt-1 text-sm font-bold text-red-700">{q.myAnswer || '未填写'}</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                  <p className="text-[11px] font-bold text-emerald-600">正确答案</p>
                  <p className="mt-1 text-sm font-bold text-emerald-700">{q.correctAnswer || '未填写'}</p>
                </div>
              </div>

              {/* 知识点 / 错因 */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="label">知识点</p>
                  <div className="flex flex-wrap gap-1.5">
                    {q.knowledgePoints.length ? (
                      q.knowledgePoints.map((kp) => (
                        <span key={kp} className="tag bg-brand-50 text-brand-700 ring-1 ring-brand-200">
                          {kp}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-ink-400">未标注</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="label">错因类型</p>
                  <div className="flex flex-wrap items-center gap-1.5">
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
                    <span className="text-xs text-ink-400">
                      难度 {DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty}
                    </span>
                  </div>
                </div>
              </div>

              {q.errorDetail && (
                <div>
                  <p className="label">错因详述</p>
                  <p className="whitespace-pre-wrap rounded-xl bg-amber-50/70 p-3 text-sm leading-relaxed text-amber-900">
                    {q.errorDetail}
                  </p>
                </div>
              )}

              {/* 掌握度 */}
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-ink-500">
                  <span>掌握度</span>
                  <span>{q.mastery}%</span>
                </div>
                <Progress value={q.mastery} color={errorColor} />
                <p className="mt-1 text-[11px] text-ink-400">
                  {q.mastery >= 80
                    ? '掌握得很稳，保持每周回看一次即可'
                    : q.mastery >= 50
                      ? '基本会了，还需要一两次巩固'
                      : '还没掌握，建议本周重点订正'}
                </p>
              </div>
            </div>
          </Card>

          {/* 时间线 */}
          <Card title="时间线">
            <ol className="space-y-3 border-l-2 border-ink-100 pl-4">
              <li className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
                <p className="text-sm font-semibold text-ink-800">录入错题</p>
                <p className="text-xs text-ink-400">{formatDateTime(q.createdAt)}</p>
              </li>
              {q.reviewedAt && (
                <li className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <p className="text-sm font-semibold text-ink-800">完成订正</p>
                  <p className="text-xs text-ink-400">{formatDateTime(q.reviewedAt)}</p>
                </li>
              )}
              <li className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500" />
                <p className="text-sm font-semibold text-ink-800">下次复习</p>
                <p className="text-xs text-ink-400">
                  {formatDateTime(reviewAt.toISOString())}
                  <span className="ml-1 text-ink-300">
                    （按掌握度 {q.mastery}% 推荐，{q.mastery >= 80 ? '一周后' : q.mastery >= 50 ? '三天后' : '明天'}）
                  </span>
                </p>
              </li>
              {q.updatedAt && q.updatedAt !== q.createdAt && (
                <li className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-ink-300" />
                  <p className="text-sm font-semibold text-ink-800">最近修改</p>
                  <p className="text-xs text-ink-400">{formatDateTime(q.updatedAt)}</p>
                </li>
              )}
            </ol>
          </Card>
        </div>

        {/* ---------------- 右栏：AI 分析 ---------------- */}
        <Card
          title="AI 智能分析"
          subtitle={q.aiAnalysis ? '基于这道题的作答痕迹生成' : '还没有分析结果'}
          extra={
            q.aiAnalysis ? (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void runAnalyze()} disabled={analyzing}>
                {analyzing ? '分析中…' : '↻ 重新分析'}
              </button>
            ) : null
          }
        >
          <AnalysisPanel
            analysis={q.aiAnalysis}
            loading={analyzing}
            onAnalyze={() => void runAnalyze()}
          />
        </Card>
      </div>

      {/* 大图预览 */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title="错题照片" size="lg">
        {preview && <img src={preview} alt="错题照片" className="w-full rounded-xl" />}
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="确认删除这道错题？"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setConfirmDelete(false)}>
              再想想
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
              {busy ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          删除后这道题和它的 AI 分析记录都会消失，无法恢复。
        </p>
        <p className="mt-2 text-xs text-ink-400">如果只是做完了，建议点「标记已订正」保留记录。</p>
      </Modal>
    </div>
  )
}
