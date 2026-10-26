import {
  DEFAULT_GROUP_ID,
  DEFAULT_STICKY_COLOR,
  DEFAULT_STICKY_OPACITY,
  GROUP_COLORS,
  URGENCY_META
} from './defaults'
import type {
  AddTodoInput,
  AppState,
  Group,
  Todo,
  UpdateTodoPatch,
  Urgency,
  WindowBounds
} from './types'

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
import { isCompleted, isStarted } from './todoUtils'

const ISO_NOW = () => new Date().toISOString()

function cleanTitle(value: unknown): string {
  const title = String(value ?? '').trim()
  if (!title) throw new Error('待办标题不能为空')
  if (title.length > 300) throw new Error('待办标题不能超过 300 个字符')
  return title
}

function cleanContent(value: unknown): string {
  const content = String(value ?? '')
  if (content.length > 50000) throw new Error('待办内容不能超过 50000 个字符')
  return content
}

function normaliseExpectedAt(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('期望完成时间格式不正确')
  return date.toISOString()
}

function normaliseUrgency(value: Urgency | undefined, fallback: Urgency = 'medium'): Urgency {
  if (value === undefined) return fallback
  if (!(value in URGENCY_META)) throw new Error('紧急程度不正确')
  return value
}

function normaliseBounds(value: WindowBounds): WindowBounds {
  return {
    x: Math.round(Number(value.x) || 0),
    y: Math.round(Number(value.y) || 0),
    width: Math.max(240, Math.round(Number(value.width) || 320)),
    height: Math.max(180, Math.round(Number(value.height) || 280))
  }
}

export function getGroup(state: AppState, groupRef: string | undefined | null): Group | undefined {
  if (!groupRef) return undefined
  return state.groups.find(
    (group) => group.id === groupRef || group.name.toLowerCase() === groupRef.toLowerCase()
  )
}

export function ensureGroup(state: AppState, nameOrId: string | undefined | null): Group {
  if (!nameOrId) {
    return state.groups.find((group) => group.id === DEFAULT_GROUP_ID) ?? state.groups[0]
  }
  const existing = getGroup(state, nameOrId)
  if (existing) return existing
  const name = nameOrId.trim()
  if (!name) {
    return state.groups.find((group) => group.id === DEFAULT_GROUP_ID) ?? state.groups[0]
  }
  return createGroup(state, name)
}

