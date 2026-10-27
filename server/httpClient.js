/**
 * server/httpClient.js —— 支持代理的 HTTP(S) 客户端
 * ---------------------------------------------------------------------------
 * 为什么不用全局 fetch：
 *   Node 自带的 `NODE_USE_ENV_PROXY` 只在**进程启动时**读取，运行时改
 *   `process.env.HTTPS_PROXY` 不生效（已实测确认）。而本系统的代理地址是
 *   用户在网页上随时改的，改完必须立刻生效、不该要求重启服务。
 *   所以这里自己实现：HTTPS 走 CONNECT 隧道，HTTP 走绝对 URI 转发。
 *
 * 能力：
 *   - 可选 HTTP/HTTPS 代理（`http://user:pass@host:port` 也支持）
 *   - 自动跟随重定向（GitHub 的 tarball 会 302 到 codeload）
 *   - 请求超时（连接 + 空闲）
 *   - 下载进度回调（用于更新进度条）
 *   - 请求体支持 Buffer（发布 Release 时要上传 tar.gz）
 */

import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { URL } from 'node:url'

/**
 * 解析代理地址。
 * @param {string} proxyUrl 空串或非法 → 返回 null（直连）
 * @returns {{host:string,port:number,protocol:string,auth?:string}|null}
 */
