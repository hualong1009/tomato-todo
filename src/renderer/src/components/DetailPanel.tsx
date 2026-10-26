import { useEffect, useRef, useState } from 'react'
import { STICKY_COLORS, URGENCY_META } from '@shared/defaults'
import type { AppState, Todo, UpdateTodoPatch, Urgency } from '@shared/types'
import { getTodoStatus, STATUS_META } from '@shared/todoUtils'
import {
  formatDateTime,
  formatFullDateTime,
  fromDatetimeLocal,
  toDatetimeLocal,
  todoStatusText
} from '../utils/format'
import {
  ArchiveIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  PaletteIcon,
  PinIcon,
  PlayIcon,
  ResetIcon,
  TimerIcon,
  TrashIcon,
  XIcon
} from './Icons'
import { Dropdown } from './Dropdown'
import { RichContentEditor } from './RichContentEditor'

interface DetailPanelProps {
  todo: Todo
  state: AppState
  now: number
  onClose: () => void
  onUpdate: (id: string, patch: UpdateTodoPatch) => Promise<boolean>
  onToggle: (todo: Todo, completed: boolean) => void
  onStart: (todo: Todo) => void
  onPin: (todo: Todo) => void
  onPomodoro: (todo: Todo) => void
  onArchive: (todo: Todo) => void
  onRestore: (todo: Todo) => void
  onDeleteForever: (todo: Todo) => void
}

