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

import { explainOcrUnreachable, suggestOcrUrl } from '../server/ocr.js'
import { ocrAddressHint, ocrPlaceholder } from '../src/features/settings/ocrPlaceholder.ts'
import { FAILURE_HINTS } from '../src/features/settings/failureHints.ts'
import { FALLBACK_PROVIDERS } from '../src/features/settings/fallbackProviders.ts'

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
console.log('\n=== 5. 推荐地址必须跟部署方式对得上 ===')
/* -------------------------------------------------------------------------- */
{
  /* 安装脚本写进来的环境变量最准 —— 两种安装方式写的都是**正确的**那个 */
  const offline = suggestOcrUrl({ OCR_SERVICE_URL: 'http://cuoti-ocr:8868' }, true)
  check('离线安装 → 用容器名 cuoti-ocr', offline.url === 'http://cuoti-ocr:8868', offline.url)
  check('离线安装 → source=env', offline.source === 'env', offline.source)

  const online = suggestOcrUrl({ OCR_SERVICE_URL: 'http://ocr:8868' }, true)
  check('在线安装 → 用容器名 ocr', online.url === 'http://ocr:8868', online.url)

  /* 没配环境变量时，按「在不在容器里」判断 */
  const inBox = suggestOcrUrl({}, true)
  check('容器里但没配 env → 仍给容器名', inBox.url === 'http://cuoti-ocr:8868', inBox.url)
  check('容器里但没配 env → source=container-default', inBox.source === 'container-default')

  const onHost = suggestOcrUrl({}, false)
  check('宿主机直跑 → 127.0.0.1', onHost.url === 'http://127.0.0.1:8868', onHost.url)
  check('宿主机直跑 → source=host-default', onHost.source === 'host-default')

  /* ⭐ 最关键的一条：容器里**绝不能**推荐 127.0.0.1 */
  check('容器里绝不能推荐 127.0.0.1', !inBox.url.includes('127.0.0.1'), inBox.url)
  check('env 优先于容器判断', suggestOcrUrl({ OCR_SERVICE_URL: 'http://x:1' }, true).url === 'http://x:1')
  check('空 env 不当推荐值', suggestOcrUrl({ OCR_SERVICE_URL: '   ' }, true).source !== 'env')
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 6. 兜底占位符也不能给「必然错的具体地址」 ===')
/* -------------------------------------------------------------------------- */
{
  /* ⭐ 这正是上一轮**漏掉**的那处 ——
     主路径改好了，兜底分支没人看。
     所以它必须有断言钉住：一个必然错的地址**不会让任何测试变红**，
     只会让用户在生产环境里踩坑。 */
  const withSuggestion = ocrPlaceholder('http://cuoti-ocr:8868')
  check('有推荐值 → 用推荐值', withSuggestion === 'http://cuoti-ocr:8868', withSuggestion)

  const withoutSuggestion = ocrPlaceholder('')
  check('没推荐值 → 给中性占位符', withoutSuggestion.includes('<主机名或容器名>'), withoutSuggestion)
  check('⭐ 兜底占位符绝不能是 127.0.0.1', !withoutSuggestion.includes('127.0.0.1'), withoutSuggestion)
  check('兜底占位符绝不能是 localhost', !withoutSuggestion.includes('localhost'), withoutSuggestion)
  check('null 也当没推荐值', !ocrPlaceholder(null).includes('127.0.0.1'))
  check('空白串也当没推荐值', !ocrPlaceholder('   ').includes('127.0.0.1'))

  /* hint 同理：有推荐值给正确值，没推荐值讲规则 */
  const hintWith = ocrAddressHint('http://cuoti-ocr:8868')
  check('hint 有推荐值 → 直接给正确值', hintWith.includes('http://cuoti-ocr:8868'), hintWith)
  const hintWithout = ocrAddressHint('')
  check('hint 没推荐值 → 讲容器名规则', hintWithout.includes('容器名') && hintWithout.includes('容器自己'))
  check('hint 没推荐值 → 不给可抄的具体地址', !hintWithout.includes('http://127.0.0.1'))
}

/* -------------------------------------------------------------------------- */
console.log('\n=== 7. 失败提示里不能有「必然错的具体地址」 ===')
/* -------------------------------------------------------------------------- */
{
  /* ⭐ 用户反馈里原样贴出来的那句话，就是从这里来的：
   *   「确认地址端口写对了，例如 http://127.0.0.1:8080」
   * 两个错：端口（侧车是 8868 不是 8080）+ 容器里 127.0.0.1 指向应用容器自己。
   * 用户照着抄必然失败 —— 而且这是**用户看得见的文案**，不是内部日志。 */
  const ocrTips = FAILURE_HINTS.ocr.tips
  const all = ocrTips.join('\n')

  check('⭐ OCR 提示里不再出现 127.0.0.1:8080', !all.includes('127.0.0.1:8080'), all.slice(0, 80))
  /* 注意：判据是「**没有可抄的具体地址**」，
   * 不是「文本里不能出现 127.0.0.1 这几个字」——
   * 「别用 127.0.0.1」是在**讲规则**，是好的文案。 */
  check('⭐ OCR 提示里没有可抄的 127.0.0.1 地址', !/https?:\/\/127\.0\.0\.1/.test(all), all.slice(0, 80))
  check('OCR 提示不再教用户「跨域 / CORS」', !/CORS|跨域/.test(all))
  check('OCR 提示提到用 docker ps 看进程', all.includes('docker ps'))
  check('OCR 提示说正确地址由后端给出', all.includes('后端'))

  /* Ollama 预设：选一下就自动填进输入框 —— 容器里同样是错的 */
  const ollama = FALLBACK_PROVIDERS.find((p) => p.id === 'ollama')
  check('找得到 Ollama 预设', !!ollama)
  check('⭐ Ollama 提示里点明了容器场景', /容器/.test(ollama?.note ?? ''), ollama?.note?.slice(0, 80))
  check('⭐ Ollama 提示里说明了该改成什么', /容器名|宿主机 IP/.test(ollama?.note ?? ''))
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
