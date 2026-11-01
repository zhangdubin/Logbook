#!/usr/bin/env node
/**
 * scripts/test-ocr-diagnose.mjs —— 「连不上」必须说清楚**试的是哪个地址**和**下一步做什么**
 * ---------------------------------------------------------------------------
 * 用户反馈的原话：
 *
 *   「模型那边没问题，是本地 OCR 服务连不上……但是本地ocr我连接了」
 *
 * 「我连接了」和「地址对」**根本不是一回事**。
 * 原来的报错只有一句：
 *   无法连接本地 OCR 服务（ECONNREFUSED），请确认 OCR 服务已启动
 *
 * —— **既没说试的是哪个地址，也没说 ECONNREFUSED 到底意味着什么**，
 * 用户只能瞎试，于是得出「明明启用了却说我没启用」的结论。
 *
 * 这条测试守住两件事：
 *   ① 报错里**必须带上实际试过的地址**
 *   ② 必须给出**能照做的下一步**，而不是「请确认服务已启动」这种空话
 *
 * 用法：node scripts/test-ocr-diagnose.mjs [--assert]
 */

import { explainOcrUnreachable } from '../server/ocr.js'

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`)
  }
}

console.log('\n=== OCR 连不上时的提示必须可操作 ===')

/* -------------------------------------------------------------------------- */
console.log('\n=== 1. ECONNREFUSED（地址能解析，但没人接） ===')
/* -------------------------------------------------------------------------- */
const refused = explainOcrUnreachable('http://127.0.0.1:8868', 'ECONNREFUSED')

check('带上了实际试过的地址', refused.includes('127.0.0.1:8868'), refused.slice(0, 60))
check('说明了 ECONNREFUSED 的含义', refused.includes('解析成功') && refused.includes('没有进程在监听'))
check('点出「容器里的 127.0.0.1 是容器自己」', refused.includes('Docker') && refused.includes('cuoti-ocr'))
check('给出了能直接抄的地址', refused.includes('http://cuoti-ocr:8868'))

/* 容器名地址被拒时，不该再提 127.0.0.1 那套 */
const refusedByName = explainOcrUnreachable('http://cuoti-ocr:8868', 'ECONNREFUSED')
check('容器名地址被拒 → 提示看容器和日志', refusedByName.includes('docker ps') && refusedByName.includes('docker logs'))
check('容器名地址被拒 → 不该再提 127.0.0.1 的坑', !refusedByName.includes('应用容器自己'))

/* -------------------------------------------------------------------------- */
console.log('\n=== 2. ENOTFOUND（地址本身解析不出来） ===')
/* -------------------------------------------------------------------------- */
const notFound = explainOcrUnreachable('http://cuoti-ocr:8868', 'ENOTFOUND')
check('带上了地址', notFound.includes('cuoti-ocr:8868'))
check('说的是「解析不了」而不是「没人接」', notFound.includes('解析不了'))
check('提醒容器里要用容器名', notFound.includes('容器名'))

/* -------------------------------------------------------------------------- */
console.log('\n=== 3. 两种错误不能互相混淆 ===')
/* -------------------------------------------------------------------------- */
check('ECONNREFUSED ≠ ENOTFOUND', refused !== notFound)
check(
  'ECONNREFUSED 说的是「解析成功、没人接」',
  refused.includes('解析成功') && !refused.includes('解析不了'),
)
check(
  'ENOTFOUND 说的是「解析不了」',
  notFound.includes('解析不了') && !notFound.includes('解析成功'),
)
check('两者都说明了区别', refused.includes('ENOTFOUND') && notFound.includes('ECONNREFUSED'))

/* -------------------------------------------------------------------------- */
console.log('\n=== 4. 兜底 ===')
/* -------------------------------------------------------------------------- */
const other = explainOcrUnreachable('http://x:1', 'ETIMEDOUT')
check('未知错误码也带上地址', other.includes('http://x:1'), other)
check('未知错误码不编造解释', !other.includes('Docker'), other)

const noUrl = explainOcrUnreachable('不是URL', 'ECONNREFUSED')
check('地址不是合法 URL 也不能崩', typeof noUrl === 'string' && noUrl.length > 0)

/* -------------------------------------------------------------------------- */
console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log(`  - ${f}`)
  if (process.argv.includes('--assert')) process.exit(1)
} else if (process.argv.includes('--assert')) {
  console.log('全部通过 ✅')
}
