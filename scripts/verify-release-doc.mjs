#!/usr/bin/env node
/**
 * scripts/verify-release-doc.mjs —— **反向校验**：文档里贴的快照 == 现实吗？
 * ---------------------------------------------------------------------------
 * `release-snapshot.mjs` 保证了「**它产出的快照是可信的**」——
 * 但快照是**贴进文档的**，**文档会被再手抄一次**。
 *
 * > **脚本保证了「产出的快照可信」，但没保证「贴进文档的那份还是那一份」。**
 *
 * 某天有人手动改了 §9.1 里的某个数（体积、tag），
 * **没有任何东西会报警** —— 因为**脚本不读文档**。
 *
 * 这个脚本**把那一环补上**：
 *   ① **读** docs/05 §9.1 里那张「本次发布快照」表
 *   ② **逐项**跟当前产物 / 远端 tag 比对
 *   ③ 不一致 → **退出码 1** —— 让「文档和现实不一致」变成**可检测的**
 *
 * 用法：
 *   npm run release:verify -- --version 1.1.19
 *   npm run release:verify -- --version 1.1.19 --doc docs/05-开发与部署指南.md
 *
 * 退出码非 0 = **文档和现实对不上，别发布**。
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseShaLine, sameCommit } from './lib/releaseSnapshot.mjs'
import { parseSnapshotDoc } from './lib/parseReleaseDoc.mjs'

/* ⚠️ `new URL(...).pathname` 会把中文目录名**百分号编码**，
 *   于是 `cwd` 指向一个不存在的目录 —— 必须用 `fileURLToPath`。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'deploy-dist')

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

const VERSION = arg('version')
const DOC = path.resolve(ROOT, arg('doc', 'docs/05-开发与部署指南.md'))
const TAG = `v${VERSION}`

if (!VERSION) {
  console.error('用法：npm run release:verify -- --version 1.1.19 [--doc <文档路径>]')
  process.exit(2)
}

let problems = 0
const fail = (msg) => {
  problems++
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
}
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)

console.log('\n=== 反向校验：文档里的快照 == 现实吗？ ===\n')

/* --- ① 读文档 ----------------------------------------------------------- */
if (!fs.existsSync(DOC)) {
  console.log(`  \x1b[31m✗\x1b[0m 文档不存在：${DOC}`)
  process.exit(1)
}
const snap = parseSnapshotDoc(fs.readFileSync(DOC, 'utf8'))
if (!snap) {
  console.log(`  \x1b[31m✗\x1b[0m 文档里找不到「本次发布快照」表 —— ${path.basename(DOC)}`)
  process.exit(1)
}
ok(`已读 ${path.basename(DOC)} 的快照表`)

/* --- ② 文档里的 tag vs 远端 tag ------------------------------------------ */
let remoteCommit = ''
if (!has('offline')) {
  try {
    const out = execSync(`git ls-remote origin refs/tags/${TAG}`, { cwd: ROOT, encoding: 'utf8' })
    remoteCommit = parseShaLine(out) || ''
  } catch {
    /* 网络问题 */
  }
}
if (!remoteCommit) {
  console.log(`  \x1b[33m⚠\x1b[0m 远端 ${TAG} 读不到 —— 跳过远端比对（其余照查）`)
} else {
  if (snap.meta.tag && snap.meta.tag !== TAG) {
    fail(`文档里的 tag 是 \`${snap.meta.tag}\`，本次发布是 \`${TAG}\``)
  } else ok(`文档里的 tag 是 \`${snap.meta.tag || TAG}\``)

  if (snap.meta.commit && !sameCommit(snap.meta.commit, remoteCommit)) {
    fail(`文档里的 tag 指向 \`${snap.meta.commit}\`，远端实际是 \`${remoteCommit.slice(0, 7)}\` —— **文档里的快照是旧的**`)
  } else ok(`文档里的 tag 指向 \`${snap.meta.commit}\` == 远端 \`${remoteCommit.slice(0, 7)}\``)
}

