/**
 * pages/Capture —— 拍照录入（手机端主战场）
 * ---------------------------------------------------------------------------
 * 流程：拍照 / 选图 / 拖拽 / 粘贴  →  选择年级学科 →  AI 识别  →  校对表单  →  保存
 * 识别失败时提供「手动补录」兜底，已拍的照片会带到补录页作为参考。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GRADES } from '@/lib/format'
import { SUBJECTS } from '@/lib/types'
import type { PhotoAnalysisResponse, Subject } from '@/lib/types'
import { AlertBox, Badge, Card, Field, Progress, Skeleton, Spinner } from '@/components/ui'
import { useToast } from '@/store/toast'
import { PhotoDropzone } from './entry/PhotoDropzone'
import { QuestionForm } from './entry/QuestionForm'
import { AnalysisPanel } from './entry/AnalysisPanel'
import { ModeBanner } from './entry/ModeBanner'
import { dataClient } from './entry/client'
import { useStudents } from './entry/hooks'
import { EMPTY_FORM, formToInput, validateForm } from './entry/formModel'
import type { ConfMap, FieldKey, QuestionFormValue } from './entry/formModel'
import type { PhotoItem } from './entry/image'

type Phase = 'idle' | 'recognizing' | 'analyzing' | 'result' | 'failed'

const PHASE_TEXT: Record<'recognizing' | 'analyzing', { title: string; desc: string }> = {
  recognizing: { title: '正在识别题目文字…', desc: '把卷子上的题干、选项抄写下来' },
  analyzing: { title: 'AI 正在分析错因与知识点…', desc: '判断这道题到底错在哪儿，并给出订正步骤' },
}

/* ------------------ 置信度分级与字段中文名 ------------------ */

/** ≥ 0.85 认为可信；0.6 ~ 0.85 建议核对；< 0.6 视为不确定 */
const CONF_GOOD = 0.85
const CONF_MID = 0.6

const FIELD_LABEL: Record<string, string> = {
  subject: '学科',
  questionType: '题型',
  knowledgePoints: '知识点',
  stem: '题干',
  options: '选项',
  myAnswer: '我的答案',
  correctAnswer: '正确答案',
  difficulty: '难度',
  errorType: '错因类型',
  errorDetail: '错因详述',
  ocrText: 'OCR 原文',
}

function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key
}

interface ConfLevel {
  text: string
  tone: 'green' | 'amber' | 'red'
  color: string
}

function confLevel(value: number): ConfLevel {
  if (value >= CONF_GOOD) return { text: '可信', tone: 'green', color: '#10b981' }
  if (value >= CONF_MID) return { text: '建议核对', tone: 'amber', color: '#f59e0b' }
  return { text: '不确定', tone: 'red', color: '#ef4444' }
}

