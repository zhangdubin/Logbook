/**
 * scripts/lib/releaseSnapshot.mjs —— 发布快照的**纯逻辑**
 * ---------------------------------------------------------------------------
 * 为什么要单独拆一个模块？
 *
 * `release-snapshot.mjs` 要**解包 472 MB 的产物**、**逐个验 sha256** ——
 * 跑一次几十秒。**这种重量级的东西不能进 `npm test`**，
 * 否则每跑一次测试都要等一分钟。
 *
 * 但**真正容易出错的是那些纯逻辑**：
 *   · 清单有几行 → 「补做了几件事」就是几
 *   · 短 SHA 和全 SHA 怎么算「相等」
 *   · `git ls-remote` 的输出怎么解析
 *
 * 这些**零依赖、毫秒级**，所以拆出来**进 `npm test`** ✓
 *
 * ⚠️ **这轮拆分的由来**：脚本第一版把计数写成手抄的，
 * 于是「写着十一件事、清单列了十二件」——
 * **而且三处「静默失败」全是形状不对**：
 *   ① `new URL().pathname` 把中文目录名百分号编码 → cwd 不存在
 *   ② macOS 的 bsdtar 不支持 GNU tar 的 `--wildcards`
 *   ③ 拿 7 位短 SHA 去 `startsWith` 40 位全 SHA → **永远 false**
 *
 *   ① ② 是环境问题，③ 是**比较的形状不对** ——
 *   **形状不对时，比较结果永远是「不相等」，而你只会以为「东西真的不一致」。**
 */

/** 从 `git ls-remote` 的一行里取出 SHA（形如 `<sha>\trefs/tags/v1.1.19`） */
export function parseShaLine(line) {
  const m = String(line ?? '').trim().match(/^([0-9a-f]{7,40})\s+/)
  return m ? m[1] : null
}

/**
 * 两个 commit 是不是「同一个」。
 *
 * ⚠️ **必须允许长度不同** —— `build-info.json` 里存的是**短 SHA**（7 位），
 *    `git ls-remote` 给的是**全 SHA**（40 位）。
 *    直接 `inner.startsWith(fullSha)` **永远为 false**。
 */
export function sameCommit(a, b) {
  const x = String(a ?? '').trim().toLowerCase()
  const y = String(b ?? '').trim().toLowerCase()
  if (!x || !y) return false
  const n = Math.min(x.length, y.length)
  if (n < 7) return false
  return x.slice(0, n) === y.slice(0, n)
}

/**
 * 去掉一行**已有的编号前缀**（`① `、`1. `、`1、`、`(1) ` …）。
 *
 * ⚠️ 为什么要有：
 *    清单文件里可能已经带了编号（人写的习惯），
 *    而脚本输出时**还会自己编一遍号** ——
 *    于是出现 `① ① 修「AI 辅助撒谎」` 这种**双重编号**。
 *
 *    **编号只该有一个来源** —— 脚本自己编。
 *    所以先把文件里带来的编号**剥掉**，再统一编一遍。
 */
export function stripNumbering(line) {
  return String(line ?? '')
    .trim()
    .replace(/^[①-⑳㉑-㉟]\s*/, '')
    .replace(/^\(?\d{1,2}\)\s*/, '')
    .replace(/^\d{1,2}\s*[.、)）]\s*/, '')
    .trim()
}

/**
 * 变更清单 → 条目数组。
 *
 * 规则：去掉空行、去掉 `#` 开头的注释行、**剥掉行内已有的编号**。
 * **「补做了几件事」= 这个数组的长度 —— 数出来的，不是写出来的。**
 */
export function parseChanges(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(stripNumbering)
    .filter(Boolean)
}

/** 变更清单 → 条数 */
export function countChanges(text) {
  return parseChanges(text).length
}

/** 从 `build-info.json` 的内容里取出 commit */
export function parseBuildInfo(json) {
  try {
    const obj = JSON.parse(String(json ?? '').trim())
    return String(obj?.commit ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * 这个 tag 来源**可信吗**？
 *
 * ⭐ **这是「快照」这个词的守门条件**：
 *    只有**远端**来源的 tag 才是「已验证」——
 *    本地 tag **可能比远端旧**，拿它比对得出的结论**不能直接用**。
 *
 * > **有快照 = 已验证。**
 * > 降级时**不产出快照**（只产出警告 + 退出码 1）——
 * > 否则「待确认的快照」和「已确认的快照」**长得一样**，
 * > **迟早有人把待确认的当成确认的用。**
 */
export function isTrustedTagSource(source) {
  return String(source ?? '').startsWith('远端')
}

/** 把 n 条变更编成 ①②③…（超过 20 条就用 `n.`） */
export function numberChanges(items) {
  const circled = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳']
  return items.map((c, i) => `${circled[i] || `${i + 1}.`} ${c}`)
}
