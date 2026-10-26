import { useEffect, useRef, useState } from 'react'
import { STICKY_COLORS, URGENCY_META } from '@shared/defaults'
import type { AppState, Todo } from '@shared/types'
import { getTodoStatus, STATUS_META } from '@shared/todoUtils'
import {
  formatDateTime,
  formatDue,
  hexToRgba,
  textColorFor,
  todoStatusText
} from '../utils/format'
import {
  CheckIcon,
  ExternalIcon,
  PaletteIcon,
  PinIcon,
  PlayIcon,
  TimerIcon,
  XIcon
} from './Icons'

export function StickyNote({ todoId }: { todoId: string }) {
  const [state, setState] = useState<AppState | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [opacity, setOpacity] = useState(0.94)
  const opacityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const todo = state?.todos.find((item) => item.id === todoId)

  useEffect(() => {
    void window.api.getState().then(setState)
    const unsubscribe = window.api.onStateChanged(setState)
    return unsubscribe
  }, [])

  useEffect(() => {
    if (todo) setOpacity(todo.stickyOpacity)
  }, [todo?.id])

  if (!todo) {
    return (
      <div className="sticky-loading">
        <span className="spinner" />
        正在载入便签…
      </div>
    )
  }

  const archived = Boolean(todo.archivedAt)
  const completed = Boolean(todo.completedAt)
  const status = getTodoStatus(todo)
  const urgency = URGENCY_META[todo.urgency]
  const foreground = textColorFor(todo.stickyColor)
  const background = hexToRgba(todo.stickyColor, opacity)
  const translucent = opacity < 0.99

  const update = (patch: Parameters<typeof window.api.updateTodo>[1]) => {
    void window.api.updateTodo(todo.id, patch)
  }

  const changeOpacity = (value: number) => {
    setOpacity(value)
    if (opacityTimer.current) clearTimeout(opacityTimer.current)
    opacityTimer.current = setTimeout(() => {
      update({ stickyOpacity: value })
    }, 220)
  }

  return (
    <div className="sticky-root" data-testid="sticky-note">
      <div
        className={`sticky-card ${translucent ? 'translucent' : ''} ${completed ? 'is-completed' : ''} ${
          archived ? 'is-archived' : ''
        }`}
        style={{
          background,
          color: foreground,
          borderColor: `color-mix(in srgb, ${foreground} 18%, transparent)`
        }}
      >
        <header className="sticky-drag">
          <span className="sticky-brand">
            <PinIcon size={14} />
            桌面便签
          </span>
          <span className="sticky-urgency" style={{ color: urgency.color }}>
            {urgency.label}
          </span>
          <div className="sticky-tools">
            <button
              className="sticky-tool"
              onClick={() => setPaletteOpen((value) => !value)}
              title="便签颜色与透明度"
              data-testid="sticky-color-toggle"
            >
              <PaletteIcon size={15} />
            </button>
            <button
              className="sticky-tool"
              onClick={() => void window.api.openMainWithTodo(todo.id)}
              title="在主窗口中打开"
            >
              <ExternalIcon size={15} />
            </button>
            <button
              className="sticky-tool"
              onClick={() => void window.api.closeSticky(todo.id)}
              title="取消固定并关闭"
              data-testid="sticky-close"
            >
              <XIcon size={15} />
            </button>
          </div>
        </header>

        <div className="sticky-body">
          <div className="sticky-meta">
            <span className="sticky-status">
              <i style={{ background: STATUS_META[status].color }} />
              {todoStatusText(todo)}
            </span>
            {todo.expectedAt && <span>{formatDue(todo.expectedAt)}</span>}
          </div>
          <h1 className="sticky-title" data-testid="sticky-title">
            {todo.title}
          </h1>
          {todo.content && <p className="sticky-content">{todo.content}</p>}
          {completed && (
            <div className="sticky-completed">实际完成 {formatDateTime(todo.completedAt)}</div>
          )}
        </div>

        <footer className="sticky-footer">
          <button
            className={`sticky-check ${completed ? 'checked' : ''}`}
            onClick={() => void window.api.toggleTodo(todo.id, !completed)}
            data-testid="sticky-check"
          >
            <CheckIcon size={13} />
            {completed ? '已完成' : '标记完成'}
          </button>
          {!completed && !todo.startedAt && (
            <button className="sticky-start" onClick={() => void window.api.startTodo(todo.id)} data-testid="sticky-start">
              <PlayIcon size={10} />
              开始
            </button>
          )}
          {!completed && todo.pomodoroCount > 0 && (
            <span className="sticky-focus">
              <TimerIcon size={12} />
              {todo.pomodoroCount}
            </span>
          )}
        </footer>

        {paletteOpen && (
          <div className="sticky-palette" style={{ color: '#f4f6fb' }}>
            <div className="sticky-palette-title">便签颜色</div>
            <div className="swatch-row">
              {STICKY_COLORS.map((color) => (
                <button
                  key={color}
                  className={`swatch ${todo.stickyColor === color ? 'selected' : ''}`}
                  style={{ background: color }}
                  onClick={() => {
                    update({ stickyColor: color })
                    setPaletteOpen(false)
                  }}
                  title={color}
                />
              ))}
            </div>
            <label className="opacity-field">
              <span>透明度</span>
              <input
                type="range"
                min="25"
                max="100"
                value={Math.round(opacity * 100)}
                onChange={(event) => changeOpacity(Number(event.target.value) / 100)}
                data-testid="sticky-opacity"
              />
              <strong>{Math.round(opacity * 100)}%</strong>
            </label>
            <p>透明背景会透出桌面，文字会自动匹配深浅色。</p>
          </div>
        )}
      </div>
    </div>
  )
}
