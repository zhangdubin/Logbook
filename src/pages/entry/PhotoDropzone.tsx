/**
 * entry/PhotoDropzone —— 照片采集区
 * ---------------------------------------------------------------------------
 * 手机端：点「拍照」直接调起相机（capture=environment）；点「相册」可多选。
 * PC 端：支持拖拽文件到虚线框，或直接 Ctrl/Cmd+V 粘贴截图。
 * 拍完/选完会立刻弹出裁剪界面 —— 拍一整页作业不如只框一道题识别得准。
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import { dataUrlBytes, fileToPhoto, isImageFile } from './image'
import type { PhotoItem } from './image'
import { ImageCropper } from './ImageCropper'
import type { CropResult } from './ImageCropper'
import { ENGINE_DESC, ENGINE_HEADLINE } from './engine'
import type { EngineState } from './engine'

/** 供父组件（拍照页）调用的命令 */
export interface PhotoDropzoneHandle {
  /** 打开某张照片的裁剪界面 */
  cropPhoto: (photoId: string) => void
  /** 唤起相机 / 相册 */
  pickPhoto: () => void
}

export function PhotoDropzone({
  ref,
  photos,
  onChange,
  onCropApplied,
  disabled = false,
  max = 6,
  engine = 'unknown',
  hint = '支持 JPG / PNG，拍照后会自动裁剪、压到 2000px 以内再上传',
}: {
  ref?: Ref<PhotoDropzoneHandle>
  photos: PhotoItem[]
  onChange: (next: PhotoItem[]) => void
  /** 裁剪生效后回调（父组件可据此重新发起识别） */
  onCropApplied?: (photo: PhotoItem) => void
  disabled?: boolean
  max?: number
  /** 当前识别能力：决定标题文案（配没配 AI 要说清楚） */
  engine?: EngineState
  hint?: string
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const albumRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 正在裁剪的照片 */
  const [cropTarget, setCropTarget] = useState<PhotoItem | null>(null)
  /** 新拍的照片选「重新拍摄」时直接丢弃，重新裁剪时保留原样 */
  const [cropIsNew, setCropIsNew] = useState(false)

  const acceptFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(isImageFile)
    if (!list.length) {
      setError('只支持图片文件（jpg / png / heic 等）')
      return
    }
    if (photos.length + list.length > max) {
      setError(`一次最多 ${max} 张，已自动截取前 ${Math.max(0, max - photos.length)} 张`)
    }
    const room = Math.max(0, max - photos.length)
    const usable = list.slice(0, room)
    if (!usable.length) return
    setBusy(true)
    setError(null)
    try {
      const items = await Promise.all(usable.map((f) => fileToPhoto(f)))
      onChange([...photos, ...items])
      /* 拍完立刻进入裁剪：只框一道题，识别率会高很多 */
      setCropTarget(items[0])
      setCropIsNew(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '图片处理失败')
    } finally {
      setBusy(false)
    }
  }

  // 粘贴图片（PC 端 Ctrl/Cmd+V）
  useEffect(() => {
    if (disabled) return
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      const files = e.clipboardData?.files
      if (files && files.length) {
        e.preventDefault()
        void acceptFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, disabled, max])

  /* 父组件可以命令式地唤起裁剪 / 选择照片 */
  useImperativeHandle(
    ref,
    () => ({
      cropPhoto: (photoId: string) => {
        const target = photos.find((p) => p.id === photoId)
        if (!target) return
        setCropTarget(target)
        setCropIsNew(false)
      },
      pickPhoto: () => cameraRef.current?.click(),
    }),
    [photos],
  )

  const applyCrop = useCallback(
    (result: CropResult, mode: 'crop' | 'full') => {
      if (!cropTarget) return
      const updated: PhotoItem = {
        ...cropTarget,
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        cropped: mode === 'crop',
        size: dataUrlBytes(result.dataUrl),
      }
      onChange(photos.map((p) => (p.id === updated.id ? updated : p)))
      setCropTarget(null)
      onCropApplied?.(updated)
    },
    [cropTarget, onChange, photos, onCropApplied],
  )

  const cancelCrop = useCallback(() => {
    if (cropTarget && cropIsNew) {
      /* 新拍的照片用户选择「重新拍摄」→ 丢掉，重新拍 */
      onChange(photos.filter((p) => p.id !== cropTarget.id))
    }
    setCropTarget(null)
  }, [cropTarget, cropIsNew, onChange, photos])

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (disabled) return
          if (e.dataTransfer?.files?.length) void acceptFiles(e.dataTransfer.files)
        }}
        className={`rounded-2xl border-2 border-dashed px-4 py-5 text-center transition ${
          dragging ? 'border-brand-400 bg-brand-50' : 'border-ink-200 bg-ink-50/50'
        }`}
      >
        <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-white text-2xl shadow-sm ring-1 ring-ink-100">
          📷
        </div>
        <p className="text-sm font-bold text-ink-700">{ENGINE_HEADLINE[engine]}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          {ENGINE_DESC[engine]}
          <br />
          拍完会弹出裁剪框，<strong className="text-ink-700">只留一道题</strong>，识别更准。
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={disabled || busy}
            onClick={() => cameraRef.current?.click()}
          >
            {busy ? '处理中…' : '📸 拍照'}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-lg"
            disabled={disabled || busy}
            onClick={() => albumRef.current?.click()}
          >
            🖼️ 从相册选
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-400">{hint}</p>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void acceptFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void acceptFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
          {error}
        </p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <div key={p.id} className="group relative overflow-hidden rounded-xl border border-ink-200 bg-white">
              <img src={p.dataUrl} alt={p.name} className="aspect-[4/3] w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(photos.filter((x) => x.id !== p.id))}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink-900/70 text-[11px] text-white opacity-90 transition hover:bg-red-600"
                aria-label="删除照片"
              >
                ✕
              </button>
              <button
                type="button"
                onClick={() => {
                  setCropTarget(p)
                  setCropIsNew(false)
                }}
                className="absolute bottom-1 left-1 rounded-md bg-ink-900/70 px-1.5 py-0.5 text-[10px] font-bold text-white opacity-90 transition hover:bg-brand-600"
                aria-label="裁剪照片"
              >
                ✂ 裁剪
              </button>
              {p.cropped && (
                <span className="absolute bottom-1 right-1 rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  已裁剪
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 裁剪界面 */}
      <ImageCropper
        open={!!cropTarget}
        src={cropTarget?.originalDataUrl ?? cropTarget?.dataUrl}
        cancelLabel={cropIsNew ? '重新拍摄' : '取消裁剪'}
        onCancel={cancelCrop}
        onApply={applyCrop}
      />
    </div>
  )
}

export default PhotoDropzone
