/**
 * features/settings/engineState.test —— 引擎类型判定的自测
 * ---------------------------------------------------------------------------
 * 这个判定以前是「拿 activeEngine 文案正则匹配 /本地/」，而文案是复合句
 * （走大模型时也是「…@供应商，视觉已启用 + 本地 OCR 服务」），
 * 于是「已启用大模型」被误判成本地引擎，页面显示了 ⚪️ 和那条黄色警告。
 *
 * 现在改成优先用后端的结构化字段 activeEngineKind，老后端才退回收紧后的文案判断。
 *
 * 跑法（不依赖测试框架）：
 *   npx esbuild src/features/settings/engineState.test.ts --format=esm --outfile=/tmp/es.mjs && node /tmp/es.mjs
 */

import { resolveEngineState } from './engineState'
import type { AISettings } from '@/lib/types'

/** 造一份设置；kind 传 undefined 表示老后端（没有 activeEngineKind） */
function makeSettings(patch: Partial<AISettings> & { activeEngineKind?: 'model' | 'local' }): AISettings {
  const base: AISettings = {
    provider: 'minimax',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKey: '',
    model: 'MiniMax-M3.1-Flash',
    visionModel: '',
    temperature: 0.2,
    timeoutMs: 30_000,
    maxOutputTokens: 4096,
    enableModel: true,
    ocrBaseUrl: '',
    ocrEnabled: false,
    hasApiKey: true,
    activeEngine: 'MiniMax-M3.1-Flash@MiniMax，视觉已启用 + 本地 OCR 服务',
  }
  const { activeEngineKind, ...rest } = patch
  const settings = { ...base, ...rest } as AISettings & { activeEngineKind?: 'model' | 'local' }
  if (activeEngineKind) settings.activeEngineKind = activeEngineKind
  return settings
}

interface Case {
  name: string
  settings: AISettings
  expectLocal: boolean
  expectBadge: '⚪️ 本地引擎' | '🟢 大模型已启用'
  /** 黄色警告是否应该出现 */
  expectWarning: boolean
}

const cases: Case[] = [
  {
    name: "kind='model' → 大模型（不显示黄色警告）",
    settings: makeSettings({ activeEngineKind: 'model', enableModel: true }),
    expectLocal: false,
    expectBadge: '🟢 大模型已启用',
    expectWarning: false,
  },
  {
    name: "kind='local' + enableModel=true → 本地 + 黄色警告",
    settings: makeSettings({
      activeEngineKind: 'local',
      enableModel: true,
      activeEngine: '本地启发式引擎 + 本地 OCR 服务（未配置可用大模型）',
    }),
    expectLocal: true,
    expectBadge: '⚪️ 本地引擎',
    expectWarning: true,
  },
  {
    name: "kind='local' + enableModel=false → 本地，不显示黄色警告",
    settings: makeSettings({ activeEngineKind: 'local', enableModel: false }),
    expectLocal: true,
    expectBadge: '⚪️ 本地引擎',
    expectWarning: false,
  },
  {
    name: '老后端（无 kind）+ 大模型文案 → 不能再被 /本地/ 误判',
    settings: makeSettings({
      enableModel: true,
      activeEngine: 'MiniMax-M3.1-Flash@MiniMax，视觉已启用 + 本地 OCR 服务',
    }),
    expectLocal: false,
    expectBadge: '🟢 大模型已启用',
    expectWarning: false,
  },
  {
    name: '老后端（无 kind）+ 本地文案 → 仍然认得出本地',
    settings: makeSettings({
      enableModel: true,
      activeEngine: '本地启发式引擎 + 本地 OCR 服务（未配置可用大模型）',
    }),
    expectLocal: true,
    expectBadge: '⚪️ 本地引擎',
    expectWarning: true,
  },
  {
    name: '老后端（无 kind）+ 英文 local-heuristic 文案 → 本地',
    settings: makeSettings({ enableModel: true, activeEngine: 'local-heuristic + ocr' }),
    expectLocal: true,
    expectBadge: '⚪️ 本地引擎',
    expectWarning: true,
  },
  {
    name: '老后端（无 kind）+ 没有文案 + enableModel=true → 大模型',
    settings: makeSettings({ enableModel: true, activeEngine: '' }),
    expectLocal: false,
    expectBadge: '🟢 大模型已启用',
    expectWarning: false,
  },
  {
    name: '老后端（无 kind）+ 没有文案 + enableModel=false → 本地',
    settings: makeSettings({ enableModel: false, activeEngine: '' }),
    expectLocal: true,
    expectBadge: '⚪️ 本地引擎',
    expectWarning: false,
  },
  {
    name: 'kind 给了不认识的值 → 退回文案判断，不崩',
    settings: makeSettings({
      activeEngineKind: 'weird' as unknown as 'model',
      enableModel: true,
      activeEngine: 'MiniMax-M3.1-Flash@MiniMax，视觉已启用 + 本地 OCR 服务',
    }),
    expectLocal: false,
    expectBadge: '🟢 大模型已启用',
    expectWarning: false,
  },
]

let failed = 0
for (const c of cases) {
  const { engineIsLocal } = resolveEngineState(c.settings)
  const badge = engineIsLocal ? '⚪️ 本地引擎' : '🟢 大模型已启用'
  const warning = Boolean(c.settings.enableModel) && engineIsLocal
  const ok = engineIsLocal === c.expectLocal && badge === c.expectBadge && warning === c.expectWarning
  if (!ok) failed++
  console.log(
    `${ok ? '✅' : '❌'} ${c.name}\n     本地=${engineIsLocal} 徽章=${badge} 黄色警告=${warning}` +
      (ok ? '' : `  （期望 本地=${c.expectLocal} 徽章=${c.expectBadge} 警告=${c.expectWarning}）`),
  )
}

/* 顺便验证老正则确实是坏的（说明为什么要改） */
const oldRegex = /本地|local|heuristic/i
const modelText = 'MiniMax-M3.1-Flash@MiniMax，视觉已启用 + 本地 OCR 服务'
console.log(
  `\n（对照）老正则 /本地|local|heuristic/ 匹配大模型文案 → ${oldRegex.test(modelText)}  ← 这就是 bug 的根源`,
)

console.log(`\n失败用例数：${failed}`)
if (failed > 0) process.exit(1)
