/**
 * server/publisher.js —— 把本机源码打成版本并发布到 GitHub Release
 * ---------------------------------------------------------------------------
 * 与「一键更新」互为闭环：
 *   开发机：发布新版本  →  GitHub Release（tag + 附件）
 *   客户端：一键更新    →  拉取同一个 Release 的附件并覆盖安装
 *
 * 安全要求：
 *   1. 打包时**绝不**包含数据库、上传图片、.env、node_modules、dist、backups；
 *   2. 令牌只从环境变量或系统配置读取，绝不写进日志、绝不回显；
 *   3. 发布前校验版本号与仓库地址，非法输入直接拒绝。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createTarGz } from './tar.js'
import { request, toBuffer } from './httpClient.js'

/** 打一条日志（发布过程的可观测性） */
function info(msg) {
  console.log(`[publisher] ${msg}`)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..')

/** 打包时跳过的目录名 */
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'backups',
  '.git',
  '.cache',
  '.vite',
  'coverage',
  '.turbo',
])

/** 打包时跳过的相对路径 */
const EXCLUDE_REL_PATHS = ['server/data', 'server/uploads']

/** 打包时跳过的文件名 */
const EXCLUDE_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
])

/** 打包时跳过的扩展名 */
const EXCLUDE_EXTENSIONS = new Set(['.log', '.db', '.db-wal', '.db-shm', '.tmp'])

/** 单个文件超过这个大小就跳过（避免把巨大的二进制打进源码包） */
const MAX_FILE_SIZE = 8 * 1024 * 1024

/** 判断某个相对路径是否应被排除 */
export function isExcludedRel(rel) {
  const norm = rel.split(path.sep).join('/')
  if (EXCLUDE_REL_PATHS.some((p) => norm === p || norm.startsWith(`${p}/`))) return true
  const parts = norm.split('/')
  if (parts.some((p) => EXCLUDE_DIR_NAMES.has(p))) return true
  const base = parts[parts.length - 1]
  if (EXCLUDE_FILE_NAMES.has(base)) return true
  if (base.startsWith('._')) return true
  const ext = path.extname(base)
  if (EXCLUDE_EXTENSIONS.has(ext)) return true
  if (/\.db-(wal|shm|journal)$/.test(base)) return true
  return false
}

/**
 * 递归收集要打包的文件。
 * @param {string} base 根目录
 * @param {string} dir 当前目录
 * @param {Array} out 收集结果
 * @param {string} prefix 归档内路径前缀
 */
function collect(base, dir, out, prefix = '') {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name
    if (isExcludedRel(rel)) continue
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push({ name: `${rel}/`, type: '5' })
      collect(base, abs, out, rel)
    } else if (ent.isFile()) {
      let st
      try {
        st = fs.statSync(abs)
      } catch {
        continue
      }
      if (st.size > MAX_FILE_SIZE) continue
      out.push({ name: rel, type: '0', data: fs.readFileSync(abs), mode: st.mode & 0o777 })
    }
    // 符号链接等其它类型一律跳过（避免打包出指向系统目录的链接）
  }
  return out
}

/** 版本号校验：允许 1.2.3 / v1.2.3 / 1.2.3-beta.1 */
export function isValidVersion(v) {
  return /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]+)?$/.test(String(v ?? '').trim())
}

/**
 * 构建源码归档（.tar.gz Buffer）。
 * @param {object} opts
 *   version  要写入 package.json 的版本号
 *   root     源码根目录，默认项目根
 * @returns {{buffer:Buffer, fileCount:number, size:number}}
 */
