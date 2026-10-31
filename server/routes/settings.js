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
import { resolveProviderConfig, describeActiveEngine, describeActiveEngineKind, testAiConnection } from '../ai.js'
import { probeOcrService } from '../ocr.js'
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
    // 结构化判定：前端不该靠解析 activeEngine 文案来猜引擎类型
    // （走大模型时文案里也有「本地 OCR 服务」，靠 /本地/ 猜会误判）
    activeEngineKind: describeActiveEngineKind(cfg),
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
    activeEngineKind: describeActiveEngineKind(cfg),
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

/* ------------------------- 本地 OCR 服务健康自检 ------------------------- */
/**
 * **为什么必须由后端探测，而不能让浏览器自己连？**
 *
 * Docker 部署时 OCR 侧车的地址是 `http://cuoti-ocr:8868` —— 那是 **Docker 内部网络**
 * 里的容器名，**浏览器根本解析不了**（浏览器跑在宿主机或用户手机上，不在 Docker 网络里）。
 *
 * 所以前端自己做直连检测的结果**永远是「连不上」**，哪怕服务好好地在跑、
 * 后端拍照识别也真的走通了。用户看到的就是「我明明启用了，为什么说没启用」。
 *
 * 后端在容器内，能连到 `cuoti-ocr` ✓。所以真相只能由后端给。
 *
 * 返回：
 *   reachable   后端探到没有（这才是真相）
 *   engine      服务自报的引擎名（rapidocr / paddleocr…）
 *   detail      原始响应或失败原因 —— 界面要能展开看，用户才排查得动
 *   latencyMs   探测耗时 —— 「142ms」是「真的在跑」的强信号
 *   configured  有没有配地址（区分「没配」和「配了但连不上」）
 */
router.get('/ocr-health', requireAuth, async (_req, res) => {
  const cfg = resolveProviderConfig()
  const baseUrl = String(cfg.ocrBaseUrl ?? '').trim()
  const configured = Boolean(baseUrl)

  if (!configured) {
    res.json({
      reachable: false,
      engine: null,
      detail: '未配置本地 OCR 服务地址',
      latencyMs: null,
      configured: false,
      baseUrl: '',
      checkedAt: new Date().toISOString(),
    })
    return
  }

  const started = Date.now()
  try {
    const probe = await probeOcrService({ baseUrl, timeoutMs: 8000 })
    const latencyMs = Date.now() - started
    // 服务自报的引擎名要从响应里抠出来（/health 返回的是 JSON 字符串）
    let engine = null
    try {
      const parsed = JSON.parse(probe.detail)
      if (parsed && typeof parsed === 'object') {
        for (const key of ['engine', 'ocr_engine', 'backend', 'model', 'name']) {
          if (typeof parsed[key] === 'string' && parsed[key].trim()) {
            engine = parsed[key].trim()
            break
          }
        }
      }
    } catch {
      /* 不是 JSON（老服务可能直接回纯文本），引擎名取不到就算了 */
    }
    res.json({
      reachable: Boolean(probe.reachable),
      engine,
      detail: probe.detail,
      latencyMs,
      configured: true,
      baseUrl,
      checkedAt: new Date().toISOString(),
    })
  } catch (err) {
    res.json({
      reachable: false,
      engine: null,
      detail: `探测失败：${String(err?.message ?? err).slice(0, 160)}`,
      latencyMs: Date.now() - started,
      configured: true,
      baseUrl,
      checkedAt: new Date().toISOString(),
    })
  }
})

export { router as settingsRouter }
export default router
