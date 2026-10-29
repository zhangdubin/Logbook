#!/usr/bin/env node
/**
 * scripts/build-deploy.mjs —— 生成「生产环境部署版本」
 *
 * 与「源码包」（发布新版本时上传到 GitHub Release 的那个）不同，
 * 部署版本是**可以直接在服务器上跑起来的成品**：
 *
 *   源码包   = 全部源码（不含 dist/、不含数据库），适合做 Git 历史与二次开发
 *   部署版本 = 源码 + 已构建好的 dist/ 前端产物 + 部署脚本，服务器上不需要装构建工具链
 *
 * 用法：
 *   node scripts/build-deploy.mjs                # 只生成到 deploy-dist/
 *   node scripts/build-deploy.mjs --upload       # 生成后上传到 GitHub Release（作为附加附件）
 *   node scripts/build-deploy.mjs --version 1.2.0
 *
 * 产物：
 *   deploy-dist/cuoti-analytics-v<版本>-deploy.tar.gz
 *   deploy-dist/cuoti-analytics-v<版本>-deploy.tar.gz.sha256
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createTarGz } from '../server/tar.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'deploy-dist')

/* -------------------------------------------------------------------------- */
/* 参数                                                                        */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = opt('--version', pkg.version)
const UPLOAD = flag('--upload')
const REPO = opt('--repo', process.env.GITHUB_REPO || '')

/* -------------------------------------------------------------------------- */
/* 收集文件                                                                    */
/* -------------------------------------------------------------------------- */

/** 这些目录/文件不进部署包 */
/**
 * 需要可执行位的脚本：*.sh 与 scripts/ 下的 .mjs。
 * 注意不要笼统地匹配 .js —— server/ 下的 .js 是被 node 加载的模块，
 * 不需要可执行位。
 */
const SCRIPT_RE = /(^|\/)(scripts\/[^/]+\.mjs|[^/]+\.sh)$/

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.cache', '.vite', 'coverage', '.turbo',
  'backups', 'deploy-dist', 'dist-package',
  // ⚠️ OCR 大模型（server 级检测+识别，约 190MB）—— **绝不能进部署包**。
  //    带了会把部署包从 ~1MB 撑到 ~174MB，用户下载和拉镜像都要等很久。
  //    模型由 ocr-service/fetch_models.py 单独下载（可选，见 ocr-service/README.md）。
  'models',
])
const SKIP_FILES = new Set([
  '.env', '.env.local', '.env.production', '.DS_Store', 'Thumbs.db',
])
// 注意：server/build-info.json **要**进部署包 —— 它带着版本号与提交号，
// 前端展示版本号靠的就是它。只是不进 git（.gitignore 已排除）。

/**
 * 判断某个路径是否要跳过。
 * @param {string} rel 相对项目根的路径（用 / 分隔）
 */
function skip(rel) {
  if (!rel) return true
  const parts = rel.split('/')
  if (parts.some((p) => SKIP_DIRS.has(p))) return true
  const base = parts[parts.length - 1]
  if (SKIP_FILES.has(base)) return true
  if (base.startsWith('._')) return true // macOS 杂物
  if (base.endsWith('.log') || base.endsWith('.db') || base.endsWith('.db-wal') || base.endsWith('.db-shm')) {
    return true
  }
  // 运行期数据目录：保留目录本身（.gitkeep），丢弃其中的内容
  if (rel.startsWith('server/data/') && base !== '.gitkeep') return true
  if (rel.startsWith('server/uploads/') && base !== '.gitkeep') return true
  return false
}

/**
 * 收集要打包的文件。
 * @param {string} dir 绝对目录
 * @param {string} base 相对项目根的基准目录
 * @returns {Array<{name: string, path: string, size: number}>}
 */
