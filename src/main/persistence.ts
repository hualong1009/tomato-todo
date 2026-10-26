import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_GROUPS,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_SETTINGS,
  DEFAULT_STICKY_COLOR,
  DEFAULT_STICKY_OPACITY
} from '../shared/defaults'
import type { AppSettings, AppState, FocusSession, Group, Todo, Urgency } from '../shared/types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isUrgency(value: unknown): value is Urgency {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent'
}

function normaliseTodo(raw: Record<string, unknown>, fallbackGroupId: string): Todo {
  const now = new Date().toISOString()
  const legacyCompleted = raw.completed === true
  const completedAt =
    typeof raw.completedAt === 'string'
      ? raw.completedAt
      : legacyCompleted && typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : null
  const archivedAt =
    typeof raw.archivedAt === 'string'
      ? raw.archivedAt
      : raw.archived === true
        ? typeof raw.updatedAt === 'string'
          ? raw.updatedAt
          : now
        : null
  const focusLog: FocusSession[] = Array.isArray(raw.focusLog)
    ? raw.focusLog
        .filter(
          (entry): entry is FocusSession =>
            Boolean(entry && typeof entry === 'object' && typeof entry.at === 'string')
        )
        .map((entry) => ({
          at: entry.at,
          minutes: Math.max(1, Math.round(Number(entry.minutes) || 0))
        }))
        .slice(-1000)
    : []
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    title: String(raw.title ?? '未命名待办'),
    content: String(raw.content ?? ''),
    groupId: String(raw.groupId ?? fallbackGroupId),
    urgency: isUrgency(raw.urgency) ? raw.urgency : 'medium',
    expectedAt: typeof raw.expectedAt === 'string' && raw.expectedAt ? raw.expectedAt : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt,
    archivedAt,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    pinned: raw.pinned === true,
    pomodoroCount: Number.isFinite(Number(raw.pomodoroCount))
      ? Number(raw.pomodoroCount)
      : focusLog.length,
    focusMinutes: Number.isFinite(Number(raw.focusMinutes))
      ? Number(raw.focusMinutes)
      : focusLog.reduce((total, entry) => total + entry.minutes, 0),
    focusLog,
    stickyColor:
      typeof raw.stickyColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.stickyColor)
        ? raw.stickyColor
        : DEFAULT_STICKY_COLOR,
    stickyOpacity: Number.isFinite(Number(raw.stickyOpacity))
      ? Math.min(1, Math.max(0.25, Number(raw.stickyOpacity)))
      : DEFAULT_STICKY_OPACITY,
    stickyBounds:
      raw.stickyBounds && typeof raw.stickyBounds === 'object'
        ? (raw.stickyBounds as Todo['stickyBounds'])
        : undefined
  }
}

export function createDefaultState(): AppState {
  return {
    version: 1,
    groups: clone(DEFAULT_GROUPS),
    todos: [],
    settings: clone(DEFAULT_SETTINGS)
  } as AppState
}

