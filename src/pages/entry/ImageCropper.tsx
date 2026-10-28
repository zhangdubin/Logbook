/**
 * entry/ImageCropper —— 图片裁剪选区
 * ---------------------------------------------------------------------------
 * 纯 canvas + Pointer Events 实现，不引第三方裁剪库：
 *   · 鼠标与触摸统一走 pointerdown / pointermove / pointerup；
 *   · 选区可整体拖动、可拖 4 个角 / 4 条边缩放，也可在空白处直接拉出新选区；
 *   · 选区外蒙半透明遮罩，实时显示选区像素尺寸与原图尺寸；
 *   · 图片等比缩放显示，再大的原图也不会撑破屏幕。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Spinner } from '@/components/ui'
import { cropImage } from './image'
import type { CropRect } from './image'

/** 八个控制点 */
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
/** 控制点命中半径（显示像素） */
const HIT_RADIUS = 18
/** 选区最小边长（源图像素） */
const MIN_EDGE = 24

type DragState =
  | { kind: 'new' }
  | { kind: 'move' }
  | { kind: 'resize'; handle: Handle }

/** 选区（源图像素） -> 显示坐标 */
interface View {
  scale: number
  ox: number
  oy: number
  cw: number
  ch: number
}

export interface CropResult {
  dataUrl: string
  width: number
  height: number
  rect: CropRect
}

export interface ImageCropperProps {
  open: boolean
  /** 待裁剪的原图（data url） */
  src?: string
  /** 「重新拍摄」还是「取消」：新建照片时为重新拍摄，重新裁剪时为取消 */
  cancelLabel?: string
  onCancel: () => void
  onApply: (result: CropResult, mode: 'crop' | 'full') => void
}

