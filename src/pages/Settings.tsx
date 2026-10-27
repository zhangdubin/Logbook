/**
 * pages/Settings —— AI 模型与识别设置
 * ---------------------------------------------------------------------------
 * 页面结构：
 *   1. 当前生效引擎（状态卡）
 *   2. 选择模型供应商（预设卡片网格）
 *   3. 连接配置（Base URL / 密钥 / 模型 / 温度 / 超时 / 开关）+ 连接测试
 *   4. 本地 OCR 服务
 *   5. 隐私说明
 *
 * 降级策略：后端还没实现 /api/settings/* 时，预设走前端内置常量
 * （features/settings/fallbackProviders.ts），当前设置走默认值，
 * 页面照常可用，只是提示「后端接口就绪后再保存生效」。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '@/lib/api'
import type { AIConnectionTestResult, AIProviderPreset, AISettings } from '@/lib/types'
import { AlertBox, Badge, Card, Modal, Skeleton, Spinner } from '@/components/ui'
import { useToast } from '@/store/toast'
import { ConnectionForm } from '@/features/settings/ConnectionForm'
import { EngineStatusCard } from '@/features/settings/EngineStatusCard'
import { LocalOcrSection } from '@/features/settings/LocalOcrSection'
import { ProviderGrid } from '@/features/settings/ProviderGrid'
import { TestResult } from '@/features/settings/TestResult'
import { DEFAULT_AI_SETTINGS, FALLBACK_PROVIDERS } from '@/features/settings/fallbackProviders'
import { clearApiKeyInput, formFromSettings, toSettingsInput } from '@/features/settings/utils'
import type { LoadState, ProvidersState, SettingsForm, TestState } from '@/features/settings/types'

export default function Settings() {
  const { push } = useToast()

  /* --------------------------- 服务端状态 --------------------------- */
  const [settings, setSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS)
  const [settingsState, setSettingsState] = useState<LoadState>('loading')
  const [settingsError, setSettingsError] = useState<string | null>(null)

  /* --------------------------- 供应商预设 --------------------------- */
  const [providers, setProviders] = useState<ProvidersState>({
    state: 'loading',
    items: [],
  })

  /* ----------------------------- 表单 ----------------------------- */
  const [form, setForm] = useState<SettingsForm>(() => formFromSettings(DEFAULT_AI_SETTINGS))
  /**
   * 表单是否有「未保存的改动」。
   * 关键：读取服务端设置时**不能**无条件重置表单 —— formFromSettings 会把
   * apiKey 置空，若在用户输入密钥后才返回，就会把刚输入的密钥悄悄抹掉，
   * 导致「保存成功但密钥没生效」的错觉。因此用 ref 记录脏状态。
   */
  const formDirtyRef = useRef(false)
  const [formDirty, setFormDirty] = useState(false)
  const markDirty = useCallback(() => {
    formDirtyRef.current = true
    setFormDirty(true)
  }, [])
  const markClean = useCallback(() => {
    formDirtyRef.current = false
    setFormDirty(false)
  }, [])

  /* ---------------------------- 交互态 ---------------------------- */
  const [testState, setTestState] = useState<TestState>('idle')
  const [testResult, setTestResult] = useState<AIConnectionTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)

  const patchForm = useCallback((patch: Partial<SettingsForm>) => {
    setForm((prev) => ({ ...prev, ...patch }))
    markDirty()
  }, [markDirty])

  /* ---------------------------- 读取设置 ---------------------------- */
  const loadSettings = useCallback(async () => {
    setSettingsState('loading')
    try {
      const res = await api.getAiSettings()
      /* 兜底：后端若返回了非对象（比如被代理到了 index.html），按失败处理 */
      if (!res || typeof res !== 'object' || Array.isArray(res)) {
        throw new Error('设置接口返回了非预期的内容')
      }
      setSettings(res)
      // 用户已经改过表单时不要覆盖，避免抹掉刚输入的 API Key
      if (!formDirtyRef.current) {
        setForm(formFromSettings(res))
      }
      setSettingsState('ready')
      setSettingsError(null)
    } catch (e) {
      setSettings(DEFAULT_AI_SETTINGS)
      if (!formDirtyRef.current) {
        setForm(formFromSettings(DEFAULT_AI_SETTINGS))
      }
      setSettingsState('fallback')
      setSettingsError(e instanceof Error ? e.message : '读取设置失败')
    }
  }, [])

  /* ---------------------------- 读取预设 ---------------------------- */
  const loadProviders = useCallback(async () => {
    setProviders((prev) => ({ ...prev, state: 'loading' }))
    try {
      const items = await api.listProviders()
      if (!Array.isArray(items) || items.length === 0) {
        setProviders({
          state: 'fallback',
          items: FALLBACK_PROVIDERS,
          message: '后端返回的预设列表为空，已切换到内置预设。',
        })
        return
      }
      setProviders({ state: 'ready', items })
    } catch (e) {
      setProviders({
        state: 'fallback',
        items: FALLBACK_PROVIDERS,
        message: e instanceof Error ? e.message : '预设接口不可用',
      })
    }
  }, [])

  useEffect(() => {
    void loadProviders()
    void loadSettings()
  }, [loadProviders, loadSettings])

  /* -------------------------- 选中供应商 -------------------------- */
  const selectProvider = useCallback((p: AIProviderPreset) => {
    setForm((prev) => ({
      ...prev,
      provider: p.id,
      baseUrl: p.baseUrl || prev.baseUrl,
      model: p.defaultModel || prev.model,
      visionModel: p.supportsVision ? prev.visionModel : '',
    }))
    markDirty()
    setTestState('idle')
    setTestResult(null)
    setTestError(null)
  }, [markDirty])

  const currentPreset = useMemo(
    () => providers.items.find((p) => p.id === form.provider),
    [providers.items, form.provider],
  )

  /* ---------------------------- 测试连接 ---------------------------- */
  const runTest = useCallback(async () => {
    setTestState('testing')
    setTestResult(null)
    setTestError(null)
    try {
      const res = await api.testAiConnection(toSettingsInput(form))
      if (!res || typeof res !== 'object' || Array.isArray(res)) {
        throw new Error('测试接口返回了非预期的内容')
      }
      setTestResult(res)
      setTestState('done')
    } catch (e) {
      setTestError(e instanceof Error ? e.message : '连接测试失败')
      setTestState('done')
    }
  }, [form])

  /* ------------------------------ 保存 ------------------------------ */
  const save = useCallback(async () => {
    setSaving(true)
    try {
      const saved = await api.saveAiSettings(toSettingsInput(form))
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
        throw new Error('保存接口返回了非预期的内容')
      }
      setSettings(saved)
      setForm(formFromSettings(saved))
      markClean()
      setSettingsState('ready')
      setSettingsError(null)
      push('设置已保存 ✅', 'success')
    } catch (e) {
      push(e instanceof Error ? e.message : '保存失败，请稍后再试', 'error')
    } finally {
      setSaving(false)
    }
  }, [form, push])

  /* ---------------------------- 清除密钥 ---------------------------- */
  const clearKey = useCallback(async () => {
    setClearing(true)
    try {
      const saved = await api.saveAiSettings(clearApiKeyInput())
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        setSettings(saved)
      } else {
        setSettings((prev) => ({ ...prev, hasApiKey: false, apiKey: '' }))
      }
      setForm((prev) => ({ ...prev, apiKey: '' }))
      markClean()
      setClearOpen(false)
      push('密钥已清除', 'success')
    } catch (e) {
      push(e instanceof Error ? e.message : '清除密钥失败', 'error')
    } finally {
      setClearing(false)
    }
  }, [push])

  /* ---------------------------- 恢复默认 ---------------------------- */
  const doReset = useCallback(async () => {
    setResetting(true)
    try {
      await api.resetAiSettings()
      setResetOpen(false)
      markClean()
      await loadSettings()
      push('已恢复默认设置', 'success')
    } catch (e) {
      push(e instanceof Error ? e.message : '恢复默认失败', 'error')
    } finally {
      setResetting(false)
    }
  }, [loadSettings, push])

  const providersFallback = providers.state === 'fallback'
  const settingsFallback = settingsState === 'fallback'

  return (
    <div className="space-y-4 pb-6">
      {/* ------------------------ 当前生效引擎 ------------------------ */}
      <EngineStatusCard
        settings={settings}
        state={settingsState}
        loading={settingsState === 'loading'}
        onReload={() => void loadSettings()}
      />

      {/* ------------------------- 选择供应商 ------------------------- */}
      <Card
        title="选择模型供应商"
        subtitle="点一下卡片，Base URL 和默认模型会自动填好"
        extra={
          <div className="flex items-center gap-2">
            <Badge tone="slate">共 {providers.items.length} 个预设</Badge>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => void loadProviders()}
              disabled={providers.state === 'loading'}
            >
              {providers.state === 'loading' ? '刷新中…' : '↻ 刷新预设'}
            </button>
          </div>
        }
      >
        {providersFallback && (
          <div className="mb-3">
            <AlertBox tone="warning" title="后端预设接口暂时不可用，已切到内置预设">
              <p>
                {providers.message ?? '接口请求失败'}。下面的卡片是前端内置的常用供应商，
                后端就绪后点「刷新预设」就会换成实时数据。
              </p>
            </AlertBox>
          </div>
        )}

        {providers.items.length === 0 && providers.state !== 'loading' ? (
          <AlertBox tone="error" title="没有拿到任何供应商预设">
            <p>请确认后端已启动并实现 GET /api/settings/providers。</p>
          </AlertBox>
        ) : (
          <ProviderGrid
            providers={providers.items}
            selectedId={form.provider}
            loading={providers.state === 'loading'}
            onSelect={selectProvider}
          />
        )}
      </Card>

      {/* ------------------------- 连接配置 ------------------------- */}
      <Card
        title="连接配置"
        subtitle="填好后先用「测试连接」试一次，确认没问题再保存"
        extra={
          settingsFallback ? (
            <Badge tone="amber">后端未就绪 · 暂用默认值</Badge>
          ) : settingsState === 'loading' ? (
            <Spinner size={14} />
          ) : null
        }
      >
        {settingsError && (
          <div className="mb-3">
            <AlertBox tone="warning" title="没能读取到已保存的设置">
              <p>{settingsError}</p>
              <p className="mt-1 opacity-80">
                当前表单是默认值，可以先填好；等后端接口就绪后再点「保存设置」。
              </p>
            </AlertBox>
          </div>
        )}

        {settingsState === 'loading' ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : (
          <ConnectionForm
            form={form}
            onChange={patchForm}
            preset={currentPreset}
            hasApiKey={settings.hasApiKey}
            maskedKey={settings.apiKey}
            onClearKey={() => setClearOpen(true)}
            clearing={clearing}
          />
        )}

        {/* 测试连接 */}
        <div className="mt-5 border-t border-ink-100 pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void runTest()}
              disabled={testState === 'testing' || settingsState === 'loading'}
            >
              {testState === 'testing' ? '测试中…' : '🔌 测试连接'}
            </button>
            <span className="text-[11px] text-ink-400">用当前表单里还没保存的值去试</span>
          </div>

          <TestResult
            state={testState}
            result={testResult}
            error={testError}
            apiKey={form.apiKey}
          />
        </div>

        {/* 保存 / 重置 */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => void save()}
            disabled={saving || settingsState === 'loading'}
          >
            {saving ? '保存中…' : '💾 保存设置'}
          </button>
          {formDirty && (
            <Badge tone="amber">有未保存的修改</Badge>
          )}
          <button
            type="button"
            className="btn btn-outline btn-lg"
            onClick={() => setResetOpen(true)}
            disabled={resetting}
          >
            ↺ 恢复默认
          </button>
        </div>
      </Card>

      {/* ------------------------ 本地 OCR 服务 ------------------------ */}
      <Card title="本地 OCR 服务" subtitle="不想把图片发出去？在本机跑 OCR，图片不出校">
        <LocalOcrSection form={form} onChange={patchForm} />
      </Card>

      {/* -------------------------- 隐私说明 -------------------------- */}
      <Card title="隐私说明" subtitle="放心把钥匙交给我们保管😌">
        <ul className="space-y-2 text-xs leading-relaxed text-ink-600">
          <li className="flex gap-2">
            <span aria-hidden>🔒</span>
            <span>
              API Key 只保存在<b className="text-ink-800">本机服务器数据库</b>里，接口返回时一律是掩码串，页面上也永远不会回显完整密钥。
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>🖼️</span>
            <span>
              错题图片只在你点「开始 AI 识别」时才会发给配置的模型服务；关掉「启用大模型」后，全部计算都在本地完成，不产生任何外部调用。
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>🏠</span>
            <span>
              本地 OCR（PaddleOCR / RapidOCR）跑在自己的电脑上，图片连网都不出，适合对数据特别在意的家庭和学校。
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>🧹</span>
            <span>点「恢复默认」会清掉已保存的密钥和地址，回到纯本地引擎状态。</span>
          </li>
        </ul>
      </Card>

      {/* ------------------------- 恢复默认确认 ------------------------- */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="恢复默认设置？"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setResetOpen(false)}>
              再想想
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void doReset()} disabled={resetting}>
              {resetting ? '恢复中…' : '确认恢复'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-600">
            恢复后：已保存的 API Key 会被清除，模型与地址回到默认的 MiniMax 配置，
            「启用大模型」会关闭，拍照识别与 AI 诊断重新走本地引擎。
          </p>
          <AlertBox tone="info">
            <span className="text-[11px]">这个操作不能撤销，确定要继续吗？</span>
          </AlertBox>
        </div>
      </Modal>

      {/* ------------------------- 清除密钥确认 ------------------------- */}
      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="确认清除 API Key？"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setClearOpen(false)}>
              再想想
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void clearKey()}
              disabled={clearing}
            >
              {clearing ? '清除中…' : '确认清除'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-600">
            清除后，已保存的 API Key 会立刻从服务器数据库里删掉，页面上的输入框也会清空。
          </p>
          <AlertBox tone="warning">
            <span className="text-[11px]">
              清除后拍照识别与 AI 诊断会退回到本地引擎（除非「启用大模型」被关闭）。之后想用的话，重新粘贴一次密钥即可。
            </span>
          </AlertBox>
        </div>
      </Modal>
    </div>
  )
}
