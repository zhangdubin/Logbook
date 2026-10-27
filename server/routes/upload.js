/**
 * server/routes/upload.js —— 拍照上传
 *
 *   POST /api/upload/photo   multipart/form-data，字段名 `photo`，可选 `studentId`
 *                            → { url: '/api/upload/<file>', id, dataUrl }
 *   GET  /api/upload/:filename → 静态返回上传的图片（**带归属校验**）
 *
 * 安全：文件名带随机性**不构成访问控制**。
 * 每个文件在 uploads 表里登记「上传者 + 归属学生」，读取时按
 *   上传者本人 / 归属学生在我的数据范围内 / 管理员
 * 三选一放行，否则 403。
 */

import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  canAccessStudent,
  forbidden,
  requireAuth,
  requirePermission,
} from '../auth.js'
import { getUpload, recordUpload } from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const UPLOAD_DIR = path.join(__dirname, '..', 'uploads')

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8MB
/** dataUrl 内联上限：超过 1.5MB 不再回传 base64，避免响应体膨胀 */
const MAX_DATA_URL_BYTES = 1.5 * 1024 * 1024

const ALLOWED_EXT = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/bmp', '.bmp'],
  ['image/svg+xml', '.svg'],
])

/** 文件名里的用户短哈希前缀：便于人工排查与日志脱敏（不泄露用户名） */
function ownerPrefix(userId) {
  return crypto.createHash('sha256').update(String(userId || '')).digest('hex').slice(0, 8)
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_EXT.get(file.mimetype) ?? path.extname(file.originalname || '').toLowerCase()
    const safeExt = /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : '.jpg'
    const name = `${ownerPrefix(req.user?.id)}-${Date.now().toString(36)}-${crypto
      .randomBytes(4)
      .toString('hex')}${safeExt}`
    cb(null, name)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && !file.mimetype.startsWith('image/')) {
      return cb(new Error('只支持上传图片文件'))
    }
    cb(null, true)
  },
})

const router = Router()

/* ------------------------------ 上传 ------------------------------ */
router.post('/photo', requirePermission('questions:create'), (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      const message =
        err?.code === 'LIMIT_FILE_SIZE'
          ? `图片过大，最大支持 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`
          : err?.message || '上传失败'
      return res.status(400).json({ error: 'UploadError', message })
    }
    if (!req.file) {
      return res.status(400).json({ error: 'BadRequest', message: '缺少文件字段 photo' })
    }

    // 可选的归属学生：越权 → 403
    const rawStudentId = req.body?.studentId ? String(req.body.studentId).trim() : ''
    if (rawStudentId && !canAccessStudent(req, rawStudentId)) {
      // 归属非法就不该留下孤儿文件
      try {
        fs.unlinkSync(req.file.path)
      } catch {
        /* ignore */
      }
      return forbidden(res, '无权为该学生上传图片')
    }

    const filename = req.file.filename
    let dataUrl = ''
    try {
      const stat = fs.statSync(req.file.path)
      if (stat.size <= MAX_DATA_URL_BYTES) {
        const mime = req.file.mimetype || 'image/jpeg'
        const buf = fs.readFileSync(req.file.path)
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      }
    } catch (e) {
      console.warn('[upload] 读取文件失败，dataUrl 置空:', e?.message)
    }

    // 登记归属：上传者 + （可选的）归属学生
    recordUpload(filename, req.user.id, rawStudentId || null)

    res.status(201).json({
      url: `/api/upload/${filename}`,
      id: filename,
      dataUrl,
    })
  })
})

/* --------------------------- 静态读取（带归属校验） --------------------------- */
router.get('/:filename', requireAuth, (req, res) => {
  const name = path.basename(req.params.filename)
  const file = path.join(UPLOAD_DIR, name)

  const record = getUpload(name)

  if (!record) {
    // 历史遗留文件（加归属校验之前上传的）：仅管理员可访问，其余一律 404
    if (req.user.role !== 'admin') {
      return res.status(404).json({ error: 'NotFound', message: '图片不存在' })
    }
  } else {
    const owner = record.owner_user_id === req.user.id
    const inScope = record.student_id ? canAccessStudent(req, record.student_id) : false
    const isAdmin = req.user.role === 'admin'
    if (!owner && !inScope && !isAdmin) {
      return forbidden(res, '无权访问该图片')
    }
  }

  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'NotFound', message: '图片不存在' })
  }
  res.sendFile(file)
})

export { router as uploadRouter }
export default router
