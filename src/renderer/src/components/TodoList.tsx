import { useState } from 'react'
import type { Group, Todo } from '@shared/types'
import { ChevronDownIcon, ChevronRightIcon, TomatoIcon } from './Icons'
import { TodoItem } from './TodoItem'

export interface TodoSection {
  key: string
  group?: Group
  todos: Todo[]
}

interface TodoListProps {
  sections: TodoSection[]
  archivedTodos: Todo[]
  archivedOnly?: boolean
  showGroupHeaders?: boolean
  emptyText: string
  selectedId: string | null
  now: number
  onSelect: (id: string) => void
  onToggle: (todo: Todo, completed: boolean) => void
  onStart: (todo: Todo) => void
  onPin: (todo: Todo) => void
  onPomodoro: (todo: Todo) => void
  onContext: (event: React.MouseEvent, todo: Todo) => void
  onRestore: (todo: Todo) => void
  onDeleteForever: (todo: Todo) => void
}

export function TodoList({
  sections,
  archivedTodos,
  archivedOnly = false,
  showGroupHeaders = false,
  emptyText,
  selectedId,
  now,
  onSelect,
  onToggle,
  onStart,
  onPin,
  onPomodoro,
  onContext,
  onRestore,
  onDeleteForever
}: TodoListProps) {
  const [archivedOpen, setArchivedOpen] = useState(false)
  const total = sections.reduce((sum, section) => sum + section.todos.length, 0)
  const isEmpty = total === 0 && archivedTodos.length === 0
  const groups = new Map<string, Group>()
  for (const section of sections) if (section.group) groups.set(section.group.id, section.group)

  const renderItem = (todo: Todo, showGroup = false) => (
    <TodoItem
      key={todo.id}
      todo={todo}
      group={groups.get(todo.groupId)}
      showGroup={showGroup}
      selected={selectedId === todo.id}
      now={now}
      onSelect={onSelect}
      onToggle={onToggle}
      onStart={onStart}
      onPin={onPin}
      onPomodoro={onPomodoro}
      onContext={onContext}
      onRestore={onRestore}
      onDeleteForever={onDeleteForever}
    />
  )

  if (isEmpty) {
    return (
      <div className="empty-state" data-testid="empty-state">
        <div className="empty-orbit">
          <span className="orbit-ring" />
          <span className="orbit-ring ring-2" />
          <TomatoIcon size={44} />
        </div>
        <h3>{emptyText}</h3>
        <p>在下方输入标题，开始你的第一条待办。点击「开始」或番茄图标，任务会进入进行中。</p>
      </div>
    )
  }

  return (
    <div className={`todo-list ${archivedOnly ? 'archived-list' : ''}`} data-testid="todo-list">
      {sections.map((section) => (
        <section className="todo-section" key={section.key} data-testid={`section-${section.key}`}>
          {showGroupHeaders && section.group && (
            <header className="section-header">
              <span
                className="section-dot"
                style={{ background: section.group.color, boxShadow: `0 0 12px ${section.group.color}` }}
              />
              <h2>{section.group.name}</h2>
              <span className="section-count">{section.todos.length}</span>
              <span className="section-line" />
            </header>
          )}
          <div className="section-items">
            {section.todos.map((todo) => renderItem(todo, !showGroupHeaders && !section.group))}
            {section.todos.length === 0 && <div className="empty-hint">这个分组还没有待办</div>}
          </div>
        </section>
      ))}

      {archivedTodos.length > 0 && (
        <section className="todo-section archived-section">
          <button
            className="archived-toggle"
            onClick={() => setArchivedOpen((open) => !open)}
            data-testid="archived-toggle"
          >
            {archivedOpen || archivedOnly ? (
              <ChevronDownIcon size={15} />
            ) : (
              <ChevronRightIcon size={15} />
            )}
            <span>已归档</span>
            <span className="section-count">{archivedTodos.length}</span>
            <span className="section-line" />
            {!archivedOnly && <span className="archived-hint">灰色显示，不参与 AI 回顾</span>}
          </button>
          {(archivedOpen || archivedOnly) && (
            <div className="section-items archived-items">
              {archivedTodos.map((todo) => renderItem(todo, !showGroupHeaders))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
