/**
 * components/ErrorBoundary —— 渲染崩溃兜底
 * ---------------------------------------------------------------------------
 * 为什么必须有这个：
 *
 * React 里任何一个组件在 render 期间抛出异常，**整棵子树会被卸载**。
 * 没有错误边界时，用户看到的就是一个**完全空白的页面**，
 * 而且不知道发生了什么、也不知道怎么回到有内容的地方。
 *
 * 真实踩过的坑：后端把 `draft.knowledgePoints` 从 `string[]` 改成了对象数组，
 * 前端把对象当 React 子节点渲染 → React error #31（Objects are not valid as
 * a React child）→ 识别结果一出来整页白屏。
 * 用户看到的现象是「识别时自己跳转到空白页面了」，跟技术原因完全对不上。
 *
 * 所以：**崩溃必须被兜住，并且要说清楚发生了什么 + 给一条能走的路。**
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** 出错时展示的标题 */
  title?: string
  /** 重试时执行的回调；不传则退回刷新页面 */
  onRetry?: () => void
}

type State = {
  error: Error | null
  info: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 留一份组件栈，方便用户截图反馈时能定位
    this.setState({ info: info?.componentStack ?? '' })
    // 控制台留痕，便于开发时排查
    console.error('[ErrorBoundary] 渲染异常：', error, info?.componentStack)
  }

  handleRetry = () => {
    this.setState({ error: null, info: '' })
    if (this.props.onRetry) {
      this.props.onRetry()
      return
    }
    window.location.reload()
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="card w-full max-w-xl space-y-4 p-6">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink-500">页面出错了</p>
            <h2 className="text-lg font-black tracking-tight text-ink-900">
              {this.props.title ?? '这个页面渲染时出了点问题'}
            </h2>
          </div>

          <p className="text-sm leading-relaxed text-ink-600">
            你的数据<strong className="font-bold text-ink-800">没有丢</strong>
            ，是页面上某个组件渲染失败了。
            点下面的按钮重试，通常就能恢复。
          </p>

          <details className="rounded-xl bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-600 ring-1 ring-ink-200">
            <summary className="cursor-pointer font-semibold text-ink-700">
              查看技术细节（反馈问题时请把这段一起发上来）
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] text-ink-500">
              {String(error?.message ?? error)}
              {info ? `\n${info.slice(0, 1200)}` : ''}
            </pre>
          </details>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn btn-primary btn-sm" onClick={this.handleRetry}>
              ↻ 重试
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                window.location.href = '/'
              }}
            >
              回到首页
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
