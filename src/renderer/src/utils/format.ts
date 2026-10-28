import type { Todo } from '@shared/types'
import { getTodoStatus } from '@shared/todoUtils'

export function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

export function formatFullDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`
}

export function formatDue(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '未设置时间'
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return '未设置时间'
  const diff = due.getTime() - now
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  const time = `${pad(due.getHours())}:${pad(due.getMinutes())}`
  if (diff < 0) {
    if (minutes < 60) return `逾期 ${minutes} 分钟`
    if (hours < 24) return `逾期 ${hours} 小时`
    return `逾期 ${days} 天`
  }
  const today = new Date(now)
  const sameDay =
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  if (sameDay) return `今天 ${time}`
  const tomorrow = new Date(now + 86400000)
  const isTomorrow =
    due.getFullYear() === tomorrow.getFullYear() &&
    due.getMonth() === tomorrow.getMonth() &&
    due.getDate() === tomorrow.getDate()
  if (isTomorrow) return `明天 ${time}`
  if (diff < 7 * 86400000) {
    return `${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][due.getDay()]} ${time}`
  }
  return `${due.getMonth() + 1}月${due.getDate()}日 ${time}`
}

export function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  if (value.length !== 6) return `rgba(255, 241, 168, ${alpha})`
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function textColorFor(hex: string): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16) || 0
  const g = parseInt(value.slice(2, 4), 16) || 0
  const b = parseInt(value.slice(4, 6), 16) || 0
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.56 ? '#242019' : '#f7f7fb'
}

export function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function todoStatusText(todo: Todo, now = Date.now()): string {
  const status = getTodoStatus(todo, now)
  if (status === 'completed') return '已完成'
  if (status === 'overdue') return '未完成·逾期'
  if (status === 'in_progress') return '进行中'
  return '未开始'
}

export function prettifyHotkey(accelerator: string): string {
  const isMac = navigator.userAgent.includes('Mac')
  return accelerator
    .replace(/CommandOrControl/gi, isMac ? '⌘' : 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Command/gi, isMac ? '⌘' : 'Win')
    .replace(/Shift/gi, 'Shift')
    .replace(/Alt/gi, isMac ? '⌥' : 'Alt')
    .replace(/\+/g, ' + ')
}

type AcceleratorEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

export function acceleratorFromEvent(event: AcceleratorEvent): string | null {
  const key = event.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  if (key === 'Escape') return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.metaKey) parts.push('Command')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (parts.length === 0) return null
  let name = ''
  if (key === ' ') name = 'Space'
  else if (key === 'ArrowUp') name = 'Up'
  else if (key === 'ArrowDown') name = 'Down'
  else if (key === 'ArrowLeft') name = 'Left'
  else if (key === 'ArrowRight') name = 'Right'
  else if (key === 'Enter') name = 'Enter'
  else if (key === 'Tab') name = 'Tab'
  else if (key === 'Backspace') name = 'Backspace'
  else if (key === 'Delete') name = 'Delete'
  else if (/^F\d{1,2}$/.test(key)) name = key
  else if (key.length === 1) name = key.toUpperCase()
  else name = key
  if (!name) return null
  return [...parts, name].join('+')
}

/** 把 Markdown 正文压成一行纯文本摘要，用于列表预览。 */
export function markdownExcerpt(content: string, limit = 120): string {
  const plain = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '[代码]')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain
}

export {
  syncStatusDetail,
  syncStatusLabel,
  type SyncIndicatorSource
} from '@shared/syncStatus'
