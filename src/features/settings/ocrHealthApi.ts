/**
 * features/settings/ocrHealthApi —— 本地 OCR 服务健康检查接口
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么**不能**在浏览器里直连 OCR 服务？
 *
 * Docker 部署时 .env 里配的常常是：
 *   OCR_SERVICE_URL=http://cuoti-ocr:8868
 * `cuoti-ocr` 是 **Docker 内部网络里的容器名**，浏览器在宿主机 / 用户设备上，
 * 根本解析不了这个域名。于是：
 *   - 服务好好地在跑，后端也连得上（拍照识别确实走通了本地 OCR）；
 *   - 设置页的健康检查却**永远**显示「未检测到」；
 *   - 用户看到的就成了「我明明启用了，为什么说我没启用」。
 *
 * 所以真相只能由后端给：后端进程在 Docker 网络里，能连到 cuoti-ocr ✓。
 * 前端只负责问一句「你那边连得到吗」，不自己发起探测。
 *
 * 说明：src/lib/api.ts 由别的同事维护，这里就地封装一个方法；
 * 将来公共 api 里加了 getOcrHealth，把这里换掉即可，界面不用动。
 */

import { ApiRequestError, UNAUTHORIZED_EVENT } from '@/lib/api'

export interface OcrHealthResponse {
  /** 后端探到服务了没有 —— 这才是真相 */
  reachable: boolean
  /** 服务自报的引擎名（rapidocr / paddleocr…），拿不到就是 null */
  engine: string | null
  /** 原始响应或失败原因，给排查用 */
  detail: string | null
  /** 探测耗时（毫秒） */
  latencyMs: number | null
  /** 有没有配地址（没配时 reachable 必然是 false） */
  configured: boolean
  /** 当前配的地址 */
  baseUrl: string
  /**
   * **这套部署里应该填的地址**（后端给的）。
   *
   * 为什么需要它：同一个地址在两种部署下含义完全相反 ——
   *   · 应用跑在宿主机上 → `http://127.0.0.1:8868` ✓
   *   · 应用跑在 Docker 里 → `127.0.0.1` 指的是**应用容器自己** ✗
   * 前端不知道自己在哪种部署里，所以由后端给。
   */
  suggestedUrl: string
  /** 探测时间 */
  checkedAt: string
}

/** 问后端「本地 OCR 服务连得到吗」 */
export async function getOcrHealth(): Promise<OcrHealthResponse> {
  const res = await fetch('/api/settings/ocr-health', { credentials: 'include' })
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
  const data = (await res.json()) as Partial<OcrHealthResponse> | null
  return {
    reachable: Boolean(data?.reachable),
    engine: typeof data?.engine === 'string' && data.engine.trim() ? data.engine.trim() : null,
    detail: typeof data?.detail === 'string' ? data.detail : null,
    latencyMs: typeof data?.latencyMs === 'number' ? data.latencyMs : null,
    configured: Boolean(data?.configured),
    baseUrl: typeof data?.baseUrl === 'string' ? data.baseUrl : '',
    suggestedUrl: typeof data?.suggestedUrl === 'string' ? data.suggestedUrl : '',
    checkedAt: typeof data?.checkedAt === 'string' ? data.checkedAt : '',
  }
}

/** 把后端错误翻译成人话 */
export function ocrHealthErrorText(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 401) return '登录状态已失效，请重新登录后再试'
    if (e.status === 404) return '后端还没有这个接口（健康检查服务未启动）'
    if (e.status >= 500) return '后端服务异常，请稍后再试'
    return e.message || '健康检查接口没跑起来'
  }
  if (e instanceof TypeError) return '后端未启动或接口不可用'
  if (e instanceof Error) return e.message || '健康检查接口没跑起来'
  return '健康检查接口没跑起来'
}
