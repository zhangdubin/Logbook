import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { useApp } from '@/store/app'
import { useToast } from '@/store/toast'
import type { Question } from '@/lib/types'
import { AlertBox, Badge, Card, EmptyState, Progress, Spinner } from '@/components/ui'
import { kpNames } from '@/pages/entry/kpShape'
import { DIFFICULTY_LABEL, subjectColor } from '@/lib/format'

type Mode = 'due' | 'weak' | 'random'

const MODE_LABEL: Record<Mode, string> = {
  due: '今日到期',
  weak: '全部未掌握',
  random: '随机 10 题',
}

interface Result {
  questionId: string
  action: 'corrected' | 'skipped'
}

export function ReviewSession() {
  const { currentStudentId, currentStudent } = useApp()
  const { push } = useToast()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('due')
  const [pool, setPool] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [analyzing, setAnalyzing] = useState(false)

  const load = useCallback(async () => {
    if (!currentStudentId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await api.listQuestions({ studentId: currentStudentId, pageSize: 200 })
      const items = res.items ?? []
      const now = Date.now()
      const due = items
        .filter((q) => q.nextReviewAt && new Date(q.nextReviewAt).getTime() <= now)
        .sort((a, b) => a.mastery - b.mastery)
      const weak = items
        .filter((q) => q.status !== 'mastered')
        .sort((a, b) => a.mastery - b.mastery)
      const random = [...items].sort(() => Math.random() - 0.5).slice(0, 10)
      setPool(
        mode === 'due' ? due : mode === 'weak' ? weak : random,
      )
      setIndex(0)
      setRevealed(false)
      setResults([])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载复习题库失败')
      setPool([])
    } finally {
      setLoading(false)
    }
  }, [currentStudentId, mode])

  useEffect(() => {
    void load()
  }, [load])

  const current = pool[index]
  const finished = index >= pool.length

  const progress = useMemo(
    () => (pool.length ? Math.round((index / pool.length) * 100) : 0),
    [index, pool.length],
  )

  async function handleCorrected() {
    if (!current || busy) return
    setBusy(true)
    try {
      await api.markCorrected(current.id, true)
      push('已记录订正，掌握度已提升 ✅', 'success')
      setResults((prev) => [...prev, { questionId: current.id, action: 'corrected' }])
      setIndex((i) => i + 1)
      setRevealed(false)
    } catch (e) {
      push(e instanceof Error ? e.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  function handleSkip() {
    if (!current) return
    setResults((prev) => [...prev, { questionId: current.id, action: 'skipped' }])
    setIndex((i) => i + 1)
    setRevealed(false)
  }

  async function handleAnalyze() {
    if (!current || analyzing) return
    setAnalyzing(true)
    try {
      await api.analyzeQuestion(current.id)
      push('AI 分析完成', 'success')
      await load()
    } catch (e) {
      push(e instanceof Error ? e.message : 'AI 分析失败', 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  /* ---------------- 加载中 ---------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-sm text-ink-500">
        <Spinner /> 正在准备复习题库…
      </div>
    )
  }

  /* ---------------- 无数据 ---------------- */
  if (!currentStudentId) {
    return (
      <Card>
        <EmptyState
          icon="👦"
          title="请先选择学生"
          description="在顶部切换或到「学生档案」新增一个学生后开始复习。"
          action={
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/students')}>
              去新增学生
            </button>
          }
        />
      </Card>
    )
  }

  if (error && pool.length === 0) {
    return (
      <AlertBox tone="error" title="题库加载失败">
        {error}
        <div className="mt-2">
          <button className="btn btn-outline btn-sm" onClick={() => void load()}>
            重试
          </button>
        </div>
      </AlertBox>
    )
  }

  /* ---------------- 完成 ---------------- */
  if (finished) {
    const correctedCount = results.filter((r) => r.action === 'corrected').length
    const skipped = results.length - correctedCount
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="text-5xl">🎉</span>
            <h2 className="text-lg font-black text-ink-900">
              {pool.length === 0 ? '暂无需要复习的错题' : '本轮复习完成'}
            </h2>
            {pool.length > 0 && (
              <p className="text-sm text-ink-500">
                共复习 <b className="text-ink-800">{results.length}</b> 题，其中{' '}
                <b className="text-emerald-600">{correctedCount}</b> 题已订正
                {skipped > 0 && `，${skipped} 题留待下次`}
              </p>
            )}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <button className="btn btn-primary" onClick={() => void load()}>
                再来一轮
              </button>
              <button className="btn btn-outline" onClick={() => navigate('/')}>
                回到学情总览
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/capture')}>
                📷 继续录入
              </button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  /* ---------------- 复习卡片 ---------------- */
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 顶部：模式 + 进度 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-ink-100/70 p-1">
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                mode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs font-bold text-ink-500">
          {index + 1} / {pool.length}
        </span>
      </div>
      <Progress value={progress} />

      <Card bodyClassName="p-4 sm:p-6">
        {/* 题头 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span
            className="tag ring-1"
            style={{
              background: `${subjectColor(current.subject)}1a`,
              color: subjectColor(current.subject),
              borderColor: `${subjectColor(current.subject)}33`,
            }}
          >
            {current.subject}
          </span>
          <Badge tone="slate">{current.questionType}</Badge>
          <Badge tone="slate">{DIFFICULTY_LABEL[current.difficulty] ?? '中等'}</Badge>
          {kpNames(current.knowledgePoints).map((k) => (
            <Badge key={k} tone="blue">
              {k}
            </Badge>
          ))}
        </div>

        {/* 题干 */}
        <p className="whitespace-pre-wrap text-[15px] leading-7 text-ink-800">{current.stem}</p>

        {/* 选项 */}
        {current.options?.length ? (
          <ul className="mt-3 space-y-1.5">
            {current.options.map((opt, i) => {
              const text = String(opt)
              const letter = /^[A-Da-d]/.test(text) ? text.slice(0, 1) : String.fromCharCode(65 + i)
              const body = /^[A-Da-d]/.test(text) ? text.slice(1).replace(/^[.、．)]/, '') : text
              const isCorrect =
                revealed && current.correctAnswer?.toUpperCase().includes(letter.toUpperCase())
              const isMine = revealed && current.myAnswer?.toUpperCase().includes(letter.toUpperCase())
              return (
                <li
                  key={i}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${
                    isCorrect
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                      : isMine
                        ? 'border-red-300 bg-red-50 text-red-800'
                        : 'border-ink-200 bg-white text-ink-700'
                  }`}
                >
                  <b className="mr-1.5">{letter}.</b>
                  {body}
                  {revealed && isCorrect && <span className="ml-2 text-xs font-bold">✓ 正确</span>}
                  {revealed && isMine && !isCorrect && (
                    <span className="ml-2 text-xs font-bold">✗ 你选的</span>
                  )}
                </li>
              )
            })}
          </ul>
        ) : null}

        {/* 图片 */}
        {current.images?.length ? (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {current.images.map((img) => (
              <img
                key={img.id}
                src={img.dataUrl || img.url}
                alt="错题图片"
                className="h-28 rounded-xl border border-ink-200 object-contain"
              />
            ))}
          </div>
        ) : null}

        {/* 答案区 */}
        {revealed && (
          <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-red-50 px-3 py-2 text-sm ring-1 ring-red-100">
                <p className="text-[11px] font-bold text-red-500">你的答案</p>
                <p className="mt-0.5 font-bold text-red-700">{current.myAnswer || '未作答'}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm ring-1 ring-emerald-100">
                <p className="text-[11px] font-bold text-emerald-600">正确答案</p>
                <p className="mt-0.5 font-bold text-emerald-700">{current.correctAnswer || '—'}</p>
              </div>
            </div>

            {current.aiAnalysis ? (
              <div className="rounded-xl bg-brand-50/70 px-3 py-2.5 text-sm ring-1 ring-brand-100">
                <p className="text-[11px] font-bold text-brand-600">AI 错因诊断</p>
                <p className="mt-1 leading-relaxed text-ink-700">{current.aiAnalysis.summary}</p>
                {current.aiAnalysis.tips?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-600">
                    {current.aiAnalysis.tips.slice(0, 3).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <button
                onClick={() => void handleAnalyze()}
                disabled={analyzing}
                className="btn btn-outline btn-sm"
              >
                {analyzing ? <Spinner size={13} /> : '🤖'} AI 分析这道题
              </button>
            )}
          </div>
        )}

        {/* 操作 */}
        <div className="mt-5 flex flex-wrap gap-2">
          {!revealed ? (
            <button className="btn btn-primary btn-lg flex-1" onClick={() => setRevealed(true)}>
              👀 显示答案
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary btn-lg flex-1"
                onClick={() => void handleCorrected()}
                disabled={busy}
              >
                {busy ? <Spinner size={14} /> : '✅'} 我已订正，掌握了
              </button>
              <button className="btn btn-outline btn-lg" onClick={handleSkip} disabled={busy}>
                还不太熟，跳过
              </button>
            </>
          )}
        </div>

        <p className="mt-3 text-center text-[11px] text-ink-400">
          {currentStudent?.name} 的第 {index + 1} 道复习题 · 订正后掌握度会自动提升并安排下次复习
        </p>
      </Card>

      <div className="flex justify-center">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => navigate(`/questions/${current.id}`)}
        >
          查看完整详情与 AI 报告 →
        </button>
      </div>
    </div>
  )
}

export default ReviewSession