export function DetailPanel({
  todo,
  state,
  now,
  onClose,
  onUpdate,
  onToggle,
  onStart,
  onPin,
  onPomodoro,
  onArchive,
  onRestore,
  onDeleteForever
}: DetailPanelProps) {
  const [title, setTitle] = useState(todo.title)
  const [content, setContent] = useState(todo.content)
  const [expected, setExpected] = useState(toDatetimeLocal(todo.expectedAt))
  const [saveState, setSaveState] = useState<'saved' | 'typing' | 'saving' | 'error'>('saved')
  const todoRef = useRef(todo)
  todoRef.current = todo
  const skipAutosave = useRef(true)
  const archived = Boolean(todo.archivedAt)
  const completed = Boolean(todo.completedAt)
  const status = getTodoStatus(todo, now)
  const group = state.groups.find((item) => item.id === todo.groupId)

  useEffect(() => {
    setTitle(todo.title)
    setContent(todo.content)
    setExpected(toDatetimeLocal(todo.expectedAt))
    setSaveState('saved')
    skipAutosave.current = true
  }, [todo.id])

  useEffect(() => {
    if (skipAutosave.current) {
      skipAutosave.current = false
      return
    }
    if (archived) return
    if (!title.trim()) return
    if (title === todoRef.current.title && content === todoRef.current.content) return
    setSaveState('typing')
    const timer = setTimeout(async () => {
      setSaveState('saving')
      const ok = await onUpdate(todo.id, { title: title.trim(), content })
      setSaveState(ok ? 'saved' : 'error')
    }, 550)
    return () => clearTimeout(timer)
  }, [title, content, todo.id, archived, onUpdate])

  const patch = async (value: UpdateTodoPatch) => {
    const ok = await onUpdate(todo.id, value)
    if (ok) setSaveState('saved')
  }

  return (
    <aside className="detail-panel" data-testid="detail-panel">
      <header className="detail-header">
        <div className="detail-header-left">
          <span className="detail-eyebrow">TASK DETAIL</span>
          <span
            className={`chip chip-status status-${status}`}
            style={{ color: STATUS_META[status].color }}
          >
            <i className="chip-dot" style={{ background: STATUS_META[status].color }} />
            {todoStatusText(todo, now)}
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭详情" data-testid="detail-close">
          <XIcon />
        </button>
      </header>

      <div className="detail-scroll">
        <div className={`detail-check-wrap ${archived ? 'disabled' : ''}`}>
          <button
            className={`detail-check ${completed ? 'checked' : ''}`}
            onClick={() => !archived && onToggle(todo, !completed)}
            role="checkbox"
            aria-checked={completed}
            data-testid="detail-check"
          >
            <CheckIcon size={16} />
          </button>
          <div>
            <strong>{completed ? '已完成' : '标记为已完成'}</strong>
            <span>
              {completed
                ? `实际完成时间 ${formatFullDateTime(todo.completedAt)}`
                : '勾选后会记录实际完成时间'}
            </span>
          </div>
        </div>

        <input
          className="detail-title-input"
          value={title}
          disabled={archived}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="待办标题"
          data-testid="detail-title"
        />
        <RichContentEditor
          value={content}
          disabled={archived}
          placeholder="写下详细内容、背景、拆分步骤…支持 Markdown 与图片"
          onChange={setContent}
        />
        <div className="save-state">
          {saveState === 'typing'
            ? '等待保存…'
            : saveState === 'saving'
              ? '保存中…'
              : saveState === 'error'
                ? '保存失败'
                : '已自动保存'}
        </div>

        <div className="detail-actions">
          {!archived && !completed && (
            <>
              {!todo.startedAt && (
                <button className="btn primary" onClick={() => onStart(todo)} data-testid="detail-start">
                  <PlayIcon size={13} />
                  开始任务
                </button>
              )}
              <button className="btn tomato" onClick={() => onPomodoro(todo)} data-testid="detail-pomodoro">
                <TimerIcon size={15} />
                番茄专注
              </button>
            </>
          )}
          {!archived && (
            <button
              className={`btn ghost ${todo.pinned ? 'active' : ''}`}
              onClick={() => onPin(todo)}
              data-testid="detail-pin"
            >
              <PinIcon size={15} filled={todo.pinned} />
              {todo.pinned ? '取消便签' : '固定便签'}
            </button>
          )}
          {archived ? (
            <>
              <button className="btn ghost" onClick={() => onRestore(todo)} data-testid="detail-restore">
                <ResetIcon size={15} />
                恢复
              </button>
              <button
                className="btn danger"
                onClick={() => onDeleteForever(todo)}
                data-testid="detail-delete-forever"
              >
                <TrashIcon size={15} />
                永久删除
              </button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => onArchive(todo)} data-testid="detail-archive">
              <ArchiveIcon size={15} />
              归档
            </button>
          )}
        </div>

        <div className="detail-grid">
          <label className="field">
            <span>所属分组</span>
            <Dropdown
              value={todo.groupId}
              disabled={archived}
              options={state.groups.map((item) => ({
                value: item.id,
                label: item.name,
                color: item.color
              }))}
              onChange={(next) => void patch({ groupId: next })}
              testId="detail-group"
            />
          </label>
          <label className="field">
            <span>紧急程度</span>
            <Dropdown
              value={todo.urgency}
              disabled={archived}
              options={(Object.keys(URGENCY_META) as Urgency[]).map((key) => ({
                value: key,
                label: URGENCY_META[key].label,
                color: URGENCY_META[key].color,
                short: URGENCY_META[key].short,
                description: URGENCY_META[key].description
              }))}
              onChange={(next) => void patch({ urgency: next as Urgency })}
              testId="detail-urgency"
            />
          </label>
          <label className="field field-wide">
            <span>期望完成时间</span>
            <input
              type="datetime-local"
              value={expected}
              disabled={archived}
              onChange={(event) => {
                setExpected(event.target.value)
                void patch({ expectedAt: fromDatetimeLocal(event.target.value) })
              }}
              data-testid="detail-expected"
            />
          </label>
        </div>

        <div className="detail-timeline">
          <div className="timeline-item">
            <ClockIcon size={14} />
            <span>创建</span>
            <strong>{formatDateTime(todo.createdAt)}</strong>
          </div>
          <div className="timeline-item">
            <PlayIcon size={12} />
            <span>实际开始</span>
            <strong>{formatDateTime(todo.startedAt)}</strong>
          </div>
          <div className="timeline-item">
            <CheckIcon size={14} />
            <span>实际完成</span>
            <strong>{formatDateTime(todo.completedAt)}</strong>
          </div>
          <div className="timeline-item">
            <ArchiveIcon size={14} />
            <span>归档</span>
            <strong>{formatDateTime(todo.archivedAt)}</strong>
          </div>
          <div className="timeline-item">
            <TimerIcon size={14} />
            <span>番茄 / 专注</span>
            <strong>
              {todo.pomodoroCount} 次 · {todo.focusMinutes} 分钟
            </strong>
          </div>
        </div>

        <div className="detail-note-style">
          <div className="section-mini-title">
            <PaletteIcon size={15} />
            桌面便签样式
            {group && <span className="muted">· {group.name}</span>}
          </div>
          <div className="swatch-row">
            {STICKY_COLORS.map((color) => (
              <button
                key={color}
                className={`swatch ${todo.stickyColor === color ? 'selected' : ''}`}
                style={{ background: color }}
                onClick={() => void patch({ stickyColor: color })}
                title={color}
                disabled={archived}
              />
            ))}
          </div>
          <label className="opacity-field">
            <span>透明度</span>
            <input
              type="range"
              min="25"
              max="100"
              value={Math.round(todo.stickyOpacity * 100)}
              disabled={archived}
              onChange={(event) => void patch({ stickyOpacity: Number(event.target.value) / 100 })}
            />
            <strong>{Math.round(todo.stickyOpacity * 100)}%</strong>
          </label>
          <p className="detail-hint">每个便签独立保存背景颜色和透明度。</p>
        </div>
      </div>
    </aside>
  )
}
