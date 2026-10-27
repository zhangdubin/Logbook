/**
 * server/tar.js —— 极简 tar 解析器（ustar / pax / GNU longname）+ 安全解压
 * ---------------------------------------------------------------------------
 * 背景：GitHub Release 的源码包是 gzip 压缩的 tar，本项目**不引入任何 npm 依赖**，
 * 因此用 Node 内置 `node:zlib` 解 gzip，再自己解析 tar 结构。
 *
 * 支持的 typeflag：
 *   '0' / '\0'  普通文件      -> 解出
 *   '5'         目录          -> 解出
 *   'L'         GNU 长文件名   -> 作用于**下一个**条目
 *   'x'         pax 扩展头    -> 作用于**下一个**条目（path / size）
 *   'g'         pax 全局头    -> 作用于**之后所有**条目（path / size）
 *   其它（'1' 硬链接 / '2' 符号链接 / '3','4' 设备 / '6' FIFO / 'K' 长链接名）-> **忽略**
 *
 * 安全要求（务必保持）：
 *   1. 拒绝绝对路径、包含 '..' 段、解析后逃出目标目录的条目；
 *   2. 只接受文件与目录两种类型；
 *   3. 目标目录用 path.resolve 后校验 startsWith 目标根目录。
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BLOCK = 512

/** 读取八进制数字字段 */
function readOctal(buf, start, len) {
  let s = ''
  for (let i = start; i < start + len; i++) {
    const b = buf[i]
    if (b === 0 || b === 0x20) break
    s += String.fromCharCode(b)
  }
  if (!s) return 0
  const n = parseInt(s, 8)
  return Number.isFinite(n) ? n : 0
}

/** 读取字符串字段（遇 NUL 结束；按 UTF-8 解码） */
function readStr(buf, start, len) {
  const slice = buf.subarray(start, start + len)
  const end = slice.indexOf(0)
  const bytes = end < 0 ? slice : slice.subarray(0, end)
  // 必须按 UTF-8 解码：项目里存在中文文件名（如 docs/09-系统设置与在线更新.md），
  // 逐字节 String.fromCharCode 会得到乱码。
  return bytes.toString('utf8')
}

/**
 * 校验头部 checksum。
 * 历史上存在「有符号 / 无符号」两种算法，两者都接受。
 */
function checksumOk(buf) {
  const stored = readOctal(buf, 148, 8)
  let unsigned = 0
  let signed = 0
  for (let i = 0; i < BLOCK; i++) {
    const b = i >= 148 && i < 156 ? 0x20 : buf[i]
    unsigned += b
    signed += b > 127 ? b - 256 : b
  }
  return stored === unsigned || stored === signed
}

/** 解析 pax 扩展头负载：形如 "30 path=owner-repo-sha/\n" */
function parsePax(data) {
  const out = {}
  // 长度前缀是**字节数**，不是字符数。中文文件名下两者不等，
  // 用字符串下标切片会把下一条记录一起吞进来（曾导致路径变成
  // "a.md\n30 mtime=..."），所以这里全程按 Buffer 的字节处理。
  let i = 0
  while (i < data.length) {
    const sp = data.indexOf(0x20, i)
    if (sp < 0) break
    const len = Number.parseInt(data.subarray(i, sp).toString('ascii'), 10)
    if (!Number.isFinite(len) || len <= 0) break
    const record = data.subarray(sp + 1, i + len).toString('utf8').replace(/\n$/, '')
    const eq = record.indexOf('=')
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1)
    i += len
  }
  return out
}

/**
 * 解析 tar 缓冲区。
 * @param {Buffer} buf
 * @returns {{entries: object[], warnings: string[]}}
 */