/* --- ③ tag 来源必须是「远端」 -------------------------------------------- */
const src = snap.meta.tagSource || ''
if (!/^远端/.test(src)) {
  fail(`文档里的「tag 来源」是「${src}」—— **不是远端**，这份快照当时就不可信`)
} else ok(`文档里的「tag 来源」是「${src}」`)

/* --- ④ 每个产物：体积 / build-info commit / sha256 ------------------------ */
if (snap.artifacts.length === 0) {
  fail('文档的快照表里没有产物行')
} else {
  for (const a of snap.artifacts) {
    const p = path.join(DIST, a.file)
    if (!fs.existsSync(p)) {
      fail(`${a.file} —— 本地不存在（产物没构建？）`)
      continue
    }
    const actualMb = (fs.statSync(p).size / 1048576).toFixed(1)
    if (a.sizeMb === null) fail(`${a.file} —— 文档里的大小读不出来`)
    else if (Math.abs(a.sizeMb - Number(actualMb)) > 0.05) {
      fail(`${a.file} —— 文档写 **${a.sizeMb} MB**，实际 **${actualMb} MB**`)
    } else ok(`${a.file} —— 大小 ${actualMb} MB`)

    /* build-info */
    let inner = ''
    try {
      const listing = execSync(`tar -tzf ${JSON.stringify(p)}`, {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
      const entry = listing.split('\n').find((l) => l.endsWith('server/build-info.json'))
      if (entry) {
        const out = execSync(`tar -xzOf ${JSON.stringify(p)} ${JSON.stringify(entry.trim())}`, {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
        })
        inner = (JSON.parse(out.trim()).commit || '').trim()
      }
    } catch {
      /* 取不到 */
    }
    if (!inner) fail(`${a.file} —— 读不到 build-info.json`)
    else if (!sameCommit(a.commit, inner)) {
      fail(`${a.file} —— 文档写 \`${a.commit}\`，产物里是 \`${inner.slice(0, 7)}\``)
    } else ok(`${a.file} —— build-info \`${inner.slice(0, 7)}\``)

    /* sha256 */
    const sumFile = `${p}.sha256`
    if (!fs.existsSync(sumFile)) {
      fail(`${a.file} —— 没有 .sha256 校验文件`)
    } else {
      try {
        execSync(`shasum -a 256 -c ${JSON.stringify(path.basename(sumFile))}`, {
          cwd: DIST,
          encoding: 'utf8',
          stdio: 'pipe',
        })
        if (!a.shaOk) fail(`${a.file} —— sha256 实际通过，但文档里没写 OK`)
        else ok(`${a.file} —— sha256 通过`)
      } catch {
        fail(`${a.file} —— sha256 **校验没过**`)
      }
    }
  }
}

/* --- ⑤ 计数自洽 ----------------------------------------------------------- */
if (!Number.isFinite(snap.meta.artifactCount)) {
  fail('文档的快照表里**没有「产物」这一行**')
} else if (snap.meta.artifactCount !== snap.artifacts.length) {
  fail(`文档写「产物 ${snap.meta.artifactCount} 个」，表里实际 ${snap.artifacts.length} 行`)
} else ok(`产物数 ${snap.artifacts.length} 个`)

if (!Number.isFinite(snap.meta.changeCount)) {
  fail('文档的快照表里**没有「补做了几件事」这一行**')
} else if (snap.meta.changeCount !== snap.changes.length) {
  fail(`文档写「补做了 ${snap.meta.changeCount} 件事」，清单里实际 ${snap.changes.length} 条 —— **计数和清单对不上**`)
} else if (snap.changes.length > 0) {
  ok(`补做的事 ${snap.changes.length} 条，与文档写的计数一致`)
}

/* -------------------------------------------------------------------------- */
console.log('')
if (problems > 0) {
  console.log(`  \x1b[31m⛔ ${problems} 项对不上 —— 文档和现实不一致，别发布\x1b[0m`)
  console.log('     修法：重新跑 `npm run release:check`，把它的输出**整段**贴进 §9.1。')
  process.exit(1)
}
console.log('  \x1b[32m✅ 文档里的快照与现实完全一致\x1b[0m')
console.log('')
