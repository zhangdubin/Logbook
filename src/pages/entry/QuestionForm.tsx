/**
 * entry/QuestionForm —— 错题录入表单（拍照识别结果 & 手动补录 共用）
 * ---------------------------------------------------------------------------
 * 字段旁标注 AI 置信度，三种模式：
 *   - 传入 fieldConfidence（逐字段置信度，拍照识别推荐）→ 字段标题旁显示带
 *     tooltip 的小圆点徽章，置信度 < 60% 的字段再加淡红边框 + 红色核对提示；
 *   - 只传 conf（整体 / 诊断置信度）→ 维持旧行为：控件右侧的「置信度 xx%」标签；
 *   - 两个都不传 → 不显示任何置信度信息。
 * fieldConfidence 是可选 prop，不传时行为与改造前完全一致，不影响既有调用方。
 */

import { ERROR_TYPE_DESC, ERROR_TYPES, ERROR_TYPE_LABEL, QUESTION_TYPES, SUBJECTS } from '@/lib/types'
import type { Difficulty, ErrorType, QuestionType, Subject } from '@/lib/types'
import { DIFFICULTY_LABEL } from '@/lib/format'
import { Field } from '@/components/ui'
import { KnowledgePointInput } from './KnowledgePointInput'
import { confidenceTone, showOptions } from './formModel'
import type { ConfMap, FieldKey, QuestionFormValue } from './formModel'
import type { CSSProperties } from 'react'

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/** 逐字段置信度分档：≥0.85 绿 / 0.60~0.85 琥珀 / <0.60 红 */
const CONF_GOOD = 0.85
const CONF_MID = 0.6

/** 低置信字段的淡红底色（用内联样式，避免被 .input 自带的边框色盖掉） */
const LOW_STYLE: CSSProperties = {
  borderColor: '#fca5a5',
  backgroundColor: '#fef2f2',
}

function confColor(value: number): string {
  if (value >= CONF_GOOD) return '#10b981'
  if (value >= CONF_MID) return '#f59e0b'
  return '#ef4444'
}

/** 旧版：控件右侧的「置信度 xx%」标签 */
function ConfidenceBadge({ value }: { value?: number }) {
  const tone = confidenceTone(value)
  if (!tone.text) return null
  return (
    <span className={`tag ring-1 ${tone.className}`} title="AI 对该字段的识别置信度">
      {tone.text}
    </span>
  )
}

/** 新版：字段标题旁的小圆点徽章（带 tooltip） */
function ConfidenceDot({ value }: { value?: number }) {
  if (value === undefined || !Number.isFinite(value)) return null
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  const color = confColor(value)
  return (
    <span
      title={`识别置信度 ${pct}%`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: `${color}1a`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {pct}%
    </span>
  )
}

/** 字段标题 + 圆点徽章 */
function LabelWithBadge({
  text,
  value,
  show,
}: {
  text: string
  value?: number
  show: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{text}</span>
      {show && <ConfidenceDot value={value} />}
    </span>
  )
}

/** 低置信字段的红色提示 */
function LowConfidenceHint() {
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-red-600">
      <span aria-hidden>⚠️</span>
      此项识别不确定，请人工核对
    </p>
  )
}

