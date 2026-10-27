/**
 * features/system/DemoModeCard —— 演示模式开关
 * ---------------------------------------------------------------------------
 * 登录页有一块「演示账号」面板（管理员/教师/家长/学生，点一下直接登录），
 * 它会公开默认口令，所以生产环境必须能关掉它。
 *
 * 生效优先级：数据库设置 > 环境变量 DEMO_MODE > 环境变量 SEED_DEMO > 默认关闭。
 * 当最终值来自环境变量时，开关不能直接拨（本机设置会被覆盖），
 * 只能通过「强制覆盖」这三个次要操作来改。
 *
 * 保存后一律重新 GET 一次，不做乐观更新。
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertBox, Badge, Card, Skeleton, ToggleRow } from '@/components/ui'
import { useAuth } from '@/store/auth'
import { useToast } from '@/store/toast'
import { demoErrorText, getDemoStatus, resetDemoMode, setDemoEnabled } from './demoApi'
import type { DemoStatus } from './demoApi'

/** 来源对应的说明文案 */
const SOURCE_LABEL: Record<DemoStatus['source'], string> = {
  setting: '由本机设置控制',
  env: '由环境变量 DEMO_MODE 控制（本机设置会被覆盖）',
  seed: '由环境变量 SEED_DEMO 控制',
  default: '默认关闭',
}

function boolText(v: boolean | null): string {
  if (v === null) return '未设置'
  return v ? '开启' : '关闭'
}

export function DemoModeCard() {
  const { push } = useToast()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('system:update')

  const [status, setStatus] = useState<DemoStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getDemoStatus()
      if (!res || typeof res !== 'object') throw new Error('接口返回了非预期的内容')
      setStatus(res)
    } catch (e) {
      setError(demoErrorText(e, '读取演示模式状态失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /* 改动之后重新 GET 一次，状态完全以后端为准 */
  const apply = useCallback(
    async (action: 'on' | 'off' | 'reset') => {
      setSaving(true)
      try {
        if (action === 'reset') await resetDemoMode()
        else await setDemoEnabled(action === 'on')
        await load()
        push(
          action === 'reset'
            ? '已交回环境变量决定'
            : action === 'on'
              ? '演示模式已开启'
              : '演示模式已关闭',
          'success',
        )
      } catch (e) {
        const msg = demoErrorText(e, '保存失败')
        setError(msg)
        push(msg, 'error')
      } finally {
        setSaving(false)
      }
    },
    [load, push],
  )

  const source = status?.source ?? 'default'
  /* 最终值由环境变量决定时，本机开关拨不动 */
  const envLocked = source === 'env' || source === 'seed'

  return (
    <Card
      title="演示模式"
      subtitle="控制登录页的「演示账号」面板是否显示"
      extra={
        status ? (
          status.demo ? (
            <Badge tone="amber">演示模式已开启</Badge>
          ) : (
            <Badge tone="green">演示模式已关闭</Badge>
          )
        ) : null
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : error && !status ? (
        <div className="space-y-3">
          <AlertBox tone="error" title="读取演示模式状态失败">
            <p className="break-words">{error}</p>
          </AlertBox>
          <button type="button" className="btn btn-outline" onClick={() => void load()}>
            ↻ 重试
          </button>
        </div>
      ) : status ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-ink-600">
            开启后，登录页会显示「演示账号」面板，可一键以管理员 / 教师 / 家长 / 学生身份登录。
          </p>

          <AlertBox tone="warning" title="生产环境请保持关闭">
            <p>该面板会公开默认口令，任何拿到这个系统的人都能直接登录。</p>
          </AlertBox>

          {/* 最终值来自环境变量时，开关只读，用下面的「强制覆盖」改 */}
          <div className={envLocked ? 'pointer-events-none opacity-60' : ''}>
            <ToggleRow
              checked={status.demo}
              onChange={(v) => {
                if (envLocked) return
                void apply(v ? 'on' : 'off')
              }}
              label="启用演示模式"
              description={
                envLocked
                  ? '当前由环境变量控制，本机开关拨不动 —— 用下面的「强制覆盖」来改。'
                  : '打开后，登录页会显示演示账号面板；关闭后登录页只显示账号密码输入框。'
              }
            />
          </div>

          <dl className="grid gap-2 rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-600 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="font-semibold text-ink-500">当前生效</dt>
              <dd className="mt-0.5 font-bold text-ink-800">
                {status.demo ? '开启' : '关闭'}
                <span className="ml-1 font-normal text-ink-500">· {SOURCE_LABEL[source]}</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-ink-500">来源</dt>
              <dd className="mt-0.5 break-words font-bold text-ink-800">{SOURCE_LABEL[source]}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-ink-500">数据库里的设置</dt>
              <dd className="mt-0.5 text-ink-700">{boolText(status.stored)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-ink-500">环境变量</dt>
              <dd className="mt-0.5 break-words text-ink-700">
                DEMO_MODE {boolText(status.envDemo)} · SEED_DEMO {boolText(status.seedDemo)}
              </dd>
            </div>
          </dl>

          {envLocked && (
            <AlertBox tone="info" title="当前由环境变量控制">
              <p>
                要在本机强制开启 / 关闭，请用下面的「强制覆盖」操作 —— 写进数据库的设置优先级高于环境变量。
              </p>
            </AlertBox>
          )}

          {error && (
            <AlertBox tone="error" title="保存失败">
              <p className="break-words">{error}</p>
            </AlertBox>
          )}

          {canManage ? (
            <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-3">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => void apply('on')}
                disabled={saving}
              >
                强制开启演示模式
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => void apply('off')}
                disabled={saving}
              >
                强制关闭演示模式
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => void apply('reset')}
                disabled={saving}
              >
                交回环境变量决定
              </button>
            </div>
          ) : (
            <AlertBox tone="warning" title="当前账号不能修改演示模式">
              <p>只有系统管理员可以调整这个开关。</p>
            </AlertBox>
          )}
        </div>
      ) : null}
    </Card>
  )
}

export default DemoModeCard
