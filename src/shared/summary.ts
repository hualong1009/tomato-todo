import { URGENCY_META } from './defaults'
import type { AppState, SummaryDates, SummaryRange, Todo } from './types'
import { getTodoStatus, isOverdue } from './todoUtils'

export const RANGE_LABELS: Record<SummaryRange, string> = {
  day: '今日',
  week: '最近 1 周',
  month: '最近 1 个月',
  year: '最近 1 年',
  custom: '自定义'
}

const RANGE_DAYS: Record<'week' | 'month' | 'year', number> = {
  week: 7,
  month: 30,
  year: 365
}

export interface SummaryStats {
  label: string
  rangeStart: string
  rangeEnd: string
  total: number
  completedCount: number
  pendingCount: number
  inProgressCount: number
  notStartedCount: number
  overdueCount: number
  focusMinutes: number
  focusSessions: number
  completionRate: string
  urgencyStats: string
  groups: string
  todosMarkdown: string
}

export interface SummaryContext extends SummaryStats {
  relevantTodos: Todo[]
  prompt: string
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${formatDate(iso)} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`
}

function truncate(value: string, length: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > length ? `${text.slice(0, length)}…` : text
}

function within(iso: string | null | undefined, from: number, to: number): boolean {
  if (!iso) return false
  const time = Date.parse(iso)
  return Number.isFinite(time) && time >= from && time <= to
}

/** 把 YYYY-MM-DD 解析成本地时区当天起点；非法时返回 NaN。 */
function parseLocalDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime()
    : Number.NaN
}

export function getRangeBounds(
  range: SummaryRange,
  now = Date.now(),
  dates?: SummaryDates
): { from: number; to: number; label: string; start: string; end: string } {
  if (range === 'day') {
    const nowDate = new Date(now)
    const from = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
    return {
      from,
      to: now,
      label: RANGE_LABELS.day,
      start: formatDate(new Date(from).toISOString()),
      end: formatDate(new Date(now).toISOString())
    }
  }
  if (range === 'custom') {
    const start = parseLocalDate(dates?.start ?? '')
    const end = parseLocalDate(dates?.end ?? '')
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error('自定义范围需要合法的开始与结束日期（格式 YYYY-MM-DD）')
    }
    if (start > end) {
      throw new Error('自定义范围的开始日期不能晚于结束日期')
    }
    // 结束日期取当天 23:59:59.999，整天的数据都算在内
    const to = end + 24 * 60 * 60 * 1000 - 1
    const label = dates!.start === dates!.end ? dates!.start : `${dates!.start} ~ ${dates!.end}`
    return { from: start, to, label, start: dates!.start, end: dates!.end }
  }
  const to = now
  const from = now - RANGE_DAYS[range] * 24 * 60 * 60 * 1000
  return {
    from,
    to,
    label: RANGE_LABELS[range],
    start: formatDate(new Date(from).toISOString()),
    end: formatDate(new Date(to).toISOString())
  }
}

export function buildSummaryContext(
  state: AppState,
  range: SummaryRange,
  now = Date.now(),
  dates?: SummaryDates
): SummaryContext {
  const bounds = getRangeBounds(range, now, dates)
  const activeTodos = state.todos.filter((todo) => !todo.archivedAt)

  const relevantTodos = activeTodos.filter((todo) => {
    if (!todo.completedAt) return true
    return (
      within(todo.completedAt, bounds.from, bounds.to) ||
      within(todo.createdAt, bounds.from, bounds.to) ||
      within(todo.updatedAt, bounds.from, bounds.to)
    )
  })

  const completedCount = relevantTodos.filter((todo) =>
    within(todo.completedAt, bounds.from, bounds.to)
  ).length
  const pendingCount = relevantTodos.length - completedCount
  const inProgressCount = relevantTodos.filter(
    (todo) => !todo.completedAt && Boolean(todo.startedAt)
  ).length
  const notStartedCount = relevantTodos.filter(
    (todo) => !todo.completedAt && !todo.startedAt
  ).length
  const overdueCount = relevantTodos.filter((todo) => isOverdue(todo, now)).length

  let focusMinutes = 0
  let focusSessions = 0
  for (const todo of activeTodos) {
    for (const session of todo.focusLog) {
      if (within(session.at, bounds.from, bounds.to)) {
        focusSessions += 1
        focusMinutes += session.minutes
      }
    }
  }

  const urgencyStats = (Object.keys(URGENCY_META) as (keyof typeof URGENCY_META)[])
    .map((key) => {
      const count = relevantTodos.filter((todo) => todo.urgency === key).length
      return count > 0 ? `${URGENCY_META[key].label} ${count}` : null
    })
    .filter(Boolean)
    .join('、')

  const groups = state.groups
    .map((group) => {
      const items = relevantTodos.filter((todo) => todo.groupId === group.id)
      if (items.length === 0) return null
      const completed = items.filter((todo) => Boolean(todo.completedAt)).length
      return `${group.name}（${completed}/${items.length} 完成）`
    })
    .filter(Boolean)
    .join('、')

  const sorted = [...relevantTodos].sort((a, b) => {
    if (Boolean(a.completedAt) !== Boolean(b.completedAt)) {
      return a.completedAt ? 1 : -1
    }
    if (!a.completedAt && !b.completedAt) {
      const urgency = URGENCY_META[b.urgency].rank - URGENCY_META[a.urgency].rank
      if (urgency !== 0) return urgency
      const aExpected = a.expectedAt ? Date.parse(a.expectedAt) : Number.MAX_SAFE_INTEGER
      const bExpected = b.expectedAt ? Date.parse(b.expectedAt) : Number.MAX_SAFE_INTEGER
      if (aExpected !== bExpected) return aExpected - bExpected
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })

  const groupName = (groupId: string) =>
    state.groups.find((group) => group.id === groupId)?.name ?? '未分组'

  const lines = sorted.map((todo) => {
    const status = getTodoStatus(todo, now)
    const statusText =
      status === 'completed'
        ? '已完成'
        : status === 'overdue'
          ? '已逾期未完成'
          : status === 'in_progress'
            ? '进行中'
            : '未开始'
    const parts = [
      todo.completedAt ? '[x]' : '[ ]',
      todo.title,
      `分组：${groupName(todo.groupId)}`,
      `紧急程度：${URGENCY_META[todo.urgency].label}`,
      `状态：${statusText}`,
      `期望：${formatDateTime(todo.expectedAt)}`,
      `开始：${formatDateTime(todo.startedAt)}`,
      `完成：${formatDateTime(todo.completedAt)}`
    ]
    const excerpt = truncate(todo.content, 180)
    return `- ${parts.join('｜')}${excerpt ? `\n  内容：${excerpt}` : ''}`
  })

  const maxLines = 250
  const todosMarkdown =
    lines.length > maxLines
      ? `${lines.slice(0, maxLines).join('\n')}\n- ……其余 ${lines.length - maxLines} 项已省略`
      : lines.join('\n') || '（该时间范围内没有待办记录）'

  const completionRate =
    completedCount + pendingCount === 0
      ? '0%'
      : `${((completedCount / (completedCount + pendingCount)) * 100).toFixed(1)}%`

  const template = state.settings.promptTemplate
  const values: Record<string, string> = {
    range: bounds.label,
    rangeStart: bounds.start,
    rangeEnd: bounds.end,
    total: String(relevantTodos.length),
    completedCount: String(completedCount),
    pendingCount: String(pendingCount),
    inProgressCount: String(inProgressCount),
    notStartedCount: String(notStartedCount),
    overdueCount: String(overdueCount),
    completionRate,
    focusMinutes: String(focusMinutes),
    focusSessions: String(focusSessions),
    urgencyStats: urgencyStats || '无',
    groups: groups || '无',
    todos: todosMarkdown
  }

  const prompt = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key] : match
  )

  return {
    label: bounds.label,
    rangeStart: bounds.start,
    rangeEnd: bounds.end,
    total: relevantTodos.length,
    completedCount,
    pendingCount,
    inProgressCount,
    notStartedCount,
    overdueCount,
    focusMinutes,
    focusSessions,
    completionRate,
    urgencyStats: urgencyStats || '无',
    groups: groups || '无',
    todosMarkdown,
    relevantTodos: sorted,
    prompt
  }
}
