/**
 * server/version.js —— 运行时版本信息
 *
 * 前端要展示的版本号必须来自**运行时真实值**，而不是打包时写死的常量：
 *
 *   - 「一键更新」只替换程序文件，不替换前端 dist/（dist 是构建产物，
 *     由 `npm run build` 重新生成）。更新完前端 bundle 里的版本号会过时，
 *     只有后端知道当前真实版本。
 *   - 所以前端在运行时问后端要版本号。
 *
 * 优先级：
 *   版本号  ← package.json 的 version
 *   提交号  ← 构建时写入的 server/build-info.json，其次运行时 `git rev-parse HEAD`
 *   构建时间 ← 构建时写入的 server/build-info.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const PKG_FILE = path.join(ROOT, 'package.json')
const BUILD_INFO_FILE = path.join(__dirname, 'build-info.json')

let cached = null

function readPkg() {
  try {
    return JSON.parse(fs.readFileSync(PKG_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function readBuildInfo() {
  try {
    return JSON.parse(fs.readFileSync(BUILD_INFO_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function gitCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

/**
 * 取当前运行版本。
 * @returns {{version: string, commit: string|null, builtAt: string|null}}
 */
export function appVersion() {
  if (cached) return cached
  const pkg = readPkg()
  const build = readBuildInfo()
  // 注意：build.commit 可能是空字符串（Docker 构建时没传 --build-arg COMMIT）。
  // 这里用 `||` 而不是 `??` —— 空字符串也要回退到 git rev-parse，
  // 否则会得到一个空提交号，前端只能显示版本号、显示不出短 hash。
  const commit = String(build.commit ?? '').trim() || gitCommit()
  cached = {
    version: String(pkg.version ?? '0.0.0'),
    commit: commit || null,
    builtAt: build.builtAt ?? null,
  }
  return cached
}

/**
 * 写入构建信息（由 scripts/build-deploy.mjs 在打包时调用）。
 * @param {{commit?: string, builtAt?: string}} info
 */
export function writeBuildInfo(info = {}) {
  const payload = {
    commit: info.commit ?? gitCommit(),
    builtAt: info.builtAt ?? new Date().toISOString(),
    version: appVersion().version,
  }
  fs.writeFileSync(BUILD_INFO_FILE, `${JSON.stringify(payload, null, 2)}\n`)
  cached = { version: payload.version, commit: payload.commit, builtAt: payload.builtAt }
  return payload
}

export default { appVersion, writeBuildInfo }
