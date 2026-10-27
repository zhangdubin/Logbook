/**
 * entry/PhotoDropzone —— 照片采集区
 * ---------------------------------------------------------------------------
 * 手机端：点「拍照」直接调起相机（capture=environment）；点「相册」可多选。
 * PC 端：支持拖拽文件到虚线框，或直接 Ctrl/Cmd+V 粘贴截图。
 */

import { useEffect, useRef, useState } from 'react'
import { fileToPhoto, isImageFile } from './image'
import type { PhotoItem } from './image'

export function PhotoDropzone({
  photos,
  onChange,
  disabled = false,
  max = 6,
  hint = '支持 JPG / PNG，手机拍照会自动压缩后上传',
}: {
  photos: PhotoItem[]
  onChange: (next: PhotoItem[]) => void
  disabled?: boolean
  max?: number
  hint?: string
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const albumRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        <p className="text-sm font-bold text-ink-700">把错题拍下来，AI 帮你识别</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          手机端点「拍照」直接调起相机；电脑上可以把图片拖进来，或按 Ctrl/Cmd+V 粘贴截图。
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PhotoDropzone
