import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { XIcon } from './Icons'

interface BottomSheetProps {
  open: boolean
  title?: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** 加高版，用于新建待办这类需要键盘的表单 */
  tall?: boolean
  testId?: string
}

/** 移动端底部面板：点击遮罩或 Esc 关闭。 */
export function BottomSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  tall,
  testId = 'bottom-sheet'
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      data-testid={`${testId}-backdrop`}
    >
      <div className={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true" data-testid={testId}>
        <span className="sheet-grabber" />
        {title && (
          <header className="sheet-head">
            <div className="sheet-heading">
              <strong>{title}</strong>
              {subtitle && <small>{subtitle}</small>}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="关闭" data-testid="sheet-close">
              <XIcon size={16} />
            </button>
          </header>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  )
}