export function QuestionForm({
  value,
  onChange,
  conf,
  fieldConfidence,
  suggestions = [],
  knowledgeOptions = [],
  errors = {},
}: {
  value: QuestionFormValue
  onChange: (patch: Partial<QuestionFormValue>) => void
  conf?: ConfMap
  /** 逐字段置信度（0~1）；传入后启用标题徽章 + 低置信高亮 */
  fieldConfidence?: Record<string, number>
  suggestions?: string[]
  knowledgeOptions?: string[]
  errors?: Record<string, string>
}) {
  const optionsVisible = showOptions(value.questionType) || value.options.length > 0

  /* 只有传了 fieldConfidence 才启用新版展示，避免影响既有调用方 */
  const useFieldConf = fieldConfidence !== undefined

  /**
   * 取某个字段的置信度：
   *   - 新模式（传了 fieldConfidence）：只认后端逐字段给出的值。
   *     后端没评估过的字段就不显示徽章 —— 拿「整体置信度」冒充单个字段
   *     的把握程度会误导人（整体低往往是因为 OCR 认字不准，不是学科选错了）。
   *   - 旧模式（只传 conf）：沿用整体 / 诊断置信度。
   */
  const confOf = (key: FieldKey): number | undefined => {
    if (useFieldConf) {
      const v = fieldConfidence?.[key]
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined
    }
    return conf?.[key]
  }

  const isLow = (key: FieldKey): boolean => {
    if (!useFieldConf) return false
    const v = confOf(key)
    return typeof v === 'number' && Number.isFinite(v) && v < CONF_MID
  }

  /** 低置信 → 红色提示；否则维持旧标签（仅在没传 fieldConfidence 时） */
  const lowHint = (key: FieldKey) =>
    isLow(key) ? (
      <LowConfidenceHint />
    ) : !useFieldConf ? (
      <ConfidenceBadge value={confOf(key)} />
    ) : null

  const setOption = (idx: number, text: string) => {
    const next = [...value.options]
    next[idx] = text
    onChange({ options: next })
  }

  const addOption = () => {
    const next = [...value.options]
    while (next.length < 4) next.push('')
    onChange({ options: next })
  }

  const removeOption = (idx: number) => {
    onChange({ options: value.options.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-4">
      {/* 学科 + 题型 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={<LabelWithBadge text="学科" value={confOf('subject')} show={useFieldConf} />}
          required
        >
          <div className="flex items-center gap-2">
            <select
              className="select"
              style={isLow('subject') ? LOW_STYLE : undefined}
              value={value.subject}
              onChange={(e) => onChange({ subject: e.target.value as Subject })}
            >
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {!useFieldConf && <ConfidenceBadge value={confOf('subject')} />}
          </div>
          {lowHint('subject')}
        </Field>

        <Field
          label={<LabelWithBadge text="题型" value={confOf('questionType')} show={useFieldConf} />}
          required
        >
          <div className="flex items-center gap-2">
            <select
              className="select"
              style={isLow('questionType') ? LOW_STYLE : undefined}
              value={value.questionType}
              onChange={(e) => onChange({ questionType: e.target.value as QuestionType })}
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {!useFieldConf && <ConfidenceBadge value={confOf('questionType')} />}
          </div>
          {lowHint('questionType')}
        </Field>
      </div>

      {/* 知识点 */}
      <Field
        label={
          <LabelWithBadge text="知识点" value={confOf('knowledgePoints')} show={useFieldConf} />
        }
        hint="知识点选得越准，后面的 AI 归因越贴合实际情况；没有把握就先留空。"
      >
        <div className="space-y-1.5">
          <div className={isLow('knowledgePoints') ? 'rounded-lg bg-red-50/70 p-1' : undefined}>
            <KnowledgePointInput
              value={value.knowledgePoints}
              onChange={(next) => onChange({ knowledgePoints: next })}
              suggestions={suggestions}
              options={knowledgeOptions}
            />
          </div>
          {lowHint('knowledgePoints')}
        </div>
      </Field>

      {/* 题干 */}
      <Field
        label={<LabelWithBadge text="题干" value={confOf('stem')} show={useFieldConf} />}
        required
        hint={errors.stem}
      >
        <div className="space-y-1.5">
          <textarea
            className="textarea"
            style={isLow('stem') ? LOW_STYLE : undefined}
            rows={4}
            value={value.stem}
            placeholder="把题目文字写下来，或用 AI 识别结果后在此修改"
            onChange={(e) => onChange({ stem: e.target.value })}
          />
          {lowHint('stem')}
        </div>
      </Field>

      {/* 选项 */}
      <Field
        label={<LabelWithBadge text="选项" value={confOf('options')} show={useFieldConf} />}
        hint={errors.options ?? '选择题请填写选项编号与内容，例如 A. 12'}
      >
        <div className="space-y-2">
          {value.options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-xs font-bold text-ink-600">
                {OPTION_LETTERS[idx] ?? idx + 1}
              </span>
              <input
                className="input"
                style={isLow('options') ? LOW_STYLE : undefined}
                value={opt}
                placeholder={`选项 ${OPTION_LETTERS[idx] ?? idx + 1} 的内容`}
                onChange={(e) => setOption(idx, e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm shrink-0 text-ink-400 hover:text-red-600"
                onClick={() => removeOption(idx)}
                aria-label="删除选项"
              >
                ✕
              </button>
            </div>
          ))}
          {optionsVisible ? (
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-outline btn-sm" onClick={addOption}>
                ＋ 添加选项
              </button>
              {!useFieldConf && <ConfidenceBadge value={confOf('options')} />}
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => onChange({ options: ['', '', '', ''] })}
            >
              ＋ 本题有选项
            </button>
          )}
          {lowHint('options')}
        </div>
      </Field>

      {/* 我的答案 / 正确答案 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={<LabelWithBadge text="我的答案" value={confOf('myAnswer')} show={useFieldConf} />}
          hint="孩子当时写的答案，方便对比"
        >
          <div className="space-y-1.5">
            <input
              className="input"
              style={isLow('myAnswer') ? LOW_STYLE : undefined}
              value={value.myAnswer}
              placeholder="如 B 或 12.5"
              onChange={(e) => onChange({ myAnswer: e.target.value })}
            />
            {lowHint('myAnswer')}
          </div>
        </Field>
        <Field
          label={
            <LabelWithBadge text="正确答案" value={confOf('correctAnswer')} show={useFieldConf} />
          }
          required
          hint={errors.correctAnswer}
        >
          <div className="space-y-1.5">
            <input
              className="input"
              style={isLow('correctAnswer') ? LOW_STYLE : undefined}
              value={value.correctAnswer}
              placeholder="如 A 或 9.6"
              onChange={(e) => onChange({ correctAnswer: e.target.value })}
            />
            {lowHint('correctAnswer')}
          </div>
        </Field>
      </div>

      {/* 难度 */}
      <Field
        label={<LabelWithBadge text="难度" value={confOf('difficulty')} show={useFieldConf} />}
        hint="按孩子的主观感受来选，下次复习时用来排序"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ difficulty: n as Difficulty })}
                className={`h-9 w-9 rounded-lg text-lg transition ${
                  n <= value.difficulty ? 'text-amber-500' : 'text-ink-200 hover:text-ink-300'
                }`}
                aria-label={`难度 ${n} 星`}
              >
                ★
              </button>
            ))}
            <span className="ml-1 text-xs font-semibold text-ink-500">
              {DIFFICULTY_LABEL[value.difficulty]}（{value.difficulty} 星）
            </span>
            {!useFieldConf && <ConfidenceBadge value={confOf('difficulty')} />}
          </div>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={value.difficulty}
            onChange={(e) => onChange({ difficulty: Number(e.target.value) as Difficulty })}
            className="w-full accent-brand-600"
            aria-label="难度滑块"
          />
          {lowHint('difficulty')}
        </div>
      </Field>

      {/* 错因类型 */}
      <Field
        label={<LabelWithBadge text="错因类型" value={confOf('errorType')} show={useFieldConf} />}
        required
        hint="选错也没关系，AI 诊断结果会自动帮你修正"
      >
        <div className="space-y-1.5">
          <select
            className="select"
            style={isLow('errorType') ? LOW_STYLE : undefined}
            value={value.errorType}
            onChange={(e) => onChange({ errorType: e.target.value as ErrorType })}
          >
            {ERROR_TYPES.map((t) => (
              <option key={t} value={t}>
                {ERROR_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <p className="text-[11px] leading-relaxed text-ink-500">{ERROR_TYPE_DESC[value.errorType]}</p>
          {lowHint('errorType')}
        </div>
      </Field>

      {/* 错因详述 */}
      <Field label="错因详述" hint="用自己的话描述当时怎么想的，对后续复盘最有价值">
        <textarea
          className="textarea"
          rows={3}
          value={value.errorDetail}
          placeholder="例如：看到小数就想直接竖式计算，没先看能不能凑整"
          onChange={(e) => onChange({ errorDetail: e.target.value })}
        />
      </Field>

      {/* 来源 / 分值 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="来源" hint="来自哪次作业、哪张卷子">
          <input
            className="input"
            value={value.source}
            placeholder="如 单元测试卷 / 课堂练习"
            onChange={(e) => onChange({ source: e.target.value })}
          />
        </Field>
        <Field label="分值">
          <input
            className="input"
            inputMode="numeric"
            value={value.points}
            placeholder="如 5"
            onChange={(e) => onChange({ points: e.target.value.replace(/[^\d.]/g, '') })}
          />
        </Field>
      </div>
    </div>
  )
}

export default QuestionForm
