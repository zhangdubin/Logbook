/**
 * entry/image —— 照片处理工具
 * ---------------------------------------------------------------------------
 * 手机直出照片往往 3~8MB，方向还可能横着躺，直接转 base64 会撑爆请求体、
 * 也会让 OCR 识别率崩掉。这里在浏览器端做三件事：
 *   1. 用 createImageBitmap(file, { imageOrientation: 'from-image' }) 修正 EXIF 方向；
 *   2. 长边超过 2000px 就等比缩到 2000px 以内（OCR 足够清晰，上传又快）；
 *   3. 统一输出 JPEG q=0.9，再由 cropImage 做选区裁剪。
 */

/** 一张待录入的照片 */
export interface PhotoItem {
  id: string
  name: string
  /** base64 data url（可直接用于 <img src> 与 AI 识别） */
  dataUrl: string
  size: number
  /** 裁剪前的原图（已压缩、已修正方向），用于「重新裁剪」时重新选区 */
  originalDataUrl?: string
  /** 当前图（dataUrl）的像素尺寸 */
  width?: number
  height?: number
  /** 是否已经裁剪过 */
  cropped?: boolean
}

/** 选区（源图像素坐标） */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** 拍摄后压缩的长边上限 */
export const MAX_EDGE = 2000
/** 拍摄后 JPEG 质量 */
export const JPEG_QUALITY = 0.9
/** 裁剪结果的 JPEG 质量 */
export const CROP_QUALITY = 0.92

let seq = 0
export function photoId(): string {
  seq += 1
  return `photo_${Date.now().toString(36)}_${seq}`
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败，换一张试试'))
    reader.readAsDataURL(file)
  })
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解析失败'))
    img.src = src
  })
}

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
}

/**
 * 解码图片并修正 EXIF 方向。
 * 优先用 createImageBitmap(..., { imageOrientation: 'from-image' })；
 * 浏览器不支持时退回 <img>（现代浏览器绘制到 canvas 时同样会按 EXIF 摆正）。
 */
async function decodeImage(file: File, fallbackDataUrl: string): Promise<DecodedImage> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height }
    }
  } catch {
    /* 退回到 <img> 方案 */
  }
  const img = await loadImage(fallbackDataUrl)
  return { source: img, width: img.naturalWidth, height: img.naturalHeight }
}

/** 估算 data url 的字节数（base64 每 4 个字符约 3 字节） */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  const body = i >= 0 ? dataUrl.slice(i + 1) : dataUrl
  return Math.round((body.length * 3) / 4)
}

/** 压缩并转 data URL；失败时回退到原始 data URL */
export async function fileToPhoto(
  file: File,
  maxSize = MAX_EDGE,
  quality = JPEG_QUALITY,
): Promise<PhotoItem> {
  const raw = await readAsDataUrl(file)
  let dataUrl = raw
  let width = 0
  let height = 0
  try {
    if (file.type !== 'image/gif') {
      const decoded = await decodeImage(file, raw)
      width = decoded.width
      height = decoded.height
      const scale = Math.min(1, maxSize / Math.max(width, height))
      const w = Math.max(1, Math.round(width * scale))
      const h = Math.max(1, Math.round(height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(decoded.source, 0, 0, w, h)
        dataUrl = canvas.toDataURL('image/jpeg', quality)
        width = w
        height = h
      }
    }
  } catch {
    dataUrl = raw
  }
  if (!width || !height) {
    try {
      const img = await loadImage(raw)
      width = img.naturalWidth
      height = img.naturalHeight
    } catch {
      width = 0
      height = 0
    }
  }
  return {
    id: photoId(),
    name: file.name || '照片',
    dataUrl,
    size: file.size,
    originalDataUrl: dataUrl,
    width,
    height,
  }
}

/**
 * 按选区裁剪图片，输出 JPEG data URL。
 * rect 使用源图像素坐标；越界会被自动收敛到图片范围内。
 */
export async function cropImage(
  src: string,
  rect: CropRect,
  quality = CROP_QUALITY,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(src)
  const natW = img.naturalWidth || img.width
  const natH = img.naturalHeight || img.height
  const x = Math.max(0, Math.min(Math.round(rect.x), natW - 1))
  const y = Math.max(0, Math.min(Math.round(rect.y), natH - 1))
  const w = Math.max(1, Math.min(Math.round(rect.w), natW - x))
  const h = Math.max(1, Math.min(Math.round(rect.h), natH - y))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持图片裁剪')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}
