/**
 * server/providers.js —— AI 供应商预设表
 * ---------------------------------------------------------------------------
 * 前端「模型设置」页面直接渲染这张表（GET /api/settings/providers）。
 * 契约见 src/lib/types.ts 的 AIProviderPreset：
 *   { id, name, baseUrl, models[], defaultModel, supportsVision, docUrl?, note? }
 *
 * supportsVision 必须准确：它决定了拍照识别时能否把图片直接发给模型。
 */

/**
 * 内置供应商预设（≥10 个）。
 * 说明：
 *  - baseUrl 均为 OpenAI 兼容协议（/chat/completions），少数厂商用 compatible-mode / paas / v3 等子路径。
 *  - models[] 是该供应商下常用的可选模型，前端下拉框直接使用。
 */
export const PROVIDER_PRESETS = [
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    models: ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
    defaultModel: 'MiniMax-M3.1-Flash',
    supportsVision: true,
    docUrl: 'https://platform.minimaxi.com/document/guides/chat-model-intro',
    note:
      '国内站 https://api.minimax.chat/v1，国际站 https://api.minimax.io/v1（两者通用同一套 API Key 体系，请按账号所在区域切换）。' +
      '官方当前在售模型为 MiniMax-M3.1-Flash 与 MiniMax-M3，二者均为多模态模型，可直接读图；' +
      'M2.5 / M2.7 已公告于 2026-11-18 退役，请勿再使用。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-2024-11-20'],
    defaultModel: 'gpt-4o-mini',
    supportsVision: true,
    docUrl: 'https://platform.openai.com/docs/guides/vision',
    note: 'gpt-4o / gpt-4.1 全系列支持图片输入，可直接用于拍照识别。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    supportsVision: false,
    docUrl: 'https://api-docs.deepseek.com/',
    note: 'DeepSeek 开放平台目前为纯文本模型，不能直接读图；拍照识别请搭配本地 OCR 服务，或改用支持视觉的模型。',
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      'qwen-vl-max',
      'qwen-vl-plus',
      'qwen2.5-vl-72b-instruct',
      'qwen2.5-vl-7b-instruct',
      'qwen-max',
      'qwen-plus',
    ],
    defaultModel: 'qwen-vl-max',
    supportsVision: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/vision',
    note: '只有 qwen-vl-* / qwen2.5-vl-* 系列支持图片输入；qwen-max、qwen-plus 为纯文本模型。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4v-flash', 'glm-4v-plus', 'glm-4-flash', 'glm-4-plus'],
    defaultModel: 'glm-4v-flash',
    supportsVision: true,
    docUrl: 'https://open.bigmodel.cn/dev/api/visual-model/glm-4v',
    note: 'GLM-4V 系列为多模态模型；glm-4-flash / glm-4-plus 为纯文本。',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-turbo-preview', 'kimi-latest', 'moonshot-v1-128k'],
    defaultModel: 'kimi-k2-turbo-preview',
    supportsVision: false,
    docUrl: 'https://platform.moonshot.cn/docs/intro',
    note: 'Kimi 开放平台当前主推模型为纯文本，不能直接读图；可配合本地 OCR 服务使用。',
  },
  {
    id: 'doubao',
    name: '字节豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      'doubao-1-5-vision-pro-32k',
      'doubao-seed-1-6-vision',
      'doubao-1-5-pro-32k',
      'doubao-1-5-lite-32k',
    ],
    defaultModel: 'doubao-1-5-vision-pro-32k',
    supportsVision: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1298454',
    note: '火山方舟需先创建「推理接入点」，实际模型名常形如 doubao-1-5-vision-pro-32k-xxxxxxxx。',
  },
  {
    id: 'baidu',
    name: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: ['ernie-4.5-vl-424b', 'ernie-4.5-vl-8b', 'ernie-4.0-turbo-8k', 'ernie-4.0-8k'],
    defaultModel: 'ernie-4.5-vl-424b',
    supportsVision: true,
    docUrl: 'https://cloud.baidu.com/product/qianfan',
    note: 'ERNIE 4.5 VL 系列支持图片输入；千帆的 v2 接口与 OpenAI 参数略有差异，个别模型不支持 response_format。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'Qwen/Qwen2.5-VL-72B-Instruct',
      'Qwen/Qwen2.5-VL-7B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
    ],
    defaultModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    supportsVision: true,
    docUrl: 'https://docs.siliconflow.cn/cn/userguide/capabilities/vision',
    note: '聚合平台，模型名带 org/model 前缀；Qwen2.5-VL 系列可直接读图。',
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5-vl:7b', 'qwen2.5-vl:3b', 'llava:7b', 'minicpm-v', 'gemma3:4b'],
    defaultModel: 'qwen2.5-vl:7b',
    supportsVision: true,
    docUrl: 'https://ollama.com/library/qwen2.5vl',
    note: '本地推理，零外网成本与零密钥泄露；需先 `ollama pull qwen2.5-vl:7b`，且服务需常驻运行。',
  },
  {
    id: 'vllm',
    name: '本地 vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    models: [
      'Qwen/Qwen3-VL-8B-Instruct',
      'Qwen/Qwen2.5-VL-7B-Instruct',
      'PaddlePaddle/PaddleOCR-VL',
    ],
    defaultModel: 'Qwen/Qwen3-VL-8B-Instruct',
    supportsVision: true,
    docUrl: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
    note:
      '校内私有化部署：`vllm serve Qwen/Qwen3-VL-8B-Instruct --port 8000`。提供 OpenAI 兼容接口，' +
      '后端零改动即可对接；图片不出校。注意 vLLM 的图片输入必须是**完整 data URL**（data:image/jpeg;base64,...），裸 base64 会被拒绝。',
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    models: [],
    defaultModel: '',
    supportsVision: false,
    note:
      '任意 OpenAI 兼容网关（如 OneAPI、NewAPI、自建 vLLM）。接口地址与模型名需手动填写；' +
      '模型名中含 vl / vision / omni / gpt-4o 等标识时后端会自动判定为视觉模型，否则可在保存时声明。',
  },
]

