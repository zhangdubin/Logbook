/**
 * features/settings/failureHints —— 连接测试失败的分类与排查建议
 * ---------------------------------------------------------------------------
 * 背景：后端已经把连接失败的原因分类好了（见 server/ai.js 的 PROVIDER_ERROR_HINT
 * 与错误分类分支），返回的 message 长这样：
 *
 *   连接失败：API Key 无效或没有权限
 *   连接失败：账户余额不足
 *   连接失败：触发了服务商限流
 *   连接失败：请求超时
 *   连接失败：模型有响应，但内容为空
 *   连接失败：连不上模型服务
 *   连接失败：接口地址或模型名不对
 *   连接失败：服务端内部错误
 *
 * 之前前端不管什么原因都显示同一张「连接失败 + 4 条通用清单」，
 * 用户看到的全是猜测（Base URL / API Key / 模型名 / 网络），
 * 一条都没指向真正的原因。这里按类型给出**最相关的**排查建议，
 * 匹配不上时才退回通用清单。
 *
 * 匹配顺序：先拿后端给的 message 匹配（那是人工分类过的，最准），
 * 匹配不上再用 detail 兜底。
 */

/** 失败类型 */
export type FailureKind =
  /** 配置没填全，测试根本跑不起来 */
  | 'notConfigured'
  /** 认证失败：密钥无效 / 没权限 */
  | 'auth'
  /** 账户余额不足 */
  | 'balance'
  /** 被限流 */
  | 'rateLimit'
  /** 服务端自己出错 */
  | 'serverError'
  /** 请求超时 */
  | 'timeout'
  /** 内容被安全策略拦了 */
  | 'safety'
  /** 请求太长，超出模型上限 */
  | 'tokenLimit'
  /** 模型有响应但正文为空（多半是输出预算被思考过程吃光） */
  | 'emptyOutput'
  /** 地址或模型名不对 */
  | 'badRequest'
  /** 压根连不上 */
  | 'unreachable'
  /** 本地 OCR 服务连不上 */
  | 'ocr'
  /** 认不出来 */
  | 'generic'

export interface FailureHint {
  /** 标题下面那句话：到底出了什么事 */
  lead: string
  /** 具体怎么改，2~4 条 */
  tips: string[]
}

/**
 * 各类失败的说明文案。
 * 措辞原则：先说「谁的锅」，再说「改哪里」，不要让用户去猜。
 */
export const FAILURE_HINTS: Record<FailureKind, FailureHint> = {
  notConfigured: {
    lead: '配置还没填全，这次测试没跑起来。',
    tips: [
      '填上 API Key —— 输入框留空表示「不修改已保存的密钥」',
      '填上接口地址（Base URL）',
      '填上模型名 —— 可以直接从下拉里选，不用手打',
    ],
  },
  auth: {
    lead: '服务商没认这把密钥 —— 先把密钥搞定，其它配置多半是对的。',
    tips: [
      '重新复制一次密钥：首尾空格会被裁掉，但中间混入换行或中文标点同样会导致 401',
      '确认用的是这个服务商的 Key —— 不同平台（OpenAI / MiniMax / DeepSeek / 智谱 / 通义…）的密钥不通用',
      '确认这把 Key 没有被禁用或过期（去服务商控制台看状态）',
      '确认账号已开通该模型的调用权限（有些平台要单独申请）',
    ],
  },
  balance: {
    lead: '密钥是通的，但账户里没有余额 —— 配置本身没错，是账的问题。',
    tips: [
      '去服务商控制台充值，然后再测一次',
      '确认当前账号就是充值过的那个 —— 团队 / 子账号最容易搞错',
    ],
  },
  rateLimit: {
    lead: '服务商把请求挡住了 —— 一般是短时间内请求太密，或该模型的并发额度用满了。',
    tips: [
      '等一两分钟再重试',
      '降低并发 / 调用频率 —— 批量识别时最容易撞上这个限制',
    ],
  },
  serverError: {
    lead: '服务商那边出错了 —— 这不是你的配置问题。',
    tips: [
      '稍后重试一次，通常几分钟内自己恢复',
      '如果反复出现，换一个模型或另一个服务商试试',
      '一直报错的话，把下面的原始信息发给服务商客服',
    ],
  },
  timeout: {
    lead: '在超时时间内没等到回应 —— 多半是网络慢，或者服务端正忙。',
    tips: [
      '把「超时（秒）」调大 —— 默认 30 秒，推理模型可以调到 60~120 秒',
      '校园网 / 公司网 / 防火墙可能拦截境外域名，换个网络或用国内节点试试',
      '确认 Base URL 没指向一个很慢的镜像',
    ],
  },
  safety: {
    lead: '内容被服务商的安全策略拦下了 —— 请求发出去了，但没拿到正文。',
    tips: [
      '换个说法再试，或者换一个审核更宽松的模型',
      '确认请求内容里没有敏感信息（身份证号、联系方式等）',
    ],
  },
  tokenLimit: {
    lead: '请求太长了，超出了模型一次能吃下的量。',
    tips: [
      '把内容缩短后再试一次',
      '换一个上下文更长的模型',
    ],
  },
  emptyOutput: {
    lead: '模型确实回包了，但正文是空的 —— 通常是「输出预算」被思考过程吃光了。',
    tips: [
      '把本页面下方的「最大输出长度（token）」调大 —— 会先思考的推理模型，思考内容也占这个预算',
      '会先思考的推理模型，也可以换一个不思考的模型（例如纯对话模型）再测',
      '换模型后仍然是空内容，检查是不是请求内容触发了安全策略',
    ],
  },
  badRequest: {
    lead: '地址或模型名对不上 —— 服务收到了请求，但不认你要的东西。',
    tips: [
      '模型名大小写敏感 —— 用控制台里的原始名称，可以直接从下拉里选',
      '确认 Base URL 的路径没多一层或少一层（有的服务要 /v1，有的不要）',
      '照服务商官方文档里的示例值抄一遍',
    ],
  },
  unreachable: {
    lead: '压根没连上这个地址 —— 请求没到模型服务。',
    tips: [
      '确认 Base URL 写全了 —— 多数兼容服务要带 /v1，例如 https://api.example.com/v1',
      '确认域名没被校园网 / 公司网拦截，换个网络试试',
      '确认端口和协议（http / https）没写错',
    ],
  },
  ocr: {
    lead: '模型那边没问题，是本地 OCR 服务连不上。',
    tips: [
      '确认 OCR 服务已经启动（命令行 / 容器里看一眼进程）',
      '确认地址端口写对了，例如 http://127.0.0.1:8080',
      '浏览器直连受跨域限制：OCR 服务没放开 CORS 时也会显示连不上，改用后端代理的地址更稳',
    ],
  },
  generic: {
    lead: '没能连上，具体原因还需要再确认一下 —— 先按下面几条排查。',
    tips: [
      'Base URL 是否写全了 —— 多数兼容服务要带 /v1，例如 https://api.example.com/v1',
      'API Key 是否有效、是否复制完整（首尾空格也会导致 401）',
      '模型名是否存在 —— 部分服务大小写敏感，先用控制台里的原始名称',
      '当前网络能不能访问这个地址 —— 校园网 / 公司网可能拦截境外域名',
    ],
  },
}

