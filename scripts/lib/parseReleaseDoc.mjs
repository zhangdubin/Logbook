/**
 * scripts/lib/parseReleaseDoc.mjs —— **反向读**文档里的发布快照
 * ---------------------------------------------------------------------------
 * 为什么要反向读？
 *
 * `release-snapshot.mjs` 保证了「**它产出的快照是可信的**」——
 * 但快照是**贴进文档的**，**文档会被再手抄一次**。
 *
 * > **脚本保证了「产出的快照可信」，但没保证「贴进文档的那份还是那一份」。**
 *
 * 某天有人手动改了 §9.1 里的某个数（体积、tag），
 * **没有任何东西会报警** —— 因为**脚本不读文档**。
 *
 * 这个模块负责**把文档里那张表读成结构化数据**，
 * 让 `verify-release-doc.mjs` 能**逐项比对**。
 *
 * ⚠️ **为什么单独拆一个模块**：
 *    解析 Markdown 表格是**纯逻辑**（毫秒级），
 *    而「解包 472 MB 产物」是**重量级**的。
 *    和上一轮一样：**纯逻辑进 `npm test`，重活留在发版时跑**。
 */

/** 去掉 Markdown 表格单元格里的一层强调（`**` / `*`）和反引号 */
export function cleanCell(text) {
  return String(text ?? '')
    .trim()
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/^\*(.*)\*$/, '$1')
    .replace(/^`(.*)`$/, '$1')
    .trim()
}

/** 一行是不是表格行（且不是分隔行 `| --- |`） */
export function isTableRow(line) {
  const t = String(line ?? '').trim()
  if (!t.startsWith('|')) return false
  return !/^\|[\s:|-]+\|$/.test(t)
}

/** 把一行表格行拆成单元格 */
export function splitRow(line) {
  return String(line ?? '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** 「14 次」→「14」；「**13** 项…」→「13」 */
export function parseCount(text) {
  const m = String(text ?? '').match(/\d+/)
  return m ? Number(m[0]) : null
}

/** 「**2.1 MB**」→「2.1」 */
export function parseSizeMb(text) {
  const m = String(text ?? '').match(/(\d+(?:\.\d+)?)\s*MB/i)
  return m ? Number(m[1]) : null
}

/** 产物文件名（带 v 前缀的那种） */
export function isArtifactName(name) {
  return /^cuoti-analytics.*\.tar\.gz$/.test(String(name ?? '').trim())
}

/**
 * 从整篇 Markdown 里**解析出那张「本次发布快照」表**。
 *
 * 返回：
 * ```js
 * {
 *   meta: {
 *     tag: 'v1.1.19',
 *     commit: 'ba373cf',
 *     tagSource: '远端（git ls-remote）',
 *     replacements: 14,
 *     changeCount: 13,
 *     artifactCount: 3,
 *   },
 *   artifacts: [
 *     { file: '...', sizeMb: 2.1, commit: 'ba373cf', shaOk: true },
 *   ],
 *   changes: ['修「AI 辅助撒谎」', ...],
 * }
 * ```
 *
 * 解析策略（**按列数区分三张表**，不靠表头文字 —— 表头可能被改）：
 *   · **2 列 + key 是已知字段** → meta
 *   · **4 列 + 首列是产物文件名** → artifact
 *   · **2 列 + 首列是 ①②③** → change
 */
export function parseSnapshotDoc(markdown) {
  const md = String(markdown ?? '')
  const anchor = md.indexOf('本次发布快照')
  if (anchor < 0) return null

  /* 只看这张快照所在的片段 —— 到下一个二级标题为止 */
  const rest = md.slice(anchor)
  const endIdx = rest.search(/\n#{2,3} /)
  const section = endIdx > 0 ? rest.slice(0, endIdx) : rest

  const meta = {}
  const artifacts = []
  const changes = []

  for (const line of section.split('\n')) {
    if (!isTableRow(line)) continue
    const cells = splitRow(line)
    if (cells.length === 4 && isArtifactName(cleanCell(cells[0]))) {
      artifacts.push({
        file: cleanCell(cells[0]),
        sizeMb: parseSizeMb(cells[1]),
        commit: cleanCell(cells[2]) || null,
        shaOk: /OK/.test(cleanCell(cells[3])),
      })
      continue
    }
    if (cells.length !== 2) continue
    const key = cleanCell(cells[0])
    const val = cleanCell(cells[1])

    if (/^[①-⑳]$/.test(key)) {
      changes.push(val)
      continue
    }
    if (/^版本\s*\/\s*tag$/.test(key)) meta.tag = val
    else if (/tag\s*指向的提交/.test(key)) meta.commit = val
    else if (/tag\s*来源/.test(key)) meta.tagSource = val
    else if (/替换次数/.test(key)) meta.replacements = parseCount(val)
    else if (/补做/.test(key)) meta.changeCount = parseCount(val)
    else if (/^产物$/.test(key)) meta.artifactCount = parseCount(val)
  }

  return { meta, artifacts, changes }
}