function collect(dir, base = '') {
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    const rel = base ? `${base}/${e.name}` : e.name
    if (skip(rel)) continue
    if (e.isSymbolicLink()) continue // 不跟随软链（node_modules 就是软链）
    if (e.isDirectory()) {
      out.push(...collect(abs, rel))
    } else if (e.isFile()) {
      out.push({ name: rel, path: abs, size: fs.statSync(abs).size })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* 主流程                                                                      */
/* -------------------------------------------------------------------------- */

function sh(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim()
}

function gitCommit() {
  try {
    return sh('git', ['rev-parse', '--short', 'HEAD'])
  } catch {
    return null
  }
}

console.log('\n\x1b[1m生成生产环境部署版本\x1b[0m')
console.log(`  版本：${VERSION}`)

// 1) 前端构建产物
const distDir = path.join(ROOT, 'dist')
if (!fs.existsSync(distDir) || flag('--skip-build')) {
  console.log('  · 构建前端（vite build）…')
  sh('npx', ['vite', 'build'])
} else {
  console.log('  · 复用已有 dist/（加 --force-build 可强制重建）')
}

// 2) 写入构建信息（供前端显示版本号）
const { writeBuildInfo } = await import('../server/version.js')
const buildInfo = writeBuildInfo({ commit: gitCommit(), builtAt: new Date().toISOString() })
console.log(`  · 构建信息：${buildInfo.commit ?? '(无 git)'} @ ${buildInfo.builtAt}`)

// 3) 收集文件
const files = collect(ROOT)
const distFiles = files.filter((f) => f.name.startsWith('dist/'))
const sourceFiles = files.filter((f) => !f.name.startsWith('dist/'))
console.log(`  · 收集到 ${files.length} 个文件（前端产物 ${distFiles.length} 个）`)

if (!distFiles.length) {
  console.error('\n\x1b[31m✗ dist/ 为空，无法生成部署版本。请先执行 npm run build\x1b[0m')
  process.exit(1)
}

// 4) 打包
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cuoti-deploy-'))
const topName = `cuoti-analytics-v${VERSION}`
fs.mkdirSync(path.join(staging, topName), { recursive: true })

const entries = []
for (const f of files) {
  const dest = path.join(staging, topName, f.name)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(f.path, dest)
  // createTarGz 需要的是**内容**（entry.data），不是大小
  entries.push({
    name: `${topName}/${f.name}`,
    type: '0',
    data: fs.readFileSync(f.path),
    // 统一归一化权限：普通文件 644，脚本 755。
    // 不直接沿用工作区的权限位 —— 工作区里被某些工具写成 600 的文件，
    // 打进包里会让服务器上的非 root 用户读不了（Docker 构建时同样会踩）。
    mode: SCRIPT_RE.test(f.name) ? 0o755 : 0o644,
  })
}
// 顶层加一个 VERSION 文件，方便服务器上确认装的是哪个版本
fs.writeFileSync(path.join(staging, topName, 'VERSION'), `${VERSION}\n`)
entries.push({
  name: `${topName}/VERSION`,
  type: '0',
  data: Buffer.from(`${VERSION}\n`, 'utf8'),
  mode: 0o644,
})

const tarGz = await createTarGz(entries)

fs.mkdirSync(OUT_DIR, { recursive: true })
const outName = `cuoti-analytics-v${VERSION}-deploy.tar.gz`
const outFile = path.join(OUT_DIR, outName)
fs.writeFileSync(outFile, tarGz)

const sha = crypto.createHash('sha256').update(tarGz).digest('hex')
fs.writeFileSync(`${outFile}.sha256`, `${sha}  ${outName}\n`)

console.log(`\n  \x1b[32m✓\x1b[0m 部署包：${path.relative(ROOT, outFile)}`)
console.log(`    大小 ${(tarGz.length / 1024 / 1024).toFixed(2)} MB，sha256 ${sha.slice(0, 16)}…`)
console.log(`    校验文件：${path.relative(ROOT, `${outFile}.sha256`)}`)

/* -------------------------------------------------------------------------- */
/* 可选：上传到 GitHub Release                                                 */
/* -------------------------------------------------------------------------- */

if (UPLOAD) {
  if (!REPO) {
    console.error('\n\x1b[31m✗ 需要 --repo owner/repo 或环境变量 GITHUB_REPO\x1b[0m')
    process.exit(1)
  }
  const token = String(process.env.GITHUB_TOKEN ?? '').trim()
  if (!token) {
    console.error('\n\x1b[31m✗ 需要环境变量 GITHUB_TOKEN（需 contents:write）\x1b[0m')
    process.exit(1)
  }
  const { publishDeployAsset } = await import('./publish-deploy-asset.mjs')
  await publishDeployAsset({ repo: REPO, version: VERSION, file: outFile, token })
}

console.log('')
