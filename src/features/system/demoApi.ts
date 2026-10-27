/**
 * features/system/demoApi —— 演示模式接口封装
 * ---------------------------------------------------------------------------
 * 为什么就地封装：`src/lib/api.ts` 由别的同事维护（正在加 AppVersion.demo），
 * 改动会冲突，所以这里在 features/system 内部自己发请求。
 * 将来公共 api 里若加了 getDemoStatus / setDemoMode，把这里换掉即可，UI 不用动。
 *
 * 接口：
 *   GET  /api/system/demo          → DemoStatus（需要登录）
 *   PUT  /api/system/demo          → DemoStatus（需要 system:update）
 *        body {enabled:true|false} 设置演示模式
 *        body {reset:true}         删掉数据库里的设置，交回环境变量决定
 */

import { ApiRequestError, UNAUTHORIZED_EVENT } from '@/lib/api'

/** 最终生效值来自哪里 */
export type DemoSource = 'setting' | 'env' | 'seed' | 'default'

export interface DemoStatus {
  /** 当前最终生效值 */
  demo: boolean
  /** 最终值来源：setting=数据库 / env=DEMO_MODE / seed=SEED_DEMO / default=默认关闭 */
  source: DemoSource
  /** 数据库里存的值；null = 没存过（由环境变量决定） */
  stored: boolean | null
  /** 环境变量 DEMO_MODE 的值；null = 没设 */
  envDemo: boolean | null
  /** 环境变量 SEED_DEMO 的值；null = 没设 */
  seedDemo: boolean | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      msg = data?.message || data?.error || msg
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    }
    throw new ApiRequestError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** 读取演示模式状态 */
export function getDemoStatus(): Promise<DemoStatus> {
  return request<DemoStatus>('/system/demo')
}

/** 强制开启 / 关闭演示模式（写进数据库，优先级高于环境变量） */
export function setDemoEnabled(enabled: boolean): Promise<DemoStatus> {
  return request<DemoStatus>('/system/demo', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

/** 交回环境变量决定（删掉数据库里的设置） */
export function resetDemoMode(): Promise<DemoStatus> {
  return request<DemoStatus>('/system/demo', {
    method: 'PUT',
    body: JSON.stringify({ reset: true }),
  })
}

/** 把后端错误翻译成人话 */
export function demoErrorText(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 401) return '登录状态已失效，请重新登录后再试'
    if (e.status === 403) return '当前账号没有「系统更新」权限'
    if (e.status === 404) return '后端接口尚未就绪（演示模式服务未启动）'
    if (e.status >= 500) return '后端服务异常，请稍后再试'
    return e.message || fallback
  }
  if (e instanceof TypeError) return '后端未启动或接口不可用'
  if (e instanceof Error) return e.message || fallback
  return fallback
}
