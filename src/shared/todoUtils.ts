import type { Todo, TodoStatus } from './types'

export const STATUS_META: Record<
  TodoStatus,
  { label: string; color: string; description: string }
> = {
  not_started: { label: '未开始', color: '#8b93a7', description: '尚未开始推进' },
  in_progress: { label: '进行中', color: '#4ea8ff', description: '已经开始推进' },
  completed: { label: '已完成', color: '#49d49d', description: '已在期望时间内完成' },
  overdue: { label: '未完成', color: '#ff5c7a', description: '已超过期望完成时间' }
}

export function isArchived(todo: Todo): boolean {
  return Boolean(todo.archivedAt)
}

export function isCompleted(todo: Todo): boolean {
  return Boolean(todo.completedAt)
}

export function isStarted(todo: Todo): boolean {
  return Boolean(todo.startedAt)
}

export function isOverdue(todo: Todo, now = Date.now()): boolean {
  if (todo.archivedAt || todo.completedAt || !todo.expectedAt) return false
  const due = Date.parse(todo.expectedAt)
  return Number.isFinite(due) && due < now
}

/**
 * 展示用的主状态。已逾期的进行中任务会显示为「未完成」，
 * 但侧边栏的「进行中」智能视图仍会包含它。
 */
export function getTodoStatus(todo: Todo, now = Date.now()): TodoStatus {
  if (todo.completedAt) return 'completed'
  if (isOverdue(todo, now)) return 'overdue'
  if (todo.startedAt) return 'in_progress'
  return 'not_started'
}

export function taskMatchesStatus(todo: Todo, status: TodoStatus | 'all', now = Date.now()): boolean {
  if (todo.archivedAt) return false
  if (status === 'all') return true
  if (status === 'completed') return Boolean(todo.completedAt)
  if (status === 'overdue') return isOverdue(todo, now)
  if (status === 'in_progress') return Boolean(todo.startedAt) && !todo.completedAt
  if (status === 'not_started') return !todo.startedAt && !todo.completedAt
  return true
}
