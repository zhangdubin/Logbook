/**
 * server/systemUpdate.js —— 基于 GitHub Release 的「一键更新」后端
 * ---------------------------------------------------------------------------
 * 能力：
 *   1. 系统配置（仓库地址 / 是否自动重启）持久化到 settings 表 key='system.config'
 *   2. 检查更新：GET {GITHUB_API_BASE}/repos/{owner}/{repo}/releases/latest
 *   3. 下载：优先 Release 附件（.tar.gz / .zip），否则用源码 tarball
 *   4. 解压：node:zlib 解 gzip + 自研 tar 解析器（server/tar.js），落到临时目录
 *   5. 应用：备份当前版本 -> 覆盖程序文件 -> 记录历史 -> 视配置决定是否重启
 *   6. 回滚：用最近一次备份把程序文件恢复回去
 *
 * 安全约定：
 *   - GITHUB_TOKEN 只用于请求，**绝不**写进响应 / 日志 / 状态文件
 *   - 解压拒绝路径穿越、绝对路径、符号链接等非文件条目
 *   - 备份与覆盖都排除：server/data、server/uploads、.env*、node_modules、dist、backups
 *   - 同一时刻只允许一个更新/回滚任务（模块级 running 标志）
 *
 * 本模块不引入任何 npm 依赖。
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { db, nowISO, parseJSON } from './db.js'
import { extractTar } from './tar.js'
import { request } from './httpClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 安装根目录（server/ 的上一级） */
export const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(__dirname, 'data')
const STATE_FILE = path.join(DATA_DIR, 'update-state.json')
const HISTORY_FILE = path.join(DATA_DIR, 'update-history.json')
const BACKUP_DIR = path.join(ROOT, 'backups')
const PACKAGE_JSON = path.join(ROOT, 'package.json')

/** settings 表中的键 */
export const SYSTEM_CONFIG_KEY = 'system.config'

/** GitHub API 基址（可配置，便于本地 mock 自测） */
export const GITHUB_API_BASE = String(process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '')

const REQUEST_TIMEOUT_MS = 15000

/* -------------------------------------------------------------------------- */
/* 排除规则                                                                    */
/* -------------------------------------------------------------------------- */

/** 任意层级都要排除的目录名 */
const EXCLUDE_DIR_NAMES = new Set(['node_modules', 'dist', 'backups', '.git'])
/** 相对安装根目录需要排除的路径（及其子目录） */
const EXCLUDE_REL_PATHS = ['server/data', 'server/uploads']
/** 任意层级都要排除的文件名 */
const EXCLUDE_FILE_NAMES = new Set(['.env', '.env.local'])

/**
 * 判断某个相对路径是否应被排除（备份与覆盖共用同一套规则）。
 * @param {string} rel 相对安装根目录的 posix 路径
 * @param {boolean} isDir
 */
export function isExcludedPath(rel, isDir = false) {
  const parts = String(rel ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
  if (!parts.length) return true
  if (parts.some((p) => EXCLUDE_DIR_NAMES.has(p))) return true
  if (EXCLUDE_FILE_NAMES.has(parts[parts.length - 1])) return true
  const prefix = parts.slice(0, 2).join('/')
  if (EXCLUDE_REL_PATHS.includes(prefix)) return true
  if (EXCLUDE_REL_PATHS.includes(parts.join('/'))) return true
  if (!isDir && parts.length === 1 && parts[0] === 'dist') return true
  return false
}

/* -------------------------------------------------------------------------- */
/* 系统配置                                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_SYSTEM_CONFIG = { repo: '', autoRestart: false, proxy: '' }

/**
 * 读取系统配置。
 * 优先级：数据库中的设置 > 环境变量。
 *   repo  ← GITHUB_REPO
 *   proxy ← GITHUB_PROXY
 *   token ← GITHUB_TOKEN（只存在环境变量里时优先用环境变量，避免被网页上的空值覆盖）
 */
export function readSystemConfig() {
  const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(SYSTEM_CONFIG_KEY)
  const raw = row ? parseJSON(row.value, null) : null
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const repo = String(stored.repo ?? '').trim() || String(process.env.GITHUB_REPO ?? '').trim()
  const proxy = String(stored.proxy ?? '').trim() || String(process.env.GITHUB_PROXY ?? '').trim()
  const envToken = String(process.env.GITHUB_TOKEN ?? '').trim()
  const storedToken = String(stored.token ?? '').trim()
  const token = envToken || storedToken
  return {
    repo,
    autoRestart: stored.autoRestart === true,
    proxy,
    token,
    // 仅数据库里存的那一份。保存配置时必须以它为基准，
    // 否则「留空 = 不修改」会把环境变量里的令牌写进数据库。
    storedToken,
    hasToken: Boolean(token),
    // 令牌来源：env = 环境变量 GITHUB_TOKEN（优先级更高），config = 系统设置里存的
    tokenSource: envToken ? 'env' : (storedToken ? 'config' : 'none'),
    ...(row?.updated_at ? { updatedAt: row.updated_at } : {}),
  }
}

/** 仓库格式校验：owner/repo */
export function isValidRepo(repo) {
  const s = String(repo ?? '').trim()
  if (!s) return true // 空串 = 未配置（允许清除）
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(s)
}

/** 版本号校验：1.2.3 / 1.2.3-beta.1 */
export function isValidVersion(version) {
  return /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]+)?$/.test(String(version ?? '').trim())
}

