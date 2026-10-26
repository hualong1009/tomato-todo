import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface MenuItem {
  id: string
  label?: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  type?: 'item' | 'separator' | 'header'
  children?: MenuItem[]
  onClick?: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 10)
    const top = Math.min(y, window.innerHeight - rect.height - 10)
    setPosition({ left: Math.max(10, left), top: Math.max(10, top) })
  }, [x, y])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      className="context-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={ref}
        className="context-menu"
        style={position}
        onMouseDown={(event) => event.stopPropagation()}
        data-testid="context-menu"
      >
        {items.map((item) => {
          if (item.type === 'separator') return <div key={item.id} className="menu-separator" />
          if (item.type === 'header') {
            return (
              <div key={item.id} className="menu-header">
                {item.label}
              </div>
            )
          }
          if (item.children?.length) {
            return (
              <div key={item.id}>
                <div className="menu-header">{item.label}</div>
                {item.children.map((child) => (
                  <MenuRow key={child.id} item={child} onClose={onClose} />
                ))}
              </div>
            )
          }
          return <MenuRow key={item.id} item={item} onClose={onClose} />
        })}
      </div>
    </div>
  )
}

function MenuRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  return (
    <button
      className={`menu-item ${item.danger ? 'danger' : ''} ${item.checked ? 'checked' : ''}`}
      disabled={item.disabled}
      onClick={() => {
        item.onClick?.()
        onClose()
      }}
    >
      <span className="menu-icon">{item.checked ? '✓' : item.icon}</span>
      <span className="menu-label">{item.label}</span>
      {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
    </button>
  )
}
