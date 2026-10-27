/**
 * pages/Manual —— 手动补录
 * ---------------------------------------------------------------------------
 * 紧凑表单 + 实时录入小贴士；支持三种进入方式：
 *   · 直接进入          -> 空白表单（草稿自动存在本机）
 *   · /manual?edit=<id> -> 编辑已有错题（保存走 PATCH）
 *   · /manual?copyFrom=<id> -> 复制为新题（保留题干/选项，清空答案）
 *   · 从拍照页兜底跳转  -> location.state.images 作为参考照片带入
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { GRADES } from '@/lib/format'
import type { Subject } from '@/lib/types'
import { AlertBox, Card, Field, Spinner } from '@/components/ui'
import { useToast } from '@/store/toast'
import { QuestionForm } from './entry/QuestionForm'
import { ModeBanner } from './entry/ModeBanner'
import { dataClient } from './entry/client'
import { useStudents } from './entry/hooks'
import { EMPTY_FORM, formFromQuestion, formToInput, validateForm } from './entry/formModel'
import type { QuestionFormValue } from './entry/formModel'

const DRAFT_KEY = 'cuoti.manual.draft.v1'

interface HandoffState {
  images?: string[]
  subject?: Subject
  grade?: string
  hint?: string
}

interface StoredDraft {
  form: QuestionFormValue
  grade: string
  savedAt: number
}

const TIPS: { icon: string; title: string; detail: string }[] = [
  { icon: '🔤', title: '选择题请填选项编号', detail: '「我的答案」和「正确答案」写 A / B / C / D，复盘时一眼就能对。' },
  { icon: '🎯', title: '知识点越准，AI 诊断越准', detail: '把课本上的小节名写上（例如「小数乘法」「定语从句」），归因才不会跑偏。' },
  { icon: '🗣️', title: '错因详述用自己的话写', detail: '写清当时怎么想的，比抄一遍正确答案更有用，后面复盘也快。' },
  { icon: '📷', title: '有卷子照片就顺手传上', detail: '拍照页拍好的照片会带过来，没拍也可以先去「拍照录入」补一张。' },
  { icon: '⏱️', title: '别一次性录太多', detail: '一次录 3~5 题最合适，录完当场订正效果最好。' },
  { icon: '🧠', title: '难度按孩子的感受选', detail: '孩子觉得难就标高难，复习计划会把难题排前面。' },
]

function readDraft(): StoredDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDraft
    if (!parsed || typeof parsed !== 'object' || !parsed.form) return null
    return parsed
  } catch {
    return null
  }
}

export default function Manual() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { push } = useToast()
  const { currentStudentId, currentStudent } = useStudents()

  const editId = searchParams.get('edit') ?? ''
  const copyFrom = searchParams.get('copyFrom') ?? ''
  const handoff = (location.state ?? null) as HandoffState | null

  const [form, setForm] = useState<QuestionFormValue>(EMPTY_FORM)
  const [grade, setGrade] = useState('')
  const [images, setImages] = useState<string[]>(handoff?.images ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restored, setRestored] = useState<StoredDraft | null>(null)
  const [knowledgeOptions, setKnowledgeOptions] = useState<string[]>([])
  const [mode, setMode] = useState<'new' | 'edit' | 'copy'>('new')

  const draftTimer = useRef<number | null>(null)
  const loadedRef = useRef(false)

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

  /* 编辑 / 复制模式：载入原题 */
  useEffect(() => {
    if (loadedRef.current) return
    const sourceId = editId || copyFrom
    if (!sourceId) {
      // 新建：尝试恢复本机草稿
      const draft = readDraft()
      if (draft) {
        setForm({ ...EMPTY_FORM, ...draft.form })
        setGrade(draft.grade)
        setRestored(draft)
      } else if (currentStudent?.grade && GRADES.includes(currentStudent.grade)) {
        setGrade(currentStudent.grade)
      }
      loadedRef.current = true
      return
    }
    loadedRef.current = true
    setLoading(true)
    void dataClient
      .getQuestion(sourceId)
      .then((q) => {
        const next = formFromQuestion(q)
        if (copyFrom) {
          // 复制为新题：保留题干与选项，清空答案和错因描述
          next.myAnswer = ''
          next.correctAnswer = ''
          next.errorDetail = ''
        }
        setForm(next)
        setGrade(q.grade)
        setMode(copyFrom ? 'copy' : 'edit')
      })
      .catch((e) => {
        push(e instanceof Error ? e.message : '读取原题失败', 'error')
      })
      .finally(() => setLoading(false))
  }, [copyFrom, editId, currentStudent, push])

  /* 从拍照页兜底带入的提示词与学科 */
  useEffect(() => {
    if (handoff?.subject) {
      setForm((prev) => ({ ...prev, subject: handoff.subject as Subject }))
    }
    if (handoff?.grade) setGrade(handoff.grade)
  }, [handoff])

  /* 草稿自动保存（本机） */
  const persistDraft = useCallback((value: QuestionFormValue, g: string) => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form: value, grade: g, savedAt: Date.now() }))
      } catch {
        /* 隐私模式下 localStorage 不可用，忽略 */
      }
    }, 600)
  }, [])

  useEffect(() => {
    if (mode !== 'new' || loading) return
    persistDraft(form, grade)
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
    }
  }, [form, grade, mode, loading, persistDraft])

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
    setRestored(null)
    setForm(EMPTY_FORM)
    setErrors({})
    push('已清空本机草稿', 'info')
  }

  const setFormValue = useCallback((patch: Partial<QuestionFormValue>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  /* ------------------------------ 保存 ------------------------------ */
  const save = async () => {
    const v = validateForm(form)
    setErrors(v)
    if (Object.keys(v).length) {
      push('还有必填项没填完，看看红色提示', 'error')
      return
    }
    if (!currentStudentId) {
      push('请先在「学生档案」里添加学生', 'error')
      return
    }
    setSaving(true)
    try {
      const input = formToInput(form, {
        studentId: currentStudentId,
        grade: grade || currentStudent?.grade,
        images: images.map((url, i) => ({ id: `img_${Date.now()}_${i}`, url, dataUrl: url })),
      })
      if (editId) {
        await dataClient.updateQuestion(editId, input)
        push('修改已保存 ✅', 'success')
        navigate(`/questions/${editId}`)
      } else {
        const created = await dataClient.createQuestion(input)
        try {
          localStorage.removeItem(DRAFT_KEY)
        } catch {
          /* ignore */
        }
        setRestored(null)
        push('已保存到错题本 ✅', 'success')
        navigate(`/questions/${created.id}`)
      }
    } catch (e) {
      push(e instanceof Error ? e.message : '保存失败，请稍后再试', 'error')
    } finally {
      setSaving(false)
    }
  }

  /* ------------------------------ 动态贴士 ------------------------------ */
  const dynamicTips = useMemo(() => {
    const list: string[] = []
    if (form.questionType === '选择题' && form.options.filter((o) => o.trim()).length < 2) {
      list.push('选择题记得补上选项内容，至少 A、B 两个')
    }
    if (!form.knowledgePoints.length) {
      list.push('还没填知识点，补一个 AI 诊断会准很多')
    }
    if (!form.errorDetail.trim()) {
      list.push('错因详述还空着，写一句当时的思路')
    }
    return list
  }, [form])

  const title = mode === 'edit' ? '编辑错题' : mode === 'copy' ? '复制为新题' : '手动补录错题'

  if (loading) {
    return (
      <Card title={title}>
        <div className="flex items-center gap-2 py-8 text-sm text-ink-500">
          <Spinner /> 正在读取原题…
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      <ModeBanner />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* ---------------- 表单 ---------------- */}
        <Card
          title={title}
          subtitle={
            mode === 'copy'
              ? '保留原题的题干与选项，答案留空让孩子重新做一遍'
              : mode === 'edit'
                ? '改完保存即可，详情页会同步更新'
                : '内容会自动存在本机草稿箱，不怕中途被叫走'
          }
          extra={
            currentStudent ? (
              <span className="tag bg-brand-50 text-brand-700 ring-1 ring-brand-200">👤 {currentStudent.name}</span>
            ) : null
          }
        >
          {restored && (
            <div className="mb-4">
              <AlertBox tone="info" title="已恢复上次没提交完的内容">
                <p>
                  草稿保存于 {new Date(restored.savedAt).toLocaleString('zh-CN')}，可以直接接着写。
                </p>
                <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={clearDraft}>
                  清空草稿，重新开始
                </button>
              </AlertBox>
            </div>
          )}

          {handoff?.hint && (
            <div className="mb-4">
              <AlertBox tone="info" title="来自拍照录入页">
                <p>照片已经带过来了，题干可以直接照着补。提示词：{handoff.hint}</p>
              </AlertBox>
            </div>
          )}

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="学生">
                <input className="input" value={currentStudent ? `${currentStudent.name} · ${currentStudent.grade}` : '未选择'} readOnly />
              </Field>
              <Field label="年级">
                <select className="select" value={grade} onChange={(e) => setGrade(e.target.value)}>
                  <option value="">不指定</option>
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <QuestionForm
              value={form}
              onChange={setFormValue}
              knowledgeOptions={knowledgeOptions}
              errors={errors}
            />

            {images.length > 0 && (
              <Field label="参考照片" hint="来自拍照录入页，可以删除不需要的那张">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {images.map((url, i) => (
                    <div key={i} className="relative overflow-hidden rounded-xl border border-ink-200 bg-white">
                      <img src={url} alt={`参考照片 ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink-900/70 text-[11px] text-white hover:bg-red-600"
                        aria-label="删除照片"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </Field>
            )}

            <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => void save()} disabled={saving}>
                {saving ? '保存中…' : editId ? '💾 保存修改' : '💾 保存到错题本'}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => navigate('/questions')} disabled={saving}>
                取消
              </button>
            </div>
          </div>
        </Card>

        {/* ---------------- 录入小贴士 ---------------- */}
        <div className="space-y-4">
          <Card title="录入小贴士" subtitle="花两分钟填准，后面能省一小时">
            <ul className="space-y-3">
              {TIPS.map((tip) => (
                <li key={tip.title} className="flex gap-2.5 rounded-xl bg-ink-50/70 p-3">
                  <span className="text-lg leading-none" aria-hidden>
                    {tip.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink-800">{tip.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{tip.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {dynamicTips.length > 0 && (
            <Card title="就差一点了" subtitle="补上这几项，AI 诊断会更准">
              <ul className="space-y-2">
                {dynamicTips.map((t) => (
                  <li key={t} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                    <span aria-hidden>💡</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="快捷入口">
            <div className="space-y-2">
              <button type="button" className="btn btn-outline w-full" onClick={() => navigate('/capture')}>
                📷 改用拍照录入
              </button>
              <button type="button" className="btn btn-ghost w-full" onClick={() => navigate('/questions')}>
                📚 先看看已有错题
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
