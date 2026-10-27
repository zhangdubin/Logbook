/**
 * entry/image —— 照片处理工具
 * ---------------------------------------------------------------------------
 * 手机直出照片往往 3~8MB，直接转 base64 会撑爆请求体，
 * 这里在浏览器端先等比压缩（最长边 1600px、JPEG 质量 0.82）再转 data URL。
 */

/** 一张待录入的照片 */
export interface PhotoItem {
  id: string
  name: string
  /** base64 data url（可直接用于 <img src> 与 AI 识别） */
  dataUrl: string
  size: number
}

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解析失败'))
    img.src = src
  })
}

/** 压缩并转 data URL；失败时回退到原始 data URL */
export async function fileToPhoto(file: File, maxSize = 1600, quality = 0.82): Promise<PhotoItem> {
  const raw = await readAsDataUrl(file)
  let dataUrl = raw
  try {
    if (file.type !== 'image/gif') {
      const img = await loadImage(raw)
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      if (scale < 1 || file.size > 320 * 1024) {
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          dataUrl = canvas.toDataURL('image/jpeg', quality)
        }
      }
    }
  } catch {
    dataUrl = raw
  }
  return { id: photoId(), name: file.name || '照片', dataUrl, size: file.size }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}
