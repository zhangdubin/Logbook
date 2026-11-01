/**
 * features/settings/ocrPlaceholder —— OCR 地址输入框的占位符
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么这个「占位符」值得单独抽成一个纯函数，还值得给它加断言？
 *
 * 事故经过：
 *   设置页写死了 `placeholder="http://127.0.0.1:8868"`。
 *   用户**照着填** —— 而在 Docker 部署里，`127.0.0.1` 指的是
 *   **应用容器自己**，不是宿主机、也不是 OCR 容器，
 *   必然 ECONNREFUSED。
 *
 *   修完之后**又漏了一处**：后端没给推荐值时（老版后端）的**兜底分支**
 *   又给回了 `http://127.0.0.1:8868`。
 *
 * 为什么会漏？因为**主路径改好了，兜底路径没人看**。
 *
 * 所以这个值必须有断言钉住 —— 它的失败模式**极其隐蔽**：
 * 一个必然错的地址**不会让任何测试变红**，只会让用户在生产环境里踩坑。
 *
 * 原则：
 *   **凡是系统不知道的值，就别给一个「看起来能抄、但可能必然错」的示例。**
 *   给中性占位符 + 把规则讲清楚 —— **规则不会骗人，具体地址会。**
 */

/**
 * OCR 地址输入框的占位符。
 *
 * @param suggestedUrl  后端给出的「这套部署该填的地址」（可能为空）
 * @returns             有推荐值就用它；没有就给**中性**占位符
 */
export function ocrPlaceholder(suggestedUrl?: string | null): string {
  const suggestion = (suggestedUrl ?? '').trim()
  return suggestion || 'http://<主机名或容器名>:8868'
}

/**
 * 地址输入框下方的说明文案。
 *
 * 有后端推荐值时**直接给出正确值**（用户复制即可）；
 * 没有时**讲规则**，而不是给一个可能错的示例。
 */
export function ocrAddressHint(suggestedUrl?: string | null): string {
  const suggestion = (suggestedUrl ?? '').trim()
  if (suggestion) {
    return `这套部署里应该填 ${suggestion}（后端按部署方式给出的推荐值）。若用别的 OCR 服务商，按其文档改。`
  }
  return (
    '填 OCR 服务的地址。若应用跑在 Docker 容器里，用**容器名**而不是 127.0.0.1 —— 容器里的 127.0.0.1 指的是容器自己。'
  )
}
