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
import { AlertBox, Card, Field, Skeleton, Spinner } from '@/components/ui'
import { useToast } from '@/store/toast'
import { PhotoDropzone } from './entry/PhotoDropzone'
import type { PhotoDropzoneHandle } from './entry/PhotoDropzone'
import { QuestionForm } from './entry/QuestionForm'
import { AnalysisPanel } from './entry/AnalysisPanel'
import {
  CONF_GOOD,
  CONF_MID,
  FieldConfidenceNotice,
  RecognitionQualityCard,
  SubjectAutoNotice,
  buildConfMap,
  mergeFieldConfidence,
  pctText,
  readExtras,
} from './entry/RecognitionQuality'
import { ModeBanner } from './entry/ModeBanner'
import { dataClient } from './entry/client'
import { useStudents } from './entry/hooks'
import { EMPTY_FORM, formToInput, validateForm } from './entry/formModel'
import { ENGINE_BUSY_NOTE, engineFailTips, ENGINE_ACTION, ENGINE_RETRY } from './entry/engine'
import type { EngineState } from './entry/engine'
import type { ConfMap, QuestionFormValue } from './entry/formModel'
import type { PhotoItem } from './entry/image'

type Phase = 'idle' | 'recognizing' | 'analyzing' | 'result' | 'failed'

const PHASE_TEXT: Record<'recognizing' | 'analyzing', { title: string; desc: string }> = {
  recognizing: { title: '正在识别题目文字…', desc: '把卷子上的题干、选项抄写下来' },
  analyzing: { title: 'AI 正在分析错因与知识点…', desc: '判断这道题到底错在哪儿，并给出订正步骤' },
}

