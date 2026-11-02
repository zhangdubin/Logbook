#!/usr/bin/env node
/**
 * scripts/release-snapshot.mjs —— **生成**「本次发布快照」，不要手写
 * ---------------------------------------------------------------------------
 * 为什么要写这个脚本？
 *
 * §9.1 的发布信息里有**四个数**必须同时改：
 *   ① 附件替换次数　② 本次改动有几项　③ tag 指向哪个提交　④ 三个产物的体积
 *
 * 手工维护这四个数的**失败率很高** —— 它们散在一大段散文里，
 * 每次发版要逐句去改，**漏一个就会留下一个自相矛盾的说明**。
 *
 * ⭐ 而且它**真的错过**：
 *   有一次我写「十一件事」，下面的清单列了**十二件** ——
 *   是文档同事发现并**把两条合并凑成十一件**才自洽的。
 *
 * > **计数不能靠人记得 —— 必须算出来。**
 *
 * 所以这个脚本做四件事：
 *   ① 从 git 读出 tag 指向的提交（**唯一可信来源**）
 *   ② 逐个产物解包读 `build-info.json`，**核对 commit 和 tag 是否一致**（P-13）
 *   ③ **验 sha256**
 *   ④ 从清单文件里**算出**「本次改动有几项」—— **数出来的，不是写出来的**
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
import {
  countChanges,
  isTrustedTagSource,
  numberChanges,
  parseBuildInfo,
  parseChanges,
  parseShaLine,
  sameCommit,
} from './lib/releaseSnapshot.mjs'

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
/* `--write <文档路径>`：把快照**直接写进**文档的「生成区」。
 * ⭐ 这是「文档里的数不可能漂移」的最后一环 ——
 *   快照不再是人手抄的，而是**脚本写的**。 */
const WRITE_TO = arg('write')
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
/* ⚠️ **远端读不到时不能悄悄降级** ——
 *    本地 tag **可能比远端旧**，拿它去比对会**报出一个假的「不一致」**，
 *    而 §9.1 把 `git ls-remote` 称作「**唯一可信来源**」。
 *    所以降级必须**大声说出来**，而且**要写进输出的快照里** ——
 *    快照会被整段贴进文档，**提示印在屏幕上没人看，印在表里才留得下**。 */
let tagCommit = ''
let tagSource = '远端（git ls-remote）'
/* `--offline`：强制走本地 tag —— 用来**验证降级路径**的行为。
   （也是网络确实不通时的手动开关。） */
if (!has('offline')) {
  try {
    const out = execSync(`git ls-remote origin refs/tags/${TAG}`, { cwd: ROOT, encoding: 'utf8' })
    tagCommit = parseShaLine(out) || ''
  } catch {
    /* 网络不通 → 下面降级 */
  }
}
if (!tagCommit) {
  tagSource = '⚠️ **本地 tag（远端读不到 —— 可能比远端旧！）**'
  try {
    tagCommit = execSync(`git rev-list -n 1 ${TAG}`, { cwd: ROOT, encoding: 'utf8' }).trim()
    console.log(`  ⚠️ **远端 ${TAG} 读不到（网络问题），退回用本地 tag**`)
    console.log(`     本地 tag **可能比远端旧** —— 拿它比对会**报出假的「不一致」**。`)
    console.log(`     网络恢复后请重跑本脚本再发版。`)
  } catch {
    fail(`读不到 ${TAG} 指向的提交（远端和本地都读不到）`)
  }
}
const short = (sha) => (sha || '').slice(0, 7)
if (tagCommit) ok(`${TAG} → ${short(tagCommit)}（来源：${tagSource.replace(/\*\*/g, '')}）`)

/* --- ② 清单：条数是**数出来的** ----------------------------------------- */
let changes = []
if (CHANGES_FILE && fs.existsSync(CHANGES_FILE)) {
  changes = parseChanges(fs.readFileSync(CHANGES_FILE, 'utf8'))
}
const changeCount = countChanges(fs.existsSync(CHANGES_FILE) ? fs.readFileSync(CHANGES_FILE, 'utf8') : '')
if (changeCount > 0) {
  ok(`本次改动 **${changeCount}** 项（从 ${path.basename(CHANGES_FILE)} 数出来的）`)
} else {
  fail('没给变更清单文件 —— 「本次改动有几项」必须算出来，不能写')
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
    inner = parseBuildInfo(out)
  } catch (e) {
    fail(`${a.file} 里读不到 build-info.json（${String(e?.message ?? e).slice(0, 60)}）`)
  }

  /* ⭐ P-13：产物和 tag 对不上是**静默故障** —— 用户拿到旧版本却以为装的是新版 */
  /* ⚠️ build-info 里存的是**短 SHA**，远端 tag 是**全 SHA** ——
   *   直接 `inner.startsWith(tagCommit)` **永远为 false**（拿 7 位去 startsWith 40 位）。
   *   两边都取前 7 位再比。 */
  const match = sameCommit(inner, tagCommit)
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
if (!isTrustedTagSource(tagSource)) {
  /* ⭐ **降级时不产出快照** ——
   *   「待确认的快照」和「已确认的快照」**长得一样**，
   *   迟早有人把待确认的当成确认的用。
   *
   *   > **有快照 = 已验证。**
   *
   *   所以这里只给警告 + 退出码 1，**不产出任何可粘贴的块**。 */
  console.log('')
  console.log('  ⛔ **tag 来源不是远端 —— 这次的结果不能直接用，不产出快照。**')
  console.log('     远端恢复后请重跑本脚本，再拿它的输出去贴文档。')
  console.log('')
  process.exit(1)
}

