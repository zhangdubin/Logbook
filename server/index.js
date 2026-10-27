/**
 * server/index.js —— Express 入口
 *
 *   监听端口：5181（前端 Vite 5180 把 /api 代理到这里）
 *   路由前缀：/api
 *   生产模式：若存在 dist/，静态托管并在未匹配路径回退到 index.html（SPA 路由可用）
 *
 * 中间件顺序（**鉴权的关键**）：
 *   1. cors / express.json
 *   2. GET /api/health、/api/version —— 公开（不泄露敏感信息）
 *   3. /api/auth/*              —— login 公开，logout/me/permissions/password 需登录
 *   4. /api/upload/*            —— 显式路由（requireAuth + 文件归属校验）
 *   5. app.use('/api', requireAuth) —— 其余所有 /api 接口一律要求登录
 *   6. 各业务路由（含 requirePermission 权限点校验与数据范围过滤）
 *
 * 启动：node --watch server/index.js   或   npm run dev:server
 */

import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { studentsRouter } from './routes/students.js'
import { questionsRouter } from './routes/questions.js'
import { statsRouter, knowledgeRouter } from './routes/stats.js'
import { analyzeRouter, chatRouter } from './routes/analyze.js'
import { uploadRouter } from './routes/upload.js'
import { settingsRouter } from './routes/settings.js'
import { authRouter } from './routes/auth.js'
import { usersRouter } from './routes/users.js'
import { systemRouter } from './routes/system.js'
import { ensureAdminUser, pruneExpiredSessions, requireAuth } from './auth.js'
import { resolveProviderConfig, describeEngineCode, describeActiveEngine } from './ai.js'
import { appVersion } from './version.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(ROOT, 'dist')

const PORT = Number(process.env.PORT || 5181)
const HOST = process.env.HOST || '0.0.0.0'

const app = express()

app.disable('x-powered-by')
// 需要携带 Cookie 的跨域请求（前端 5180 通过 Vite 代理访问，实为同源）
app.use(cors({ origin: true, credentials: true }))
// 拍照上传会带 base64，放宽 JSON 体积
app.use(express.json({ limit: '30mb' }))
app.use(express.urlencoded({ extended: true, limit: '30mb' }))

/* --------------------------- 健康检查（公开） --------------------------- */
app.get('/api/health', (_req, res) => {
  const cfg = resolveProviderConfig()
  res.json({
    ok: true,
    service: 'cuoti-analytics-api',
    version: appVersion().version,
    time: new Date().toISOString(),
    // 反映**实际生效**的引擎，而不是写死（不含任何密钥）
    ai: describeEngineCode(cfg),
    aiLabel: describeActiveEngine(cfg),
  })
})

/* --------------------------- 版本信息（公开） --------------------------- */
/**
 * 前端展示版本号用。不含任何敏感信息，因此公开。
 * 版本号取**运行时真实值**（读 package.json），而不是打包时写死的常量 ——
 * 因为「一键更新」之后前端 dist 可能没重建，只有后端知道当前真实版本。
 */
app.get('/api/version', (_req, res) => {
  const v = appVersion()
  res.json({
    name: '错题本 · 学情智能分析系统',
    version: v.version,
    commit: v.commit,
    builtAt: v.builtAt,
    node: process.version,
  })
})

/* --------------------------- API 路由 --------------------------- */

// 认证相关：login 公开，其余由 router 内部鉴权
app.use('/api/auth', authRouter)

// ★ 鉴权中间件：/api/health 与 /api/auth/login 之外的所有 /api 接口都要登录
app.use('/api', requireAuth)

app.use('/api/students', studentsRouter)
app.use('/api/questions', questionsRouter)
app.use('/api/stats', statsRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/analyze', analyzeRouter)
app.use('/api/ai', chatRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/users', usersRouter)
app.use('/api/system', systemRouter)

// 上传图片**不再用 express.static 直出**：
// 直出会绕过归属校验（任何登录用户猜到文件名就能下载任意学生的错题原图）。
// 统一走 uploadRouter 的显式路由（requireAuth + 文件归属校验）。
// 注意：必须挂在 app.use('/api', requireAuth) 之后，req.user 才有值。
app.use('/api/upload', uploadRouter)

/* ------------------------ 未匹配的 API 路径 ------------------------ */
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: `接口不存在: ${req.method} ${req.originalUrl}`,
  })
})

/* --------------------- 生产构建产物 + SPA 回退 --------------------- */
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }))
}

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  if (req.path.startsWith('/api')) return next()

  const indexHtml = path.join(DIST_DIR, 'index.html')
  if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml)

  res.status(404).json({
    error: 'NotFound',
    message: '前端构建产物不存在，请先执行 npm run build（或使用 Vite 开发服务器）',
  })
})

/* --------------------------- 错误处理 --------------------------- */
app.use((err, _req, res, _next) => {
  console.error('[server] 未捕获异常:', err)
  if (res.headersSent) return
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'BadRequest', message: '请求体不是合法的 JSON' })
  }
  res.status(500).json({ error: 'InternalError', message: err?.message || '服务器内部错误' })
})

/* ----------------------------- 启动 ----------------------------- */

// 首次启动：users 表为空时自动创建管理员账号
ensureAdminUser()
// 清理过期会话
try {
  pruneExpiredSessions()
} catch (err) {
  console.warn('[server] 清理过期会话失败:', err?.message)
}

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] 错题统计分析后端已启动: http://127.0.0.1:${PORT}/api`)
  console.log(`[server] 健康检查: GET http://127.0.0.1:${PORT}/api/health`)
  console.log(
    `[server] AI 引擎: ${describeActiveEngine(resolveProviderConfig())}`,
  )
})

server.on('error', (err) => {
  console.error('[server] 启动失败:', err)
  process.exit(1)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[server] 收到 ${sig}，正在关闭...`)
    server.close(() => process.exit(0))
  })
}

export default app
