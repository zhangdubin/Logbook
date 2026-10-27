/**
 * entry/ModeBanner —— 演示数据提示条
 * ---------------------------------------------------------------------------
 * 当真实接口不可用、自动降级到本地演示数据时显示，避免用户误以为是真实学情。
 */

import { AlertBox } from '@/components/ui'
import { useDataMode } from './hooks'

export function ModeBanner() {
  const mode = useDataMode()
  if (mode !== 'mock') return null
  return (
    <AlertBox tone="warning" title="当前为演示数据">
      后端接口暂时连不上，页面展示的是本地演示数据（不会被保存到服务器）。
      接口恢复后会自动切回真实数据，无需刷新。
    </AlertBox>
  )
}

export default ModeBanner