export function buildSourceArchive({ version, root = ROOT } = {}) {
  const entries = collect(root, root, [])
  const pkgPath = path.join(root, 'package.json')
  const overrides = new Map()

  if (version && fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      pkg.version = version
      overrides.set(
        'package.json',
        Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`, 'utf8'),
      )
    } catch {
      /* package.json 读不了就按原样打包 */
    }
  }

  const final = []
  for (const e of entries) {
    if (overrides.has(e.name)) {
      final.push({ name: e.name, type: '0', data: overrides.get(e.name), mode: e.mode })
    } else {
      final.push(e)
    }
  }
  // package.json 被排除或不存在时补一份
  if (version && !final.some((e) => e.name === 'package.json')) {
    final.push({
      name: 'package.json',
      type: '0',
      data: Buffer.from(`${JSON.stringify({ name: 'cuoti-analytics', version }, null, 2)}\n`, 'utf8'),
    })
  }

  const buffer = createTarGz(final)
  return { buffer, fileCount: final.length, size: buffer.length }
}

/** 从仓库地址解析 owner/repo */
export function parseRepo(repo) {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(String(repo ?? '').trim())
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

/**
 * 发布新版本到 GitHub。
 * @param {object} opts
 *   repo        owner/repo
 *   version     版本号（不带 v）
 *   notes       更新说明
 *   prerelease  是否预发布
 *   token       GitHub 令牌
 *   proxyUrl    代理地址
 *   apiBase     GitHub API 根地址（测试用）
 *   root        源码根目录
 * @returns {Promise<object>} 发布结果
 */
/**
 * 读取本机 git 状态（若该目录是 git 仓库）。
 * 返回 { sha, dirty }；不是 git 仓库或没装 git 时返回 null。
 *
 * 用途：让 Release 的 tag 指向**真正对应这份源码包的提交**，
 * 而不是仓库默认分支的 HEAD —— 否则本地有未推送改动时，
 * tag 指向的代码和附件内容会对不上。
 */
export function readGitState(root = ROOT) {
  try {
    const opts = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], opts).trim()
    if (!/^[0-9a-f]{40}$/.test(sha)) return null
    const status = execFileSync('git', ['status', '--porcelain'], opts)
    return { sha, dirty: status.trim().length > 0 }
  } catch {
    return null
  }
}

export async function publishRelease({
  repo,
  version,
  notes = '',
  prerelease = false,
  token,
  proxyUrl = '',
  apiBase = process.env.GITHUB_API_BASE || 'https://api.github.com',
  root = ROOT,
} = {}) {
  const parsed = parseRepo(repo)
  if (!parsed) {
    const err = new Error('仓库地址格式不正确，应为 owner/repo')
    err.code = 'BadRequest'
    throw err
  }
  if (!isValidVersion(version)) {
    const err = new Error('版本号格式不正确，应形如 1.2.3')
    err.code = 'BadRequest'
    throw err
  }
  if (!token) {
    const err = new Error(
      '缺少 GitHub 令牌：请在系统设置里填写令牌，或设置环境变量 GITHUB_TOKEN（需要 contents:write 权限）',
    )
    err.code = 'BadRequest'
    throw err
  }

  const { owner, repo: repoName } = parsed
  const tag = `v${version}`
  const assetName = `cuoti-analytics-v${version}.tar.gz`
  // 附件上传走独立的域名（uploads.github.com），与 API 基址不同；
  // 自建 GitHub 或本地 mock 时用 GITHUB_UPLOAD_BASE 覆盖。
  const uploadBase = String(
    process.env.GITHUB_UPLOAD_BASE ||
      (apiBase.includes('api.github.com') ? 'https://uploads.github.com' : apiBase),
  ).replace(/\/+$/, '')

  // 1) 打包源码
  const { buffer, fileCount, size } = buildSourceArchive({ version, root })

  // 2) 创建 Release
  // 若本机是 git 仓库，就把 tag 指向当前提交（而不是默认分支的 HEAD），
  // 保证 tag 对应的代码与附件内容一致。
  const git = readGitState(root)
  const createBody = JSON.stringify({
    tag_name: tag,
    name: tag,
    body: notes || `发布 ${tag}`,
    prerelease: Boolean(prerelease),
    draft: false,
    ...(git?.sha ? { target_commitish: git.sha } : {}),
  })
  const created = await request(`${apiBase}/repos/${owner}/${repoName}/releases`, {
    method: 'POST',
    proxyUrl,
    timeoutMs: 30000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cuoti-analytics',
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(createBody)),
    },
    body: createBody,
  })

  let release = null

  if (created.status === 422) {
    const msg = extractGitHubMessage(created.body)
    // Release 已经存在 → 不当失败，**改成往已有的 Release 上补传附件**。
    //
    // 为什么这么做：创建 Release 和上传附件是两步，中间任何一步失败（网络抖动、
    // 大附件上传超时）都会留下一个「有 Release、没附件」的半成品。
    // 用户再点一次「发布」却只会看到 already_exists，什么也修不了 ——
    // 只能换个版本号重发。这对用户来说毫无意义。
    // 所以这里去找回已有的 Release，接着传附件，让「发布」可以重跑。
    const existing = await findReleaseByTag({ owner, repoName, tag, token, proxyUrl, apiBase })
    if (existing?.id) {
      release = existing
      info(`Release ${tag} 已存在，往已有 Release 上补传附件`)
    } else {
      throw new Error(
        msg
          ? `创建 Release 失败（标签 ${tag} 可能已存在）：${msg}`
          : `创建 Release 失败：标签 ${tag} 已存在，请换一个版本号`,
      )
    }
  } else if (created.status === 401) {
    throw new Error('GitHub 令牌无效或已过期，请检查系统设置里的令牌')
  } else if (created.status === 403) {
    throw new Error('GitHub 拒绝访问：令牌缺少 contents:write 权限，或被限流')
  } else if (created.status < 200 || created.status >= 300) {
    throw new Error(
      `创建 Release 失败：HTTP ${created.status} ${extractGitHubMessage(created.body) ?? ''}`.trim(),
    )
  } else {
    try {
      release = JSON.parse(created.body.toString('utf8'))
    } catch {
      throw new Error('创建 Release 失败：返回内容无法解析')
    }
  }

  // 3) 上传附件
  // 附件已存在也当成功 —— 同一个附件重传一次是幂等的，不该让用户卡住
  const uploadUrl = `${uploadBase}/repos/${owner}/${repoName}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`
  const uploaded = await request(uploadUrl, {
    method: 'POST',
    proxyUrl,
    timeoutMs: 120000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cuoti-analytics',
      'Content-Type': 'application/gzip',
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  })

  if (uploaded.status === 422) {
    // 同名附件已存在 = 之前已经传过了，这次直接当成功（幂等）。
    // 之前这里是直接抛错，于是「有 Release、没附件」的半成品永远补不回来。
    const assetName2 = assetName
    info(`附件 ${assetName2} 已存在，跳过重复上传`)
    return {
      ok: true,
      version,
      tag,
      releaseId: release.id,
      releaseUrl: release.html_url ?? `https://github.com/${owner}/${repoName}/releases/tag/${tag}`,
      assetName: assetName2,
      assetId: null,
      assetSize: null,
      reused: true,
      fileCount,
      size,
      commit: git?.sha ?? null,
    }
  }
  if (uploaded.status === 401) {
    throw new Error('GitHub 令牌无效或已过期')
  }
  if (uploaded.status === 403) {
    throw new Error('GitHub 拒绝访问：令牌缺少 contents:write 权限')
  }
  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new Error(
      `附件上传失败：HTTP ${uploaded.status} ${extractGitHubMessage(uploaded.body) ?? ''}`.trim(),
    )
  }

  let asset
  try {
    asset = JSON.parse(uploaded.body.toString('utf8'))
  } catch {
    asset = null
  }

  return {
    ok: true,
    version,
    tag,
    releaseId: release.id,
    releaseUrl: release.html_url ?? `https://github.com/${owner}/${repoName}/releases/tag/${tag}`,
    assetName: asset?.name ?? assetName,
    assetSize: asset?.size ?? size,
    fileCount,
    commit: git?.sha ?? null,
    dirty: git?.dirty === true,
    message: `已发布 ${tag}，包含 ${fileCount} 个文件（${(size / 1024).toFixed(1)} KB）${
      git?.dirty ? '；注意：本地有未提交的改动，附件内容与该 tag 指向的提交不完全一致' : ''
    }`,
  }
}