/** 预设 id -> 预设对象 */
export const PRESET_MAP = new Map(PROVIDER_PRESETS.map((p) => [p.id, p]))

/** 取预设（未知 id 返回 null） */
export function getPreset(id) {
  if (!id) return null
  return PRESET_MAP.get(String(id)) ?? null
}

/**
 * 视觉模型名特征：命中即认为是「能看图」的模型。
 * 用于 custom / 用户自填模型名的场景。
 */
const VISION_MODEL_PATTERNS = [
  /-vl\b/i,
  /\bvl-/i,
  /vl:/i,
  /vision/i,
  /omni/i,
  /multimodal/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-5/i,
  /chatgpt-4o/i,
  /minimax-m3/i,
  /glm-4v/i,
  /glm-4\.5v/i,
  /ernie.*vl/i,
  /doubao.*vision/i,
  /doubao.*vl/i,
  /llava/i,
  /minicpm-v/i,
  /pixtral/i,
  /internvl/i,
  /qwen.*-vl/i,
]

/** 模型名是否看起来是视觉模型 */
export function modelLooksVision(model) {
  const m = String(model ?? '').trim()
  if (!m) return false
  return VISION_MODEL_PATTERNS.some((re) => re.test(m))
}

/**
 * 综合判定「该配置是否支持视觉」。
 * @param {object} p
 * @param {string} p.provider  供应商 id
 * @param {string} p.model     模型名
 * @param {boolean} [p.declared] 用户显式声明（custom 供应商时使用）
 */
export function resolveVisionSupport({ provider, model, declared } = {}) {
  if (typeof declared === 'boolean') return declared
  const preset = getPreset(provider)
  // 明确不支持视觉的供应商（deepseek / moonshot）一律为 false；custom 走模型名启发式
  if (preset && !preset.supportsVision && preset.id !== 'custom') return false
  if (modelLooksVision(model)) return true
  // 使用预设默认模型时沿用预设能力
  if (preset && preset.supportsVision && preset.defaultModel === model) return true
  return false
}

/** 依据 baseUrl 猜测供应商 id（用于环境变量配置的引擎描述） */
export function guessProviderByBaseUrl(baseUrl) {
  const u = String(baseUrl ?? '').toLowerCase()
  if (!u) return 'custom'
  if (u.includes('minimax')) return 'minimax'
  if (u.includes('openai.com')) return 'openai'
  if (u.includes('deepseek')) return 'deepseek'
  if (u.includes('dashscope') || u.includes('aliyuncs')) return 'qwen'
  if (u.includes('bigmodel') || u.includes('zhipu')) return 'zhipu'
  if (u.includes('moonshot')) return 'moonshot'
  if (u.includes('volces') || u.includes('doubao')) return 'doubao'
  if (u.includes('baidubce') || u.includes('qianfan')) return 'baidu'
  if (u.includes('siliconflow')) return 'siliconflow'
  if (u.includes('11434') || u.includes('ollama')) return 'ollama'
  return 'custom'
}

export default PROVIDER_PRESETS
