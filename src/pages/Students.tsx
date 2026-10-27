/**
 * pages/Students —— 学生档案管理
 * ---------------------------------------------------------------------------
 * 卡片展示每个学生的错题数量与最近录入时间，支持新增 / 编辑 / 删除。
 * 新增或删除后会同步刷新全局学生列表（AppShell 的学生选择器）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GRADES, formatDate, fromNow } from '@/lib/format'
import type { Question, Student, StudentInput } from '@/lib/types'
import { AlertBox, Avatar, Card, EmptyState, Field, Modal, Skeleton } from '@/components/ui'
import { useToast } from '@/store/toast'
import { ModeBanner } from './entry/ModeBanner'
import { dataClient } from './entry/client'
import { useStudents } from './entry/hooks'

const AVATAR_COLORS = [
  '#3b63f6',
  '#ec4899',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ef4444',
  '#64748b',
]

const EMPTY_FORM: StudentInput = {
  name: '',
  grade: '三年级',
  avatarColor: AVATAR_COLORS[0],
  school: '',
  note: '',
}

export default function Students() {
  const navigate = useNavigate()
  const { push } = useToast()
  const { students, loading, error, reload, setCurrentStudentId, currentStudentId } = useStudents()

  const [editing, setEditing] = useState<Student | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<StudentInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Student | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([])

  /* 统计每个学生的错题数与最近录入时间 */
  const loadQuestions = useCallback(async () => {
    try {
      const res = await dataClient.listQuestions({ page: 1, pageSize: 200 })
      setQuestions(res.items)
    } catch {
      setQuestions([])
    }
  }, [])

  useEffect(() => {
    void loadQuestions()
  }, [loadQuestions])

  const stats = useMemo(() => {
    const map = new Map<string, { count: number; latest: string | null }>()
    questions.forEach((q) => {
      const cur = map.get(q.studentId) ?? { count: 0, latest: null }
      cur.count += 1
      if (!cur.latest || q.createdAt > cur.latest) cur.latest = q.createdAt
      map.set(q.studentId, cur)
    })
    return map
  }, [questions])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (s: Student) => {
    setEditing(s)
    setForm({
      name: s.name,
      grade: s.grade,
      avatarColor: s.avatarColor,
      school: s.school ?? '',
      note: s.note ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      setFormError('请填写孩子姓名')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await dataClient.updateStudent(editing.id, form)
        push('档案已更新 ✅', 'success')
      } else {
        const created = await dataClient.createStudent(form)
        setCurrentStudentId(created.id)
        push(`已添加「${created.name}」的档案 ✅`, 'success')
      }
      setModalOpen(false)
      await reload()
      await loadQuestions()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!removing) return
    setRemoveBusy(true)
    try {
      await dataClient.deleteStudent(removing.id)
      push(`已删除「${removing.name}」的档案`, 'success')
      setRemoving(null)
      await reload()
      await loadQuestions()
    } catch (e) {
      push(e instanceof Error ? e.message : '删除失败', 'error')
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-6">
      <ModeBanner />

      <Card
        title="学生档案"
        subtitle="每个孩子一份档案，错题、分析和统计都按档案分开"
        extra={
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            ＋ 新增学生
          </button>
        }
      >
        {error && (
          <div className="mb-3">
            <AlertBox tone="error" title="加载失败">
              <p>{error}</p>
              <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => void reload()}>
                重试
              </button>
            </AlertBox>
          </div>
        )}

        {loading && !students.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card space-y-3 p-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        ) : students.length === 0 ? (
          <EmptyState
            icon="👦"
            title="还没有学生档案"
            description="先添加一个孩子的档案，之后拍照录入的错题都会归到他/她名下。"
            action={
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                ＋ 新增学生
              </button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {students.map((s) => {
              const stat = stats.get(s.id) ?? { count: 0, latest: null }
              const isCurrent = s.id === currentStudentId
              return (
                <article
                  key={s.id}
                  className={`card card-hover p-4 ${isCurrent ? 'ring-2 ring-brand-200' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={s.name} color={s.avatarColor} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-bold text-ink-900">{s.name}</p>
                        {isCurrent && <span className="tag bg-brand-50 text-brand-700 ring-1 ring-brand-200">当前</span>}
                      </div>
                      <p className="text-xs text-ink-500">
                        {s.grade}
                        {s.school ? ` · ${s.school}` : ''}
                      </p>
                    </div>
                  </div>

                  {s.note && (
                    <p className="mt-3 rounded-lg bg-ink-50/80 px-3 py-2 text-xs leading-relaxed text-ink-500">
                      {s.note}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-4 text-xs text-ink-500">
                    <span>
                      错题 <span className="text-sm font-bold text-ink-800">{stat.count}</span> 道
                    </span>
                    <span>
                      最近录入{' '}
                      <span className="font-semibold text-ink-700">
                        {stat.latest ? fromNow(stat.latest) : '暂无'}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-300">建档于 {formatDate(s.createdAt)}</p>

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setCurrentStudentId(s.id)
                        navigate('/capture')
                      }}
                    >
                      📷 拍照录入
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(s)}>
                      编辑
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => setRemoving(s)}>
                      删除
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Card>

      {/* 新增 / 编辑 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `编辑「${editing.name}」` : '新增学生'}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <AlertBox tone="error">{formError}</AlertBox>}

          <Field label="姓名" required>
            <input
              className="input"
              value={form.name}
              placeholder="孩子的名字"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="年级" required>
            <select
              className="select"
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>

          <Field label="学校">
            <input
              className="input"
              value={form.school ?? ''}
              placeholder="选填，例如 实验二小"
              onChange={(e) => setForm({ ...form, school: e.target.value })}
            />
          </Field>

          <Field label="备注" hint="记下孩子的学习习惯，AI 诊断时会更贴合">
            <textarea
              className="textarea"
              rows={3}
              value={form.note ?? ''}
              placeholder="例如：数学计算偏弱，做题快但容易漏步骤"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>

          <Field label="头像颜色">
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, avatarColor: c })}
                  className={`h-9 w-9 rounded-full transition ${
                    form.avatarColor === c ? 'ring-2 ring-ink-900 ring-offset-2' : 'hover:scale-105'
                  }`}
                  style={{ background: c }}
                  aria-label={`选择颜色 ${c}`}
                />
              ))}
            </div>
          </Field>

          <div className="flex items-center gap-3 rounded-xl bg-ink-50/70 p-3">
            <Avatar name={form.name || '新同学'} color={form.avatarColor} size={40} />
            <p className="text-xs text-ink-500">预览效果</p>
          </div>
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="确认删除档案？"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setRemoving(null)}>
              再想想
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={removeBusy}>
              {removeBusy ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          将删除「{removing?.name}」的档案。该学生名下的错题会一并失效，且无法恢复。
        </p>
      </Modal>
    </div>
  )
}