export function parseTar(buf) {
  const entries = []
  const warnings = []
  let offset = 0
  let longName = null
  let paxNext = null
  let paxGlobal = {}

  // 宽容一点：直接传 .tar.gz 进来也能解析（gzip 魔数 1f 8b）
  let input = buf
  if (buf?.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      input = zlib.gunzipSync(buf)
    } catch (err) {
      warnings.push(`gzip 解压失败：${err instanceof Error ? err.message : String(err)}`)
      return { entries, warnings }
    }
  }

  while (offset + BLOCK <= input.length) {
    const header = input.subarray(offset, offset + BLOCK)
    // 全 0 块 = 归档结束（或填充）
    let allZero = true
    for (let i = 0; i < BLOCK; i++) {
      if (header[i] !== 0) { allZero = false; break }
    }
    if (allZero) break

    if (!checksumOk(header)) {
      warnings.push(`第 ${offset / BLOCK} 块的 tar 头校验和不匹配，已停止解析`)
      break
    }

    const name = readStr(header, 0, 100)
    const mode = readOctal(header, 100, 8)
    const size = readOctal(header, 124, 12)
    const typeflag = String.fromCharCode(header[156] || 0x30)
    const prefix = readStr(header, 345, 155)

    offset += BLOCK
    const data = input.subarray(offset, offset + size)
    offset += Math.ceil(size / BLOCK) * BLOCK

    if (typeflag === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '')
      continue
    }
    if (typeflag === 'K') continue // GNU 长链接名：忽略
    if (typeflag === 'x') {
      paxNext = parsePax(data)
      continue
    }
    if (typeflag === 'g') {
      paxGlobal = { ...paxGlobal, ...parsePax(data) }
      continue
    }

    let fullName = longName ?? paxNext?.path ?? paxGlobal?.path ?? (prefix ? `${prefix}/${name}` : name)
    const realSize = Number(paxNext?.size ?? paxGlobal?.size ?? size)
    longName = null
    paxNext = null

    entries.push({
      name: fullName,
      type: typeflag,
      mode,
      size: realSize,
      data: typeflag === '0' || typeflag === '\0' || typeflag === '7' ? data : null,
    })
  }

  return { entries, warnings }
}

/**
 * 归一化并校验条目路径；不合法返回 null。
 * @returns {string|null} 安全的相对路径（posix 分隔符）
 */
export function safeEntryPath(rawName) {
  const name = String(rawName ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!name) return null
  if (name.startsWith('/') || /^[A-Za-z]:\//.test(name)) return null // 绝对路径
  const parts = name.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.some((p) => p === '..')) return null // 路径穿越
  if (!parts.length) return null
  return parts.join('/')
}

/**
 * 安全解压 tar 缓冲区到目标目录。
 *
 * @param {Buffer} buf
 * @param {string} destDir
 * @returns {{files: string[], dirs: string[], warnings: string[]}}
 */
export function extractTar(buf, destDir) {
  const root = path.resolve(destDir)
  fs.mkdirSync(root, { recursive: true })

  const { entries, warnings } = parseTar(buf)
  const files = []
  const dirs = []

  for (const entry of entries) {
    // 只接受文件与目录；符号链接/硬链接/设备文件一律忽略
    if (entry.type !== '0' && entry.type !== '\0' && entry.type !== '7' && entry.type !== '5') {
      warnings.push(`忽略不支持的 tar 条目类型 '${entry.type === '\0' ? '0' : entry.type}'：${entry.name}`)
      continue
    }

    const rel = safeEntryPath(entry.name)
    if (!rel) {
      warnings.push(`拒绝非法路径条目（绝对路径或包含 ..）：${entry.name}`)
      continue
    }

    const target = path.resolve(root, rel)
    if (target !== root && !target.startsWith(root + path.sep)) {
      warnings.push(`拒绝逃逸目标目录的条目：${entry.name}`)
      continue
    }

    if (entry.type === '5') {
      fs.mkdirSync(target, { recursive: true })
      dirs.push(rel)
      continue
    }

    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, entry.data ?? Buffer.alloc(0))
    files.push(rel)
  }

  return { files, dirs, warnings }
}

export default { parseTar, extractTar, safeEntryPath }

/* ========================================================================== */
/* 打包（发布新版本时把本机源码打成 Release 附件）                              */
/* ========================================================================== */

