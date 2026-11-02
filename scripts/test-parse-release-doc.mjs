#!/usr/bin/env node
/**
 * scripts/test-parse-release-doc.mjs —— **反向读文档**的纯逻辑断言
 * ---------------------------------------------------------------------------
 * 为什么单独测？
 *
 * `verify-release-doc.mjs` 要**解包 472 MB 的产物**、**验 sha256** ——
 * 跑一次几十秒，**不能进 `npm test`**。
 *
 * 但**真正容易出错的是解析 Markdown 表格**：
 *   · 表头文字**可能被改**（所以不能靠表头认表，要靠列数）
 *   · 单元格里的 `**` / 反引号**要剥掉**
 *   · 「**14 次**」要能读成数字
 *   · 「**2.1 MB**」要能读成数字
 *
 * 这些**零依赖、毫秒级** → **进 `npm test`** ✓
 *
 * ⚠️ **这轮拆分的由来**：docs 第 35 轮指出
 *    「脚本保证了『产出的快照可信』，但没保证『贴进文档的那份还是那一份』」——
 *    **那最后一环没人守**。这个模块就是去守它的。
 *
 * 用法：node scripts/test-parse-release-doc.mjs [--assert]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cleanCell,
  isArtifactName,
  isTableRow,
  parseCount,
  parseSizeMb,
  parseSnapshotDoc,
  splitRow,
} from './lib/parseReleaseDoc.mjs'

/* ⚠️ `new URL(...).pathname` 会把中文目录名**百分号编码**，
 *   于是路径指向一个不存在的目录 —— 必须用 `fileURLToPath`。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOC = path.join(ROOT, 'docs', '05-开发与部署指南.md')

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

/** 一份和 docs/05 §9.1 形状**完全一样**的样本文档 */
const SAMPLE = `
## 9.1 发布

> **本次发布快照**（**发版时整段替换，不要逐句改**）

| 项 | 值 |
| --- | --- |
| 版本 / tag | \`v1.1.19\` |
| tag 指向的提交 | \`ba373cf\` |
| **tag 来源** | **远端（git ls-remote）** |
| 附件替换次数 | 14 次 |
| 发布后补做的事 | **13** 项（下列清单数出来的） |
| 产物 | 3 个 |

| 产物 | 大小 | build-info commit | sha256 |
| --- | --- | --- | --- |
| \`cuoti-analytics-v1.1.19-deploy.tar.gz\` | **2.1 MB** | \`ba373cf\` | OK ✓ |
| \`cuoti-analytics-offline-v1.1.19-amd64.tar.gz\` | **249.4 MB** | \`ba373cf\` | OK ✓ |
| \`cuoti-analytics-offline-v1.1.19.tar.gz\` | **472.7 MB** | \`ba373cf\` | OK ✓ |

**补做的事**：

| # | 改动 |
| --- | --- |
| ① | 修「AI 辅助撒谎」 |
| ② | 把「界面该显示哪几行」纳入断言 |
| ③ | 降级时不产出快照 |

## 9.2 别的章节
`

console.log('\n=== 反向读文档的纯逻辑 ===')

