#!/usr/bin/env node
/**
 * scripts/test-engine-state.mjs —— 引擎类型判定的自测入口
 * ---------------------------------------------------------------------------
 * 跑的是 src/features/settings/engineState.test.ts（TypeScript）。
 *
 * 为什么用 jiti 跑而不是 esbuild：
 *   - esbuild 不是本项目的依赖（Vite 8 用的是 rolldown），npx 拉它要联网；
 *   - jiti 已经在依赖树里，能直接执行 .ts；
 *   - 这个测试文件本身会被 tsc --noEmit 检查（类型写错立刻暴露），
 *     这里只负责「跑起来」。
 *
 * 用法：
 *   node scripts/test-engine-state.mjs
 *
 * 退出码：0 = 全过；1 = 有失败用例。
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEST_FILE = path.join(ROOT, 'src', 'features', 'settings', 'engineState.test.ts')

let jiti
try {
  const { createJiti } = require('jiti')
  jiti = createJiti(import.meta.url, { interopDefault: true })
} catch {
  console.error('✗ 找不到 jiti —— 跑不了 TypeScript 测试')
  console.error('  安装：npm i -D jiti')
  process.exit(1)
}

console.log('=== 引擎类型判定自测（activeEngineKind）===')
try {
  await jiti.import(TEST_FILE)
} catch (err) {
  console.error('✗ 测试执行出错：', err?.message ?? err)
  process.exit(1)
}
