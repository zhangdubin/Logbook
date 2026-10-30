/**
 * server/db.js
 * ---------------------------------------------------------------------------
 * 使用 Node 内置 `node:sqlite`（无需任何原生模块）。
 *
 * 关键约束（node:sqlite 特有，务必遵守）：
 *  1. 返回的行是 null 原型对象 —— JSON.stringify 正常，展开 / Object.keys 也可用。
 *  2. 绑定参数不支持 JS 布尔值，必须先转成 0 / 1。
 *  3. stmt.get() 未命中时返回 undefined（不是 null）。
 *  4. undefined 也不能作为绑定值，必须转成 null。
 *
 * 本模块同时负责：
 *  - 建库建表 + 索引
 *  - 行 -> 前端契约对象（camelCase）的映射
 *  - 若干查询辅助函数
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_DIR = path.join(__dirname, 'data')
export const UPLOAD_DIR = path.join(__dirname, 'uploads')
export const DB_FILE = path.join(DATA_DIR, 'cuoti.db')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

export const db = new DatabaseSync(DB_FILE)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/* -------------------------------------------------------------------------- */
/* 表结构                                                                     */
/* -------------------------------------------------------------------------- */

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  grade        TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#3b82f6',
  school       TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL,
  subject        TEXT NOT NULL,
  grade          TEXT NOT NULL DEFAULT '',
  semester       TEXT,
  knowledge_points TEXT NOT NULL DEFAULT '[]',
  question_type  TEXT NOT NULL DEFAULT '解答题',
  source         TEXT,
  stem           TEXT NOT NULL DEFAULT '',
  options        TEXT NOT NULL DEFAULT '[]',
  my_answer      TEXT,
  correct_answer TEXT,
  error_type     TEXT NOT NULL DEFAULT 'knowledge_gap',
  error_detail   TEXT,
  difficulty     INTEGER NOT NULL DEFAULT 3,
  points         REAL,
  images         TEXT NOT NULL DEFAULT '[]',
  ai_analysis    TEXT,
  mastery        INTEGER NOT NULL DEFAULT 30,
  status         TEXT NOT NULL DEFAULT 'unreviewed',
  corrected      INTEGER NOT NULL DEFAULT 0,
  tags           TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  reviewed_at    TEXT,
  next_review_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_questions_student   ON questions(student_id);
CREATE INDEX IF NOT EXISTS idx_questions_subject   ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_questions_error     ON questions(error_type);
CREATE INDEX IF NOT EXISTS idx_questions_created   ON questions(created_at);
CREATE INDEX IF NOT EXISTS idx_questions_kp        ON questions(knowledge_points);
CREATE INDEX IF NOT EXISTS idx_students_created    ON students(created_at);

-- 键值配置表（当前用于 AI 模型设置：key = 'ai.config'）
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 账号表：四级权限的唯一载体
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL,               -- admin | teacher | parent | student
  password_hash        TEXT NOT NULL,               -- scrypt$<saltHex>$<hashHex>
  avatar_color         TEXT,
  phone                TEXT,
  note                 TEXT,
  status               TEXT NOT NULL DEFAULT 'active', -- active | disabled
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT,
  last_login_at        TEXT
);

-- 会话表：Cookie 值 <-> 用户
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT,
  expires_at TEXT,
  user_agent TEXT,
  ip         TEXT
);

