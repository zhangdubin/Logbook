/**
 * entry/engine —— 识别引擎状态与对应文案
 * ---------------------------------------------------------------------------
 * 不是所有学校都配了大模型：配了视觉模型 / 只配了本地 OCR / 两个都没配，
 * 实际走的是完全不同的链路。文案必须诚实反映当前配置，否则用户点完发现
 * 识别结果不对，会觉得被骗。
 *
 * 状态来源：GET /api/settings/ai（登录即可读，不需要管理员权限）。
 * 字段缺失 / 接口失败 → 'unknown' → 使用中性文案，不承诺 AI。
 */

/** 当前识别能力 */
export type EngineState =
  /** 配了视觉模型（图片会发给大模型） */
  | 'vision'
  /** 没配模型，但本地 OCR 可用（图片不出校） */
  | 'local'
  /** 两个都没配：只能靠手动补录 */
  | 'none'
  /** 拿不到配置（接口失败 / 权限不足）：用中性文案 */
  | 'unknown'

/** 采集区的主标题 */
export const ENGINE_HEADLINE: Record<EngineState, string> = {
  vision: '把错题拍下来，AI 帮你识别',
  local: '把错题拍下来，本地引擎识别，图片不出校',
  none: '把错题拍下来。本机还没配置识别引擎，识别结果需要手动校对',
  unknown: '把错题拍下来，识别后可以逐项核对再保存',
}

/** 采集区的补充说明 */
export const ENGINE_DESC: Record<EngineState, string> = {
  vision: '手机端点「拍照」直接调起相机；电脑上可以把图片拖进来，或按 Ctrl/Cmd+V 粘贴截图。',
  local:
    '本机识别，照片不会上传到网上。手机端点「拍照」直接调起相机；电脑上可以拖拽或 Ctrl/Cmd+V 粘贴。',
  none: '拍完会弹出裁剪框，识别结果需要你自己校对；也可以直接用「手动补录」。',
  unknown:
    '手机端点「拍照」直接调起相机；电脑上可以把图片拖进来，或按 Ctrl/Cmd+V 粘贴截图。',
}

/** 识别进行中的说明：让用户知道在等什么、大概要多久 */
export const ENGINE_BUSY_NOTE: Record<EngineState, string> = {
  vision: '正在把照片发给 AI 模型识别，通常 3~10 秒，请稍候。',
  local: '正在本机识别，照片不会上传到网上，通常 2~8 秒。',
  none: '本机没有配置识别引擎，这次可能识别不出来；你也可以直接手动补录。',
  unknown: '正在识别，通常需要几秒，请稍候。',
}

/** 主操作按钮的文案：按钮上不能写死「AI」 */
export const ENGINE_ACTION: Record<EngineState, string> = {
  vision: '✨ 开始 AI 识别',
  local: '🔍 开始本地识别',
  none: '🔍 尝试识别',
  unknown: '🔍 开始识别',
}

/** 「重新识别」按钮 */
export const ENGINE_RETRY: Record<EngineState, string> = {
  vision: '↺ 重新识别',
  local: '↺ 重新识别',
  none: '↺ 再试一次',
  unknown: '↺ 重新识别',
}

/** 识别失败时给的建议 */
export function engineFailTips(engine: EngineState, message: string): string[] {
  const msg = message.toLowerCase()
  const noText =
    msg.includes('未识别') ||
    msg.includes('没有识别') ||
    msg.includes('无文字') ||
    msg.includes('no text') ||
    msg.includes('ocr')
  if (engine === 'none') {
    return [
      '本机还没配置识别引擎，现在只能靠手动补录。',
      '管理员可以在「系统设置 → AI 引擎」里配置后，拍照就能自动识别了。',
    ]
  }
  if (noText) {
    return [
      '没认出文字：可能是拍得太暗、有反光，或者框里不是题目。',
      '试试重新裁剪，只留题干和选项；或者把光线调亮一点重拍一张。',
    ]
  }
  return ['识别服务暂时不可用，照片已经保留。', '可以再试一次，或者先手动补录，之后再补充识别。']
}
