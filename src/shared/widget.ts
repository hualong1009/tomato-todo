import { URGENCY_META } from './defaults'
import type { AppState, Todo } from './types'

/**
 * 桌面小组件摘要。
 *
 * 小组件是原生 RemoteViews，不能跑 React；同时待办 JSON 里可能内嵌几十 MB 的
 * 图片/附件 base64，直接让原生侧解析既慢又可能 OOM。所以由渲染层生成一份
 * 轻量摘要（最多 5 条、无正文、无附件）写进独立存储，原生只读这份摘要。
 */
export interface WidgetTodoItem {
  id: string
  title: string
  /** 紧急程度对应的颜色，原生直接用来画圆点 */
  color: string
  /** 右侧副标题：期望完成时间或状态 */
  meta: string
  overdue: boolean
}

export interface WidgetSummary {
  generatedAt: string
  /** 未完成的待办总数 */
  total: number
  /** 已逾期数量 */
  overdue: number
  /** 最近更新的待办（最多 limit 条） */
  items: WidgetTodoItem[]
}

export const WIDGET_ITEM_LIMIT = 5

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 把期望完成时间格式化成小组件上的短文本：今天 18:00 / 明天 09:00 / 10-28 09:00 */
export function formatWidgetMeta(todo: Todo, now: Date = new Date()): string {
  if (!todo.expectedAt) return todo.startedAt ? '进行中' : '未开始'
  const date = new Date(todo.expectedAt)
  if (Number.isNaN(date.getTime())) return todo.startedAt ? '进行中' : '未开始'
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return `今天 ${time}`
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  if (isTomorrow) return `明天 ${time}`
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

/** 是否已逾期（有期望完成时间且已过、未完成、未归档）。 */
export function isWidgetOverdue(todo: Todo, now: Date = new Date()): boolean {
  if (todo.completedAt || todo.archivedAt) return false
  if (!todo.expectedAt) return false
  const date = new Date(todo.expectedAt)
  return !Number.isNaN(date.getTime()) && date.getTime() < now.getTime()
}

/**
 * 生成小组件摘要：未完成、未归档的待办按「最近更新」倒序取前 5 条。
 */
export function buildWidgetSummary(
  state: Pick<AppState, 'todos'>,
  options: { now?: Date; limit?: number } = {}
): WidgetSummary {
  const now = options.now ?? new Date()
  const limit = options.limit ?? WIDGET_ITEM_LIMIT
  const active = state.todos.filter((todo) => !todo.archivedAt && !todo.completedAt)
  const sorted = [...active].sort((a, b) => {
    const left = Date.parse(b.updatedAt || b.createdAt)
    const right = Date.parse(a.updatedAt || a.createdAt)
    return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right)
  })
  return {
    generatedAt: now.toISOString(),
    total: active.length,
    overdue: active.filter((todo) => isWidgetOverdue(todo, now)).length,
    items: sorted.slice(0, Math.max(0, limit)).map((todo) => ({
      id: todo.id,
      title: todo.title,
      color: URGENCY_META[todo.urgency].color,
      meta: formatWidgetMeta(todo, now),
      overdue: isWidgetOverdue(todo, now)
    }))
  }
}
