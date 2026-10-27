import { useState } from 'react'
import { DownloadIcon } from './Icons'
import { Modal } from './Modal'

interface UpdateDialogProps {
  version: string | null
  onClose: () => void
  onIgnore: () => Promise<void>
  onOpenRelease: () => Promise<void>
}

/** 只提示新版本，不后台下载/安装；安装包由用户在 GitHub Releases 选择。 */
export function UpdateDialog({ version, onClose, onIgnore, onOpenRelease }: UpdateDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={Boolean(version)}
      onClose={onClose}
      title="发现新版本"
      className="small-modal update-modal"
      backdropClassName="update-backdrop"
      testId="update-dialog"
    >
      <div className="modal-body update-body">
        <DownloadIcon size={28} />
        <strong>番茄待办 v{version} 已发布</strong>
        <p>当前版本 v{__APP_VERSION__}。前往 GitHub Releases 查看更新内容并选择适合您设备的安装包。</p>
      </div>
      <footer className="modal-footer">
        <button
          className="btn ghost"
          disabled={busy}
          data-testid="update-ignore"
          onClick={async () => {
            setBusy(true)
            try {
              await onIgnore()
            } finally {
              setBusy(false)
            }
          }}
        >
          忽略此版本
        </button>
        <button className="btn primary" data-testid="update-open-release" onClick={() => void onOpenRelease()}>
          前往更新
        </button>
      </footer>
    </Modal>
  )
}