export default function Capture() {
  const navigate = useNavigate()
  const { push } = useToast()
  const { currentStudentId, currentStudent } = useStudents()

  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState<Subject | ''>('')
  /** 用户是否手动改过学科（改过就不再被自动判定覆盖） */
  const [subjectTouched, setSubjectTouched] = useState(false)
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
  /** 当前识别能力：决定文案与失败建议 */
  const [engine, setEngine] = useState<EngineState>('unknown')
  /** 识别超过 8 秒还没结果 */
  const [slow, setSlow] = useState(false)

  const phaseTimer = useRef<number | null>(null)
  /** 慢识别提示计时器 */
  const slowTimer = useRef<number | null>(null)
  /** 照片采集区：需要「重新裁剪 / 换一张照片」时命令式调用 */
  const dropzoneRef = useRef<PhotoDropzoneHandle>(null)

  /* 初始化年级（跟随当前学生） */
  useEffect(() => {
    if (currentStudent?.grade && GRADES.includes(currentStudent.grade)) setGrade(currentStudent.grade)
  }, [currentStudent])

  /* 当前识别能力：配了视觉模型 / 只有本地 OCR / 都没配 */
  useEffect(() => {
    let alive = true
    void dataClient.getEngineState().then((state) => {
      if (alive) setEngine(state)
    })
    return () => {
      alive = false
    }
  }, [])

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
      if (slowTimer.current) window.clearTimeout(slowTimer.current)
    },
    [],
  )

  const setFormValue = useCallback((patch: Partial<QuestionFormValue>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const applyResult = (res: PhotoAnalysisResponse) => {
    const d = res.draft
    const a = res.analysis
    /* 用户没手动选过学科时，把后端自动判定的学科作为下拉框默认值 */
    if (!subjectTouched && d.subject) setSubject(d.subject)
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
  /** imageOverride：裁剪完成后直接用新图重新识别（不用等 state 生效） */
  const runAnalyze = async (imageOverride?: string) => {
    const image = imageOverride ?? photos[0]?.dataUrl
    if (!image) {
      push('先拍一张错题照片吧 📷', 'error')
      return
    }
    if (phase === 'recognizing' || phase === 'analyzing') return

    setPhase('recognizing')
    setFailMsg(null)
    setResult(null)
    setSlow(false)

    phaseTimer.current = window.setTimeout(() => {
      setPhase((p) => (p === 'recognizing' ? 'analyzing' : p))
    }, 1500)
    /* 超过 8 秒还没结果，给一句「还在识别」和提速建议 */
    slowTimer.current = window.setTimeout(() => setSlow(true), 8000)

    try {
      const res = await dataClient.analyzePhoto({
        image,
        grade: grade || undefined,
        subject: subject || undefined,
        hint: hint.trim() || undefined,
      })
      if (phaseTimer.current) window.clearTimeout(phaseTimer.current)
      if (slowTimer.current) window.clearTimeout(slowTimer.current)
      setResult(res)
      applyResult(res)
      setPhase('result')
      push('识别完成，核对一下就能保存 ✅', 'success')
    } catch (e) {
      if (phaseTimer.current) window.clearTimeout(phaseTimer.current)
      if (slowTimer.current) window.clearTimeout(slowTimer.current)
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

  /* ------------------------------ 识别不准时的三个出口 ------------------------------ */
  /** 回到裁剪界面重新框选 */
  const recrop = () => {
    const first = photos[0]
    if (!first) {
      push('先拍一张错题照片吧 📷', 'error')
      return
    }
    dropzoneRef.current?.cropPhoto(first.id)
  }

  /** 直接把光标送到题干，手动改内容 */
  const editManually = () => {
    const el = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder^="把题目文字"]',
    )
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus({ preventScroll: true })
    } else {
      push('在右边表单里直接改就行', 'info')
    }
  }

  /** 换一张照片重新拍 */
  const pickAnother = () => {
    dropzoneRef.current?.pickPhoto()
  }

  /* ------------------------------ 兜底：手动补录 ------------------------------ */
  /**
   * 跳到手动补录页，并把**已经识别到的文字**一起带过去，
   * 用户不用从头再打一遍。
   * 文字走 query（字段名与表单一致，重复参数表示数组）：
   *   stem / subject / questionType / myAnswer / correctAnswer /
   *   errorType / errorDetail / difficulty
   *   options（重复） / knowledgePoints（重复）
   * 图片仍然走 location.state（体积大，不适合塞 URL）。
   */
  const gotoManual = () => {
    const params = new URLSearchParams()
    const put = (key: string, value: string | number | undefined) => {
      if (value === undefined || value === null || value === '') return
      params.set(key, String(value))
    }
    put('stem', form.stem)
    put('subject', form.subject)
    put('questionType', form.questionType)
    put('myAnswer', form.myAnswer)
    put('correctAnswer', form.correctAnswer)
    put('errorType', form.errorType)
    put('errorDetail', form.errorDetail)
    put('difficulty', form.difficulty)
    form.options.forEach((o) => params.append('options', o))
    form.knowledgePoints.forEach((k) => params.append('knowledgePoints', k))
    const qs = params.toString()
    navigate(`/manual${qs ? `?${qs}` : ''}`, {
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
    setSubjectTouched(false)
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

  /* 后端可选字段：学科自动判定 / 警告（没有就完全不显示） */
  const extras = useMemo(() => readExtras(result), [result])

  /* 学科下拉框下方的「已自动判断为 XX」提示 */
  const subjectNotice = useMemo(
    () =>
      result ? (
        <SubjectAutoNotice
          subject={extras.inferSubject ?? result.draft.subject}
          confidence={extras.subjectConfidence}
          evidence={extras.subjectEvidence}
        />
      ) : null,
    [result, extras],
  )

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
            <PhotoDropzone
              ref={dropzoneRef}
              photos={photos}
              onChange={setPhotos}
              onCropApplied={(p) => {
                /* 已经识别过一次再裁剪 → 直接用新图重新识别；
                   新拍的照片 → 只更新图片，等用户点「开始 AI 识别」再识别（不白烧接口） */
                if (phase === 'result') {
                  push('裁剪完成，正在用新图重新识别…', 'info')
                  void runAnalyze(p.dataUrl)
                } else {
                  push('裁剪完成 ✅ 照片已更新', 'success')
                }
              }}
              disabled={busy}
              engine={engine}
            />

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
                  onChange={(e) => {
                    setSubject(e.target.value as Subject | '')
                    setSubjectTouched(true)
                  }}
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
                <p className="mt-1.5 text-[11px] leading-relaxed text-brand-600/70">
                  {ENGINE_BUSY_NOTE[engine]}
                </p>
                {slow && (
                  <p className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    还在识别，图片较大时可以先裁剪掉无关部分，会快很多。
                    <button
                      type="button"
                      className="ml-1 font-bold underline"
                      onClick={recrop}
                    >
                      去裁剪
                    </button>
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </div>
            )}

            {phase === 'failed' && (
              <AlertBox tone="error" title="这次没能识别出来，看看下面这几招">
                <p>{failMsg ?? '识别服务暂时不可用。'}</p>
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed opacity-90">
                  {engineFailTips(engine, failMsg ?? '').map((tip, i) => (
                    <li key={i}>· {tip}</li>
                  ))}
                </ul>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={gotoManual}>
                    ✍️ 手动补录这道题
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={recrop}>
                    ✂️ 重新裁剪
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => void runAnalyze()}>
                    🔁 再试一次
                  </button>
                  {engine === 'none' && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => navigate('/system')}
                    >
                      ⚙️ 去配置识别引擎
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] opacity-80">
                  照片已经保留；手动补录时会带着照片和已识别到的文字过去，不用重打一遍。
                </p>
              </AlertBox>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary btn-lg flex-1 sm:flex-none"
                onClick={() => void runAnalyze()}
                disabled={busy || !photos.length}
              >
                {busy ? '识别中…' : ENGINE_ACTION[engine]}
              </button>
              {phase === 'result' && (
                <button type="button" className="btn btn-outline btn-lg" onClick={reset}>
                  {ENGINE_RETRY[engine]}
                </button>
              )}
              <button type="button" className="btn btn-outline btn-lg" onClick={gotoManual} disabled={busy}>
                ✍️ 手动补录这道题
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
                      多半是字迹潦草、光线不足，或者一��拍进去好几道题。
                      下面三个办法都能救，选一个就行：
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary btn-sm" onClick={recrop}>
                        ✂️ 重新裁剪
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={editManually}>
                        ✍️ 手动修改
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={pickAnother}>
                        🖼️ 换一张照片
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] opacity-80">
                      裁剪只留一道题通常最有效；实在看不清就手动改一下，存进去一样能用。
                    </p>
                  </AlertBox>
                )}

                <RecognitionQualityCard result={result} />

                <Card
                  title="核对识别结果"
                  subtitle="AI 先填好一版，改完再保存更省事"
                  extra={
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tag bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                        整体置信度 {pctText(result.draft.confidence)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={recrop}
                        disabled={!photos.length}
                      >
                        ✂️ 重新裁剪
                      </button>
                    </div>
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
                    subjectNotice={subjectNotice}
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
                    <button type="button" className="btn btn-ghost" onClick={gotoManual} disabled={saving}>
                      ✍️ 手动补录这道题
                    </button>
                  </div>
                </Card>

                <Card title="AI 分析结果" subtitle="识别与归因是同一份模型输出，保存后可在详情页继续查看">
                  <AnalysisPanel analysis={result.analysis} pipeline={result.pipeline} />
                </Card>
              </>
            ) : (
              <Card title="识别结果预览" subtitle={`拍好照片后点击「${ENGINE_ACTION[engine].replace(/^[✨🔍]\s*/, '')}」`}>
                <div className="space-y-3">
                  <div className="rounded-xl border border-dashed border-ink-200 px-4 py-10 text-center">
                    <div className="text-3xl">🧾</div>
                    <p className="mt-2 text-sm font-bold text-ink-700">这里会显示识别出的题目</p>
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
