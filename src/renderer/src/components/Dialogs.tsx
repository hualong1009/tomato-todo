import { useEffect, useState } from 'react'
import { AlertIcon, CheckIcon, XIcon } from './Icons'
import { Modal } from './Modal'

export interface ToastState {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onClose, toast.tone === 'error' ? 5200 : 3000)
    return () => clearTimeout(timer)
  }, [toast, onClose])

  if (!toast) return null
  return (
    <div className={`toast toast-${toast.tone}`} data-testid="toast">
      <span className="toast-icon">
        {toast.tone === 'success' ? <CheckIcon size={16} /> : toast.tone === 'error' ? <AlertIcon size={16} /> : <span>i</span>}
      </span>
      <span>{toast.message}</span>
      <button className="toast-close" onClick={onClose} aria-label="关闭提示">
        <XIcon size={14} />
      </button>
    </div>
  )
}

interface NameDialogProps {
  open: boolean
  title: string
  initialValue?: string
  placeholder?: string
  submitLabel?: string
  onClose: () => void
  onSubmit: (value: string) => Promise<void> | void
}

export function NameDialog({
  open,
  title,
  initialValue = '',
  placeholder = '',
  submitLabel = '确定',
  onClose,
  onSubmit
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const submit = async () => {
    if (!value.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit(value.trim())
      onClose()
    } catch {
      // 提交错误由父组件负责提示
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} className="small-modal">
      <div className="modal-body">
        <input
          className="text-input"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          data-testid="name-dialog-input"
        />
      </div>
      <footer className="modal-footer">
        <button className="btn ghost" onClick={onClose}>
          取消
        </button>
        <button className="btn primary" disabled={!value.trim() || busy} onClick={() => void submit()}>
          {submitLabel}
        </button>
      </footer>
    </Modal>
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onClose,
  onConfirm
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose} title={title} className="small-modal">
      <div className="modal-body">
        <p className="confirm-message">{message}</p>
      </div>
      <footer className="modal-footer">
        <button className="btn ghost" onClick={onClose}>
          取消
        </button>
        <button
          className={`btn ${danger ? 'danger' : 'primary'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
              onClose()
            } catch {
              // 操作错误由父组件负责提示
            } finally {
              setBusy(false)
            }
          }}
          data-testid="confirm-dialog-ok"
        >
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  )
}
