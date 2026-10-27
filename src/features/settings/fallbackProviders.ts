/**
 * features/settings/fallbackProviders —— 前端内置的供应商预设与默认设置
 * ---------------------------------------------------------------------------
 * 背景：后端的 GET /api/settings/providers 与 GET /api/settings/ai 属于较新的
 * 能力，部署环境里可能还没上线（返回 404）或后端根本没启动（网络错误）。
 *
 * 为了让「模型设置」页在任何环境下都能正常打开、也能先填好参数再等后端就绪，
 * 这里内置一份与后端约定一致的预设列表与默认设置，作为优雅降级的兜底：
 *
 *   - listProviders() 失败 -> 用 FALLBACK_PROVIDERS 渲染卡片，页面顶部提示
 *     「后端预设接口不可用，已使用内置预设」；
 *   - getAiSettings() 失败 -> 用 DEFAULT_AI_SETTINGS 填充表单，并明确告知
 *     「当前展示的是默认值，保存需等后端接口就绪后才会生效」。
 *
 * 注意：
 *   1. 这份常量只是「兜底数据」，不是权威来源；后端接口一旦可用，
 *      页面会自动改用真实接口返回的数据（不需要改任何代码）；
 *   2. baseUrl 一律写成兼容 OpenAI 协议的形式（含 /v1），省得用户自己拼；
 *   3. supportsVision 依据各家公开文档填写，拿不准的一律填 false，
 *      前端只会因此多显示一句提示，不会影响功能。
 */

import type { AIProviderPreset, AISettings } from '@/lib/types'

/** 内置供应商预设（顺序即页面展示顺序） */
export const FALLBACK_PROVIDERS: AIProviderPreset[] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    models: ['MiniMax-M2', 'MiniMax-M2.1', 'MiniMax-Text-01'],
    defaultModel: 'MiniMax-M2',
    supportsVision: false,
    docUrl: 'https://platform.minimaxi.com/document',
    note: '国内直连、兼容 OpenAI 协议，文本与错因分析够用；拍照识别需要另配视觉模型或本地 OCR。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    defaultModel: 'gpt-4o',
    supportsVision: true,
    docUrl: 'https://platform.openai.com/docs',
    note: '国际版，需要所在网络能访问；gpt-4o 系列支持图片输入，拍照识别可直接用。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    supportsVision: false,
    docUrl: 'https://api-docs.deepseek.com/',
    note: '国产性价比高，文本推理扎实；目前没有图片输入接口，拍照识别会走本地 OCR。',
  },
  {
    id: 'qwen',
    name: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-vl-plus', 'qwen-vl-max'],
    defaultModel: 'qwen-plus',
    supportsVision: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/',
    note: '兼容 OpenAI 协议，qwen-vl 系列能看图；国内访问顺畅，适合学校网络。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4v-plus', 'glm-4-flash'],
    defaultModel: 'glm-4-plus',
    supportsVision: true,
    docUrl: 'https://open.bigmodel.cn/dev/api',
    note: 'GLM-4V 支持图片输入；baseUrl 用 /api/paas/v4 这一层，不要再追加 /v1。',
  },
  {
    id: 'ollama',
    name: 'Ollama 本地部署',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5vl', 'minicpm-v', 'llava'],
    defaultModel: 'qwen2.5vl',
    supportsVision: true,
    docUrl: 'https://ollama.com/library',
    note: '模型跑在自己电脑上，数据完全不出本机；需要先 ollama serve 并拉取对应模型。',
  },
  {
    id: 'custom',
    name: '自定义（兼容 OpenAI 协议）',
    baseUrl: '',
    models: [],
    defaultModel: '',
    supportsVision: false,
    docUrl: 'https://github.com/openai/openai-openapi',
    note: '任何提供 /v1/chat/completions 的服务都可以填在这里，Base URL、模型名按对方文档来。',
  },
]

/** 默认设置：未启用大模型，完全走本地启发式引擎 */
export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'minimax',
  baseUrl: 'https://api.minimax.chat/v1',
  apiKey: '',
  model: 'MiniMax-M2',
  visionModel: '',
  temperature: 0.2,
  timeoutMs: 30_000,
  enableModel: false,
  ocrBaseUrl: '',
  ocrEnabled: false,
  hasApiKey: false,
  activeEngine: '本地启发式引擎（未启用大模型）',
}