/* -------------------------------------------------------------------------- */
console.log('\n=== 1. 单元格清洗 ===')
/* -------------------------------------------------------------------------- */
{
  check('剥掉 **强调**', cleanCell('**2.1 MB**') === '2.1 MB')
  check('剥掉反引号', cleanCell('`ba373cf`') === 'ba373cf')
  check('剥掉 **和反引号**', cleanCell('**`x`**') === 'x')
  check('普通文本不动', cleanCell('  普通  ') === '普通')
  check('空输入', cleanCell('') === '')
  check('null', cleanCell(null) === '')
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 2. 表格行识别 ===')
/* -------------------------------------------------------------------------- */
{
  check('是表格行', isTableRow('| a | b |') === true)
  check('分隔行不是', isTableRow('| --- | --- |') === false)
  check('分隔行（带冒号）不是', isTableRow('| :--- | ---: |') === false)
  check('普通文字不是', isTableRow('普通文字') === false)
  check('空行不是', isTableRow('') === false)
  check('拆单元格', JSON.stringify(splitRow('| a | b |')) === JSON.stringify(['a', 'b']))
  check('拆单列', JSON.stringify(splitRow('| a |')) === JSON.stringify(['a']))
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 3. 数字读取 ===')
/* -------------------------------------------------------------------------- */
{
  check('「14 次」→ 14', parseCount('14 次') === 14)
  check('「**13** 项…」→ 13', parseCount('**13** 项（下列清单数出来的）') === 13)
  check('没有数字 → null', parseCount('没有') === null)
  check('「2.1 MB」→ 2.1', parseSizeMb('**2.1 MB**') === 2.1)
  check('「249.4 MB」→ 249.4', parseSizeMb('249.4 MB') === 249.4)
  check('「472.7 MB」→ 472.7', parseSizeMb('**472.7 MB**') === 472.7)
  check('没有 MB → null', parseSizeMb('abc') === null)
  check('产物名识别', isArtifactName('cuoti-analytics-v1.1.19-deploy.tar.gz') === true)
  check('非产物名', isArtifactName('普通文字') === false)
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 4. 整份快照的解析 ===')
/* -------------------------------------------------------------------------- */
{
  const s = parseSnapshotDoc(SAMPLE)
  check('解析得到结果', s !== null)

  check('tag', s.meta.tag === 'v1.1.19', s.meta.tag)
  check('tag 指向的提交', s.meta.commit === 'ba373cf', s.meta.commit)
  check('tag 来源', /远端/.test(s.meta.tagSource), s.meta.tagSource)
  check('替换次数 14', s.meta.replacements === 14, String(s.meta.replacements))
  check('补做了 13 件事', s.meta.changeCount === 13, String(s.meta.changeCount))
  check('产物 3 个', s.meta.artifactCount === 3, String(s.meta.artifactCount))

  check('三个产物', s.artifacts.length === 3, String(s.artifacts.length))
  check('产物 1 文件名', s.artifacts[0].file === 'cuoti-analytics-v1.1.19-deploy.tar.gz')
  check('产物 1 大小 2.1', s.artifacts[0].sizeMb === 2.1, String(s.artifacts[0].sizeMb))
  check('产物 1 commit', s.artifacts[0].commit === 'ba373cf')
  check('产物 1 sha256 OK', s.artifacts[0].shaOk === true)
  check('产物 3 大小 472.7', s.artifacts[2].sizeMb === 472.7, String(s.artifacts[2].sizeMb))

  check('三条改动', s.changes.length === 3, String(s.changes.length))
  check('改动 1 内容', s.changes[0] === '修「AI 辅助撒谎」', s.changes[0])
  check('改动 3 内容', s.changes[2] === '降级时不产出快照', s.changes[2])
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 5. 边界 ===')
/* -------------------------------------------------------------------------- */
{
  check('没有快照锚点 → null', parseSnapshotDoc('普通文档') === null)
  check('空文档 → null', parseSnapshotDoc('') === null)
  check('null → null', parseSnapshotDoc(null) === null)

  /* ⭐ **不能越过下一个章节** ——
     否则 §9.2 里如果也有一张类似的表，会被误读进来。 */
  const two = SAMPLE + '\n| 项 | 值 |\n| --- | --- |\n| 版本 / tag | `v9.9.9` |\n'
  const s = parseSnapshotDoc(two)
  check('⭐ 只读第一张快照表（不越界到下一节）', s.meta.tag === 'v1.1.19', s.meta.tag)
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 6. 真实的 §9.1 文档：内部自洽吗？ ===')
/* -------------------------------------------------------------------------- */
/* ⭐ docs 第 36 轮的观察：
   `release:verify` 拦下的两类东西**性质不同**：
     · 文档停在上一轮的值      → **忘了更新**（要等发布流程才发现）
     · **表里写 13、清单 14 行** → **文档内部自相矛盾**（写完当场就能看出来）

   第二类**跟发布时机无关** —— 它是**文档自己跟自己矛盾**，
   所以**可以（也应该）提前到 `npm test`** ✓
   纯读文档，**毫秒级**。 */
{
  if (!fs.existsSync(DOC)) {
    check('§9.1 文档存在', false, path.join('docs', '05-开发与部署指南.md'))
  } else {
    check('§9.1 文档存在', true)
    const s = parseSnapshotDoc(fs.readFileSync(DOC, 'utf8'))
    check('文档里有「本次发布快照」表', s !== null)

    if (s) {
      check('⭐ 表里的「补做了几件事」== 清单实际条数',
        s.meta.changeCount === s.changes.length,
        `表里 ${s.meta.changeCount}，清单 ${s.changes.length} 条`)

      check('⭐ 表里的「产物」个数 == 产物行数',
        s.meta.artifactCount === s.artifacts.length,
        `表里 ${s.meta.artifactCount}，表体 ${s.artifacts.length} 行`)

      check('清单不是空的', s.changes.length > 0, `${s.changes.length} 条`)

      check('每个产物都写了大小', s.artifacts.every((a) => a.sizeMb !== null))
      check('每个产物都写了 commit', s.artifacts.every((a) => a.commit))
      check('每个产物都标了 sha256 OK', s.artifacts.every((a) => a.shaOk))
      check('tag 指向的提交是 7 位短 SHA', /^[0-9a-f]{7}$/.test(s.meta.commit || ''), s.meta.commit)

      /* 「tag 来源」必须是「远端」——
         降级时产出的快照**本身就不该用**，不该贴在文档里。 */
      check('⭐ tag 来源是「远端」', /^远端/.test(s.meta.tagSource || ''), s.meta.tagSource)
    }
  }
}

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log(`  - ${f}`)
  if (process.argv.includes('--assert')) process.exit(1)
} else if (process.argv.includes('--assert')) {
  console.log('全部通过 ✅')
}