export function ImageCropper({
  open,
  src,
  cancelLabel = '重新拍摄',
  onCancel,
  onApply,
}: ImageCropperProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{
    mode: DragState
    startX: number
    startY: number
    startRect: CropRect
  } | null>(null)

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<CropRect | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* ------------------------------ 载入图片 ------------------------------ */
  useEffect(() => {
    if (!open || !src) return
    let alive = true
    setError(null)
    setNatural(null)
    setRect(null)
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      imgRef.current = img
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      setNatural({ w, h })
      /* 不预选：第一次拖拽一定是「画一个新选区」，而不是平移整张图 */
      setRect(null)
    }
    img.onerror = () => {
      if (alive) setError('图片加载失败，请重新拍摄')
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [open, src])

  /* ------------------------------ 计算显示比例 ------------------------------ */
  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || !natural) return
    const cw = wrap.clientWidth
    const ch = wrap.clientHeight
    if (!cw || !ch) return
    const scale = Math.min(cw / natural.w, ch / natural.h)
    setView({
      scale,
      ox: (cw - natural.w * scale) / 2,
      oy: (ch - natural.h * scale) / 2,
      cw,
      ch,
    })
  }, [natural])

  useEffect(() => {
    measure()
    if (!wrapRef.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [measure])

  /* ------------------------------ 绘制 ------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    /* 重新打开裁剪时 natural 会先被清空，此时 view 可能还是上一次的，必须挡住 */
    if (!canvas || !img || !view || !natural) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(view.cw * dpr) || canvas.height !== Math.round(view.ch * dpr)) {
      canvas.width = Math.round(view.cw * dpr)
      canvas.height = Math.round(view.ch * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, view.cw, view.ch)

    /* 底图 */
    ctx.drawImage(img, view.ox, view.oy, natural.w * view.scale, natural.h * view.scale)

    const sel = rect
    if (!sel) {
      /* 还没框选：给一个明显提示，别让用户以为页面没响应 */
      const bw = natural.w * view.scale
      const bh = natural.h * view.scale
      ctx.setLineDash([8, 6])
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 2
      ctx.strokeRect(view.ox + 1, view.oy + 1, bw - 2, bh - 2)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(15,23,42,0.55)'
      ctx.fillRect(view.ox, view.oy, bw, bh)
      ctx.fillStyle = '#ffffff'
      ctx.font = '600 14px system-ui, -apple-system, "PingFang SC", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('拖动框选题目区域', view.ox + bw / 2, view.oy + bh / 2)
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
      return
    }
    const x = view.ox + sel.x * view.scale
    const y = view.oy + sel.y * view.scale
    const w = sel.w * view.scale
    const h = sel.h * view.scale

    /* 选区外遮罩 */
    ctx.fillStyle = 'rgba(15, 23, 42, 0.58)'
    ctx.fillRect(0, 0, view.cw, y)
    ctx.fillRect(0, y + h, view.cw, view.ch - y - h)
    ctx.fillRect(0, y, x, h)
    ctx.fillRect(x + w, y, view.cw - x - w, h)

    /* 九宫格参考线 */
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    for (let i = 1; i <= 2; i += 1) {
      ctx.beginPath()
      ctx.moveTo(x + (w * i) / 3, y)
      ctx.lineTo(x + (w * i) / 3, y + h)
      ctx.moveTo(x, y + (h * i) / 3)
      ctx.lineTo(x + w, y + (h * i) / 3)
      ctx.stroke()
    }

    /* 选区边框 */
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
    ctx.strokeStyle = '#3b63f6'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

    /* 控制点 */
    const hs = 11
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#3b63f6'
    ctx.lineWidth = 2
    HANDLES.forEach((handle) => {
      const p = handlePoint(handle, x, y, w, h)
      ctx.beginPath()
      ctx.rect(p.x - hs / 2, p.y - hs / 2, hs, hs)
      ctx.fill()
      ctx.stroke()
    })
  }, [view, rect, natural])

  /* ------------------------------ 坐标换算 ------------------------------ */
  const toLocal = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const box = canvas.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  const handlePoint = (handle: Handle, x: number, y: number, w: number, h: number) => {
    switch (handle) {
      case 'nw':
        return { x, y }
      case 'n':
        return { x: x + w / 2, y }
      case 'ne':
        return { x: x + w, y }
      case 'e':
        return { x: x + w, y: y + h / 2 }
      case 'se':
        return { x: x + w, y: y + h }
      case 's':
        return { x: x + w / 2, y: y + h }
      case 'sw':
        return { x, y: y + h }
      default:
        return { x, y: y + h / 2 }
    }
  }

  /** 命中控制点 */
  const hitHandle = (px: number, py: number): Handle | null => {
    if (!rect || !view) return null
    const x = view.ox + rect.x * view.scale
    const y = view.oy + rect.y * view.scale
    const w = rect.w * view.scale
    const h = rect.h * view.scale
    for (const handle of HANDLES) {
      const p = handlePoint(handle, x, y, w, h)
      if (Math.abs(px - p.x) <= HIT_RADIUS && Math.abs(py - p.y) <= HIT_RADIUS) return handle
    }
    return null
  }

  const insideRect = (px: number, py: number): boolean => {
    if (!rect || !view) return false
    const x = view.ox + rect.x * view.scale
    const y = view.oy + rect.y * view.scale
    return px >= x && px <= x + rect.w * view.scale && py >= y && py <= y + rect.h * view.scale
  }

  /* ------------------------------ 拖拽 ------------------------------ */
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!view || !natural) return
    const p = toLocal(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    const handle = hitHandle(p.x, p.y)
    if (handle) {
      dragRef.current = { mode: { kind: 'resize', handle }, startX: p.x, startY: p.y, startRect: rect! }
    } else if (insideRect(p.x, p.y)) {
      dragRef.current = { mode: { kind: 'move' }, startX: p.x, startY: p.y, startRect: rect! }
    } else {
      dragRef.current = {
        mode: { kind: 'new' },
        startX: p.x,
        startY: p.y,
        startRect: { x: 0, y: 0, w: 0, h: 0 },
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || !view || !natural) return
    const p = toLocal(e)
    const dx = (p.x - drag.startX) / view.scale
    const dy = (p.y - drag.startY) / view.scale

    let next: CropRect
    if (drag.mode.kind === 'new') {
      const x1 = drag.startX / view.scale
      const y1 = drag.startY / view.scale
      const x2 = p.x / view.scale
      const y2 = p.y / view.scale
      next = {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
      }
    } else if (drag.mode.kind === 'move') {
      next = { ...drag.startRect, x: drag.startRect.x + dx, y: drag.startRect.y + dy }
    } else {
      next = resizeRect(drag.startRect, drag.mode.handle, dx, dy, MIN_EDGE)
    }
    setRect(clampRect(next, natural))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针已释放 */
    }
    /* 轻点（没拖出东西）时保持原选区 */
    if (drag && drag.mode.kind === 'new' && rect && rect.w * rect.h > 0) {
      const moved =
        Math.abs(e.clientX - drag.startX) > 4 || Math.abs(e.clientY - drag.startY) > 4
      if (!moved) setRect(drag.startRect)
    }
  }

  /* ------------------------------ 输出 ------------------------------ */
  const applyCrop = async () => {
    if (!src || !natural || !rect) return
    setWorking(true)
    setError(null)
    try {
      const cropped = await cropImage(src, rect)
      onApply({ ...cropped, rect }, 'crop')
    } catch (e) {
      setError(e instanceof Error ? e.message : '裁剪失败，请重试')
    } finally {
      setWorking(false)
    }
  }

  const applyFull = () => {
    if (!src || !natural) return
    onApply(
      { dataUrl: src, width: natural.w, height: natural.h, rect: { x: 0, y: 0, w: natural.w, h: natural.h } },
      'full',
    )
  }

  if (!open) return null

  const selText = rect
    ? `${Math.round(rect.w)} × ${Math.round(rect.h)} 像素`
    : '未选择'

  /*
   * 用 portal 挂到 body 上：卡片组件带 backdrop-blur，会成为 fixed 定位的包含块，
   * 直接渲染在页面里会让裁剪框错位（手机端尤其明显）。
   */
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink-900/60 backdrop-blur-[2px]" onClick={onCancel} aria-hidden />
      <div
        className="animate-pop-in relative z-10 flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="裁剪照片"
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-ink-800">裁剪题目区域</h3>
            <p className="mt-0.5 text-[11px] text-ink-500">
              拖动框选 · 拖角点缩放 · 选区外会自动盖住
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {/* 引导：只框一道题，识别率会高很多 */}
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
            <p className="text-xs font-bold text-amber-800">✂️ 只框选一道题，识别会准很多</p>
            <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-amber-700">
              <li>· 框里只放<strong>一道题</strong>：题干和选项都要包含，框太大识别会不准</li>
              <li>· 尽量避开<strong>手、阴影、反光</strong>，拍平一点、光线均匀最好</li>
              <li>· 题干和选项之间<strong>不要隔太多空白</strong>，空白多容易被截断</li>
            </ul>
          </div>

          <div
            ref={wrapRef}
            className="relative h-[46vh] min-h-[240px] w-full overflow-hidden rounded-xl bg-ink-900"
            style={{ touchAction: 'none' }}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full"
              style={{ touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {!natural && !error && (
              <div className="absolute inset-0 grid place-items-center text-xs text-white/70">
                图片加载中…
              </div>
            )}
            {error && (
              <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-500">
            <span>
              选区 <strong className="text-ink-800">{selText}</strong>
            </span>
            <span>
              原图 {natural ? `${natural.w} × ${natural.h}` : '—'}
            </span>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-ink-100 bg-white/95 px-4 py-3 pb-[calc(0.75rem+var(--safe-bottom))] backdrop-blur">
          <button
            type="button"
            className="btn btn-primary btn-lg flex-1 sm:flex-none"
            onClick={() => void applyCrop()}
            disabled={working || !rect || rect.w < MIN_EDGE || rect.h < MIN_EDGE}
            title={rect ? '按这个选区裁剪' : '先在图上拖出选区'}
          >
            {working ? '处理中…' : '✓ 用这个选区'}
          </button>
          <button type="button" className="btn btn-outline" onClick={applyFull} disabled={working}>
            全图
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={working}>
            {cancelLabel}
          </button>
          {working && <Spinner className="ml-1" />}
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */
/* 选区计算                                                                   */
/* -------------------------------------------------------------------------- */

/** 按控制点缩放选区 */
function resizeRect(start: CropRect, handle: Handle, dx: number, dy: number, min: number): CropRect {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left = start.x + dx
  if (handle.includes('e')) right = start.x + start.w + dx
  if (handle.includes('n')) top = start.y + dy
  if (handle.includes('s')) bottom = start.y + start.h + dy

  if (right - left < min) {
    if (handle.includes('w')) left = right - min
    else right = left + min
  }
  if (bottom - top < min) {
    if (handle.includes('n')) top = bottom - min
    else bottom = top + min
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** 把选区收敛回图片范围内 */
function clampRect(rect: CropRect, natural: { w: number; h: number }): CropRect {
  const w = Math.min(Math.max(rect.w, 1), natural.w)
  const h = Math.min(Math.max(rect.h, 1), natural.h)
  const x = Math.min(Math.max(rect.x, 0), natural.w - w)
  const y = Math.min(Math.max(rect.y, 0), natural.h - h)
  return { x, y, w, h }
}

export default ImageCropper
