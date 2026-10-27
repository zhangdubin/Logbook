/**
 * pages/Login —— 登录窗口
 * ---------------------------------------------------------------------------
 * PC：左右分栏（左=品牌卖点，右=登录表单）
 * 手机：单列，表单在上，品牌区压缩为一条标题栏
 *
 * 演示账号：管理员 / 教师 / 家长 / 学生，点击可一键填入并登录。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertBox, Spinner } from '@/components/ui'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/store/auth'
import { useToast } from '@/store/toast'
import { formatVersion, useAppVersion } from '@/features/auth/useVersion'

/* ---------------------------- 演示账号 ---------------------------- */

interface DemoAccount {
  key: string
  label: string
  username: string
  password: string
  emoji: string
  tone: string
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    key: 'admin',
    label: '管理员',
    username: 'admin',
    password: 'admin123',
    emoji: '🛡️',
    tone: 'from-violet-500 to-violet-600',
  },
  {
    key: 'teacher',
    label: '教师',
    username: 'teacher',
    password: 'teacher123',
    emoji: '👩‍🏫',
    tone: 'from-blue-500 to-blue-600',
  },
  {
    key: 'parent',
    label: '家长',
    username: 'parent',
    password: 'parent123',
    emoji: '👨‍👩‍👧',
    tone: 'from-emerald-500 to-emerald-600',
  },
  {
    key: 'student',
    label: '学生',
    username: 'student',
    password: 'student123',
    emoji: '🎒',
    tone: 'from-amber-500 to-amber-600',
  },
]

/* ---------------------------- 品牌卖点 ---------------------------- */

const HIGHLIGHTS: { icon: string; title: string; detail: string }[] = [
  { icon: '📷', title: '拍照识别', detail: '拍下错题即可自动识别题目、选项与作答，告别手工录入' },
  { icon: '🔍', title: '错因诊断', detail: '定位知识盲点、审题偏差、计算失误等真实错因，而非只抄答案' },
  { icon: '📈', title: '学情报告', detail: '按学科、知识点、错因维度生成可执行的学习建议与复习计划' },
  { icon: '🤝', title: '家长老师协同', detail: '家长看自己孩子的成长，老师看班级共性问题，各看各的权限范围' },
]