-- 上传文件归属表：谁上传的、归属哪个学生（决定谁有权访问该文件）
CREATE TABLE IF NOT EXISTS uploads (
  filename      TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  student_id    TEXT,
  created_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_uploads_owner   ON uploads(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_student ON uploads(student_id);
`)

/* --------------------------------------------------------------------------
 * 兼容已有数据库：students 表补齐三列（家长 / 教师 / 学生本人账号）
 * -------------------------------------------------------------------------- */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

ensureColumn('students', 'parent_id', 'parent_id TEXT')
ensureColumn('students', 'teacher_id', 'teacher_id TEXT')
ensureColumn('students', 'user_id', 'user_id TEXT')

db.exec(`
CREATE INDEX IF NOT EXISTS idx_students_teacher ON students(teacher_id);
CREATE INDEX IF NOT EXISTS idx_students_parent ON students(parent_id);
CREATE INDEX IF NOT EXISTS idx_students_user   ON students(user_id);
`)

/* -------------------------------------------------------------------------- */
/* 小工具                                                                     */
/* -------------------------------------------------------------------------- */

/** node:sqlite 不接受 boolean / undefined，统一收敛成可绑定值 */
export function bindable(value) {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

/** 安全 JSON.parse，失败时回退到默认值 */
export function parseJSON(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback
  if (typeof raw === 'object') return raw
  try {
    const v = JSON.parse(raw)
    return v === null || v === undefined ? fallback : v
  } catch {
    return fallback
  }
}

export function nowISO() {
  return new Date().toISOString()
}

export function toBool(v) {
  return v === 1 || v === true || v === '1' || v === 'true'
}

/** 形如 2026-10-26 的本地日期串 */
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function uid(prefix = 'q') {
  const s = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}${s}`
}

/* -------------------------------------------------------------------------- */
/* 账号与角色                                                                  */
/* -------------------------------------------------------------------------- */

/** 账号角色 → students 表中「关联学生」的列名 */
export const ROLE_LINK_COLUMN = {
  admin: null,
  teacher: 'teacher_id',
  parent: 'parent_id',
  student: 'user_id',
}

/** 合法角色 */
export const VALID_ROLES = ['admin', 'teacher', 'parent', 'student']

/** 该账号关联的学生 id 列表（按角色语义：教师=所授学生，家长=孩子，学生=本人） */
export function linkedStudentIdsForUser(userId, role) {
  const col = ROLE_LINK_COLUMN[role]
  if (!col) return []
  const rows = db.prepare(`SELECT id FROM students WHERE ${col} = ? ORDER BY created_at ASC`).all(userId)
  return rows.map((r) => r.id)
}

/**
 * 行 → 前端 User 契约对象（**绝不包含 password_hash**）
 * @param {object} row users 表原始行
 * @param {string[]} [linkedIds] 关联学生 id
 */
export function mapUser(row, linkedIds) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    avatarColor: row.avatar_color ?? '#3b82f6',
    status: row.status ?? 'active',
    phone: row.phone ?? '',
    note: row.note ?? '',
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at ?? '',
    linkedStudentIds: Array.isArray(linkedIds) ? linkedIds : [],
    mustChangePassword: toBool(row.must_change_password),
  }
}

/** 取单个账号行（含 password_hash，仅服务端内部使用） */
export function getUserRow(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

/** 按用户名取账号行（含 password_hash，仅服务端内部使用） */
export function getUserRowByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

/** 全部账号行 */
export function listUserRows() {
  return db.prepare('SELECT * FROM users ORDER BY created_at ASC, id ASC').all()
}

/** 账号 → 前端契约对象（自动补齐 linkedStudentIds） */
export function listUsers() {
  return listUserRows().map((row) => mapUser(row, linkedStudentIdsForUser(row.id, row.role)))
}

/* -------------------------------------------------------------------------- */
/* 上传文件归属                                                                */
/* -------------------------------------------------------------------------- */

/** 记录一条上传：谁传的、归属哪个学生 */
export function recordUpload(filename, ownerUserId, studentId) {
  db.prepare(
    `INSERT INTO uploads (filename, owner_user_id, student_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(filename) DO UPDATE SET
       owner_user_id = excluded.owner_user_id,
       student_id    = COALESCE(uploads.student_id, excluded.student_id)`,
  ).run(filename, ownerUserId, bindable(studentId), nowISO())
}

/** 取上传记录；没有记录返回 undefined */
export function getUpload(filename) {
  return db.prepare('SELECT * FROM uploads WHERE filename = ?').get(filename)
}

/**
 * 补写归属学生：把引用了该文件的错题所属学生写进 uploads.student_id。
 *
 * 只在 student_id 为空时补写（**不覆盖**已有归属）——
 * 否则「把别人孩子的照片挂到自己孩子的错题下」就能骗取访问权。
 */
export function attachUploadToStudent(filename, studentId) {
  if (!filename || !studentId) return
  db.prepare(
    'UPDATE uploads SET student_id = ? WHERE filename = ? AND (student_id IS NULL OR student_id = ?)',
  ).run(studentId, filename, studentId)
}

/**
 * 从图片 URL / 引用里解析出上传文件名。
 * 支持 `/api/upload/xxx.png`、`http://host/api/upload/xxx.png`、`xxx.png` 三种形态。
 */
export function extractUploadFilename(ref) {
  if (!ref || typeof ref !== 'string') return ''
  const s = ref.split('?')[0].split('#')[0].trim()
  if (!s) return ''
  const m = s.match(/(?:^|\/)api\/upload\/([^/]+)$/i) || s.match(/^([^/]+\.[A-Za-z0-9]{2,5})$/)
  return m ? m[1] : ''
}

/* -------------------------------------------------------------------------- */
/* 行映射 —— 数据库 snake_case  <->  前端契约 camelCase                       */
/* -------------------------------------------------------------------------- */

export function mapStudent(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    grade: row.grade ?? '',
    avatarColor: row.avatar_color ?? '#3b82f6',
    school: row.school ?? '',
    note: row.note ?? '',
    createdAt: row.created_at,
  }
}

