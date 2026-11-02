#!/usr/bin/env node
/**
 * scripts/test-release-snapshot.mjs —— 发布快照的**纯逻辑**断言
 * ---------------------------------------------------------------------------
 * 为什么单独测这些？
 *
 * `release-snapshot.mjs` 本体要**解包 472 MB 的产物**、**逐个验 sha256** ——
 * 跑一次几十秒，**不能进 `npm test`**。
 *
 * 但**真正容易出错的是那些纯逻辑**，而且它们**毫秒级**：
 *   · 清单有几行 → 「补做了几件事」就是几
 *   · 短 SHA 和全 SHA 怎么算「相等」
 *   · `git ls-remote` 的输出怎么解析
 *
 * ⚠️ **这轮拆分的由来**：脚本第一版把计数写成手抄的，
 * 于是「写着十一件事、清单列了十二件」——
 * 而**三处「静默失败」全是形状不对**：
 *   ① `new URL().pathname` 把中文目录名百分号编码 → cwd 不存在
 *   ② macOS 的 bsdtar 不支持 GNU tar 的 `--wildcards`
 *   ③ 拿 7 位短 SHA 去 `startsWith` 40 位全 SHA → **永远 false**
 *
 *   ③ 是**比较的形状不对** ——
 *   **形状不对时，比较结果永远是「不相等」，而你只会以为「东西真的不一致」。**
 *
 * 用法：node scripts/test-release-snapshot.mjs [--assert]
 */

import {
  countChanges,
  numberChanges,
  parseBuildInfo,
  parseChanges,
  parseShaLine,
  sameCommit,
} from './lib/releaseSnapshot.mjs'

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

console.log('\n=== 发布快照的纯逻辑 ===')

/* -------------------------------------------------------------------------- */
console.log('\n=== 1. 「补做了几件事」必须数出来 ===')
/* -------------------------------------------------------------------------- */
{
  check('空清单 → 0 项', countChanges('') === 0)
  check('三行 → 3 项', countChanges('a\nb\nc') === 3)
  check('空行不算', countChanges('a\n\n\nb\n') === 2, String(countChanges('a\n\n\nb\n')))
  check('# 开头是注释，不算', countChanges('a\n# 注释\nb') === 2)
  check('行首空格不算空行', countChanges('   \n a') === 1)
  check('末尾换行不额外算一项', countChanges('a\nb\n') === 2)

  /* ⭐ 这一条就是本轮事故的护栏：
     「写着十一件事、清单列了十二件」——
     计数必须**跟着清单走**，不能手写。 */
  const twelve = Array.from({ length: 12 }, (_, i) => `第${i + 1}件`).join('\n')
  check('⭐ 清单十二行 → 12 项（不是手写的 11）', countChanges(twelve) === 12, String(countChanges(twelve)))
  check('parseChanges 和 countChanges 一致', parseChanges(twelve).length === countChanges(twelve))

  const numbered = numberChanges(parseChanges(twelve))
  check('编号到 ⑫', numbered[11].startsWith('⑫'), numbered[11])
  check('编号条数不变', numbered.length === 12)
  check('超过 20 条用 n. 兜底', numberChanges(Array.from({ length: 25 }, (_, i) => `x${i}`))[24].startsWith('25.'))
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 2. SHA 比较：短的和全的要能算相等 ===')
/* -------------------------------------------------------------------------- */
{
  const full = '09d677961256aee6c44aed64460f40ad60038907'
  const short = '09d6779'

  check('⭐ 短 SHA vs 全 SHA → 相等', sameCommit(short, full) === true)
  check('⭐ 全 SHA vs 短 SHA → 相等（顺序无关）', sameCommit(full, short) === true)
  check('短 vs 短 → 相等', sameCommit('09d6779', '09d6779') === true)
  check('不同 → 不等', sameCommit('09d6779', 'a616a1b') === false)
  check('空 → 不等', sameCommit('', full) === false)
  check('null → 不等', sameCommit(null, full) === false)
  check('大小写不敏感', sameCommit('09D6779', '09d6779') === true)
  check('太短（<7 位）不算相等', sameCommit('09d', full) === false)

  /* ⚠️ 这就是「三处静默失败」的第 ③ 处 ——
     第一版写的是 `inner.startsWith(tagCommit)`，
     拿 **7 位**去 startsWith **40 位** → **永远 false**，
     于是白报三次「产物和 tag 不一致」。 */
  check('⭐ 不是用 startsWith 判的（7 位 vs 40 位必须相等）', '09d6779'.startsWith(full) === false && sameCommit('09d6779', full) === true)
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 3. git ls-remote 的输出 ===')
/* -------------------------------------------------------------------------- */
{
  check('标准行', parseShaLine('09d677961256aee6c44aed64460f40ad60038907\trefs/tags/v1.1.19') === '09d677961256aee6c44aed64460f40ad60038907')
  check('带空格分隔也行', parseShaLine('09d6779   refs/tags/v1.1.19') === '09d6779')
  check('空行 → null', parseShaLine('') === null)
  check('不是 SHA 开头 → null', parseShaLine('fatal: unable to access') === null)
  check('null → null', parseShaLine(null) === null)
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 4. build-info 解析 ===')
/* -------------------------------------------------------------------------- */
{
  check('正常 JSON', parseBuildInfo('{"commit":"a616a1b","version":"1.1.19"}') === 'a616a1b')
  check('坏 JSON → 空串（不能抛）', parseBuildInfo('{oops') === '')
  check('缺 commit → 空串', parseBuildInfo('{"version":"1.1.19"}') === '')
  check('空输入 → 空串', parseBuildInfo('') === '')
  check('null → 空串', parseBuildInfo(null) === '')
}

/* -------------------------------------------------------------------------- */
console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log(`  - ${f}`)
  if (process.argv.includes('--assert')) process.exit(1)
} else if (process.argv.includes('--assert')) {
  console.log('全部通过 ✅')
}
