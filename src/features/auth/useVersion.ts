/**
 * features/auth/useVersion —— 应用版本号 + 演示模式开关（装饰性信息）
 * ---------------------------------------------------------------------------
 * 设计要点：
 *   - 拉取失败（后端未启动 / 网络不通 / 接口 404）**静默失败**：
 *     不抛错、不弹提示、不影响页面渲染；
 *   - 版本号只是装饰，组件里不写死，取不到就整行不渲染；
 *   - 与登录态无关：user 还没加载完也能正常取到。
 *
 * 演示模式（`demo`）：
 *   - 由后端 `GET /api/version` 的 `demo` 字段决定（默认 false = 生产环境）；
 *   - **安全优先**：取不到 / 解析不出来一律当作「关闭」，绝不因为拿不到就把
 *     演示账号面板（默认口令）露出来；
 *   - 与版本号展示解耦：版本号取不到时同样能拿到 demo 标志。
 */

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import type { AppVersion } from '@/lib/api'

export type { AppVersion }

/**
 * 模块级共享请求 —— `useAppVersion()` 与 `useDemoMode()` 同时使用时
 * 只发一次 `GET /api/version`。
 */
let inflight: Promise<AppVersion> | null = null

function loadVersion(): Promise<AppVersion> {
  if (!inflight) {
    inflight = api.getVersion().catch((err: unknown) => {
      // 失败后允许后续重试
      inflight = null
      throw err
    })
  }
  return inflight
}

/**
 * 从版本响应里读 `demo` 标志。
 *
 * 用 `unknown` + 运行时收窄，不依赖 `AppVersion` 接口上是否已声明 `demo`，
 * 这样后端加字段与前端类型更新可以解耦。
 */
export function readDemoFlag(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const flag = (payload as Record<string, unknown>).demo
  return flag === true
}

/**
 * 拉取一次应用版本信息。
 * @returns 拿不到时为 null
 */
export function useAppVersion(): AppVersion | null {
  const [version, setVersion] = useState<AppVersion | null>(null)

  useEffect(() => {
    let cancelled = false
    loadVersion()
      .then((v) => {
        if (!cancelled && v) setVersion(v)
      })
      .catch(() => {
        /* 静默失败：版本号只是装饰性信息 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return version
}

/**
 * 演示模式开关。
 *
 * @returns
 *   - `demo`：是否演示环境。**默认 false**（取不到即当作生产环境，安全优先）；
 *   - `loading`：是否还在拉取（用于避免闪烁判断，渲染时可忽略）。
 */
export function useDemoMode(): { demo: boolean; loading: boolean } {
  const [demo, setDemo] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadVersion()
      .then((v) => {
        if (cancelled) return
        setDemo(readDemoFlag(v))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        // 拿不到 → 按生产环境处理，绝不暴露演示账号面板
        setDemo(false)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { demo, loading }
}

/**
 * 格式化为展示文案：`v1.0.0 · 4e535c1`
 * @returns 无法格式化时返回 null
 */
export function formatVersion(version: AppVersion | null): string | null {
  if (!version || !version.version) return null
  const base = `v${version.version}`
  const commit = version.commit?.trim()
  return commit ? `${base} · ${commit}` : base
}