export function mapImage(img) {
  if (!img || typeof img !== 'object') return { id: uid('img'), url: '' }
  return {
    id: img.id ?? uid('img'),
    url: img.url ?? '',
    ...(img.dataUrl ? { dataUrl: img.dataUrl } : {}),
    ...(img.createdAt ? { createdAt: img.createdAt } : {}),
  }
}

/**
 * 知识点一律归一化成**字符串数组**。
 *
 * 历史包袱：有一段时间后端把 draft.knowledgePoints 改成了对象数组
 * （{name, confidence, level, evidence}），前端又把它原样存了回来，
 * 于是 knowledge_points 列里存的是对象数组。
 * 那样的话前端把它当 React 子节点渲染会抛 error #31，
 * 而且 json_each 做的知识点搜索也对不上。
 *
 * 所以**读和写都归一化**：写的时候拦住新的坏数据，
 * 读的时候把历史坏数据就地修正（不必等用户手动跑清洗脚本）。
 */
export function normalizeKnowledgePoints(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const kp of list) {
    let name = ''
    if (typeof kp === 'string') name = kp.trim()
    else if (kp && typeof kp === 'object') {
      const n = kp.name
      if (typeof n === 'string') name = n.trim()
      else if (n && typeof n === 'object') {
        const deep = n.name
        if (typeof deep === 'string') name = deep.trim()
      }
    }
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * 把库里「知识点是对象数组」的历史数据就地改正成字符串数组。
 *
 * 背景：有一段时间后端把 draft.knowledgePoints 改成了对象数组，
 * 前端又把它原样存了回来，于是 knowledge_points 列里存的是对象数组。
 * 读取时已经归一化（normalizeKnowledgePoints），所以**功能上不受影响**；
 * 但留着不干净，导出数据或直接查库时会看到 `{"name":"…","confidence":…}`。
 *
 * 放在启动时自动跑一次：用户不用做任何操作。
 * 幂等 —— 没有坏数据时一次写入都没有。
 *
 * @returns {{ scanned: number, fixed: number }}
 */
export function repairKnowledgePoints() {
  let scanned = 0
  let fixed = 0
  try {
    const rows = db.prepare('SELECT id, knowledge_points FROM questions').all()
    scanned = rows.length
    const upd = db.prepare('UPDATE questions SET knowledge_points = ? WHERE id = ?')
    for (const row of rows) {
      let raw = []
      try {
        raw = JSON.parse(row.knowledge_points ?? '[]')
      } catch {
        continue
      }
      if (!Array.isArray(raw)) continue
      if (raw.every((k) => typeof k === 'string')) continue
      upd.run(JSON.stringify(normalizeKnowledgePoints(raw)), row.id)
      fixed += 1
    }
  } catch (err) {
    console.warn('[db] 知识点数据订正失败:', err?.message)
    return { scanned, fixed }
  }
  return { scanned, fixed }
}

export function mapQuestion(row, studentName) {
  if (!row) return null
  const kp = parseJSON(row.knowledge_points, [])
  const opts = parseJSON(row.options, [])
  const imgs = parseJSON(row.images, [])
  const tags = parseJSON(row.tags, [])
  const analysis = row.ai_analysis ? parseJSON(row.ai_analysis, null) : null

  return {
    id: row.id,
    studentId: row.student_id,
    ...(studentName ? { studentName } : {}),
    subject: row.subject,
    grade: row.grade ?? '',
    semester: row.semester ?? '',
    knowledgePoints: normalizeKnowledgePoints(kp),
    questionType: row.question_type,
    source: row.source ?? '',
    stem: row.stem ?? '',
    options: Array.isArray(opts) ? opts : [],
    myAnswer: row.my_answer ?? '',
    correctAnswer: row.correct_answer ?? '',
    errorType: row.error_type,
    errorDetail: row.error_detail ?? '',
    difficulty: Number(row.difficulty ?? 3),
    points: row.points === null || row.points === undefined ? undefined : Number(row.points),
    images: Array.isArray(imgs) ? imgs.map(mapImage) : [],
    aiAnalysis: analysis ?? null,
    mastery: Number(row.mastery ?? 30),
    status: row.status,
    corrected: toBool(row.corrected),
    tags: Array.isArray(tags) ? tags : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    reviewedAt: row.reviewed_at ?? null,
    nextReviewAt: row.next_review_at ?? null,
  }
}

/* -------------------------------------------------------------------------- */
/* 查询辅助                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 取学生列表（按创建时间排序）
 * @param {string[]|null} [ids] 数据范围：null / undefined 表示不限制；数组表示白名单
 */
export function listStudents(ids) {
  if (Array.isArray(ids)) {
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    return db
      .prepare(`SELECT * FROM students WHERE id IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...ids)
      .map(mapStudent)
  }
  const rows = db.prepare('SELECT * FROM students ORDER BY created_at ASC').all()
  return rows.map(mapStudent)
}

export function getStudent(id) {
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(id)
  return mapStudent(row)
}

export function getStudentName(id) {
  const row = db.prepare('SELECT name FROM students WHERE id = ?').get(id)
  return row ? row.name : undefined
}

/** 取单条错题（已映射为前端契约对象） */
export function getQuestion(id) {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!row) return null
  return mapQuestion(row, getStudentName(row.student_id))
}

/**
 * 统一的错题查询：支持过滤 + 分页 + 排序。
 * @param {object} f
 * @param {string} [f.studentId]
 * @param {string[]} [f.studentIds] 数据范围白名单（与 studentId 同时给时取交集）
 * @param {string} [f.subject]
 * @param {string} [f.knowledgePoint]
 * @param {string} [f.errorType]
 * @param {string} [f.status]
 * @param {number|boolean} [f.corrected]
 * @param {string} [f.keyword]  题干 / 答案 / 来源 模糊匹配
 * @param {string} [f.startDate] YYYY-MM-DD
 * @param {string} [f.endDate]   YYYY-MM-DD
 * @param {number} [f.page]      1 起
 * @param {number} [f.pageSize]  默认 20
 */
export function queryQuestions(f = {}) {
  const where = []
  const params = []

  if (f.studentId) {
    where.push('student_id = ?')
    params.push(f.studentId)
  }
  if (Array.isArray(f.studentIds)) {
    if (!f.studentIds.length) {
      // 范围内没有学生：直接构造恒假条件
      where.push('1 = 0')
    } else {
      where.push(`student_id IN (${f.studentIds.map(() => '?').join(',')})`)
      params.push(...f.studentIds)
    }
  }
  if (f.subject) {
    where.push('subject = ?')
    params.push(f.subject)
  }
  if (f.errorType) {
    where.push('error_type = ?')
    params.push(f.errorType)
  }
  if (f.status) {
    where.push('status = ?')
    params.push(f.status)
  }
  if (f.corrected !== undefined && f.corrected !== null && f.corrected !== '') {
    where.push('corrected = ?')
    params.push(f.corrected ? 1 : 0)
  }
  if (f.knowledgePoint) {
    // knowledge_points 为 JSON 数组字符串，用 json_each 展开匹配
    where.push(`EXISTS (
      SELECT 1 FROM json_each(questions.knowledge_points) je
      WHERE je.value LIKE '%' || ? || '%'
    )`)
    params.push(f.knowledgePoint)
  }
  if (f.keyword) {
    where.push('(stem LIKE ? OR my_answer LIKE ? OR correct_answer LIKE ? OR source LIKE ? OR error_detail LIKE ?)')
    const kw = `%${f.keyword}%`
    params.push(kw, kw, kw, kw, kw)
  }
  if (f.startDate) {
    where.push('date(created_at) >= ?')
    params.push(f.startDate)
  }
  if (f.endDate) {
    where.push('date(created_at) <= ?')
    params.push(f.endDate)
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM questions ${clause}`).get(...params)
  const total = Number(totalRow?.c ?? 0)

  const page = Math.max(1, Number(f.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(f.pageSize) || 20))

  const rows = db
    .prepare(
      `SELECT * FROM questions ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize)

  const items = rows.map((r) => mapQuestion(r, getStudentName(r.student_id)))
  return { items, total, page, pageSize }
}

/** 取某个学生（可选）全部错题，用于统计计算 */
export function fetchAllQuestions({ studentId, studentIds } = {}) {
  const where = []
  const params = []
  if (studentId) {
    where.push('student_id = ?')
    params.push(studentId)
  }
  if (Array.isArray(studentIds)) {
    if (!studentIds.length) {
      where.push('1 = 0')
    } else {
      where.push(`student_id IN (${studentIds.map(() => '?').join(',')})`)
      params.push(...studentIds)
    }
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return db
    .prepare(`SELECT * FROM questions ${clause} ORDER BY created_at ASC`)
    .all(...params)
    .map((r) => mapQuestion(r, getStudentName(r.student_id)))
}

/** 知识点引用统计：{ name, subject, count } */
export function knowledgePointRefs(subject) {
  const rows = db
    .prepare(
      `SELECT je.value AS name, q.subject AS subject, COUNT(*) AS count
         FROM questions q, json_each(q.knowledge_points) je
        ${subject ? 'WHERE q.subject = ?' : ''}
        GROUP BY je.value, q.subject
        ORDER BY count DESC, name ASC`,
    )
    .all(...(subject ? [subject] : []))
  /* je.value 在历史坏数据里可能是整个 JSON 对象文本，这里统一取名字 */
  return rows
    .map((r) => ({ name: normalizeKnowledgePoints([r.name])[0] ?? '', subject: r.subject, count: Number(r.count) }))
    .filter((r) => r.name)
}

export default db