export function createGroup(state: AppState, name: string, color?: string): Group {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('分组名称不能为空')
  if (cleanName.length > 40) throw new Error('分组名称不能超过 40 个字符')
  if (state.groups.some((group) => group.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('已存在同名分组')
  }
  const selectedColor =
    color && /^#[0-9a-f]{6}$/i.test(color)
      ? color
      : GROUP_COLORS[state.groups.length % GROUP_COLORS.length]
  const group: Group = {
    id: createId(),
    name: cleanName,
    color: selectedColor,
    createdAt: ISO_NOW()
  }
  state.groups.push(group)
  return group
}

export function updateGroup(
  state: AppState,
  id: string,
  patch: { name?: string; color?: string }
): Group {
  const group = state.groups.find((item) => item.id === id)
  if (!group) throw new Error('分组不存在')
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('分组名称不能为空')
    if (name.length > 40) throw new Error('分组名称不能超过 40 个字符')
    if (
      state.groups.some(
        (item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      throw new Error('已存在同名分组')
    }
    group.name = name
  }
  if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) group.color = patch.color
  return group
}

export function deleteGroup(state: AppState, id: string): void {
  if (id === DEFAULT_GROUP_ID) throw new Error('默认收件箱不能删除')
  const index = state.groups.findIndex((item) => item.id === id)
  if (index === -1) throw new Error('分组不存在')
  state.groups.splice(index, 1)
  const now = ISO_NOW()
  for (const todo of state.todos) {
    if (todo.groupId === id) {
      todo.groupId = DEFAULT_GROUP_ID
      todo.updatedAt = now
    }
  }
}

export function createTodo(state: AppState, input: AddTodoInput): Todo {
  const group = ensureGroup(state, input.groupId)
  const now = ISO_NOW()
  const todo: Todo = {
    id: createId(),
    title: cleanTitle(input.title),
    content: cleanContent(input.content),
    groupId: group.id,
    urgency: normaliseUrgency(input.urgency),
    expectedAt: normaliseExpectedAt(input.expectedAt),
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    pomodoroCount: 0,
    focusMinutes: 0,
    focusLog: [],
    stickyColor: DEFAULT_STICKY_COLOR,
    stickyOpacity: DEFAULT_STICKY_OPACITY,
    attachments: []
  }
  state.todos.unshift(todo)
  return todo
}

function requireTodo(state: AppState, id: string): Todo {
  const todo = state.todos.find((item) => item.id === id)
  if (!todo) throw new Error('待办不存在')
  return todo
}

export function updateTodo(state: AppState, id: string, patch: UpdateTodoPatch): Todo {
  const todo = requireTodo(state, id)
  if (patch.title !== undefined) todo.title = cleanTitle(patch.title)
  if (patch.content !== undefined) todo.content = cleanContent(patch.content)
  if (patch.groupId !== undefined) {
    const group = getGroup(state, patch.groupId)
    if (!group) throw new Error('目标分组不存在')
    todo.groupId = group.id
  }
  if (patch.urgency !== undefined) todo.urgency = normaliseUrgency(patch.urgency)
  if (patch.expectedAt !== undefined) todo.expectedAt = normaliseExpectedAt(patch.expectedAt)

  if (patch.started !== undefined) {
    if (patch.started) {
      if (!todo.startedAt) todo.startedAt = ISO_NOW()
      todo.archivedAt = null
    } else {
      todo.startedAt = null
    }
  }

  if (patch.completed !== undefined) {
    if (patch.completed) {
      todo.archivedAt = null
      if (!todo.completedAt) todo.completedAt = ISO_NOW()
      if (!todo.startedAt) todo.startedAt = todo.completedAt
    } else {
      todo.completedAt = null
    }
  }

  if (patch.archived !== undefined) {
    if (patch.archived) {
      if (!todo.archivedAt) todo.archivedAt = ISO_NOW()
      todo.pinned = false
    } else {
      todo.archivedAt = null
    }
  }

  if (patch.stickyColor !== undefined && /^#[0-9a-f]{6}$/i.test(patch.stickyColor)) {
    todo.stickyColor = patch.stickyColor
  }
  if (patch.stickyOpacity !== undefined) {
    const opacity = Number(patch.stickyOpacity)
    if (Number.isFinite(opacity)) {
      todo.stickyOpacity = Math.min(1, Math.max(0.25, opacity))
    }
  }
  if (patch.stickyBounds !== undefined) {
    todo.stickyBounds = normaliseBounds(patch.stickyBounds)
  }
  if (patch.attachments !== undefined) {
    todo.attachments = patch.attachments
  }

  todo.updatedAt = ISO_NOW()
  return todo
}

export function startTodo(state: AppState, id: string): Todo {
  const todo = requireTodo(state, id)
  if (todo.archivedAt) throw new Error('归档的待办需要先恢复')
  if (isCompleted(todo)) throw new Error('已完成的待办不能开始，请先取消完成')
  if (!todo.startedAt) todo.startedAt = ISO_NOW()
  todo.updatedAt = ISO_NOW()
  return todo
}

export function setCompleted(state: AppState, id: string, completed: boolean): Todo {
  return updateTodo(state, id, { completed })
}

export function archiveTodo(state: AppState, id: string): Todo {
  return updateTodo(state, id, { archived: true })
}

export function restoreTodo(state: AppState, id: string): Todo {
  return updateTodo(state, id, { archived: false })
}

export function deleteTodoPermanently(state: AppState, id: string): void {
  const index = state.todos.findIndex((todo) => todo.id === id)
  if (index === -1) throw new Error('待办不存在')
  state.todos.splice(index, 1)
}

export function setPinned(state: AppState, id: string, pinned: boolean): Todo {
  const todo = requireTodo(state, id)
  if (pinned && todo.archivedAt) throw new Error('归档的待办不能固定到桌面')
  todo.pinned = pinned
  todo.updatedAt = ISO_NOW()
  return todo
}

export function recordFocus(state: AppState, id: string, minutes: number): Todo {
  const todo = requireTodo(state, id)
  if (todo.archivedAt) throw new Error('归档的待办不能开始专注')
  if (isCompleted(todo)) throw new Error('已完成的待办不能开始专注')
  const value = Math.max(1, Math.round(Number(minutes) || 0))
  const now = ISO_NOW()
  todo.pomodoroCount += 1
  todo.focusMinutes += value
  todo.focusLog.push({ at: now, minutes: value })
  if (todo.focusLog.length > 1000) todo.focusLog.splice(0, todo.focusLog.length - 1000)
  if (!isStarted(todo)) todo.startedAt = now
  todo.updatedAt = now
  return todo
}
