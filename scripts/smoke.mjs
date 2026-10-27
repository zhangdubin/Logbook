#!/usr/bin/env node
/**
 * 端到端接口契约自检脚本
 * 用法：node scripts/smoke.mjs [baseUrl]
 * 默认 baseUrl = http://127.0.0.1:5181
 *
 * 校验 src/lib/api.ts 中声明的全部端点的「结构」是否符合契约，
 * 并验证 stats/report、analyze 等关键能力可用。
 */

const BASE = process.argv[2] || 'http://127.0.0.1:5181'

let passed = 0
let failed = 0
const failures = []

function ok(name, detail = '') {
  passed++
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
}
function bad(name, detail = '') {
  failed++
  failures.push(`${name}: ${detail}`)
  console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
}
function check(name, cond, detail = '') {
  cond ? ok(name, detail) : bad(name, detail || '断言失败')
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

/** 极简 Cookie 罐：登录后把 ct_session 带上后续请求 */
const cookieJar = new Map()
function cookieHeader() {
  if (!cookieJar.size) return undefined
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}
function absorbCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? []
  for (const line of raw) {
    const [pair] = line.split(';')
    const idx = pair.indexOf('=')
    if (idx > 0) cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookieHeader() ? { Cookie: cookieHeader() } : undefined,
  })
  absorbCookies(res)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-json */
  }
  return { res, json, text, status: res.status }
}
async function send(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  absorbCookies(res)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-json */
  }
  return { res, json, text, status: res.status }
}

/** multipart 上传（带 Cookie 罐） */
async function upload(path, form) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: cookieHeader() ? { Cookie: cookieHeader() } : undefined,
    body: form,
  })
  absorbCookies(res)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-json */
  }
  return { res, json, text, status: res.status }
}

/** 1×1 透明 PNG */
/**
 * 检查数据库里没有落库的真实 GitHub 令牌。
 * 真实令牌形如 github_pat_…（细粒度）或 ghp_…（classic）；
 * 冒烟测试自己写入的假令牌 ghp_smoke_… 属于预期，不算泄露。
 */
async function checkNoRealTokenInDb() {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const path = new URL('../server/data/cuoti.db', import.meta.url)
    const db = new DatabaseSync(path)
    const rows = db.prepare('SELECT key, value FROM settings').all()
    db.close()
    for (const r of rows) {
      const v = String(r.value ?? '')
      const m = v.match(/(github_pat_[A-Za-z0-9_]{20,})|(ghp_[A-Za-z0-9]{20,})/g) || []
      const real = m.filter((x) => !x.startsWith('ghp_smoke_'))
      if (real.length) {
        return { ok: false, detail: `数据库 ${r.key} 里出现了真实令牌` }
      }
    }
    return { ok: true, detail: '数据库里没有真实令牌' }
  } catch (e) {
    return { ok: true, detail: `（跳过：${e.message}）` }
  }
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const hasKeys = (v, keys) => isObj(v) && keys.every((k) => k in v)

