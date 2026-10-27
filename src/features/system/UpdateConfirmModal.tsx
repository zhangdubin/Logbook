/**
 * features/system/UpdateConfirmModal —— 「一键更新」二次确认
 * ---------------------------------------------------------------------------
 * 更新会替换程序文件，必须把风险讲清楚：
 *   - 会替换：前端 dist/ 与后端 server/ 的程序文件；
 *   - 不会覆盖：数据库 server/data/、上传图片 server/uploads/、.env；
 *   - 可能需要重启服务才生效；
 *   - 建议先备份。
 */

import { AlertBox, Modal } from '@/components/ui'

export function UpdateConfirmModal({
  open,
  onClose,
  onConfirm,
  busy = false,
  version,
  repo,
  autoRestart = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  busy?: boolean
  /** 将要安装的版本 */
  version?: string
  repo?: string
  autoRestart?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="确认执行一键更新？"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            再想想
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? '更新中…' : '确认更新'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-600">
          将从 GitHub 拉取{version ? ` ${version}` : '最新版本'}并替换本机的程序文件
          {repo ? `（仓库：${repo}）` : ''}。
        </p>

        <ul className="space-y-1.5 rounded-xl bg-ink-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-ink-600">
          <li>✅ <b className="text-ink-800">会替换</b>：前端 <span className="font-mono">dist/</span> 与后端{' '}
            <span className="font-mono">server/</span> 的程序文件</li>
          <li>🔒 <b className="text-ink-800">不会被覆盖</b>：数据库{' '}
            <span className="font-mono">server/data/</span>、上传的图片{' '}
            <span className="font-mono">server/uploads/</span>、以及 <span className="font-mono">.env</span></li>
          <li>🔄 更新后<b className="text-ink-800">可能需要重启服务</b>才生效
            {autoRestart ? '（已开启自动重启，服务会自动拉起，页面会短暂断开）' : '（当前没开自动重启，需要你手动重启）'}
          </li>
          <li>💡 建议先备份整个目录，再执行更新</li>
        </ul>

        <AlertBox tone="warning">
          <span className="text-[11px]">更新过程中页面可能会短暂无响应，属于正常现象，别急着关掉服务。</span>
        </AlertBox>
      </div>
    </Modal>
  )
}

export default UpdateConfirmModal
