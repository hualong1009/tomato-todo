import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { keyboardViewportBounds } from '../utils/keyboardViewport'
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
  const baselineHeight = useRef(window.innerHeight)
  const baselineWidth = useRef(window.innerWidth)
  const [viewport, setViewport] = useState({ top: 0, bottom: 0 })

  useEffect(() => {
    if (!open) return
    const visual = window.visualViewport
    const update = () => {
      const keyboard = Number.parseFloat(
        document.documentElement.style.getPropertyValue('--keyboard-inset')
      ) || 0
      if (window.innerWidth !== baselineWidth.current) {
        // 旋转屏幕后旧方向的高度不能再当作基准。
        baselineWidth.current = window.innerWidth
        baselineHeight.current = window.innerHeight
      } else {
        // 键盘的 resize 事件可能比原生 inset 先到；不要因此把缩小后的
        // 高度记为基准，导致随后计算出重复的键盘避让量。
        baselineHeight.current = Math.max(baselineHeight.current, window.innerHeight)
      }
      const next = keyboardViewportBounds(
        window.innerHeight,
        baselineHeight.current,
        visual,
        keyboard
      )
      setViewport((previous) =>
        previous.top === next.top && previous.bottom === next.bottom ? previous : next
      )
    }
    update()
    visual?.addEventListener('resize', update)
    visual?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('tomato:insets', update)
    return () => {
      visual?.removeEventListener('resize', update)
      visual?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('tomato:insets', update)
    }
  }, [open])

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
      style={{ top: viewport.top, bottom: viewport.bottom }}
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