/** 代理地址校验：空串合法；否则必须是 http://host:port 或 http://user:pass@host:port */
export function isValidProxy(proxy) {
  const s = String(proxy ?? '').trim()
  if (!s) return true
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`)
    return /^https?:$/.test(u.protocol) && Boolean(u.hostname)
  } catch {
    return false
  }
}

/**
 * 保存系统配置。
 * token 留空 = 不修改（和 AI 密钥同样的语义）；传 '__CLEAR__' = 显式清除。
 */
export function saveSystemConfig(input = {}) {
  const errors = []
  const repo = String(input.repo ?? '').trim()
  if (!isValidRepo(repo)) {
    errors.push('repo 必须是 owner/repo 格式')
  }
  const proxy = String(input.proxy ?? '').trim()
  if (!isValidProxy(proxy)) {
    errors.push('proxy 必须是 http://host:port 形式的代理地址')
  }
  if (errors.length) return { errors }

  const current = readSystemConfig()
  const rawToken = input.token === undefined ? null : String(input.token)
  // 基准必须是「数据库里存的那份」，不能是有效令牌：
  // 环境变量里的令牌优先级更高，但不该被顺手写进数据库。
  let token = current.storedToken
  if (rawToken === '__CLEAR__') token = ''
  else if (rawToken && rawToken.trim()) token = rawToken.trim()

  const value = { repo, autoRestart: input.autoRestart === true, proxy, token }
  const now = nowISO()
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(SYSTEM_CONFIG_KEY, JSON.stringify(value), now)
  const envToken = String(process.env.GITHUB_TOKEN ?? '').trim()
  return {
    errors: [],
    config: {
      repo,
      autoRestart: value.autoRestart,
      proxy,
      hasToken: Boolean(envToken || token),
      tokenSource: envToken ? 'env' : (token ? 'config' : 'none'),
      updatedAt: now,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 版本比较                                                                    */
/* -------------------------------------------------------------------------- */

/** 解析版本号；非标准版本返回 null */
export function parseVersion(v) {
  const m = String(v ?? '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.+))?$/)
  if (!m) return null
  return {
    nums: [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)],
    pre: m[4] ?? null,
  }
}

/**
 * 比较两个版本号。
 * @returns {number|null} -1 / 0 / 1；无法比较（非标准版本号）时返回 null
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1
  }
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1 // 正式版 > 预发布版
  if (!pb.pre) return -1
  return pa.pre < pb.pre ? -1 : 1
}

/** 当前安装版本（读 package.json） */
export function currentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
    return String(pkg.version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

/* -------------------------------------------------------------------------- */
/* 状态                                                                        */
/* -------------------------------------------------------------------------- */

const MAX_LOG = 500

function defaultStatus() {
  return {
    state: 'idle',
    message: '尚未执行更新',
    progress: 0,
    log: [],
  }
}

function loadState() {
  try {
    const raw = parseJSON(fs.readFileSync(STATE_FILE, 'utf8'), null)
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.state === 'string') {
      return { ...defaultStatus(), ...raw, log: Array.isArray(raw.log) ? raw.log : [] }
    }
  } catch {
    /* 没有状态文件：首次运行 */
  }
  return defaultStatus()
}

/** 模块级当前状态 */
let status = loadState()
/** 更新/回滚互斥标志 */
let running = false
/** 是否已经写过状态文件 */
let stateFileWritten = false

function persistState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(status, null, 2), 'utf8')
    stateFileWritten = true
  } catch {
    /* 状态文件写失败不影响主流程 */
  }
}

/** 追加一条日志（自动脱敏） */
export function addLog(message) {
  const line = sanitize(String(message ?? ''))
  status.log = [...(status.log ?? []), line].slice(-MAX_LOG)
  persistState()
  return line
}

/** 脱敏：任何 token / 密钥都不能进日志与状态文件 */
export function sanitize(text) {
  let s = String(text ?? '')
  const token = String(process.env.GITHUB_TOKEN ?? '').trim()
  if (token) s = s.split(token).join('***')
  // 网页上保存的令牌同样要脱敏
  try {
    const stored = String(readSystemConfig().token ?? '').trim()
    if (stored) s = s.split(stored).join('***')
  } catch {
    /* 配置读不到就算了 */
  }
  s = s.replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '***')
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, 'sk-***')
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, '$1***')
  return s
}

/** 更新状态（合并 + 持久化） */
export function setStatus(patch) {
  status = { ...status, ...patch }
  persistState()
  return status
}

/** 读取当前状态（对外返回副本） */
export function getUpdateStatus() {
  return { ...status, log: [...(status.log ?? [])] }
}

/** 是否有任务正在跑 */
export function isUpdating() {
  return running
}

/* -------------------------------------------------------------------------- */
/* GitHub 交互                                                                 */
/* -------------------------------------------------------------------------- */

function githubHeaders({ auth = true } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cuoti-analytics',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = String(process.env.GITHUB_TOKEN ?? '').trim() || readSystemConfig().token
  if (auth && token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * 查询仓库的最新 Release。
 * @param {string} repo owner/repo
 * @param {object} opts { proxyUrl, token }
 * @returns {Promise<{ok: boolean, release?: object, kind?: string, message?: string}>}
 */
export async function fetchLatestRelease(repo, { proxyUrl = '', token = '' } = {}) {
  const ownerRepo = String(repo ?? '').trim()
  if (!ownerRepo) {
    return { ok: false, kind: 'not-configured', message: '尚未配置 GitHub 仓库' }
  }
  const url = `${GITHUB_API_BASE}/repos/${ownerRepo}/releases/latest`
  const headers = githubHeaders()
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await request(url, {
      method: 'GET',
      headers,
      proxyUrl,
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
    if (res.status === 404) {
      return { ok: false, kind: 'no-release', message: '该仓库还没有发布任何 Release' }
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers['x-ratelimit-remaining']
      if (String(remaining) === '0') {
        return { ok: false, kind: 'rate-limit', message: 'GitHub API 调用频率受限，请稍后再试或配置 GITHUB_TOKEN' }
      }
      return { ok: false, kind: 'forbidden', message: 'GitHub API 返回 403（仓库无访问权限或已被限流）' }
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, kind: 'http', message: `GitHub API 返回 HTTP ${res.status}` }
    }
    let release
    try {
      release = JSON.parse(res.body.toString('utf8'))
    } catch {
      return { ok: false, kind: 'http', message: 'GitHub API 返回内容无法解析' }
    }
    return { ok: true, release }
  } catch (err) {
    const msg = String(err?.message ?? '')
    if (/超时/.test(msg)) {
      return { ok: false, kind: 'timeout', message: 'GitHub API 请求超时（15 秒）' }
    }
    if (/代理/.test(msg)) {
      return { ok: false, kind: 'proxy', message: msg }
    }
    return { ok: false, kind: 'network', message: `无法连接 GitHub API：${shortError(err)}` }
  }
}

/** 在 Release 的附件里找一个可用的源码包 */
export function pickAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  // 只认 tar 系：解包器只实现了 tar/gzip（server/tar.js）。
  // 这里曾经把 .zip 也列进候选，一旦发布方挂了 zip 附件就会选中它，
  // 然后在解包阶段失败 —— 所以宁可回退到源码 tarball，也不要选一个解不开的包。
  const wanted = ['.tar.gz', '.tgz']

  // 同一个 Release 下现在挂了两个包，选取顺序必须确定，不能依赖 API 返回顺序：
  //   1) 源码包   cuoti-analytics-v<版本>.tar.gz          —— 一键更新用这个
  //   2) 部署版本 cuoti-analytics-v<版本>-deploy.tar.gz   —— 云服务器安装用这个
  // 两者内容基本一致（部署版本多一个 dist/，而 dist/ 在更新时本来就会被排除），
  // 所以选谁都能正确更新；这里优先源码包，避免白下 dist/ 那部分体积。
  const sourcePkg = assets.find((a) => {
    const n = String(a?.name ?? '').toLowerCase()
    return n.endsWith('.tar.gz') && !n.includes('-deploy.')
  })
  if (sourcePkg) return sourcePkg

  for (const ext of wanted) {
    const hit = assets.find((a) => String(a?.name ?? '').toLowerCase().endsWith(ext))
    if (hit) return hit
  }
  return null
}

/** 组装 UpdateInfo */
export function buildUpdateInfo(release, { repo, current, message, kind } = {}) {
  const base = {
    configured: Boolean(repo),
    repo: repo ?? '',
    currentVersion: current ?? currentVersion(),
    latestVersion: '',
    latestTag: '',
    publishedAt: null,
    notes: '',
    hasUpdate: false,
    prerelease: false,
  }
  if (kind === 'not-configured') {
    return { ...base, message: '尚未配置 GitHub 仓库' }
  }
  if (!release) {
    return { ...base, message: message ?? '暂时无法获取最新 Release' }
  }

  const tag = String(release.tag_name ?? '')
  const latest = tag.replace(/^v/i, '')
  const asset = pickAsset(release)
  const cmp = compareVersions(latest, base.currentVersion)

  let hasUpdate
  let note = message
  if (cmp === null) {
    // 非标准版本号：退化为「有新 Release 即视为有更新」
    hasUpdate = Boolean(tag) && latest !== base.currentVersion
    note = note ?? '版本号不是标准 semver，无法精确比较：按「有新 Release 即视为有更新」处理'
  } else {
    hasUpdate = cmp > 0
  }

  return {
    ...base,
    latestVersion: latest,
    latestTag: tag,
    publishedAt: release.published_at ?? null,
    notes: String(release.body ?? ''),
    hasUpdate,
    prerelease: release.prerelease === true,
    ...(asset ? { assetName: String(asset.name ?? ''), assetSize: Number(asset.size ?? 0) || undefined } : {}),
    ...(note ? { message: note } : {}),
  }
}

/** 检查更新（对外端点用） */
export async function checkUpdate() {
  const cfg = readSystemConfig()
  const current = currentVersion()
  if (!cfg.repo) {
    return buildUpdateInfo(null, { repo: '', current, kind: 'not-configured' })
  }
  const res = await fetchLatestRelease(cfg.repo, { proxyUrl: cfg.proxy, token: cfg.token })
  if (!res.ok) {
    return buildUpdateInfo(null, { repo: cfg.repo, current, message: res.message, kind: res.kind })
  }
  return buildUpdateInfo(res.release, { repo: cfg.repo, current })
}

/* -------------------------------------------------------------------------- */
/* 下载                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 流式下载到磁盘（每 100ms 回调一次进度）。
 * @param {string} url
 * @param {string} dest
 * @param {(received:number,total:number)=>void} onProgress
 * @param {{auth?: boolean, proxyUrl?: string, fallbackNoAuth?: boolean, timeoutMs?: number}} opts
 *   公开仓库的附件在 CDN 跳转后不接受 Authorization 头，带上会 400；
 *   私有仓库的附件又**必须**带 Authorization 才能下载。
 *   所以：先按传入的 auth 试，失败再用另一种方式重试一次。
 */
export async function downloadTo(
  url,
  dest,
  onProgress,
  { auth = true, proxyUrl = '', fallbackNoAuth = true, timeoutMs = 10 * 60 * 1000 } = {},
) {
  const attempt = async (useAuth) => {
    const res = await request(url, {
      method: 'GET',
      headers: githubHeaders({ auth: useAuth }),
      proxyUrl,
      timeoutMs,
      connectTimeoutMs: 20_000,
      onProgress: (received, total) => onProgress?.(received, total),
    })
    return res
  }

  let res = await attempt(auth)
  if (
    fallbackNoAuth &&
    (res.status === 401 || res.status === 403 || res.status === 404)
  ) {
    // 一次失败就换另一种鉴权方式再试：
    // 带鉴权失败 → 公开仓库的 CDN 不接受该头；不带失败 → 私有仓库必须带头
    res = await attempt(!auth)
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`下载失败：HTTP ${res.status}`)
  }
  const total = Number(res.headers['content-length'] || 0)
  fs.writeFileSync(dest, res.body)
  onProgress?.(res.body.length, total || res.body.length)
  return { received: res.body.length, total: total || res.body.length }
}

/* -------------------------------------------------------------------------- */
/* 文件复制                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 递归复制（带排除规则）。
 * @param {string} src
 * @param {string} dest
 * @param {string} relBase 相对安装根目录的前缀（用于排除判断）
 */
async function copyRecursive(src, dest, relBase = '') {
  const stat = await fsp.lstat(src)
  if (stat.isSymbolicLink()) return // 不复制符号链接
  const rel = relBase ? `${relBase}/${path.basename(src)}` : path.basename(src)

  if (stat.isDirectory()) {
    if (isExcludedPath(rel, true)) return
    await fsp.mkdir(dest, { recursive: true })
    for (const entry of await fsp.readdir(src)) {
      await copyRecursive(path.join(src, entry), path.join(dest, entry), rel)
    }
    return
  }
  if (!stat.isFile()) return
  if (isExcludedPath(rel, false)) return
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.copyFile(src, dest)
}

/** 把 src 目录下的**内容**复制到 dest 目录 */
async function copyDirContents(src, dest, relBase = '') {
  await fsp.mkdir(dest, { recursive: true })
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    if (isJunkEntry(entry.name)) continue
    const childRel = relBase ? `${relBase}/${entry.name}` : entry.name
    if (isExcludedPath(childRel, entry.isDirectory())) continue
    await copyRecursive(path.join(src, entry.name), path.join(dest, entry.name), childRel)
  }
}

/**
 * 删除 target 下「在 source 里不存在」的条目，用于把回滚做成真正的还原。
 * 受保护目录（数据、密钥、依赖、备份）一律不动。
 * @returns {Promise<number>} 删除的文件数
 */
async function removeFilesNotIn(source, target, relBase = '') {
  let removed = 0
  let entries = []
  try {
    entries = await fsp.readdir(target, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (isJunkEntry(entry.name)) continue
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    if (isExcludedPath(rel, entry.isDirectory())) continue
    const srcPath = path.join(source, entry.name)
    const dstPath = path.join(target, entry.name)
    if (entry.isDirectory()) {
      let srcIsDir = false
      try {
        srcIsDir = (await fsp.lstat(srcPath)).isDirectory()
      } catch {
        srcIsDir = false
      }
      if (!srcIsDir) {
        // 备份里没有这个目录 → 整个删掉
        await fsp.rm(dstPath, { recursive: true, force: true })
        removed++
        continue
      }
      removed += await removeFilesNotIn(srcPath, dstPath, rel)
      continue
    }
    if (!entry.isFile()) continue
    const exists = await fsp
      .lstat(srcPath)
      .then((s) => s.isFile())
      .catch(() => false)
    if (!exists) {
      await fsp.rm(dstPath, { force: true })
      removed++
    }
  }
  return removed
}

/* -------------------------------------------------------------------------- */
/* 历史                                                                        */
/* -------------------------------------------------------------------------- */

export function readHistory() {
  try {
    const raw = parseJSON(fs.readFileSync(HISTORY_FILE, 'utf8'), [])
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeHistory(list) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8')
  } catch (err) {
    addLog(`写入更新历史失败：${shortError(err)}`)
  }
}

/* -------------------------------------------------------------------------- */
/* 更新主流程                                                                  */
/* -------------------------------------------------------------------------- */

function shortError(err) {
  const msg = String(err?.message ?? err ?? '未知错误').replace(/\s+/g, ' ').trim()
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg
}

/**
 * 归档里需要忽略的“杂物”条目。
 * macOS 的 tar 会带上 AppleDouble（`._xxx`）与 `__MACOSX/`，部分工具还会写
 * `pax_global_header` / `.DS_Store`。它们不是程序文件，必须排除，
 * 否则会破坏下面的「顶层目录识别」。
 */
function isJunkEntry(name) {
  return (
    name === '__MACOSX' ||
    name === '.DS_Store' ||
    name === 'pax_global_header' ||
    name.startsWith('._') ||
    name.startsWith('.DS_Store')
  )
}

/**
 * 找到临时目录里 Release 包的顶层目录。
 *
 * GitHub 的 tarball 解压后是 `owner-repo-sha/` 这一层；但不能只靠「有且只有一个
 * 条目」来判断 —— 一旦包里混进了 `._xxx`、`__MACOSX/`、`pax_global_header`
 * 这类杂物，识别就会失败，导致新版本被写进一个**嵌套子目录**，
 * 表面显示「更新成功」，实际程序文件根本没换（这是一个真实踩过的坑）。
 *
 * 判定顺序：
 *   1. 去掉杂物后恰好剩一个目录 → 就是它；
 *   2. 剩下多个目录 → 挑其中**含 package.json** 的那个（Node 项目的权威信号）；
 *   3. 都没有 → 退化为目录本身（按原样平铺复制）。
 */
function detectPackageRoot(dir) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return dir
  }
  const clean = entries.filter((e) => !isJunkEntry(e.name))
  const dirs = clean.filter((e) => e.isDirectory())

  if (dirs.length === 1 && clean.length === 1) return path.join(dir, dirs[0].name)

  const withPkg = dirs.filter((d) => {
    try {
      return fs.existsSync(path.join(dir, d.name, 'package.json'))
    } catch {
      return false
    }
  })
  if (withPkg.length === 1) return path.join(dir, withPkg[0].name)

  return dir
}

/**
 * 执行更新（异步后台任务）。重复调用时直接返回当前状态，不并发执行。
 * @returns {Promise<UpdateStatus>}
 */
export async function runUpdate() {
  if (running) {
    return getUpdateStatus()
  }
  running = true
  const previousVersion = currentVersion()

  try {
    setStatus({
      state: 'checking',
      message: '正在检查 GitHub Release…',
      progress: 2,
      log: [],
      startedAt: nowISO(),
      finishedAt: undefined,
      error: undefined,
      newVersion: undefined,
      previousVersion,
      requiresRestart: false,
    })
    addLog(`开始检查更新：当前版本 ${previousVersion}`)

    const cfg = readSystemConfig()
    if (!cfg.repo) {
      throw new Error('尚未配置 GitHub 仓库，请在「系统设置 → 系统更新」中填写 owner/repo')
    }

    const res = await fetchLatestRelease(cfg.repo, { proxyUrl: cfg.proxy, token: cfg.token })
    if (!res.ok) {
      throw new Error(res.message || '获取最新 Release 失败')
    }
    const release = res.release
    const tag = String(release.tag_name ?? '')
    const latest = tag.replace(/^v/i, '')
    addLog(`最新 Release：${tag || '(无 tag)'}`)

    const cmp = compareVersions(latest, previousVersion)
    if (cmp !== null && cmp <= 0) {
      setStatus({
        state: 'done',
        message: `当前已是最新版本（${previousVersion}）`,
        progress: 100,
        finishedAt: nowISO(),
      })
      addLog('无需更新，任务结束')
      return getUpdateStatus()
    }

    const asset = pickAsset(release)
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cuoti-update-'))
    const tarPath = path.join(tmpDir, 'package.tar.gz')

    /* ---------- 下载 ---------- */
    setStatus({ state: 'downloading', message: '正在下载更新包…', progress: 5 })
    const sourceTarballUrl = `${GITHUB_API_BASE}/repos/${cfg.repo}/tarball/${encodeURIComponent(tag)}`

    const progress = (got, total) => {
      const pct = total > 0
        ? Math.min(68, 5 + Math.round((got / total) * 63))
        : Math.min(68, 5 + Math.round((got / 1024 / 1024) * 10))
      setStatus({ progress: pct, message: `正在下载更新包…（${formatBytes(got)}${total ? ` / ${formatBytes(total)}` : ''}）` })
    }

    let received = 0
    if (asset?.browser_download_url) {
      const assetUrl = String(asset.browser_download_url)
      addLog(`使用 Release 附件：${asset.name}（${Number(asset.size ?? 0)} 字节）`)
      try {
        const r = await downloadTo(assetUrl, tarPath, progress, {
          auth: false, // 公开仓库的 CDN 不接受 Authorization 头；私有仓库会自动回退到带头
          proxyUrl: cfg.proxy,
          // 附件 CDN 时快时慢（实测同一条下载从 5 秒超时到 104 秒成功都有），
          // 所以给它单独的时间盒：超了就走源码 tarball（codeload 通道稳定在 2-3 秒）。
          timeoutMs: 90_000,
        })
        received = r.received
      } catch (err) {
        // 附件走的是 release-assets.githubusercontent.com，这个域名在国内常常连不通或极慢，
        // 而源码 tarball 走 codeload.github.com 通常是通的。
        // 所以附件失败时改走源码 tarball，而不是整个更新失败。
        addLog(`附件下载失败（${sanitize(shortError(err))}），改用源码 tarball`)
        const r = await downloadTo(sourceTarballUrl, tarPath, progress, {
          auth: true,
          proxyUrl: cfg.proxy,
        })
        received = r.received
      }
    } else {
      addLog(`Release 没有源码包附件，改用源码 tarball：${tag}`)
      const r = await downloadTo(sourceTarballUrl, tarPath, progress, {
        auth: true,
        proxyUrl: cfg.proxy,
      })
      received = r.received
    }
    addLog(`下载完成：${formatBytes(received)}`)

    /* ---------- 解压 ---------- */
    setStatus({ state: 'downloading', message: '正在解压更新包…', progress: 70 })
    const gz = await fsp.readFile(tarPath)
    const tarBuf = zlib.gunzipSync(gz)
    const extractDir = path.join(tmpDir, 'extracted')
    const { files, warnings } = extractTar(tarBuf, extractDir)
    for (const w of warnings) addLog(`⚠ ${w}`)
    addLog(`解压完成：${files.length} 个文件${warnings.length ? `，${warnings.length} 条警告` : ''}`)

    const pkgRoot = detectPackageRoot(extractDir)

    /* ---------- 备份 ---------- */
    setStatus({ state: 'applying', message: '正在备份当前版本…', progress: 76 })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = path.join(BACKUP_DIR, `${previousVersion}-${stamp}`)
    await fsp.mkdir(backupDir, { recursive: true })
    await copyDirContents(ROOT, backupDir)
    addLog(`已备份当前版本到：${path.relative(ROOT, backupDir)}`)

    /* ---------- 覆盖 ---------- */
    setStatus({ state: 'applying', message: '正在写入新版本文件…', progress: 86 })
    await copyDirContents(pkgRoot, ROOT)
    addLog('新版本文件已写入安装目录（已排除数据目录、密钥与构建产物）')

    /* ---------- 记录（校验通过后才写历史） ---------- */
    const newVersion = (() => {
      try {
        return String(JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version ?? latest)
      } catch {
        return latest
      }
    })()

    /* ---------- 校验：写进去的必须真的是新版本 ---------- */
    /* 覆盖逻辑一旦出问题（比如顶层目录识别错、把文件写进了嵌套子目录），
       这里必须拦下来报「失败」，绝不能让界面显示「更新成功」而程序根本没换。 */
    if (latest && newVersion === previousVersion) {
      const msg = `覆盖后版本号仍是 ${previousVersion}，新文件没有正确写入安装目录`
      addLog(`✗ ${msg}`)
      addLog('已保留备份，可调用「回滚」恢复；请检查更新包结构是否与预期一致')
      setStatus({
        state: 'failed',
        message: `更新失败：${msg}`,
        progress: 0,
        error: msg,
        previousVersion,
        requiresRestart: false,
        finishedAt: nowISO(),
      })
      return getUpdateStatus()
    }
    addLog(`版本校验通过：${previousVersion} → ${newVersion}`)

    const history = readHistory()
    history.push({
      version: newVersion,
      previousVersion,
      appliedAt: nowISO(),
      backupDir: path.relative(ROOT, backupDir),
    })
    writeHistory(history.slice(-20))

    /* ---------- 重启 ---------- */
    if (cfg.autoRestart) {
      setStatus({
        state: 'restarting',
        message: '更新完成，1.5 秒后重启服务…',
        progress: 100,
        newVersion,
        requiresRestart: true,
        finishedAt: nowISO(),
      })
      addLog('已配置自动重启：1.5 秒后退出进程，请由 pm2 / systemd / docker 的重启策略拉起')
      setTimeout(() => process.exit(0), 1500)
    } else {
      setStatus({
        state: 'done',
        message: '更新已完成，请重启服务后生效',
        progress: 100,
        newVersion,
        requiresRestart: true,
        finishedAt: nowISO(),
      })
      addLog('未配置自动重启：请手动重启服务（pm2 restart / systemctl restart / docker restart）')
    }

    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不影响结果 */
    }
    return getUpdateStatus()
  } catch (err) {
    const message = sanitize(shortError(err))
    setStatus({
      state: 'failed',
      message: `更新失败：${message}`,
      progress: 0,
      error: message,
      finishedAt: nowISO(),
    })
    addLog(`✗ 更新失败：${message}`)
    return getUpdateStatus()
  } finally {
    running = false
  }
}

/**
 * 回滚到最近一次更新前的备份（异步后台任务）。
 * @returns {Promise<UpdateStatus>}
 */
export async function rollbackUpdate() {
  if (running) {
    return getUpdateStatus()
  }
  running = true
  try {
    setStatus({
      state: 'applying',
      message: '正在回滚到上一个版本…',
      progress: 10,
      log: [],
      startedAt: nowISO(),
      finishedAt: undefined,
      error: undefined,
      requiresRestart: false,
    })
    addLog('开始回滚')

    const history = readHistory()
    const last = history[history.length - 1]
    if (!last?.backupDir) {
      throw new Error('没有可用的历史备份，无法回滚')
    }
    const backupAbs = path.resolve(ROOT, last.backupDir)
    if (!backupAbs.startsWith(path.resolve(ROOT) + path.sep)) {
      throw new Error('备份目录路径非法')
    }
    if (!fs.existsSync(backupAbs)) {
      throw new Error(`备份目录不存在：${last.backupDir}`)
    }
    addLog(`使用备份：${last.backupDir}`)
    setStatus({ message: '正在恢复备份文件…', progress: 45 })
    await copyDirContents(backupAbs, ROOT)
    addLog('备份文件已恢复')

    /* 删除本次更新**新增**的文件，让回滚是真正的「回到旧版」而不是「盖一层旧版」。
       只删 ROOT 下、备份里不存在、且不在保护目录里的条目。 */
    const removed = await removeFilesNotIn(backupAbs, ROOT)
    if (removed > 0) addLog(`已清理更新新增的 ${removed} 个文件`)
    else addLog('没有需要清理的新增文件')

    const restored = (() => {
      try {
        return String(JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version ?? last.previousVersion)
      } catch {
        return last.previousVersion
      }
    })()

    setStatus({
      state: 'done',
      message: `已回滚到版本 ${restored}，请重启服务后生效`,
      progress: 100,
      newVersion: restored,
      previousVersion: last.version,
      requiresRestart: true,
      finishedAt: nowISO(),
    })
    addLog(`回滚完成：当前版本 ${restored}（请重启服务）`)
    return getUpdateStatus()
  } catch (err) {
    const message = sanitize(shortError(err))
    setStatus({
      state: 'failed',
      message: `回滚失败：${message}`,
      progress: 0,
      error: message,
      finishedAt: nowISO(),
    })
    addLog(`✗ 回滚失败：${message}`)
    return getUpdateStatus()
  } finally {
    running = false
  }
}

function formatBytes(n) {
  const num = Number(n || 0)
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1024 / 1024).toFixed(2)} MB`
}

