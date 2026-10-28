import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useBackDismiss } from '../platform/backNavigation'
import { XIcon } from './Icons'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  className?: string
  backdropClassName?: string
  children: ReactNode
  testId?: string
}

export function Modal({ open, onClose, title, className = '', backdropClassName = '', children, testId }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 手机端返回键先关闭弹窗（嵌套弹窗也能按打开顺序逐个关闭）
  useBackDismiss(open, onClose)

  if (!open) return null
  return (
    <div
      className={`modal-backdrop ${backdropClassName}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`modal-card ${className}`}
        role="dialog"
        aria-modal="true"
        data-testid={testId}
      >
        {title !== undefined && (
          <header className="modal-header">
            <div className="modal-title">{title}</div>
            <button className="icon-btn" onClick={onClose} aria-label="关闭" data-testid="modal-close">
              <XIcon />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  )
}
