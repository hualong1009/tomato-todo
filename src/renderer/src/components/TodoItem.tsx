import type { CSSProperties, MouseEvent } from 'react'
import { useState } from 'react'
import { URGENCY_META } from '@shared/defaults'
import type { Group, Todo } from '@shared/types'
import { getTodoStatus, isOverdue, STATUS_META } from '@shared/todoUtils'
import { todoStatusText, formatDateTime, formatDue, markdownExcerpt } from '../utils/format'
import { isMobile } from '../platform'
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  MoreIcon,
  PinIcon,
  PlayIcon,
  ResetIcon,
  TimerIcon,
  TrashIcon
} from './Icons'

interface TodoItemProps {
  todo: Todo
  group?: Group
  showGroup?: boolean
  selected: boolean
  now: number
  onSelect: (id: string) => void
  onToggle: (todo: Todo, completed: boolean) => void
  onStart: (todo: Todo) => void
  onPin: (todo: Todo) => void
  onPomodoro: (todo: Todo) => void
  onContext: (event: MouseEvent, todo: Todo) => void
  onRestore: (todo: Todo) => void
  onDeleteForever: (todo: Todo) => void
}

export function TodoItem({
  todo,
  group,
  showGroup = false,
  selected,
  now,
  onSelect,
  onToggle,
  onStart,
  onPin,
  onPomodoro,
  onContext,
  onRestore,
  onDeleteForever
}: TodoItemProps) {
  const [burst, setBurst] = useState(0)
  const completed = Boolean(todo.completedAt)
  const archived = Boolean(todo.archivedAt)
  const status = getTodoStatus(todo, now)
  const overdue = isOverdue(todo, now)
  const urgency = URGENCY_META[todo.urgency]

  const toggle = () => {
    if (archived) return
    if (!completed) setBurst(Date.now())
    onToggle(todo, !completed)
  }

  return (
    <article
      className={`todo-item ${completed ? 'completed' : ''} ${archived ? 'archived' : ''} ${
        selected ? 'selected' : ''
      } ${overdue ? 'overdue' : ''}`}
      data-status={status}
      data-testid="todo-item"
      data-todo-id={todo.id}
      data-archived={archived}
      data-completed={completed}
      onClick={() => onSelect(todo.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        onContext(event, todo)
      }}
    >
      <div className="todo-glow" style={{ background: urgency.color }} />
      <button
        className="todo-check"
        role="checkbox"
        aria-checked={completed}
        aria-label={completed ? '标记为未完成' : '标记为已完成'}
        onClick={(event) => {
          event.stopPropagation()
          toggle()
        }}
        data-testid="todo-check"
      >
        <CheckIcon size={14} />
        {burst > 0 && (
          <span key={burst} className="confetti">
            {Array.from({ length: 9 }).map((_, index) => (
              <i
                key={index}
                style={
                  {
                    '--i': index,
                    '--c': ['#ff5f57', '#ffb45c', '#5aa2ff', '#49d49d', '#b38cff'][index % 5]
                  } as CSSProperties
                }
              />
            ))}
          </span>
        )}
      </button>

      <div className="todo-main">
        <div className="todo-title-line">
          <h3 className="todo-title">{todo.title}</h3>
          {archived && <span className="chip chip-archive">已归档</span>}
        </div>
        {todo.content.trim() && (
          <p className="todo-excerpt">{markdownExcerpt(todo.content)}</p>
        )}
        <div className="todo-chips">
          <span
            className={`chip chip-status status-${status}`}
            style={{ color: STATUS_META[status].color }}
          >
            <i className="chip-dot" style={{ background: STATUS_META[status].color }} />
            {todoStatusText(todo, now)}
          </span>
          <span className="chip chip-urgency" style={{ color: urgency.color }}>
            {urgency.label}
          </span>
          {todo.expectedAt && (
            <span className={`chip chip-date ${overdue ? 'is-overdue' : ''}`}>
              {overdue ? <AlertIcon size={12} /> : <CalendarIcon size={12} />}
              {formatDue(todo.expectedAt, now)}
            </span>
          )}
          {showGroup && group && (
            <span className="chip chip-group">
              <i className="chip-dot" style={{ background: group.color }} />
              {group.name}
            </span>
          )}
          {todo.pomodoroCount > 0 && (
            <span className="chip chip-focus">
              <TimerIcon size={12} />
              {todo.pomodoroCount} 番茄
            </span>
          )}
          {completed && (
            <span className="chip chip-completed-time">
              完成于 {formatDateTime(todo.completedAt)}
            </span>
          )}
          {!completed && todo.startedAt && (
            <span className="chip chip-start-time">
              <PlayIcon size={10} />
              {formatDateTime(todo.startedAt)} 开始
            </span>
          )}
        </div>
      </div>

      <div className="todo-actions">
        {archived ? (
          <>
            <button
              className="action-btn"
              title="恢复到列表"
              onClick={(event) => {
                event.stopPropagation()
                onRestore(todo)
              }}
              data-testid="todo-restore"
            >
              <ResetIcon size={15} />
            </button>
            <button
              className="action-btn danger"
              title="永久删除"
              onClick={(event) => {
                event.stopPropagation()
                onDeleteForever(todo)
              }}
              data-testid="todo-delete-forever"
            >
              <TrashIcon size={15} />
            </button>
          </>
        ) : (
          <>
            {!completed && !todo.startedAt && (
              <button
                className="start-btn"
                title="开始任务"
                onClick={(event) => {
                  event.stopPropagation()
                  onStart(todo)
                }}
                data-testid="todo-start"
              >
                <PlayIcon size={11} />
                开始
              </button>
            )}
            {todo.startedAt && !completed && (
              <span className="doing-pill" title="任务已开始">
                <i />
                进行中
              </span>
            )}
            {!isMobile && (
              <button
                className={`action-btn pin ${todo.pinned ? 'active' : ''}`}
                title={todo.pinned ? '取消桌面便签' : '固定到桌面便签'}
                onClick={(event) => {
                  event.stopPropagation()
                  onPin(todo)
                }}
                data-testid="todo-pin"
              >
                <PinIcon size={15} filled={todo.pinned} />
              </button>
            )}
            <button
              className="action-btn tomato"
              title="开始番茄专注"
              onClick={(event) => {
                event.stopPropagation()
                onPomodoro(todo)
              }}
              data-testid="todo-pomodoro"
            >
              <TimerIcon size={16} />
            </button>
          </>
        )}
        <button
          className="action-btn more"
          title="更多操作"
          onClick={(event) => {
            event.stopPropagation()
            onContext(event, todo)
          }}
          data-testid="todo-more"
        >
          <MoreIcon size={15} />
        </button>
      </div>
    </article>
  )
}
