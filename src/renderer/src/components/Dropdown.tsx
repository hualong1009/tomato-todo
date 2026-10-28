import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackDismiss } from '../platform/backNavigation'
import { CheckIcon, ChevronDownIcon } from './Icons'

export interface DropdownOption {
  value: string
  label: string
  /** 左侧标记颜色：分组圆点 / 紧急程度徽标 */
  color?: string
  /** 徽标文字（如紧急程度的“急/高/中/低”） */
  short?: string
  description?: string
}

interface DropdownProps {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  /** mini = 输入区内的紧凑样式；default = 详情面板 */
  size?: 'mini' | 'default'
  testId?: string
}

interface PopupPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

export function Dropdown({
  value,
  options,
  onChange,
  disabled = false,
  size = 'default',
  testId
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<PopupPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value) ?? options[0]

  // 手机端返回键先收起下拉选项，而不是直接关掉整个详情面板
  useBackDismiss(open, () => setOpen(false))

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const popupMaxHeight = 264
    const openUpward = spaceBelow < Math.min(popupMaxHeight, options.length * 40 + 16) && rect.top > spaceBelow
    setPosition({
      top: openUpward ? Math.max(10, rect.top - 6) : rect.bottom + 6,
      left: rect.left,
      width: Math.max(rect.width, 180),
      maxHeight: Math.min(popupMaxHeight, (openUpward ? rect.top : window.innerHeight - rect.bottom) - 18)
    })
    listRef.current?.setAttribute('data-placement', openUpward ? 'top' : 'bottom')
  }, [options.length])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (
        !triggerRef.current?.contains(event.target as Node) &&
        !listRef.current?.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    const onWheel = (event: WheelEvent) => {
      // 在弹层内部滚动时保持打开
      if (listRef.current?.contains(event.target as Node)) return
      if (listRef.current) {
        updatePosition()
      } else {
        setOpen(false)
      }
    }
    // 弹层挂在 body 上，不跟随面板 / 列表滚动，所以外层一滚动就收起，避免停在错位置
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (open) {
      const index = Math.max(
        0,
        options.findIndex((option) => option.value === value)
      )
      setActiveIndex(index)
    }
  }, [open, options, value])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.children[activeIndex]
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const commit = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
      } else {
        setActiveIndex((index) => Math.min(options.length - 1, index + 1))
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (open) setActiveIndex((index) => Math.max(0, index - 1))
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveIndex(options.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
      } else {
        const option = options[activeIndex]
        if (option) commit(option.value)
      }
    }
  }

  const style = position
    ? {
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight
      }
    : undefined

  // 弹层挂到 body：详情面板带 backdrop-filter 与动画残留的 transform，
  // 会成为 position: fixed 的包含块，把弹层顶到面板外面（桌面端「点下拉就乱」）。
  const menu = (
    <div
      ref={listRef}
      className="dropdown-menu"
      style={style}
      role="listbox"
      data-testid={testId ? `${testId}-menu` : undefined}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value
        const isActive = index === activeIndex
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={isSelected}
            className={`dropdown-option${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => commit(option.value)}
            data-testid={testId ? `${testId}-option-${option.value}` : undefined}
          >
            {option.color ? (
              option.short ? (
                <span
                  className="dropdown-badge"
                  style={{
                    color: option.color,
                    background: `color-mix(in srgb, ${option.color} 16%, transparent)`,
                    borderColor: `color-mix(in srgb, ${option.color} 34%, transparent)`
                  }}
                >
                  {option.short}
                </span>
              ) : (
                <span className="dropdown-dot" style={{ background: option.color }} />
              )
            ) : null}
            <span className="dropdown-option-text">
              <span className="dropdown-option-label">{option.label}</span>
              {option.description ? (
                <span className="dropdown-option-desc">{option.description}</span>
              ) : null}
            </span>
            {isSelected ? <CheckIcon size={13} /> : null}
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger ${size}${open ? ' open' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={onKeyDown}
        data-testid={testId}
        data-state={open ? 'open' : 'closed'}
      >
        {selected?.color ? (
          selected.short ? (
            <span
              className="dropdown-badge"
              style={{
                color: selected.color,
                background: `color-mix(in srgb, ${selected.color} 16%, transparent)`,
                borderColor: `color-mix(in srgb, ${selected.color} 34%, transparent)`
              }}
            >
              {selected.short}
            </span>
          ) : (
            <span className="dropdown-dot" style={{ background: selected.color }} />
          )
        ) : null}
        <span className="dropdown-value">{selected?.label}</span>
        <ChevronDownIcon size={13} className={`dropdown-chevron${open ? ' flipped' : ''}`} />
      </button>
      {open && position ? createPortal(menu, document.body) : null}
    </>
  )
}