console.log('\n=== 快照 ===\n')

/* --- 快照块（既是打印内容，也是写进文档的内容） ------------------------- */
const block = []
block.push('> **本次发布快照**（**发版时整段替换，不要逐句改**）')
block.push('')
block.push('| 项 | 值 |')
block.push('| --- | --- |')
block.push(`| 版本 / tag | \`${TAG}\` |`)
block.push(`| tag 指向的提交 | \`${short(tagCommit)}\` |`)
block.push(`| tag 来源 | ${tagSource} |`)
if (REPLACEMENTS) block.push(`| 附件替换次数 | ${REPLACEMENTS} 次 |`)
/* ⭐ **标签要用「版本中立」的措辞** ——
 * 原来写「**发布后补做的事**」，那是因为 v1.1.19 **反复重传过 17 次**，
 * 每次传完又修了几件事 —— 那个列表确实是「传完之后补做的」。
 *
 * 但**新版本第一次上传时，「传完之后补做的」应该是 0** ——
 * 而那时这个列表装的是「**这一版做了什么**」。
 *
 * **同一个标签不能一会儿说 A、一会儿说 B** —— 那是在骗读者。
 * 所以改成**版本中立**的「本次改动」：
 *   · 对 v1.1.19：这一版（含发布后补做）的全部改动 ✓
 *   · 对 v1.1.20：这一版的改动 ✓
 */
block.push(`| 本次改动 | **${changeCount}** 项（下列清单数出来的） |`)
block.push(`| 产物 | ${rows.length} 个 |`)
block.push('')
block.push('| 产物 | 大小 | build-info commit | sha256 |')
block.push('| --- | --- | --- | --- |')
for (const r of rows) {
  block.push(`| \`${r.file}\` | **${r.mb} MB** | \`${r.commit}\` | ${r.sumOk ? 'OK ✓' : '**没过**'} |`)
}
if (changes.length) {
  block.push('')
  block.push('**本次改动**：')
  block.push('')
  block.push('| # | 改动 |')
  block.push('| --- | --- |')
  numberChanges(changes).forEach((line, i) => {
    const m = line.match(/^([①-⑳]|\d+\.)\s*(.*)$/)
    block.push(`| ${m ? m[1] : i + 1} | ${m ? m[2] : line} |`)
  })
}
const blockText = block.join('\n')
console.log(blockText)

/* --- 写进文档的「生成区」 ------------------------------------------------ */
if (WRITE_TO) {
  const START = '<!-- RELEASE-SNAPSHOT:START -->'
  const END = '<!-- RELEASE-SNAPSHOT:END -->'
  const docPath = path.isAbsolute(WRITE_TO) ? WRITE_TO : path.join(ROOT, WRITE_TO)
  if (!fs.existsSync(docPath)) {
    console.log('')
    console.log(`  ✗ 文档不存在：${docPath}`)
    process.exit(1)
  }
  const doc = fs.readFileSync(docPath, 'utf8')
  const si = doc.indexOf(START)
  const ei = doc.indexOf(END)
  if (si < 0 || ei < 0 || ei < si) {
    console.log('')
    console.log(`  ✗ 文档里没有生成区标记（${START} … ${END}）—— **没动文件**`)
    console.log('     请先在文档的快照位置加上这两个标记。')
    process.exit(1)
  }
  fs.writeFileSync(docPath, doc.slice(0, si + START.length) + '\n\n' + blockText + '\n\n' + doc.slice(ei))
  console.log('')
  console.log(`  ✓ 已写进 ${path.relative(ROOT, docPath)} 的生成区`)
}

console.log('')
if (problems > 0) {
  console.log(`  ⛔ **${problems} 项校验没过 —— 别发出去**`)
  process.exit(1)
}
console.log('  ✅ 全部校验通过 —— 上面的块可以整段贴进 docs/05 §9.1')
console.log('')