/** 从 GitHub 的 JSON 错误响应里取出可读信息 */
function extractGitHubMessage(buf) {
  if (!buf) return ''
  try {
    const j = JSON.parse(buf.toString('utf8'))
    if (typeof j.message === 'string') {
      const detail = Array.isArray(j.errors) && j.errors.length ? `：${j.errors.map((e) => e.message || e.code).join('；')}` : ''
      return `${j.message}${detail}`
    }
    return ''
  } catch {
    return ''
  }
}

/** 临时文件目录（发布用的附件落盘位置，可选） */
export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cuoti-publish-'))
}

/**
 * 按 tag 找回已存在的 Release。
 *
 * 用于「Release 已创建但附件没传上去」的补救：用户再点一次发布时，
 * GitHub 会回 422 already_exists，这时不该报错，而是找到已有的 Release
 * 继续把附件传上去 —— 让「发布」这个动作可以重跑。
 *
 * @returns {Promise<object|null>}
 */
export async function findReleaseByTag({
  owner,
  repoName,
  tag,
  token,
  proxyUrl = '',
  apiBase = 'https://api.github.com',
} = {}) {
  try {
    const res = await request(
      `${apiBase}/repos/${owner}/${repoName}/releases/tags/${encodeURIComponent(tag)}`,
      {
        method: 'GET',
        proxyUrl,
        timeoutMs: 30000,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'cuoti-analytics',
        },
      },
    )
    if (res.status < 200 || res.status >= 300) return null
    return JSON.parse(res.body.toString('utf8'))
  } catch {
    return null
  }
}

export { toBuffer }