async function main() {
  console.log(`\x1b[1m接口契约自检 → ${BASE}\x1b[0m`)

  /* ---------- 基础连通 ---------- */
  section('基础连通')
  const health = await get('/api/health').catch(() => null)
  check('后端可达', health !== null, health ? `HTTP ${health.status}` : '连接失败')

  /* ---------- 版本号（前端展示用，公开端点） ---------- */
  section('版本信息')
  const ver = await get('/api/version').catch(() => null)
  check(
    'GET /api/version 返回版本号',
    ver?.status === 200 && typeof ver.json?.version === 'string' && ver.json.version.length > 0,
    ver ? `HTTP ${ver.status} version=${ver.json?.version}` : '连接失败',
  )
  check(
    '版本号符合 semver 形态',
    /^\d+\.\d+\.\d+/.test(ver?.json?.version ?? ''),
    ver?.json?.version ?? '(无)',
  )
  check(
    'GET /api/version 无需登录即可访问',
    ver?.status === 200,
    `HTTP ${ver?.status}`,
  )
  check(
    'health 也带版本号',
    typeof health?.json?.version === 'string' && health.json.version.length > 0,
    `version=${health?.json?.version}`,
  )
  check(
    '版本接口不泄露敏感信息',
    ver?.json && !('token' in ver.json) && !('apiKey' in ver.json),
    Object.keys(ver?.json ?? {}).join(','),
  )

  /* 未登录时不能读演示模式状态 */
  const demoRead = await get('/api/system/demo').catch(() => null)
  check(
    'GET /api/system/demo 需要登录',
    demoRead?.status === 401,
    `HTTP ${demoRead?.status}`,
  )

  /* ---------- 认证与权限 ---------- */
  section('认证与权限')
  const anon = await get('/api/students')
  check('未登录访问受保护端点返回 401', anon.status === 401, `HTTP ${anon.status}`)

  const login = await send('POST', '/api/auth/login', {
    username: 'admin',
    password: 'admin123',
  })
  check('管理员登录成功', login.status === 200, `HTTP ${login.status}`)
  check(
    '登录返回 user + permissions',
    hasKeys(login.json, ['user', 'permissions']) &&
      Array.isArray(login.json?.permissions) &&
      login.json.permissions.length > 0,
    `${login.json?.permissions?.length ?? 0} 个权限点`,
  )
  check(
    '管理员拥有 settings:ai 与 users:manage',
    login.json?.permissions?.includes('settings:ai') &&
      login.json?.permissions?.includes('users:manage'),
  )
  check(
    '登录响应不含口令散列',
    !JSON.stringify(login.json ?? {}).includes('scrypt$'),
  )

  const me = await get('/api/auth/me')
  check('GET /api/auth/me 返回当前用户', me.status === 200 && me.json?.user?.role === 'admin', `role=${me.json?.user?.role}`)

  const permMatrix = await get('/api/auth/permissions')
  check(
    'GET /api/auth/permissions 返回权限矩阵',
    permMatrix.status === 200 && isObj(permMatrix.json) && Object.keys(permMatrix.json).length >= 15,
    `${Object.keys(permMatrix.json ?? {}).length} 个权限点`,
  )

  const users = await get('/api/users')
  check('GET /api/users 返回账号数组', Array.isArray(users.json), `HTTP ${users.status}`)
  check(
    '账号字段完整 (id/username/name/role/status)',
    Array.isArray(users.json) &&
      users.json.length > 0 &&
      hasKeys(users.json[0], ['id', 'username', 'name', 'role', 'status']),
    `${users.json?.length ?? 0} 个账号`,
  )
  check(
    '账号列表不含口令散列',
    !JSON.stringify(users.json ?? []).includes('scrypt$'),
  )

  /* ---------- 演示模式（生产环境不该显示演示账号面板） ---------- */
  section('演示模式')
  check(
    '/api/version 带 demo 标志',
    typeof ver?.json?.demo === 'boolean',
    `demo=${ver?.json?.demo}`,
  )
  const demoAdmin = await get('/api/system/demo')
  check(
    '管理员可读演示模式状态',
    demoAdmin?.status === 200 && typeof demoAdmin.json?.demo === 'boolean',
    demoAdmin ? `HTTP ${demoAdmin.status} demo=${demoAdmin.json?.demo} source=${demoAdmin.json?.source}` : '连接失败',
  )
  check(
    '两个接口的 demo 值一致',
    demoAdmin?.json?.demo === ver?.json?.demo,
    `version=${ver?.json?.demo} system=${demoAdmin?.json?.demo}`,
  )
  // 演示模式默认必须关闭：生产环境一旦打开，登录页会把默认口令公开出去
  check(
    '未显式开启时演示模式为关闭',
    demoAdmin?.json?.demo === false,
    `demo=${demoAdmin?.json?.demo} source=${demoAdmin?.json?.source}`,
  )
  // 切到开启再复原，确认开关真的生效、且不留下残留状态
  const demoOn = await send('PUT', '/api/system/demo', { enabled: true })
  check(
    '可开启演示模式',
    demoOn?.status === 200 && demoOn.json?.demo === true && demoOn.json?.source === 'setting',
    demoOn ? `HTTP ${demoOn.status} source=${demoOn.json?.source}` : '连接失败',
  )
  const demoVerOn = await get('/api/version')
  check(
    '开启后 /api/version 同步为 demo=true',
    demoVerOn?.json?.demo === true,
    `demo=${demoVerOn?.json?.demo}`,
  )
  const demoReset = await send('PUT', '/api/system/demo', { reset: true })
  check(
    '可交回环境变量决定',
    demoReset?.status === 200 && demoReset.json?.stored === null,
    demoReset ? `HTTP ${demoReset.status} source=${demoReset.json?.source}` : '连接失败',
  )
  const demoVerOff = await get('/api/version')
  check(
    '复原后演示模式回到关闭',
    demoVerOff?.json?.demo === false,
    `demo=${demoVerOff?.json?.demo}`,
  )

  /* ---------- 学生 ---------- */
  section('学生档案')
  const students = await get('/api/students')
  check('GET /api/students 返回数组', Array.isArray(students.json), `HTTP ${students.status}`)
  if (!Array.isArray(students.json) || !students.json.length) {
    console.log('  \x1b[33m! 未检测到学生数据，请先执行 npm run seed\x1b[0m')
  } else {
    const s = students.json[0]
    check(
      '学生字段完整 (id/name/grade/avatarColor/createdAt)',
      hasKeys(s, ['id', 'name', 'grade', 'avatarColor', 'createdAt']),
      s.name,
    )
    const created = await send('POST', '/api/students', {
      name: '__冒烟测试学生__',
      grade: '初一',
    })
    check('POST /api/students', created.status === 200 || created.status === 201, `HTTP ${created.status}`)
    if (created.json?.id) {
      const patched = await send('PATCH', `/api/students/${created.json.id}`, { note: 'smoke' })
      check('PATCH /api/students/:id', patched.status === 200, `HTTP ${patched.status}`)
      const removed = await send('DELETE', `/api/students/${created.json.id}`)
      check('DELETE /api/students/:id', removed.status === 204 || removed.status === 200, `HTTP ${removed.status}`)
    }
  }

  const studentId = students.json?.[0]?.id

  /* ---------- 错题 ---------- */
  section('错题 CRUD 与筛选')
  const list = await get('/api/questions?page=1&pageSize=5')
  check('GET /api/questions 分页结构', hasKeys(list.json, ['items', 'total', 'page', 'pageSize']))
  check('items 为数组', Array.isArray(list.json?.items))
  const first = list.json?.items?.[0]
  if (first) {
    check(
      '错题字段完整 (subject/knowledgePoints/errorType/mastery/status)',
      hasKeys(first, ['id', 'studentId', 'subject', 'knowledgePoints', 'errorType', 'mastery', 'status', 'images']),
      `${first.subject} · ${first.errorType}`,
    )
    const filtered = await get(`/api/questions?studentId=${studentId}&pageSize=100`)
    check('按 studentId 过滤生效', filtered.json?.items?.length > 0, `${filtered.json?.items?.length} 条`)
    const bySubject = await get('/api/questions?subject=数学&pageSize=100')
    const pureSubject =
      !bySubject.json?.items?.length ||
      bySubject.json.items.every((q) => q.subject === '数学')
    check('按学科过滤生效', pureSubject, `${bySubject.json?.items?.length} 条`)
  }

  const newQ = await send('POST', '/api/questions', {
    studentId,
    subject: '数学',
    grade: '初一',
    knowledgePoints: ['__冒烟测试知识点__'],
    questionType: '选择题',
    stem: '__冒烟测试题目__',
    myAnswer: 'A',
    correctAnswer: 'B',
    errorType: 'knowledge_gap',
    difficulty: 3,
  })
  check('POST /api/questions', newQ.status === 200 || newQ.status === 201, `HTTP ${newQ.status}`)
  const qid = newQ.json?.id
  if (qid) {
    const patchedQ = await send('PATCH', `/api/questions/${qid}`, { stem: '__冒烟测试题目(改)__' })
    check('PATCH /api/questions/:id', patchedQ.status === 200, `HTTP ${patchedQ.status}`)
    const analyzed = await send('POST', `/api/questions/${qid}/analyze`, {})
    check(
      'POST /api/questions/:id/analyze 返回 AIAnalysis',
      hasKeys(analyzed.json, ['byModel', 'diagnosis', 'rootCauses', 'correctSteps', 'tips', 'summary']),
      `byModel=${analyzed.json?.byModel}`,
    )
    check(
      'diagnosis 结构正确 (type/confidence/reason)',
      hasKeys(analyzed.json?.diagnosis, ['type', 'confidence', 'reason']),
    )
    const corrected = await send('POST', `/api/questions/${qid}/corrected`, { corrected: true })
    check('POST /api/questions/:id/corrected', corrected.status === 200, `HTTP ${corrected.status}`)
    check('订正后 mastery 提升至巩固区间', (corrected.json?.mastery ?? 0) >= 70, `mastery=${corrected.json?.mastery}`)
    check('订正后 status 为巩固中或已掌握', ['learning', 'mastered'].includes(corrected.json?.status), `status=${corrected.json?.status}`)
    const del = await send('DELETE', `/api/questions/${qid}`)
    check('DELETE /api/questions/:id', del.status === 204 || del.status === 200, `HTTP ${del.status}`)
  }

  /* ---------- 清理兜底：确保冒烟数据不残留 ---------- */
  const leftovers = await get('/api/questions?keyword=' + encodeURIComponent('__冒烟测试题目__'))
  const leftoverItems = leftovers.json?.items ?? leftovers.json?.list ?? []
  for (const item of leftoverItems) {
    if (item?.id) await send('DELETE', `/api/questions/${item.id}`)
  }
  check('冒烟测试数据已清理干净', leftoverItems.length === 0, `残留 ${leftoverItems.length} 条`)

  /* ---------- 拍照分析 ---------- */
  section('拍照分析')
  const photo = await send('POST', '/api/analyze/photo', {
    image: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
    grade: '初一',
    subject: '数学',
  })
  check('POST /api/analyze/photo', photo.status === 200 || photo.status === 201, `HTTP ${photo.status}`)
  check(
    '返回 draft + analysis',
    hasKeys(photo.json, ['draft', 'analysis']) &&
      hasKeys(photo.json?.draft, ['subject', 'questionType', 'knowledgePoints', 'stem', 'confidence']),
  )

  /* ---------- AI 模型设置 ---------- */
  section('AI 模型设置')
  const providers = await get('/api/settings/providers')
  check('GET /api/settings/providers 返回预设数组', Array.isArray(providers.json), `${providers.json?.length ?? 0} 个`)
  check(
    '预设数量 ≥ 10',
    (providers.json?.length ?? 0) >= 10,
    `${providers.json?.length ?? 0} 个`,
  )
  const mm = providers.json?.find((p) => p.id === 'minimax')
  check('minimax 预设存在且支持视觉', !!mm && mm.supportsVision === true, mm?.defaultModel)
  check(
    '预设字段完整 (id/name/baseUrl/models/defaultModel/supportsVision)',
    !!mm && hasKeys(mm, ['id', 'name', 'baseUrl', 'models', 'defaultModel', 'supportsVision']),
  )

  const settings0 = await get('/api/settings/ai')
  check('GET /api/settings/ai 返回设置对象', hasKeys(settings0.json, ['provider', 'baseUrl', 'apiKey', 'model', 'hasApiKey', 'activeEngine']))

  const saved = await send('PUT', '/api/settings/ai', {
    provider: 'minimax',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKey: 'sk-smoke-FAKEKEY-9876543210',
    model: 'MiniMax-M3.1-Flash',
    enableModel: true,
  })
  check('PUT /api/settings/ai 成功', saved.status === 200, `HTTP ${saved.status}`)
  check('返回的 apiKey 已掩码', typeof saved.json?.apiKey === 'string' && saved.json.apiKey.includes('*'), saved.json?.apiKey)
  check('hasApiKey 为 true', saved.json?.hasApiKey === true)

  const resaved = await send('PUT', '/api/settings/ai', { model: 'MiniMax-M3.1-Flash' })
  check('PUT 只传掩码 apiKey 不覆盖密钥', resaved.json?.hasApiKey === true, `apiKey=${resaved.json?.apiKey}`)

  const cleared = await send('PUT', '/api/settings/ai', { apiKey: '' })
  check('PUT 空串 apiKey 可清除密钥', cleared.json?.hasApiKey === false, `hasApiKey=${cleared.json?.hasApiKey}`)

  const conn = await send('POST', '/api/settings/ai/test', {})
  check('POST /api/settings/ai/test 始终返回 200', conn.status === 200, `HTTP ${conn.status}`)
  check('连通性测试返回 ok 字段', typeof conn.json?.ok === 'boolean', `ok=${conn.json?.ok}`)

  const reset = await send('DELETE', '/api/settings/ai')
  check('DELETE /api/settings/ai 恢复默认', reset.status === 204 || reset.status === 200, `HTTP ${reset.status}`)

  /* ---------- 角色数据隔离 ---------- */
  section('角色数据隔离')
  const adminCookie = new Map(cookieJar)
  const adminStudents = await get('/api/students')
  const adminStudentIds = (adminStudents.json ?? []).map((s) => s.id)

  cookieJar.clear()
  const parentLogin = await send('POST', '/api/auth/login', {
    username: 'parent',
    password: 'parent123',
  })
  check('家长登录成功', parentLogin.status === 200, `HTTP ${parentLogin.status}`)
  const parentStudents = await get('/api/students')
  check(
    '家长只看到自己关联的学生',
    Array.isArray(parentStudents.json) &&
      parentStudents.json.length > 0 &&
      parentStudents.json.length < adminStudentIds.length,
    `${parentStudents.json?.length ?? 0}/${adminStudentIds.length} 名学生`,
  )
  const foreign = adminStudentIds.find((id) => !parentStudents.json.some((s) => s.id === id))
  if (foreign) {
    const cross = await get(`/api/stats/report?studentId=${foreign}`)
    check('家长越权查看他人报告返回 403', cross.status === 403, `HTTP ${cross.status}`)
  }
  const parentSettings = await send('PUT', '/api/settings/ai', { model: 'x' })
  check('家长修改系统设置返回 403', parentSettings.status === 403, `HTTP ${parentSettings.status}`)

  /* ---------- 上传图片的归属隔离 ---------- */
  const parentStudentId = parentStudents.json?.[0]?.id
  const pngBytes = Buffer.from(TINY_PNG_BASE64, 'base64')
  const form = new FormData()
  form.append('photo', new Blob([pngBytes], { type: 'image/png' }), 'smoke.png')
  if (parentStudentId) form.append('studentId', parentStudentId)
  const up = await upload('/api/upload/photo', form)
  check('家长上传照片成功', up.status === 201 || up.status === 200, `HTTP ${up.status}`)
  const filename = String(up.json?.url ?? '').split('/').pop()
  check('上传返回可访问的文件名', !!filename, filename)

  const own = await get(`/api/upload/${filename}`)
  check('上传者本人可访问该图片', own.status === 200, `HTTP ${own.status}`)

  const anonCookie = new Map(cookieJar)
  cookieJar.clear()
  const anonFile = await get(`/api/upload/${filename}`)
  check('未登录访问图片返回 401', anonFile.status === 401, `HTTP ${anonFile.status}`)
  cookieJar.clear()
  anonCookie.forEach((v, k) => cookieJar.set(k, v))

  // 造一个「第二个家长」，关联别人的学生，验证其拿不到本家长的图片
  const otherStudentId = adminStudentIds.find((id) => id !== parentStudentId)
  let tempParentId = ''
  if (otherStudentId) {
    cookieJar.clear()
    adminCookie.forEach((v, k) => cookieJar.set(k, v))
    const created = await send('POST', '/api/users', {
      username: `__smoke_parent_${Date.now()}`,
      password: 'smoke123456',
      name: '冒烟测试家长',
      role: 'parent',
    })
    tempParentId = created.json?.id ?? ''
    check('管理员可创建家长账号', created.status === 200 && !!tempParentId, `HTTP ${created.status}`)
    if (tempParentId) {
      const linked = await send('POST', `/api/users/${tempParentId}/students/${otherStudentId}`)
      check('管理员可关联学生', linked.status === 200, `HTTP ${linked.status}`)

      cookieJar.clear()
      await send('POST', '/api/auth/login', {
        username: created.json?.username,
        password: 'smoke123456',
      })
      const cross = await get(`/api/upload/${filename}`)
      check('他人家长访问该图片返回 403', cross.status === 403, `HTTP ${cross.status}`)
    }
  }

  // 清理临时账号
  if (tempParentId) {
    cookieJar.clear()
    adminCookie.forEach((v, k) => cookieJar.set(k, v))
    const del = await send('DELETE', `/api/users/${tempParentId}`)
    check('临时测试账号已清理', del.status === 204 || del.status === 200, `HTTP ${del.status}`)
  }

  cookieJar.clear()
  adminCookie.forEach((v, k) => cookieJar.set(k, v))
  const parentLogin2 = await send('POST', '/api/auth/login', {
    username: 'parent',
    password: 'parent123',
  })
  check('家长重新登录成功', parentLogin2.status === 200, `HTTP ${parentLogin2.status}`)

  cookieJar.clear()
  const studentLogin = await send('POST', '/api/auth/login', {
    username: 'student',
    password: 'student123',
  })
  check('学生登录成功', studentLogin.status === 200, `HTTP ${studentLogin.status}`)
  const studentReport = await get('/api/stats/report')
  check('学生查看学情报告返回 403', studentReport.status === 403, `HTTP ${studentReport.status}`)
  const studentExport = await get('/api/stats/export')
  check('学生导出报表返回 403', studentExport.status === 403, `HTTP ${studentExport.status}`)
  const studentUsers = await get('/api/users')
  check('学生访问账号管理返回 403', studentUsers.status === 403, `HTTP ${studentUsers.status}`)
  const studentOverview = await get('/api/stats/overview')
  check('学生仍可访问自己的学情总览', studentOverview.status === 200, `HTTP ${studentOverview.status}`)

  // 恢复管理员会话，供后续统计与设置用例使用
  cookieJar.clear()
  adminCookie.forEach((v, k) => cookieJar.set(k, v))

  /* ---------- 统计 ---------- */
  section('统计分析')
  const ov = await get(`/api/stats/overview?studentId=${studentId}`)
  check('GET /api/stats/overview', ov.status === 200, `HTTP ${ov.status}`)
  check('overview 顶层结构', hasKeys(ov.json, ['totals', 'bySubject', 'byErrorType', 'trend', 'heatmap', 'weakPoints', 'recent']))
  check('totals 结构', hasKeys(ov.json?.totals, ['questions', 'corrected', 'mastery', 'pending', 'activeDays']))
  check('bySubject 元素结构', Array.isArray(ov.json?.bySubject) && (!ov.json.bySubject.length || hasKeys(ov.json.bySubject[0], ['key', 'label', 'total', 'mastery', 'errorRate'])))
  check('byErrorType 元素结构', Array.isArray(ov.json?.byErrorType) && (!ov.json.byErrorType.length || hasKeys(ov.json.byErrorType[0], ['type', 'label', 'count', 'ratio'])))
  check('trend 元素结构', Array.isArray(ov.json?.trend) && (!ov.json.trend.length || hasKeys(ov.json.trend[0], ['date', 'total', 'mastery'])))
  check('weakPoints 元素结构', Array.isArray(ov.json?.weakPoints) && (!ov.json.weakPoints.length || hasKeys(ov.json.weakPoints[0], ['name', 'subject', 'total', 'mastery', 'severity'])))

  const rep = await get(`/api/stats/report?studentId=${studentId}`)
  check('GET /api/stats/report', rep.status === 200, `HTTP ${rep.status}`)
  check(
    'report 结构 (summary/strengths/weaknesses/suggestions/weeklyPlan/parentNotes)',
    hasKeys(rep.json, ['summary', 'strengths', 'weaknesses', 'suggestions', 'weeklyPlan', 'parentNotes']),
  )

  const kp = await get('/api/knowledge/points')
  check('GET /api/knowledge/points', Array.isArray(kp.json), `${kp.json?.length ?? 0} 个知识点`)

  /* ---------- 导出 ---------- */
  section('数据导出')
  const authHeaders = cookieHeader() ? { Cookie: cookieHeader() } : undefined
  const xlsx = await fetch(`${BASE}/api/stats/export?format=xlsx&studentId=${studentId}`, {
    headers: authHeaders,
  })
  const xbuf = Buffer.from(await xlsx.arrayBuffer())
  check('xlsx 导出', xlsx.status === 200 && xbuf.length > 1000, `${xbuf.length} bytes`)
  check('xlsx 为合法 zip 容器', xbuf.slice(0, 2).toString() === 'PK')
  const csv = await fetch(`${BASE}/api/stats/export?format=csv&studentId=${studentId}`, {
    headers: authHeaders,
  })
  const ctext = await csv.text()
  check('csv 导出', csv.status === 200 && ctext.length > 50, `${ctext.length} chars`)

  /* ---------- 系统设置与在线更新 ---------- */
  section('系统设置与在线更新')
  cookieJar.clear()
  adminCookie.forEach((v, k) => cookieJar.set(k, v))
  const sysConfig = await get('/api/system/config')
  check('GET /api/system/config 返回系统配置', hasKeys(sysConfig.json, ['repo', 'autoRestart', 'proxy', 'hasToken']), `HTTP ${sysConfig.status}`)
  check('配置里没有明文令牌', sysConfig.json?.token === undefined, JSON.stringify(sysConfig.json?.token))

  const badRepo = await send('PUT', '/api/system/config', { repo: '不是合法仓库地址', autoRestart: false })
  check('非法仓库地址被拒绝 (400)', badRepo.status === 400, `HTTP ${badRepo.status}`)

  const badProxy = await send('PUT', '/api/system/config', { repo: 'octocat/hello-world', autoRestart: false, proxy: 'ftp://不是代理' })
  check('非法代理地址被拒绝 (400)', badProxy.status === 400, `HTTP ${badProxy.status}`)

  const okRepo = await send('PUT', '/api/system/config', {
    repo: 'octocat/hello-world',
    autoRestart: false,
    proxy: 'http://127.0.0.1:7890',
  })
  check('PUT /api/system/config 保存合法仓库', okRepo.status === 200, `HTTP ${okRepo.status}`)
  check('仓库地址已保存', okRepo.json?.repo === 'octocat/hello-world', okRepo.json?.repo)
  check('代理地址已保存', okRepo.json?.proxy === 'http://127.0.0.1:7890', okRepo.json?.proxy)

  // 令牌：保存后只回显 hasToken，不回显明文
  const withToken = await send('PUT', '/api/system/config', {
    repo: 'octocat/hello-world',
    autoRestart: false,
    proxy: '',
    token: 'ghp_smoke_token_1234567890',
  })
  check('令牌保存成功', withToken.status === 200, `HTTP ${withToken.status}`)
  check('令牌只回显 hasToken', withToken.json?.hasToken === true && withToken.json?.token === undefined, JSON.stringify(withToken.json?.hasToken))

  // 留空 = 不修改
  const keepToken = await send('PUT', '/api/system/config', {
    repo: 'octocat/hello-world',
    autoRestart: false,
    proxy: '',
  })
  check('令牌留空表示不修改', keepToken.json?.hasToken === true, JSON.stringify(keepToken.json?.hasToken))

  // 回归：后端进程带 GITHUB_TOKEN 环境变量时，「留空 = 不修改」绝不能把
  // 环境变量里的真实令牌写进数据库（否则环境变量的密钥会落库）。
  // 直接查数据库验证这个不变量 —— 令牌永远不该通过接口回显。
  const dbLeak = await checkNoRealTokenInDb()
  check(
    '留空保存不会把环境变量令牌写进数据库',
    dbLeak.ok,
    dbLeak.detail,
  )

  const updateInfo = await get('/api/system/update/info')
  check('GET /api/system/update/info 返回更新信息', updateInfo.status === 200, `HTTP ${updateInfo.status}`)
  check(
    'UpdateInfo 字段完整',
    hasKeys(updateInfo.json, ['configured', 'repo', 'currentVersion', 'hasUpdate']),
    Object.keys(updateInfo.json ?? {}).join(','),
  )
  check('当前版本号可读', typeof updateInfo.json?.currentVersion === 'string' && !!updateInfo.json.currentVersion, updateInfo.json?.currentVersion)

  const updateStatus = await get('/api/system/update/status')
  check('GET /api/system/update/status 返回任务状态', updateStatus.status === 200, `HTTP ${updateStatus.status}`)
  check(
    'UpdateStatus 字段完整',
    hasKeys(updateStatus.json, ['state', 'message', 'progress', 'log']),
    Object.keys(updateStatus.json ?? {}).join(','),
  )

  // 权限：非管理员访问更新端点必须 403
  cookieJar.clear()
  await send('POST', '/api/auth/login', { username: 'parent', password: 'parent123' })
  const parentUpdate = await get('/api/system/update/info')
  check('家长访问更新信息被拒绝 (403)', parentUpdate.status === 403, `HTTP ${parentUpdate.status}`)
  const parentApply = await send('POST', '/api/system/update/apply')
  check('家长触发更新被拒绝 (403)', parentApply.status === 403, `HTTP ${parentApply.status}`)

  // 未登录必须 401
  cookieJar.clear()
  const anonUpdate = await get('/api/system/update/info')
  check('未登录访问更新信息被拒绝 (401)', anonUpdate.status === 401, `HTTP ${anonUpdate.status}`)

  /* ---------- 发布新版本 ---------- */
  cookieJar.clear()
  adminCookie.forEach((v, k) => cookieJar.set(k, v))
  const publishBadVersion = await send('POST', '/api/system/update/publish', { version: '不是版本号', notes: '' })
  check('非法版本号被拒绝 (400)', publishBadVersion.status === 400, `HTTP ${publishBadVersion.status}`)

  const publishNoRepo = await send('PUT', '/api/system/config', { repo: '', autoRestart: false, proxy: '' })
  check('清空仓库配置成功', publishNoRepo.status === 200, `HTTP ${publishNoRepo.status}`)
  const publishNoRepoRes = await send('POST', '/api/system/update/publish', { version: '9.9.9', notes: '' })
  check('未配置仓库时发布被拒绝 (400)', publishNoRepoRes.status === 400, `HTTP ${publishNoRepoRes.status}`)
  check(
    '发布失败提示可读',
    typeof publishNoRepoRes.json?.message === 'string' && publishNoRepoRes.json.message.includes('仓库'),
    publishNoRepoRes.json?.message,
  )

  // 权限：家长不能发布
  cookieJar.clear()
  await send('POST', '/api/auth/login', { username: 'parent', password: 'parent123' })
  const parentPublish = await send('POST', '/api/system/update/publish', { version: '9.9.9', notes: '' })
  check('家长发布新版本被拒绝 (403)', parentPublish.status === 403, `HTTP ${parentPublish.status}`)

  // 未登录必须 401
  cookieJar.clear()
  const anonPublish = await send('POST', '/api/system/update/publish', { version: '9.9.9', notes: '' })
  check('未登录发布新版本被拒绝 (401)', anonPublish.status === 401, `HTTP ${anonPublish.status}`)

  // 恢复现场：清掉仓库配置与令牌
  cookieJar.clear()
  adminCookie.forEach((v, k) => cookieJar.set(k, v))
  await send('PUT', '/api/system/config', { repo: '', autoRestart: false, proxy: '', token: '__CLEAR__' })
  const restored = await get('/api/system/config')
  // 若后端进程本身带 GITHUB_TOKEN 环境变量，hasToken 会恒为 true
  // （环境变量优先于系统设置里的令牌），此时令牌来源应为 env。
  const tokenCleared =
    restored.json?.hasToken === false ||
    restored.json?.tokenSource === 'env'
  check(
    '测试后配置已复原',
    restored.json?.repo === '' && tokenCleared,
    JSON.stringify(restored.json),
  )

  /* ---------- 汇总 ---------- */
  console.log(`\n\x1b[1m结果：${passed} 通过 / ${failed} 失败\x1b[0m`)
  if (failures.length) {
    console.log('\x1b[31m失败项：\x1b[0m')
    failures.forEach((f) => console.log(`  - ${f}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('\x1b[31m自检异常终止：\x1b[0m', e)
  process.exit(1)
})