/* ------------------------------ 页面 ------------------------------ */

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, user, loading: authLoading } = useAuth()
  const { push } = useToast()
  /** 版本号（装饰性信息，拿不到就静默不显示） */
  const appVersion = useAppVersion()
  const versionLabel = formatVersion(appVersion)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usernameRef = useRef<HTMLInputElement>(null)
  const redirecting = useRef(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  /* 已登录则直接回跳 */
  useEffect(() => {
    if (!authLoading && user && !redirecting.current) {
      redirecting.current = true
      navigate(from, { replace: true })
    }
  }, [authLoading, user, from, navigate])

  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  const doLogin = useCallback(
    async (u: string, p: string) => {
      if (!u.trim() || !p) {
        setError('请输入账号和密码')
        return
      }
      setSubmitting(true)
      setError(null)
      try {
        await login(u.trim(), p)
        push('登录成功，欢迎回来 👋', 'success')
        navigate(from, { replace: true })
      } catch (e) {
        setError(friendlyError(e))
      } finally {
        setSubmitting(false)
      }
    },
    [login, navigate, from, push],
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    void doLogin(username, password)
  }

  /** 演示账号：一键填入并直接登录 */
  const useDemo = (acc: DemoAccount) => {
    setUsername(acc.username)
    setPassword(acc.password)
    setError(null)
    void doLogin(acc.username, acc.password)
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink-50/40 lg:flex-row">
      {/* ============ PC 左栏：品牌区 ============ */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 to-brand-500 lg:flex lg:w-[46%] lg:max-w-[620px] lg:flex-col lg:justify-between lg:px-12 lg:py-14">
        <BrandDecor />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-2xl font-black text-white ring-1 ring-white/25 backdrop-blur">
              错
            </div>
            <div className="leading-tight">
              <p className="text-[22px] font-black tracking-tight text-white">错题本</p>
              <p className="text-xs font-semibold tracking-[0.2em] text-brand-100">
                学情分析系统
              </p>
            </div>
          </div>

          <h1 className="mt-10 text-[34px] font-black leading-[1.25] tracking-tight text-white">
            错题本 · 学情分析系统
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-brand-100">
            拍照即录入，AI 读懂每道错题背后的原因，
            <br className="hidden xl:block" />
            把「抄一遍」变成「真正学会」。
          </p>

          <ul className="mt-10 space-y-4">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex gap-3.5">
                <span
                  className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-base ring-1 ring-white/20"
                  aria-hidden
                >
                  {h.icon}
                </span>
                <div>
                  <p className="text-sm font-bold text-white">{h.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-brand-100/90">{h.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 mt-10 flex items-center gap-2 rounded-xl bg-black/15 px-4 py-3 text-xs text-brand-50 ring-1 ring-white/10">
          <span aria-hidden>🔒</span>
          <p>
            <b className="font-bold text-white">数据存储在本机，图片不出校</b>
            <span className="block text-brand-100/80">离线可用的校园内网部署方案</span>
          </p>
        </div>
      </aside>

      {/* ============ 手机端：压缩品牌标题栏 ============ */}
      <div className="flex items-center gap-2.5 bg-gradient-to-r from-brand-700 to-brand-500 px-4 py-3 lg:hidden">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-base font-black text-white ring-1 ring-white/25">
          错
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-black text-white">错题本 · 学情分析系统</p>
          <p className="truncate text-[11px] text-brand-100">拍照即录入 · AI 读懂错题背后的原因</p>
        </div>
        <span className="ml-auto shrink-0 text-[10px] text-brand-100">🔒 本机存储</span>
      </div>

      {/* ============ 右栏：登录表单 ============ */}
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8 lg:py-14">
        <div className="w-full max-w-[420px]">
          <div className="mb-6">
            <h2 className="text-2xl font-black tracking-tight text-ink-900">登录</h2>
            <p className="mt-1 text-xs text-ink-500">请使用系统分配的账号登录，不同角色可见内容不同</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {error && (
              <AlertBox tone="error" title="登录失败">
                {error}
              </AlertBox>
            )}

            <div>
              <label className="label" htmlFor="login-username">
                账号
              </label>
              <input
                id="login-username"
                ref={usernameRef}
                className="input"
                value={username}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="请输入账号，如 teacher"
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div>
              <label className="label" htmlFor="login-password">
                密码
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  className="input pr-11"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                  aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner size={16} /> 登录中…
                </>
              ) : (
                '登录'
              )}
            </button>
          </form>

          {/* ---------------- 演示账号 ---------------- */}
          <div className="mt-7">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-ink-200" />
              <span className="text-[11px] font-bold text-ink-400">演示账号</span>
              <span className="h-px flex-1 bg-ink-200" />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.key}
                  type="button"
                  disabled={submitting}
                  onClick={() => useDemo(acc)}
                  title={`${acc.username} / ${acc.password}`}
                  data-testid={`demo-${acc.key}`}
                  className={`flex flex-col items-center gap-1 rounded-xl border border-ink-200 bg-white px-2 py-2.5 text-xs font-bold text-ink-700 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card disabled:opacity-60`}
                >
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br ${acc.tone} text-sm text-white`}
                    aria-hidden
                  >
                    {acc.emoji}
                  </span>
                  {acc.label}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-center text-[11px] text-ink-400">
              演示环境账号，点击可直接登录
            </p>
          </div>

          <p className="mt-6 text-center text-[11px] text-ink-400">
            🔒 数据存储在本机，图片不出校 · 四级权限分级管理
          </p>

          {/* 版本号（低对比度小字，不抢表单视觉重心；取不到则整行不渲染） */}
          {versionLabel && (
            <p className="mt-1 break-all text-center text-[11px] text-ink-400">{versionLabel}</p>
          )}
        </div>
      </main>
    </div>
  )
}

/* ---------------------------- 辅助组件 ---------------------------- */

function BrandDecor() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-brand-900/30 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.7 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.7 17.7 0 0 1-3 3.9M6.6 6.6A17.6 17.6 0 0 0 2 12s3.6 7 10 7a10.9 10.9 0 0 0 5.4-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  )
}

/* ------------------------- 错误信息友好化 ------------------------- */

function friendlyError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    switch (e.status) {
      case 401:
        return '账号或密码不正确'
      case 403:
        return '该账号已被停用，请联系管理员'
      case 429:
        return '尝试次数过多，请 15 分钟后再试'
      case 404:
        return '后端未启动或登录接口不可用（/api/auth/login 未开放）'
      case 502:
      case 503:
      case 504:
        return '后端未启动或登录接口不可用，请确认服务已运行后重试'
      default:
        return e.message || '登录失败，请稍后重试'
    }
  }
  // 网络层异常（fetch 直接抛出 TypeError）：后端未启动
  if (e instanceof TypeError) {
    return '后端未启动或登录接口不可用，请确认服务已运行后重试'
  }
  if (e instanceof Error) {
    if (/fetch|network|load failed/i.test(e.message)) {
      return '后端未启动或登录接口不可用，请确认服务已运行后重试'
    }
    return e.message
  }
  return '后端未启动或登录接口不可用，请确认服务已运行后重试'
}