/**
 * 写一个 ustar 头部。
 * @param {string} name 条目名（≤100 字节）或配合 prefix 使用
 * @param {number} size 文件大小
 * @param {string} type typeflag
 * @param {number} mode 权限位
 * @param {string} prefix ustar 的 prefix 字段（可选）
 */
function writeHeader(name, size, type = '0', mode = 0o644, prefix = '') {
  const buf = Buffer.alloc(BLOCK)
  buf.write(name, 0, 'utf8')
  buf.write(mode.toString(8).padStart(7, '0') + '\0', 100, 'ascii')
  buf.write('0000000\0', 108, 'ascii') // uid
  buf.write('0000000\0', 116, 'ascii') // gid
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii')
  buf.write('00000000000\0', 136, 'ascii') // mtime（0 = 1970，通用归档器都能解）
  buf.write('        ', 148, 'ascii') // checksum 占位
  buf.write(type, 156, 'ascii')
  buf.write('ustar\0', 257, 'ascii')
  buf.write('00', 263, 'ascii')
  if (prefix) buf.write(prefix, 345, 'utf8')

  let sum = 0
  for (const b of buf) sum += b
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  return buf
}

/** pax 扩展头的一条记录：`<总长度> <key>=<value>\n` */
function paxRecord(key, value) {
  const kv = ` ${key}=${value}\n`
  let len = kv.length + 1
  while (String(len).length + kv.length !== len) len = String(len).length + kv.length
  return `${len}${kv}`
}

/** 按 512 字节补齐 */
function pad512(buf) {
  const rem = buf.length % BLOCK
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(BLOCK - rem)])
}

/**
 * 把条目编码成 tar 块。
 * 长路径（>100 字节）自动降级为 pax 扩展头（'x'）+ 一个占位名，
 * 因为 tar 的 name 字段只有 100 字节，而项目里有中文文件名（UTF-8 每字 3 字节）。
 */
function encodeEntry(entry) {
  const name = entry.name
  const size = entry.data ? entry.data.length : 0
  const type = entry.type ?? '0'
  const chunks = []

  const nameBytes = Buffer.byteLength(name, 'utf8')
  let ustarName = name
  let prefix = ''

  if (nameBytes > 100) {
    // 先尝试 ustar 的 prefix（155 字节）拆成 目录 + 文件名
    const idx = name.lastIndexOf('/')
    const dir = idx > 0 ? name.slice(0, idx) : ''
    const base = idx > 0 ? name.slice(idx + 1) : name
    if (
      dir &&
      Buffer.byteLength(dir, 'utf8') <= 155 &&
      Buffer.byteLength(base, 'utf8') <= 100
    ) {
      prefix = dir
      ustarName = base
    } else {
      // 再降级：pax 扩展头携带真实路径
      const pax = Buffer.from(paxRecord('path', name), 'utf8')
      chunks.push(writeHeader('PaxHeader', pax.length, 'x', 0o644))
      chunks.push(pad512(pax))
      ustarName = Buffer.byteLength(name, 'utf8') > 100 ? name.slice(-100) : name
      // 占位名不能超 100 字节，截断到安全长度
      while (Buffer.byteLength(ustarName, 'utf8') > 100) ustarName = ustarName.slice(1)
    }
  }

  chunks.push(writeHeader(ustarName, size, type, entry.mode ?? (type === '5' ? 0o755 : 0o644), prefix))
  if (type === '0' && entry.data) chunks.push(pad512(entry.data))
  return Buffer.concat(chunks)
}

/**
 * 把条目列表打包成 gzip 压缩的 tar。
 * @param {Array<{name:string,data?:Buffer,type?:string,mode?:number}>} entries
 * @returns {Buffer} .tar.gz 内容
 */
export function createTarGz(entries) {
  const parts = entries.map(encodeEntry)
  // 归档结束：两个 512 字节的空块
  parts.push(Buffer.alloc(BLOCK * 2))
  return zlib.gzipSync(Buffer.concat(parts), { level: 6 })
}

export { encodeEntry, writeHeader, paxRecord }