export function parseProxy(proxyUrl) {
  const raw = String(proxyUrl ?? '').trim()
  if (!raw) return null
  let u
  try {
    u = new URL(raw.includes('://') ? raw : `http://${raw}`)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol)) return null
  const host = u.hostname
  if (!host) return null
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  const auth = u.username
    ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password || '')}`
    : ''
  return { host, port, protocol: u.protocol, ...(auth ? { auth } : {}) }
}

/** 代理鉴权头 */
function proxyAuthHeader(proxy) {
  if (!proxy?.auth) return {}
  return { 'Proxy-Authorization': `Basic ${Buffer.from(proxy.auth).toString('base64')}` }
}

/**
 * 通过 HTTP 代理建立到目标 https 主机的 CONNECT 隧道。
 * @returns {Promise<import('node:tls').TLSSocket>}
 */
function connectTunnel(target, proxy) {
  return new Promise((resolve, reject) => {
    const key = `${target.hostname}:${target.port || 443}`
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: key,
      headers: { Host: key, ...proxyAuthHeader(proxy) },
      timeout: 20000,
    })
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`代理拒绝 CONNECT（HTTP ${res.statusCode}）`))
        return
      }
      // SNI 的 servername 不能是 IP 地址（否则 Node 直接抛 ERR_INVALID_ARG_VALUE），
      // 只有域名才需要传。
      const host = target.hostname
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
      const secure = tls.connect(
        {
          socket,
          ...(isIp ? {} : { servername: host }),
          ALPNProtocols: ['http/1.1'],
        },
        () => resolve(secure),
      )
      secure.once('error', (err) => reject(err))
    })
    req.once('error', (err) =>
      reject(new Error(`无法连接代理 ${proxy.host}:${proxy.port}：${err.message}`)),
    )
    req.once('timeout', () => {
      req.destroy()
      reject(new Error('连接代理超时'))
    })
    req.end()
  })
}

/**
 * 发起一次请求（不处理重定向）。
 * @returns {Promise<{status:number,headers:object,body:Buffer}>}
 */
async function requestOnce(url, opts) {
  const { method, headers, body, proxy, timeoutMs, onProgress, connectTimeoutMs } = opts
  const target = new URL(url)

  let socket = null
  let useHttps = target.protocol === 'https:'
  let requestOptions

  if (proxy) {
    if (useHttps) {
      socket = await connectTunnel(target, proxy)
      requestOptions = {
        method,
        headers,
        // host/port/path 仍然要填：TLS 套接字由 createConnection 提供，
        // 但请求行与 Host 头依赖这三个字段（漏掉会连到 localhost 去）。
        host: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        agent: false,
        createConnection: () => socket,
      }
    } else {
      // 明文 HTTP：把完整 URL 作为请求行发给代理
      requestOptions = {
        method,
        headers: { Host: target.host, ...headers },
        host: proxy.host,
        port: proxy.port,
        path: target.href,
      }
      useHttps = false
    }
  } else {
    requestOptions = {
      method,
      headers,
      host: target.hostname,
      port: target.port || (useHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
    }
  }

  const lib = useHttps ? https : http

  return new Promise((resolve, reject) => {
    // 整体超时：`req.setTimeout` 只在 socket 建立后才计时，
    // 连接阶段卡住（IP 不可达等）时不会触发，所以这里再挂一个墙钟计时器。
    const hardTimer = setTimeout(() => {
      req.destroy(new Error(`请求超时（${timeoutMs}ms）`))
    }, timeoutMs)
    // 连接阶段单独计时：有些 CDN 域名在国内是「TCP 连得上、但握手永远不返回」，
    // 不单独设限的话要干等整个下载超时才失败（实测会白等 10 分钟）。
    let connected = false
    const connectTimer = setTimeout(() => {
      if (!connected) req.destroy(new Error(`连接超时（${connectTimeoutMs}ms）`))
    }, connectTimeoutMs)
    const done = (fn) => (...args) => {
      clearTimeout(hardTimer)
      clearTimeout(connectTimer)
      fn(...args)
    }

    const req = lib.request(requestOptions, done((res) => {
      const chunks = []
      let received = 0
      const total = Number(res.headers['content-length'] ?? 0) || 0

      res.on('data', (chunk) => {
        chunks.push(chunk)
        received += chunk.length
        if (onProgress) {
          try {
            onProgress(received, total)
          } catch {
            /* 进度回调出错不影响下载 */
          }
        }
      })
      res.on('end', () => {
        clearTimeout(hardTimer)
        try {
          socket?.destroy()
        } catch {
          /* ignore */
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      })
      res.on('error', (err) => {
        clearTimeout(hardTimer)
        reject(err)
      })
    }))

    req.on('socket', (socket) => {
      if (!socket.connecting) connected = true
      else socket.once('connect', () => { connected = true })
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`请求超时（${timeoutMs}ms）`))
    })
    req.on('error', done((err) => {
      try {
        socket?.destroy()
      } catch {
        /* ignore */
      }
      // 走代理时的连接类错误要说清楚是「代理」的问题，
      // 否则用户只会看到 ECONNREFUSED，分不清是自己的网络还是代理挂了。
      const code = String(err?.code ?? '')
      const connErr = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|ECONNRESET/.test(code)
      if (proxy && connErr && !/代理/.test(String(err?.message ?? ''))) {
        reject(new Error(`无法连接代理 ${proxy.host}:${proxy.port}：${err.message}`))
        return
      }
      reject(err)
    }))

    if (body) req.write(body)
    req.end()
  })
}

/**
 * 发起请求并自动跟随重定向。
 * @param {string} url
 * @param {object} opts
 *   method, headers, body(Buffer|string|null), proxyUrl, timeoutMs,
 *   maxRedirects, onProgress(received,total)
 * @returns {Promise<{status:number,headers:object,body:Buffer}>}
 */
export async function request(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    proxyUrl = '',
    timeoutMs = 15000,
    connectTimeoutMs = 20000,
    maxRedirects = 5,
    onProgress = null,
  } = opts

  const proxy = parseProxy(proxyUrl)
  let current = url
  let currentMethod = method
  let currentBody = body

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await requestOnce(current, {
      method: currentMethod,
      headers,
      body: currentBody,
      proxy,
      timeoutMs,
      connectTimeoutMs,
      onProgress: i === 0 ? onProgress : null,
    })

    const code = res.status
    const location = res.headers.location
    if ([301, 302, 303, 307, 308].includes(code) && location) {
      const next = new URL(location, current)
      const crossedOrigin = next.origin !== new URL(current).origin
      // 跨域跳转时必须丢掉 Authorization：
      // 私有仓库的附件会 302 到签名的对象存储地址，对方收到
      // 「Authorization: Bearer ...」会直接拒（只允许一种鉴权机制）。
      // 反过来也不能把凭据带到别的域去。
      if (crossedOrigin) delete headers.authorization
      // 303 一律转 GET；307/308 保持方法与请求体
      if (code === 303) {
        currentMethod = 'GET'
        currentBody = null
        delete headers['content-length']
      }
      current = next.href
      continue
    }
    return res
  }
  throw new Error('重定向次数过多')
}

/** 把 Buffer / 字符串请求体规范化 */
export function toBuffer(body) {
  if (body == null) return null
  if (Buffer.isBuffer(body)) return body
  return Buffer.from(String(body), 'utf8')
}

export default { request, parseProxy, toBuffer }
