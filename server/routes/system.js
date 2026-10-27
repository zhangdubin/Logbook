/**
 * server/routes/system.js —— 系统设置与在线更新
 *
 *   GET    /api/system/config         → SystemConfig（仓库地址、代理等，非敏感）
 *   PUT    /api/system/config         → SystemConfig（保存；repo 必须是 owner/repo）
 *   GET    /api/system/update/info    → UpdateInfo（GitHub 最新 Release 概况）
 *   POST   /api/system/update/apply   → UpdateStatus（立即返回，更新在后台异步执行）
 *   GET    /api/system/update/status  → UpdateStatus（轮询任务进度）
 *   POST   /api/system/update/rollback→ UpdateStatus（立即返回，回滚在后台异步执行）
 *   POST   /api/system/update/publish → PublishResult（把本机源码发布成 Release）
 *
 * 权限：除 GET /config 外，其余端点都需要 `system:update`（仅管理员）。
 * 约定：任何单次请求失败都返回结构化结果而不是 500，避免前端拿不到原因。
 */

import { Router } from 'express'

import { requireAuth, requirePermission } from '../auth.js'
import {
  checkUpdate,
  currentVersion,
  getUpdateStatus,
  publishVersion,
  readSystemConfig,
  rollbackUpdate,
  runUpdate,
  saveSystemConfig,
} from '../systemUpdate.js'

const router = Router()

/* ------------------------------ 读取配置 ------------------------------ */
/* 仓库地址不是敏感信息，任何已登录用户都能读（前端要显示当前状态） */
router.get('/config', requireAuth, (_req, res) => {
  const cfg = readSystemConfig()
  // 令牌绝不明文回显，只给一个「有没有配」的布尔值
  res.json({
    repo: cfg.repo,
    autoRestart: cfg.autoRestart,
    proxy: cfg.proxy,
    hasToken: Boolean(cfg.hasToken),
    tokenSource: cfg.tokenSource ?? 'none',
    ...(cfg.updatedAt ? { updatedAt: cfg.updatedAt } : {}),
  })
})

/* ------------------------------ 保存配置 ------------------------------ */
router.put('/config', requirePermission('system:update'), (req, res) => {
  const { errors, config } = saveSystemConfig(req.body ?? {})
  if (errors?.length) {
    res.status(400).json({ error: 'BadRequest', message: errors.join('；') })
    return
  }
  res.json(config)
})

/* ---------------------------- 检查更新 ---------------------------- */
router.get('/update/info', requirePermission('system:update'), async (_req, res) => {
  try {
    res.json(await checkUpdate())
  } catch (e) {
    res.json({
      configured: false,
      repo: readSystemConfig().repo,
      // 异常分支也要带上真实版本号，否则前端会显示「当前版本为空」
      currentVersion: currentVersion(),
      latestVersion: '',
      latestTag: '',
      publishedAt: null,
      notes: '',
      hasUpdate: false,
      prerelease: false,
      message: e instanceof Error ? e.message : '检查更新失败',
    })
  }
})

/* ---------------------------- 执行更新 ---------------------------- */
/* 立即返回任务初始状态，真正的下载/备份/覆盖在后台跑，前端轮询 status */
router.post('/update/apply', requirePermission('system:update'), (_req, res) => {
  // 不 await：让响应先出去，任务在后台推进
  void runUpdate().catch(() => {
    /* runUpdate 内部已把错误写进状态里 */
  })
  res.json(getUpdateStatus())
})

/* ---------------------------- 任务状态 ---------------------------- */
router.get('/update/status', requirePermission('system:update'), (_req, res) => {
  res.json(getUpdateStatus())
})

/* ---------------------------- 回滚版本 ---------------------------- */
router.post('/update/rollback', requirePermission('system:update'), (_req, res) => {
  void rollbackUpdate().catch(() => {
    /* 同上，错误已写入状态 */
  })
  res.json(getUpdateStatus())
})

/* ---------------------------- 发布新版本 ---------------------------- */
/* 把本机源码打包成 tar.gz，创建 GitHub Release 并上传附件。
 * 与「一键更新」闭环：这里发布出去，其他机器就能一键拉取。 */
router.post('/update/publish', requirePermission('system:update'), async (req, res) => {
  try {
    const result = await publishVersion(req.body ?? {})
    res.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : '发布失败'
    res.status(e?.code === 'BadRequest' ? 400 : 500).json({
      ok: false,
      version: String(req.body?.version ?? '').trim(),
      tag: '',
      error: message,
      message,
    })
  }
})

export { router as systemRouter }
export default router