export function normaliseState(raw: unknown): AppState {
  const fallback = createDefaultState()
  if (!raw || typeof raw !== 'object') return fallback
  const source = raw as Partial<AppState> & Record<string, unknown>

  const groupsRaw = Array.isArray(source.groups) ? source.groups : []
  const groups: Group[] = groupsRaw
    .filter((group): group is Group => Boolean(group && typeof group === 'object'))
    .map((group, index) => ({
      id: String(group.id ?? `group-${index}`),
      name: String(group.name ?? `分组 ${index + 1}`),
      color:
        typeof group.color === 'string' && /^#[0-9a-f]{6}$/i.test(group.color)
          ? group.color
          : DEFAULT_GROUPS[0].color,
      createdAt: typeof group.createdAt === 'string' ? group.createdAt : new Date().toISOString()
    }))
  if (!groups.some((group) => group.id === 'inbox')) {
    groups.unshift(clone(DEFAULT_GROUPS[0]))
  }

  const groupIds = new Set(groups.map((group) => group.id))
  const todosRaw: unknown[] = Array.isArray(source.todos) ? source.todos : []
  const todos = todosRaw
    .filter((todo): todo is Record<string, unknown> => Boolean(todo && typeof todo === 'object'))
    .map((todo) => normaliseTodo(todo, 'inbox'))
    .map((todo) => {
      if (!groupIds.has(todo.groupId)) todo.groupId = 'inbox'
      return todo
    })

  const settingsSource = (source.settings ?? {}) as Partial<AppSettings>
  const settings: AppSettings = {
    ai: {
      ...fallback.settings.ai,
      ...(settingsSource.ai ?? {})
    },
    promptTemplate:
      typeof settingsSource.promptTemplate === 'string' && settingsSource.promptTemplate.trim()
        ? settingsSource.promptTemplate
        : DEFAULT_PROMPT_TEMPLATE,
    pomodoro: {
      ...fallback.settings.pomodoro,
      ...(settingsSource.pomodoro ?? {})
    },
    general: {
      ...fallback.settings.general,
      ...(settingsSource.general ?? {})
    },
    webdav: {
      ...fallback.settings.webdav,
      ...(settingsSource.webdav ?? {})
    },
    security: {
      ...fallback.settings.security,
      ...(settingsSource.security ?? {})
    }
  }

  if (settings.ai.provider !== 'openai' && settings.ai.provider !== 'anthropic') {
    settings.ai.provider = 'openai'
  }
  if (!settings.ai.baseUrl) settings.ai.baseUrl = fallback.settings.ai.baseUrl
  if (!settings.ai.model) settings.ai.model = fallback.settings.ai.model
  settings.pomodoro.focusMinutes = Math.min(
    180,
    Math.max(1, Math.round(Number(settings.pomodoro.focusMinutes) || 25))
  )
  settings.pomodoro.breakMinutes = Math.min(
    60,
    Math.max(1, Math.round(Number(settings.pomodoro.breakMinutes) || 5))
  )
  if (settings.general.theme !== 'light') settings.general.theme = 'dark'
  if (typeof settings.general.hotkey !== 'string' || !settings.general.hotkey.trim()) {
    settings.general.hotkey = fallback.settings.general.hotkey
  }
  if (settings.webdav.lastStatus !== 'success' && settings.webdav.lastStatus !== 'error') {
    settings.webdav.lastStatus = 'idle'
  }
  settings.webdav.enabled = Boolean(settings.webdav.enabled)
  settings.webdav.autoUpload = settings.webdav.autoUpload !== false
  settings.webdav.url = String(settings.webdav.url ?? '')
  settings.webdav.remotePath = String(
    settings.webdav.remotePath || fallback.settings.webdav.remotePath
  )
  settings.webdav.username = String(settings.webdav.username ?? '')
  settings.webdav.password = String(settings.webdav.password ?? '')
  settings.webdav.encryptionPassword = String(settings.webdav.encryptionPassword ?? '')
  settings.webdav.lastSyncAt =
    typeof settings.webdav.lastSyncAt === 'string' ? settings.webdav.lastSyncAt : null
  settings.webdav.lastError =
    typeof settings.webdav.lastError === 'string' ? settings.webdav.lastError : null
  settings.general.closeToTray = settings.general.closeToTray !== false
  settings.security.passwordHash = String(settings.security.passwordHash ?? '')
  settings.security.autoLockMinutes = Math.min(
    240,
    Math.max(0, Math.round(Number(settings.security.autoLockMinutes) || 0))
  )

  return { version: 1, groups, todos, settings }
}

export interface LoadedState {
  state: AppState
  exists: boolean
  mtimeMs: number
}

export function loadStateFile(file: string): LoadedState {
  if (!existsSync(file)) {
    return { state: createDefaultState(), exists: false, mtimeMs: 0 }
  }
  try {
    const content = readFileSync(file, 'utf8')
    const state = normaliseState(JSON.parse(content))
    return { state, exists: true, mtimeMs: statSync(file).mtimeMs }
  } catch (error) {
    try {
      copyFileSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      // 保留原始文件，失败时不影响应用启动
    }
    process.stderr.write(`[tomato-todo] 数据文件读取失败，已使用默认数据: ${String(error)}\n`)
    return { state: createDefaultState(), exists: true, mtimeMs: statSync(file).mtimeMs }
  }
}

export function saveStateFile(file: string, state: AppState): number {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(temp, file)
  return statSync(file).mtimeMs
}
