#!/usr/bin/env node
/**
 * scripts/release-snapshot.mjs —— **生成**「本次发布快照」，不要手写
 * ---------------------------------------------------------------------------
 * 为什么要写这个脚本？
 *
 * §9.1 的发布信息里有**四个数**必须同时改：
 *   ① 附件替换次数　② 发布后补做了几件事　③ tag 指向哪个提交　④ 三个产物的体积
 *
 * 手工维护这四个数的**失败率很高** —— 它们散在一大段散文里，
 * 每次发版要逐句去改，**漏一个就会留下一个自相矛盾的说明**。
 *
 * ⭐ 而且它**真的错过**：
 *   有一次我写「补做了十一件事」，下面的清单列了**十二件** ——
 *   是文档同事发现并**把两条合并凑成十一件**才自洽的。
 *
 * > **计数不能靠人记得 —— 必须算出来。**
 *
 * 所以这个脚本做四件事：
 *   ① 从 git 读出 tag 指向的提交（**唯一可信来源**）
 *   ② 逐个产物解包读 `build-info.json`，**核对 commit 和 tag 是否一致**（P-13）
 *   ③ **验 sha256**
 *   ④ 从清单文件里**算出**「补做了几件事」—— **数出来的，不是写出来的**
 *
 * 用法：
 *   node scripts/release-snapshot.mjs --version 1.1.19 --changes /tmp/changes.txt
 *   node scripts/release-snapshot.mjs --version 1.1.19 --changes /tmp/changes.txt --replacements 10
 *
 * 退出码非 0 = 有校验没过（**别把没过的东西发出去**）。
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ **必须用 fileURLToPath，不能用 `new URL(...).pathname`** ——
 *   `.pathname` 会把路径里的**非 ASCII 字符百分号编码**
 *   （`学生错题本` → `%E5%AD%A6...`），
 *   于是 `cwd` 指向一个**不存在的目录**，
 *   后面所有 git / tar 命令**全部静默失败**。
 *   本仓库路径里就有中文 —— 这个坑只在这台机器上出现。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'deploy-dist')

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

const VERSION = arg('version')
const CHANGES_FILE = arg('changes')
const REPLACEMENTS = arg('replacements', '')
const TAG = `v${VERSION}`

if (!VERSION) {
  console.error('用法：node scripts/release-snapshot.mjs --version 1.1.19 --changes <清单文件> [--replacements N]')
  process.exit(2)
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 生成发布快照 ===\n')

let problems = 0
const fail = (msg) => {
  problems++
  console.log(`  ✗ ${msg}`)
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

/* --- ① tag 指向的提交 --------------------------------------------------- */
let tagCommit = ''
try {
  tagCommit = execSync(`git ls-remote origin refs/tags/${TAG}`, { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split(/\s+/)[0]
} catch {
  /* 网络不通就退回本地 */
}
if (!tagCommit) {
  try {
    tagCommit = execSync(`git rev-list -n 1 ${TAG}`, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    fail(`读不到 ${TAG} 指向的提交`)
  }
}
const short = (sha) => (sha || '').slice(0, 7)
if (tagCommit) ok(`远端 tag ${TAG} → ${short(tagCommit)}`)

/* --- ② 清单：条数是**数出来的** ----------------------------------------- */
let changes = []
if (CHANGES_FILE && fs.existsSync(CHANGES_FILE)) {
  changes = fs
    .readFileSync(CHANGES_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}
const changeCount = changes.length
if (changeCount > 0) {
  ok(`补做了 **${changeCount}** 件事（从 ${path.basename(CHANGES_FILE)} 数出来的）`)
} else {
  fail('没给变更清单文件 —— 「补做了几件事」必须算出来，不能写')
}

/* --- ③ 逐个产物：核对 commit + 验 sha256 -------------------------------- */
const artifacts = [
  { file: `cuoti-analytics-v${VERSION}-deploy.tar.gz`, label: '在线部署包' },
  { file: `cuoti-analytics-offline-v${VERSION}-amd64.tar.gz`, label: '离线包（Intel）' },
  { file: `cuoti-analytics-offline-v${VERSION}.tar.gz`, label: '离线包（双架构）' },
]

const rows = []
for (const a of artifacts) {
  const p = path.join(DIST, a.file)
  if (!fs.existsSync(p)) {
    fail(`${a.file} 不存在`)
    continue
  }
  const bytes = fs.statSync(p).size
  const mb = (bytes / 1048576).toFixed(1)

  /* build-info 里的 commit —— 产物自报的身份。
   * ⚠️ 先 `tar -tzf` 列出真实路径再取 —— macOS 的 bsdtar
   *    **不支持 GNU tar 的 `--wildcards`**，直接写通配符会静默取不到。 */
  let inner = ''
  try {
    const listing = execSync(`tar -tzf ${JSON.stringify(p)}`, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    const entry = listing.split('\n').find((l) => l.endsWith('server/build-info.json'))
    if (!entry) throw new Error('包里没有 server/build-info.json')
    const out = execSync(`tar -xzOf ${JSON.stringify(p)} ${JSON.stringify(entry.trim())}`, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
    inner = JSON.parse(out.trim()).commit || ''
  } catch (e) {
    fail(`${a.file} 里读不到 build-info.json（${String(e?.message ?? e).slice(0, 60)}）`)
  }

  /* ⭐ P-13：产物和 tag 对不上是**静默故障** —— 用户拿到旧版本却以为装的是新版 */
  /* ⚠️ build-info 里存的是**短 SHA**，远端 tag 是**全 SHA** ——
   *   直接 `inner.startsWith(tagCommit)` **永远为 false**（拿 7 位去 startsWith 40 位）。
   *   两边都取前 7 位再比。 */
  const match = inner && tagCommit && inner.slice(0, 7) === short(tagCommit)
  if (match) ok(`${a.file} 的 build-info commit 与 tag 一致（${short(inner)}）`)
  else fail(`${a.file} 的 build-info commit（${short(inner) || '?'}）与 tag（${short(tagCommit)}）**不一致**`)

  /* sha256 */
  const sumFile = `${p}.sha256`
  let sumOk = false
  if (fs.existsSync(sumFile)) {
    try {
      execSync(`shasum -a 256 -c ${JSON.stringify(path.basename(sumFile))}`, {
        cwd: DIST,
        encoding: 'utf8',
        stdio: 'pipe',
      })
      sumOk = true
    } catch {
      /* 失败 */
    }
  }
  if (sumOk) ok(`${a.file} 的 sha256 校验通过`)
  else fail(`${a.file} 的 sha256 **校验没过**（或校验文件缺失）`)

  rows.push({ file: a.file, label: a.label, mb, bytes, commit: short(inner), sumOk })
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 快照 ===\n')
console.log('> **本次发布快照**（发版时整张替换，不要逐句改）\n')
console.log('| 项 | 值 |')
console.log('| --- | --- |')
console.log(`| 版本 / tag | \`${TAG}\` |`)
console.log(`| tag 指向的提交 | \`${short(tagCommit)}\` |`)
if (REPLACEMENTS) console.log(`| 附件替换次数 | ${REPLACEMENTS} 次 |`)
console.log(`| 发布后补做的事 | **${changeCount}** 项（下列清单数出来的） |`)
console.log(`| 产物 | ${rows.length} 个 |`)
console.log('')
console.log('| 产物 | 大小 | build-info commit | sha256 |')
console.log('| --- | --- | --- | --- |')
for (const r of rows) {
  console.log(`| \`${r.file}\` | **${r.mb} MB** | \`${r.commit}\` | ${r.sumOk ? 'OK ✓' : '**没过**'} |`)
}
if (changes.length) {
  console.log('')
  console.log('补做的事：')
  const cn = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']
  changes.forEach((c, i) => console.log(`${cn[i] || `${i + 1}.`} ${c}`))
}

console.log('')
if (problems > 0) {
  console.log(`  ⛔ **${problems} 项校验没过 —— 别发出去**`)
  process.exit(1)
}
console.log('  ✅ 全部校验通过 —— 上面的块可以整段贴进 docs/05 §9.1')
console.log('')