/**
 * 关键词规则。
 * 顺序有意义：先匹配更具体的，再匹配宽泛的。
 */
const RULES: { kind: FailureKind; re: RegExp }[] = [
  /* OCR 放最前：这类失败里「未配置 API Key」只是背景，真正的堵点是 OCR 服务连不上 */
  { kind: 'ocr', re: /ocr[^，。；]{0,12}(不可达|连不上|超时|失败)/i },
  { kind: 'notConfigured', re: /未配置|没有配置|未填写|请先在设置页|缺少(密钥|key)/i },
  { kind: 'auth', re: /api\s*key|密钥|认证|鉴权|401|403|unauthor|invalid|无效|过期|权限|1004/i },
  { kind: 'balance', re: /余额|欠费|insufficient|quota|额度用尽|1008/i },
  { kind: 'rateLimit', re: /限流|频率|rate\s*limit|429|1002|too\s*many/i },
  { kind: 'serverError', re: /服务端(内部错误|超时|繁忙)|内部错误|500|502|503|1000|1001|1013|服务异常/i },
  { kind: 'timeout', re: /超时|timeout|timed\s*out|etimedout|abort/i },
  { kind: 'safety', re: /安全策略|内容(被)?过滤|敏感词|1027/i },
  { kind: 'tokenLimit', re: /token\s*数|token[^，。；]{0,8}上限|上下文(长度|超)|1039/i },
  { kind: 'emptyOutput', re: /内容为空|空内容|输出预算|没有输出|未输出|reasoning|思考/i },
  /* \bnot\s*found\b 里的词边界很关键：不加的话 "ENOTFOUND" 也会被当成 404 */
  { kind: 'badRequest', re: /模型名|模型不存在|\bnot\s*found\b|404|接口地址|参数不合法|base\s*url/i },
  { kind: 'unreachable', re: /连不上|无法连接|enotfound|econnrefused|eai_again|fetch\s*failed|dns|代理不可用/i },
]

/**
 * 判定这次失败属于哪一类。
 * 先看后端给的 message（人工分类过的，最准），再看 detail 兜底。
 */
export function classifyFailure(message?: string | null, detail?: string | null): FailureKind {
  const msg = (message ?? '').trim()
  for (const rule of RULES) {
    if (msg && rule.re.test(msg)) return rule.kind
  }
  const det = (detail ?? '').trim()
  for (const rule of RULES) {
    if (det && rule.re.test(det)) return rule.kind
  }
  return 'generic'
}

/**
 * 把后端给的结论整理成标题。
 * 「连接失败：API Key 无效或没有权限」-> 「API Key 无效或没有权限」
 * 只剩「连接失败」时用兜底文案。
 */
export function failureTitle(message?: string | null): string {
  const m = (message ?? '').trim()
  if (!m) return '连接测试失败'
  const stripped = m.replace(/^连接失败\s*[:：]\s*/, '').trim()
  if (!stripped || stripped === '连接失败') return '连接测试失败'
  return stripped
}