function pctText(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

/** 把后端返回的逐字段置信度转成表单用的字段 -> 置信度映射 */
function buildConfMap(
  draft: PhotoAnalysisResponse['draft'],
  diagnosisConfidence?: number,
): ConfMap {
  const fc = draft.fieldConfidence ?? {}
  const overall = typeof draft.confidence === 'number' ? draft.confidence : 0
  const pick = (key: FieldKey): number => {
    const v = fc[key]
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.min(1, Math.max(0, v))
      : overall
  }
  const errorTypeConfidence =
    typeof fc.errorType === 'number' && Number.isFinite(fc.errorType)
      ? fc.errorType
      : (diagnosisConfidence ?? overall)
  return {
    subject: pick('subject'),
    questionType: pick('questionType'),
    knowledgePoints: pick('knowledgePoints'),
    stem: pick('stem'),
    options: pick('options'),
    myAnswer: pick('myAnswer'),
    correctAnswer: pick('correctAnswer'),
    difficulty: pick('difficulty'),
    errorType: errorTypeConfidence,
  }
}

/**
 * 逐字段置信度：后端给了就用；额外把「错因诊断」的把握程度补进 errorType，
 * 让表单里也能看到这一项的置信度。后端没给逐字段数据时返回 undefined，
 * 表单会自动退回旧的整体置信度展示方式。
 */
function mergeFieldConfidence(result: PhotoAnalysisResponse): Record<string, number> | undefined {
  const fc = result.draft.fieldConfidence
  if (!fc) return undefined
  const merged: Record<string, number> = { ...fc }
  const diag = result.analysis.diagnosis?.confidence
  if (merged.errorType === undefined && typeof diag === 'number' && Number.isFinite(diag)) {
    merged.errorType = diag
  }
  return merged
}

/* ------------------ 识别质量卡片 ------------------ */

function engineHint(engine: string): string {
  switch (engine) {
    case 'vision-model':
      return '这次是视觉模型直接看图识别，题干、公式和作图一般比较完整。'
    case 'local-ocr':
      return '这次先用本地 OCR 提取文字，再由引擎结构化成题目，图片没有上传到云端。'
    case 'hint-fallback':
      return '这次没有可用的视觉模型，只按你填的提示词推导，识别结果请务必人工核对。'
    default:
      return '识别引擎已把识别过程拆解成下面几个信号，权重越高说明对结果影响越大。'
  }
}

function RecognitionQualityCard({ result }: { result: PhotoAnalysisResponse }) {
  const draft = result.draft
  const pipeline = result.pipeline
  const confidence = typeof draft.confidence === 'number' ? draft.confidence : 0
  const level = confLevel(confidence)

  return (
    <Card title="识别质量" subtitle="这次识别走的是哪条链路、把握有多大">
      <div className="space-y-4">
        {/* 整体置信度 */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-ink-500">整体置信度</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-ink-900">
              {pctText(confidence)}
            </p>
          </div>
          <Badge tone={level.tone}>{level.text}</Badge>
        </div>
        <Progress value={confidence * 100} color={level.color} height={10} />
        <p className="text-[11px] leading-relaxed text-ink-400">
          {confidence >= CONF_GOOD
            ? '整体识别质量不错，简单扫一眼就能保存。'
            : confidence >= CONF_MID
              ? '有些地方可能认错了，重点看看标了「建议核对」的字段。'
              : '这次识别把握不大，建议逐字对照原图检查一遍再保存。'}
        </p>

        {/* 识别链路 */}
        <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <p className="text-xs font-bold text-ink-700">🔗 识别链路</p>
          {pipeline ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">{pipeline.ocrEngineLabel}</Badge>
                {pipeline.model && <Badge tone="violet">{pipeline.model}</Badge>}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                {engineHint(pipeline.ocrEngine)}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
              后端还没有返回链路信息；识别引擎升级后，这里会显示具体用了视觉模型还是本地 OCR。
            </p>
          )}
        </div>

        {/* 置信度构成 */}
        {pipeline?.signals && pipeline.signals.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold text-ink-700">📊 置信度构成</p>
            <div className="space-y-2.5">
              {pipeline.signals.map((s, i) => {
                const sLevel = confLevel(s.value)
                return (
                  <div key={`${s.name}-${i}`}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-ink-600">{s.name}</span>
                      <span className="shrink-0 text-ink-400">
                        {pctText(s.value)} · 权重 {Math.round(s.weight * 100)}%
                      </span>
                    </div>
                    <Progress value={s.value * 100} color={sLevel.color} height={6} />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 需要注意 */}
        {pipeline?.warnings && pipeline.warnings.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold text-ink-700">⚠️ 需要注意</p>
            <ul className="space-y-1.5">
              {pipeline.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800"
                >
                  <span aria-hidden>⚠️</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ------------------ 逐字段置信度：可疑字段清单 ------------------ */

function FieldConfidenceNotice({ result }: { result: PhotoAnalysisResponse }) {
  const fc = result.draft.fieldConfidence

  if (!fc || Object.keys(fc).length === 0) {
    return (
      <p className="rounded-xl bg-ink-50/80 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
        后端这次没有提供逐字段置信度，先按整体置信度 {pctText(result.draft.confidence)} 参考。
      </p>
    )
  }

  const items = Object.entries(fc)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v < CONF_GOOD)
    .sort((a, b) => a[1] - b[1])

  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-emerald-50/70 px-3 py-2 text-[11px] leading-relaxed text-emerald-700">
        ✅ 所有字段的识别置信度都在 {pctText(CONF_GOOD)} 以上，快速扫一眼就能保存。
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-red-100 bg-red-50/60 p-3">
      <p className="text-xs font-bold text-red-700">🔍 建议重点核对的字段</p>
      <ul className="mt-2 space-y-1.5">
        {items.map(([key, value]) => {
          const level = confLevel(value)
          const risky = value < CONF_MID
          return (
            <li
              key={key}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-white/85 px-3 py-2"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: level.color }}
                aria-hidden
              />
              <span className="text-xs font-bold text-ink-800">{fieldLabel(key)}</span>
              <Badge tone={level.tone}>{pctText(value)}</Badge>
              <span className="text-[11px] text-ink-500">
                {risky ? '此项识别不确定，请人工核对' : '这一项把握不大，建议核对一下'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function Capture() {
  const navigate = useNavigate()
  const { push } = useToast()
  const { currentStudentId, currentStudent } = useStudents()

  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState<Subject | ''>('')
  const [hint, setHint] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<PhotoAnalysisResponse | null>(null)
  const [form, setForm] = useState<QuestionFormValue>(EMPTY_FORM)
  const [conf, setConf] = useState<ConfMap>({})
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [knowledgeOptions, setKnowledgeOptions] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [failMsg, setFailMsg] = useState<string | null>(null)

  const phaseTimer = useRef<number | null>(null)

  /* 初始化年级（跟随当前学生） */
  useEffect(() => {
    if (currentStudent?.grade && GRADES.includes(currentStudent.grade)) setGrade(currentStudent.grade)
  }, [currentStudent])

  /* 知识点候选（已有错题里的知识点） */
  useEffect(() => {
    let alive = true
    void dataClient
      .getKnowledgePoints()
      .then((list) => {
        if (!alive) return
        /* 同一个知识点名可能挂在多个学科下，去重后 React 的 key 才唯一 */
        setKnowledgeOptions(Array.from(new Set(list.map((k) => k.name))))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(
    () => () => {
      if (phaseTimer.current) window.clearTimeout(phaseTimer.current)
    },
    [],
  )

  const setFormValue = useCallback((patch: Partial<QuestionFormValue>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const applyResult = (res: PhotoAnalysisResponse) => {
    const d = res.draft
    const a = res.analysis
    setForm({
      subject: d.subject ?? '数学',
      questionType: d.questionType ?? '解答题',
      knowledgePoints: Array.from(new Set(d.knowledgePoints ?? [])),
      stem: d.stem ?? '',
      options: [...(d.options ?? [])],
      myAnswer: d.myAnswer ?? '',
      correctAnswer: d.correctAnswer ?? '',
      difficulty: d.difficulty ?? 3,
      errorType: a.diagnosis?.type ?? 'knowledge_gap',
      errorDetail: a.diagnosis?.reason ?? '',
      source: '',
      points: '',
    })
    /* 优先使用后端给的逐字段置信度，没有的字段回落到整体置信度 */
    setConf(buildConfMap(d, a.diagnosis?.confidence))
    /* AI 推荐知识点去重，避免同名标签重复渲染 */
    setSuggestions(Array.from(new Set(a.knowledgeGaps ?? [])))
  }

  /* ------------------------------ AI 识别 ------------------------------ */
  const runAnalyze = async () => {
    if (!photos.length) {
      push('先拍一张错题照片吧 📷', 'error')
      return
    }
    if (phase === 'recognizing' || phase === 'analyzing') return

    setPhase('recognizing')
    setFailMsg(null)
    setResult(null)

    phaseTimer.current = window.setTimeout(() => {
      setPhase((p) => (p === 'recognizing' ? 'analyzing' : p))
    }, 1500)

    try {
      const res = await dataClient.analyzePhoto({
        image: photos[0].dataUrl,
        grade: grade || undefined,
        subject: subject || undefined,
        hint: hint.trim() || undefined,
      })
      if (phaseTimer.current) window.clearTimeout(phaseTimer.current)
      setResult(res)
      applyResult(res)
      setPhase('result')
      push('识别完成，核对一下就能保存 ✅', 'success')
    } catch (e) {
      if (phaseTimer.current) window.clearTimeout(phaseTimer.current)
      setFailMsg(e instanceof Error ? e.message : '识别失败')
      setPhase('failed')
    }
  }

  /* ------------------------------ 保存 ------------------------------ */
  const save = async () => {
    const v = validateForm(form)
    setErrors(v)
    if (Object.keys(v).length) {
      push('还有必填项没填完，检查一下红字提示', 'error')
      return
    }
    if (!currentStudentId) {
      push('请先在「学生档案」里添加学生', 'error')
      return
    }
    setSaving(true)
    try {
      const created = await dataClient.createQuestion(
        formToInput(form, {
          studentId: currentStudentId,
          grade: grade || currentStudent?.grade,
          images: photos.map((p) => ({ id: p.id, url: p.dataUrl, dataUrl: p.dataUrl })),
          aiAnalysis: result?.analysis ?? null,
        }),
      )
      push('已保存到错题本 ✅', 'success')
      navigate(`/questions/${created.id}`)
    } catch (e) {
      push(e instanceof Error ? e.message : '保存失败，请稍后再试', 'error')
    } finally {
      setSaving(false)
    }
  }

  /* ------------------------------ 兜底：手动补录 ------------------------------ */
  const gotoManual = () => {
    navigate('/manual', {
      state: {
        images: photos.map((p) => p.dataUrl),
        subject: subject || undefined,
        grade: grade || undefined,
        hint: hint.trim() || undefined,
      },
    })
  }

  const reset = () => {
    setPhase('idle')
    setResult(null)
    setForm(EMPTY_FORM)
    setConf({})
    setSuggestions([])
    setErrors({})
    setFailMsg(null)
  }

  const busy = phase === 'recognizing' || phase === 'analyzing'
  const phaseInfo = busy ? PHASE_TEXT[phase as 'recognizing' | 'analyzing'] : null

  const studentHint = useMemo(
    () =>
      currentStudent
        ? `将保存到「${currentStudent.name} · ${currentStudent.grade}」的错题本`
        : '请先在「学生档案」中选择或添加学生',
    [currentStudent],
  )

  /* 表单用的逐字段置信度（后端没给时为 undefined，表单自动退回旧展示） */
  const fieldConf = useMemo(() => (result ? mergeFieldConfidence(result) : undefined), [result])

  return (
    <div className="space-y-4 pb-6">
      <ModeBanner />

      <Card
        title="拍照录入错题"
        subtitle={studentHint}
        extra={
          currentStudent ? (
            <span className="tag bg-brand-50 text-brand-700 ring-1 ring-brand-200">👤 {currentStudent.name}</span>
          ) : null
        }
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* ---------------- 左栏：采集 + 设置 ---------------- */}
          <div className="space-y-4">
            <PhotoDropzone photos={photos} onChange={setPhotos} disabled={busy} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="年级" hint="选对年级，难度判断更准">
                <select
                  className="select"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  disabled={busy}
                >
                  <option value="">不指定</option>
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="学科" hint="选对学科，知识点推荐更准">
                <select
                  className="select"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value as Subject | '')}
                  disabled={busy}
                >
                  <option value="">自动判断</option>
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="提示词 / 备注" hint="例如「第 3 大题」「只看第二小题」，能明显提升识别准确率">
              <input
                className="input"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="如：第 3 大题，应用题第二小题"
                disabled={busy}
              />
            </Field>

            {busy && phaseInfo && (
              <div className="rounded-xl border border-brand-100 bg-brand-50/70 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-brand-700">
                  <Spinner /> {phaseInfo.title}
                </p>
                <p className="mt-1 text-xs text-brand-600/80">{phaseInfo.desc}</p>
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </div>
            )}

            {phase === 'failed' && (
              <AlertBox tone="error" title="自动识别失败，请手动补录">
                <p>{failMsg ?? '识别服务暂时不可用。'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={gotoManual}>
                    ✍️ 去手动补录
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => void runAnalyze()}>
                    🔁 再试一次
                  </button>
                </div>
                <p className="mt-2 text-[11px] opacity-80">照片已经保留，手动补录时会作为参考带过去。</p>
              </AlertBox>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary btn-lg flex-1 sm:flex-none"
                onClick={() => void runAnalyze()}
                disabled={busy || !photos.length}
              >
                {busy ? '识别中…' : '✨ 开始 AI 识别'}
              </button>
              {phase === 'result' && (
                <button type="button" className="btn btn-outline btn-lg" onClick={reset}>
                  ↺ 重新识别
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-lg" onClick={gotoManual} disabled={busy}>
                ✍️ 手动补录
              </button>
            </div>
          </div>

          {/* ---------------- 右栏：识别结果表单 ---------------- */}
          <div className="space-y-4">
            {phase === 'result' && result ? (
              <>
                {result.draft.confidence < CONF_MID && (
                  <AlertBox
                    tone="error"
                    title="识别置信度偏低，请重点核对题干与答案，确认后再保存"
                  >
                    <p>
                      这次整体置信度只有 {pctText(result.draft.confidence)}，
                      多半是字迹潦草、光线不足或者题目拍跨页了。
                      逐字对照原图检查一遍，确认没错再保存，免得错题本里存错内容。
                    </p>
                  </AlertBox>
                )}

                <RecognitionQualityCard result={result} />

                <Card
                  title="核对识别结果"
                  subtitle="AI 先填好一版，改完再保存更省事"
                  extra={
                    <span className="tag bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      整体置信度 {pctText(result.draft.confidence)}
                    </span>
                  }
                >
                  <div className="mb-4">
                    <FieldConfidenceNotice result={result} />
                  </div>
                  <QuestionForm
                    value={form}
                    onChange={setFormValue}
                    conf={conf}
                    fieldConfidence={fieldConf}
                    suggestions={suggestions}
                    knowledgeOptions={knowledgeOptions}
                    errors={errors}
                  />
                  {result.draft.ocrText && (
                    <details className="mt-4 rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2">
                      <summary className="cursor-pointer text-xs font-bold text-ink-500">查看 OCR 原始文字</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-500">
                        {result.draft.ocrText}
                      </pre>
                    </details>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={() => void save()}
                      disabled={saving}
                    >
                      {saving ? '保存中…' : '💾 保存到错题本'}
                    </button>
                    <button type="button" className="btn btn-outline" onClick={reset} disabled={saving}>
                      重新识别
                    </button>
                  </div>
                </Card>

                <Card title="AI 分析结果" subtitle="识别与归因是同一份模型输出，保存后可在详情页继续查看">
                  <AnalysisPanel analysis={result.analysis} pipeline={result.pipeline} />
                </Card>
              </>
            ) : (
              <Card title="识别结果预览" subtitle="拍好照片后点击「开始 AI 识别」">
                <div className="space-y-3">
                  <div className="rounded-xl border border-dashed border-ink-200 px-4 py-10 text-center">
                    <div className="text-3xl">🧾</div>
                    <p className="mt-2 text-sm font-bold text-ink-700">这里会显示 AI 识别出的题目</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-500">
                      识别后你可以逐项核对、修改，再保存到孩子的错题本。
                    </p>
                  </div>
                  <ul className="space-y-1.5 text-xs text-ink-500">
                    <li>· 手机上直接点「拍照」，光线充足、拍正一点识别更准</li>
                    <li>· 一张图放一道题效果最好，多题同框可以补充提示词</li>
                    <li>· 识别不准也没关系，右边的表单随便改</li>
                  </ul>
                </div>
              </Card>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
