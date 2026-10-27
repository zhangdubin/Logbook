/**
 * server/routes/settings.js —— AI 模型设置（前端可配置）
 *
 *   GET    /api/settings/providers  → AIProviderPreset[]
 *   GET    /api/settings/ai         → AISettings（apiKey 已掩码）
 *   PUT    /api/settings/ai         → AISettings（保存；掩码 apiKey 视为"不修改"）
 *   DELETE /api/settings/ai         → 204（恢复默认）
 *   POST   /api/settings/ai/test    → AIConnectionTestResult（始终 HTTP 200）
 */

import { Router } from 'express'

import { PROVIDER_PRESETS } from '../providers.js'
import {
  getAiSettingsPublic,
  saveAiSettings,
  resetAiSettings,
} from '../settings.js'
import { resolveProviderConfig, describeActiveEngine, testAiConnection } from '../ai.js'
import { requireAuth, requirePermission } from '../auth.js'

const router = Router()

/* ------------------------------ 供应商预设 ------------------------------ */
/* 任何已登录用户都可以读取（前端设置页要用） */
router.get('/providers', requireAuth, (_req, res) => {
  res.json(PROVIDER_PRESETS)
})

/* --------------------------- 读取当前设置 ------------------------------ */
/* 登录即可读（API Key 始终以掩码返回）；**修改** 需要 settings:ai 权限 */
router.get('/ai', requireAuth, (_req, res) => {
  const cfg = resolveProviderConfig()
  res.json({
    ...getAiSettingsPublic(),
    activeEngine: describeActiveEngine(cfg),
  })
})

/* --------------------------- 保存设置 ------------------------------ */
router.put('/ai', requirePermission('settings:ai'), (req, res) => {
  const body = req.body ?? {}
  const { errors, public: pub, stored } = saveAiSettings(body)
  if (errors.length) {
    return res.status(400).json({ error: 'BadRequest', message: errors.join('；'), errors })
  }
  const cfg = resolveProviderConfig()
  res.json({
    ...pub,
    activeEngine: describeActiveEngine(cfg),
    ...(stored?.updatedAt ? { updatedAt: stored.updatedAt } : {}),
  })
})

/* --------------------------- 恢复默认 ------------------------------ */
router.delete('/ai', requirePermission('settings:ai'), (_req, res) => {
  resetAiSettings()
  res.status(204).end()
})

/* --------------------------- 连接测试 ------------------------------ */
router.post('/ai/test', requirePermission('settings:ai'), async (req, res) => {
  try {
    const result = await testAiConnection(req.body ?? {})
    // 无论成功失败都返回 200，前端根据 ok 字段展示
    res.status(200).json(result)
  } catch (err) {
    res.status(200).json({
      ok: false,
      provider: String(req.body?.provider ?? ''),
      model: String(req.body?.model ?? ''),
      message: '连接失败',
      latencyMs: 0,
      vision: false,
      detail: `连接失败：${err?.message ?? '未知错误'}`,
    })
  }
})

export { router as settingsRouter }
export default router
