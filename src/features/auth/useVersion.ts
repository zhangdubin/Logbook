/**
 * features/auth/useVersion —— 应用版本号（装饰性信息）
 * ---------------------------------------------------------------------------
 * 设计要点：
 *   - 拉取失败（后端未启动 / 网络不通 / 接口 404）**静默失败**：
 *     不抛错、不弹提示、不影响页面渲染；
 *   - 版本号只是装饰，组件里不写死，取不到就整行不渲染；
 *   - 与登录态无关：user 还没加载完也能正常取到。
 */

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import type { AppVersion } from '@/lib/api'

export type { AppVersion }

/**
 * 拉取一次应用版本信息。
 * @returns 拿不到时为 null
 */
export function useAppVersion(): AppVersion | null {
  const [version, setVersion] = useState<AppVersion | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getVersion()
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
 * 格式化为展示文案：`v1.0.0 · 4e535c1`
 * @returns 无法格式化时返回 null
 */
export function formatVersion(version: AppVersion | null): string | null {
  if (!version || !version.version) return null
  const base = `v${version.version}`
  const commit = version.commit?.trim()
  return commit ? `${base} · ${commit}` : base
}
