/**
 * features/system/UpdateConfirmModal —— 「一键更新」二次确认
 * ---------------------------------------------------------------------------
 * 更新会替换程序文件，必须把风险讲清楚 —— 而且**必须说实话**：
 *   - 会替换：后端 server/ 的程序文件；
 *   - **不会替换**：前端构建产物 dist/（在线更新不重新构建前端）；
 *   - 不会覆盖：数据库 server/data/、上传图片 server/uploads/、.env；
 *   - 可能需要重启服务才生效；
 *   - 建议先备份。
 *
 * ⚠️ 这里曾经写着「会替换：前端 dist/ 与后端 server/」，**那是错的** ——
 * 实际更新逻辑把 dist/ 整个排除了（server/systemUpdate.js 的 EXCLUDE_DIR_NAMES）。
 * 照实写清楚，用户才不会更新完发现页面没变化而以为更新失败。
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
          <li>✅ <b className="text-ink-800">会替换</b>：后端 <span className="font-mono">server/</span>{' '}
            的程序文件</li>
          <li>🔒 <b className="text-ink-800">不会被覆盖</b>：数据库{' '}
            <span className="font-mono">server/data/</span>、上传的图片{' '}
            <span className="font-mono">server/uploads/</span>、以及 <span className="font-mono">.env</span></li>
          <li>🔄 更新后<b className="text-ink-800">可能需要重启服务</b>才生效
            {autoRestart ? '（已开启自动重启，服务会自动拉起，页面会短暂断开）' : '（当前没开自动重启，需要你手动重启）'}
          </li>
          <li>💡 建议先备份整个目录，再执行更新</li>
        </ul>

        <AlertBox tone="warning" title="这次更新不会更新前端页面">
          <div className="space-y-1.5 text-[11px] leading-relaxed">
            <p>
              在线更新只替换<b className="text-ink-800">后端程序</b>，前端构建产物{' '}
              <span className="font-mono">dist/</span> 是排除在外的，也不会重新构建。
            </p>
            <p>
              如果这次版本<b className="text-ink-800">改了前端</b>（页面、交互、样式），更新完刷新页面
              <b className="text-ink-800">看不到变化</b> —— 那是正常的，不是更新失败。
            </p>
            <p className="rounded-lg bg-white/70 px-2 py-1.5 font-mono text-[10px] text-ink-600">
              容器部署要让前端也更新，请在宿主机执行：
              <br />
              cd /opt/cuoti-analytics &amp;&amp; docker compose --profile ocr up -d --build
            </p>
          </div>
        </AlertBox>

        <AlertBox tone="warning">
          <span className="text-[11px]">更新过程中页面可能会短暂无响应，属于正常现象，别急着关掉服务。</span>
        </AlertBox>
      </div>
    </Modal>
  )
}

export default UpdateConfirmModal