/* -------------------------------------------------------------------------- */
/* 发布新版本（把本机源码做成 GitHub Release）                                    */
/* -------------------------------------------------------------------------- */

/**
 * 发布新版本。
 * @param {{version?:string, notes?:string, prerelease?:boolean}} input
 * @returns {Promise<object>} 发布结果
 */
export async function publishVersion(input = {}) {
  const cfg = readSystemConfig()
  const version = String(input.version ?? '').trim().replace(/^v/i, '')
  const notes = String(input.notes ?? '').trim()
  const prerelease = input.prerelease === true

  if (!cfg.repo) {
    const err = new Error('尚未配置 GitHub 仓库，请先在系统设置里填写 owner/repo')
    err.code = 'BadRequest'
    throw err
  }
  if (!isValidVersion(version)) {
    const err = new Error('版本号格式不正确，应形如 1.2.3')
    err.code = 'BadRequest'
    throw err
  }
  if (!cfg.token) {
    const err = new Error(
      '缺少 GitHub 令牌：请在系统设置里填写令牌，或设置环境变量 GITHUB_TOKEN（需要 contents:write 权限）',
    )
    err.code = 'BadRequest'
    throw err
  }
  const current = currentVersion()
  // 只拦「比当前版本更低」的降级发布。
  // 首次发布 v1.0.0 是正常场景（当前版本就是 1.0.0），不能拦；
  // 同一个 tag 重复发布由 GitHub 自己返回 422。
  const cmp = compareVersions(version, current)
  if (cmp !== null && cmp < 0) {
    const err = new Error(
      `版本号 ${version} 低于当前版本 ${current}，不能发布更低的版本（会变成降级安装）`,
    )
    err.code = 'BadRequest'
    throw err
  }

  const { publishRelease } = await import('./publisher.js')
  const result = await publishRelease({
    repo: cfg.repo,
    version,
    notes,
    prerelease,
    token: cfg.token,
    proxyUrl: cfg.proxy,
    apiBase: GITHUB_API_BASE,
  })
  addLog(`已发布 ${result.tag}：${result.fileCount} 个文件，${formatBytes(result.assetSize)}`)
  return result
}

export { stateFileWritten }
export default {
  readSystemConfig,
  saveSystemConfig,
  checkUpdate,
  runUpdate,
  rollbackUpdate,
  publishVersion,
  getUpdateStatus,
  isUpdating,
}
