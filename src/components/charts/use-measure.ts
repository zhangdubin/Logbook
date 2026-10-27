import { useEffect, useRef, useState } from 'react'

/**
 * 容器尺寸测量 —— 图表组件统一通过 ResizeObserver 自适应宽度。
 * 单独抽出成文件，便于 dual-axis.tsx 等子图复用，避免 index.tsx 与子图互相 import 形成循环依赖。
 */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, ...size }
}

export default useMeasure
