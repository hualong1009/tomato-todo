import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_GROUP_ID, URGENCY_META } from '@shared/defaults'
import type {
  AddTodoInput,
  AppSettings,
  AppState,
  SecurityState,
  SummaryRange,
  Todo,
  UpdateTodoPatch
} from '@shared/types'
import { isOverdue, STATUS_META } from '@shared/todoUtils'
import { RELEASES_URL } from '@shared/updates'
import { AIPanel } from './components/AIPanel'
import { ConfirmDialog, NameDialog, Toast, type ToastState } from './components/Dialogs'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { DetailPanel } from './components/DetailPanel'
import { LockOverlay } from './components/LockOverlay'
import {
  AlertIcon,
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudCheckIcon,
  CloudIcon,
  CloudOffIcon,
  DownloadIcon,
  FolderIcon,
  LayersIcon,
  MenuIcon,
  MoonIcon,
  PinIcon,
  PlayIcon,
  PlusIcon,
  ResetIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  TimerIcon,
  TomatoIcon,
  TrashIcon,
  XIcon,
  SystemIcon
} from './components/Icons'
import { PomodoroMini, PomodoroOverlay, type PomodoroState } from './components/PomodoroOverlay'
import { SettingsModal } from './components/SettingsModal'
import { isMobile } from './platform'
import { dismissTopOverlay, exitMobileApp, installBackButton } from './platform/backNavigation'
import { BottomSheet } from './components/BottomSheet'
import { MobileViewSheet } from './components/MobileViewSheet'
import { Sidebar, type ViewKey } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { TodoComposer } from './components/TodoComposer'
import { TodoList, type TodoSection } from './components/TodoList'
import { UpdateDialog } from './components/UpdateDialog'
import {
  cleanError,
  formatClock,
  syncStatusDetail,
  syncStatusLabel,
  type SyncIndicatorSource
} from './utils/format'

interface ConfirmState {
  title: string
  message: string
  label: string
  danger?: boolean
  action: () => Promise<void>
}

interface GroupDialogState {
  mode: 'add' | 'rename'
  groupId?: string
  initial?: string
}

const URGENCY_ORDER = { urgent: 4, high: 3, medium: 2, low: 1 }

function sortTodos(a: Todo, b: Todo, archived = false): number {
  if (archived) {
    return Date.parse(b.archivedAt ?? b.updatedAt) - Date.parse(a.archivedAt ?? a.updatedAt)
  }
  if (Boolean(a.completedAt) !== Boolean(b.completedAt)) return a.completedAt ? 1 : -1
  if (!a.completedAt && !b.completedAt) {
    const urgency = URGENCY_ORDER[b.urgency] - URGENCY_ORDER[a.urgency]
    if (urgency !== 0) return urgency
    const aExpected = a.expectedAt ? Date.parse(a.expectedAt) : Number.MAX_SAFE_INTEGER
    const bExpected = b.expectedAt ? Date.parse(b.expectedAt) : Number.MAX_SAFE_INTEGER
    if (aExpected !== bExpected) return aExpected - bExpected
    return Date.parse(b.createdAt) - Date.parse(a.createdAt)
  }
  return Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt)
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [view, setView] = useState<ViewKey>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [aiOpen, setAiOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null)
  const updateChecked = useRef(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [context, setContext] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [groupDialog, setGroupDialog] = useState<GroupDialogState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [pomodoro, setPomodoro] = useState<PomodoroState | null>(null)
  const [pomodoroOpen, setPomodoroOpen] = useState(false)
  const [security, setSecurity] = useState<SecurityState | null>(null)
  const [viewSheet, setViewSheet] = useState(false)
  const [composerSheet, setComposerSheet] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const composerRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const completingRef = useRef(false)
  const pomodoroRef = useRef<PomodoroState | null>(null)
  const stateRef = useRef<AppState | null>(null)
  pomodoroRef.current = pomodoro
  stateRef.current = state
  const viewRef = useRef<ViewKey>(view)
  viewRef.current = view
  const searchOpenRef = useRef(false)
  searchOpenRef.current = searchOpen
  const securityRef = useRef<SecurityState | null>(null)
  securityRef.current = security

  const showToast = useCallback(
    (message: string, tone: 'info' | 'success' | 'error' = 'info') => {
      setToast({ id: Date.now(), message, tone })
    },
    []
  )

  const checkUpdates = useCallback(async (manual: boolean) => {
    try {
      const result = await window.api.checkForUpdates()
      if (result.status === 'available') {
        if (manual || result.version !== stateRef.current?.settings.general.ignoredUpdateVersion) {
          if (manual) setSettingsOpen(false)
          setAvailableUpdate(result.version)
        }
      } else if (manual) {
        showToast(
          result.status === 'up-to-date' ? '当前已是最新版本' : result.message,
          result.status === 'error' ? 'error' : 'success'
        )
      }
    } catch {
      if (manual) showToast('无法连接 GitHub，请检查网络后重试', 'error')
    }
  }, [showToast])

  const runAction = useCallback(
    async (action: () => Promise<AppState>): Promise<boolean> => {
      try {
        const next = await action()
        setState(next)
        return true
      } catch (error) {
        showToast(cleanError(error), 'error')
        return false
      }
    },
    [showToast]
  )

  useEffect(() => {
    void window.api.getState().then(setState)
    const unsubscribeState = window.api.onStateChanged(setState)
    const unsubscribeEvents = window.api.onEvent((event) => {
      if (event.type === 'toast') showToast(event.message, event.tone)
      if (event.type === 'select-todo') {
        setSelectedId(event.todoId)
        setView('all')
      }
    })
    const unsubscribeMax = window.api.onMaximizedChanged(setMaximized)
    void window.api.windowIsMaximized().then(setMaximized)
    const unsubscribeSecurity = window.api.onSecurityChanged(setSecurity)
    void window.api.getSecurityState().then(setSecurity)
    return () => {
      unsubscribeState()
      unsubscribeEvents()
      unsubscribeMax()
      unsubscribeSecurity()
    }
  }, [showToast])

  // 每次启动只检查一次；离线/限流时静默失败。锁定状态下不弹出更新提示。
  useEffect(() => {
    if (!state || !security || security.locked || updateChecked.current) return
    const timer = window.setTimeout(() => {
      if (updateChecked.current) return
      updateChecked.current = true
      void checkUpdates(false)
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [Boolean(state), security?.locked, checkUpdates])

  // 上报用户活动，主进程据此计算空闲自动锁定
  const lastActivitySent = useRef(0)
  useEffect(() => {
    const report = () => {
      const now = Date.now()
      if (now - lastActivitySent.current < 5000) return
      lastActivitySent.current = now
      window.api.reportActivity()
    }
    window.addEventListener('pointerdown', report, true)
    window.addEventListener('keydown', report, true)
    return () => {
      window.removeEventListener('pointerdown', report, true)
      window.removeEventListener('keydown', report, true)
    }
  }, [])

  // 「跟随系统」主题：监听系统深浅色变化，换算成实际生效的主题
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const themeSetting = state?.settings.general.theme ?? 'system'
  const effectiveTheme =
    themeSetting === 'system' ? (systemDark ? 'dark' : 'light') : themeSetting
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
  }, [effectiveTheme])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (selectedId && state && !state.todos.some((todo) => todo.id === selectedId)) {
      setSelectedId(null)
    }
  }, [selectedId, state])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        composerRef.current?.focus()
      } else if (meta && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (meta && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      } else if (meta && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setAiOpen(true)
      } else if (event.key === 'Escape') {
        if (context) setContext(null)
        else if (aiOpen) setAiOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [context, aiOpen])

  // Android 返回键：先逐个关闭已打开的浮层（浮层自己注册，见 platform/backNavigation），
  // 再退出搜索 / 分组视图，最后才退出应用。锁定状态下返回不生效。
  useEffect(() => {
    let dispose: (() => void) | null = null
    let cancelled = false
    void installBackButton(() => {
      if (securityRef.current?.locked && securityRef.current.hasPassword) return
      if (dismissTopOverlay()) return
      if (searchOpenRef.current) {
        setSearchOpen(false)
        setSearch('')
        return
      }
      if (viewRef.current !== 'all') {
        setView('all')
        return
      }
      void exitMobileApp()
    }).then((cleanup) => {
      if (cancelled) cleanup?.()
      else dispose = cleanup
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  useEffect(() => {
    if (!pomodoro?.running || !pomodoro.endsAt) return
    const timer = setInterval(() => {
      setPomodoro((previous) => {
        if (!previous?.endsAt) return previous
        const remaining = Math.max(0, Math.ceil((previous.endsAt - Date.now()) / 1000))
        return { ...previous, remaining }
      })
    }, 250)
    return () => clearInterval(timer)
  }, [pomodoro?.running, pomodoro?.endsAt])

  useEffect(() => {
    document.title = pomodoro
      ? `${formatClock(pomodoro.remaining)} · ${pomodoro.phase === 'focus' ? '专注' : '休息'}`
      : '番茄待办'
  }, [pomodoro?.remaining, pomodoro?.phase])

  const finishPhase = useCallback(async () => {
    const current = pomodoroRef.current
    const appState = stateRef.current
    if (!current || !appState) return
    const focusPhase = current.phase === 'focus'
    const todo = appState.todos.find((item) => item.id === current.todoId)
    if (focusPhase) {
      const minutes = Math.round(current.total / 60)
      const ok = await runAction(() => window.api.recordFocus(current.todoId, minutes))
      if (ok) {
        void window.api.notify(
          '番茄专注完成',
          `${todo?.title ?? '专注任务'} · 已记录 ${minutes} 分钟专注`
        )
        showToast(`专注完成，已记录 ${minutes} 分钟`, 'success')
      }
    } else {
      void window.api.notify('休息结束', '可以开始下一轮专注了')
      showToast('休息结束，准备下一轮专注', 'success')
    }
    const nextPhase = focusPhase ? 'break' : 'focus'
    const nextMinutes = focusPhase
      ? appState.settings.pomodoro.breakMinutes
      : appState.settings.pomodoro.focusMinutes
    const nextTotal = Math.max(1, Math.round(nextMinutes)) * 60
    setPomodoro({
      ...current,
      phase: nextPhase,
      total: nextTotal,
      remaining: nextTotal,
      running: false,
      endsAt: null,
      completedFocus: current.completedFocus + (focusPhase ? 1 : 0)
    })
    window.setTimeout(() => {
      completingRef.current = false
    }, 300)
  }, [runAction, showToast])

  useEffect(() => {
    if (!pomodoro || !pomodoro.running || pomodoro.remaining > 0) return
    if (completingRef.current) return
    completingRef.current = true
    void finishPhase()
  }, [pomodoro?.remaining, pomodoro?.running, finishPhase])

  const addTodo = async (input: AddTodoInput): Promise<boolean> => {
    return runAction(() => window.api.addTodo(input))
  }

  const updateTodo = async (id: string, patch: UpdateTodoPatch): Promise<boolean> => {
    return runAction(() => window.api.updateTodo(id, patch))
  }

  const toggleTodo = async (todo: Todo, completed: boolean) => {
    const ok = await runAction(() => window.api.toggleTodo(todo.id, completed))
    if (ok) {
      showToast(completed ? '已完成，实际完成时间已记录' : '已恢复为未完成', 'success')
    }
  }

  const startTodo = async (todo: Todo) => {
    const ok = await runAction(() => window.api.startTodo(todo.id))
    if (ok) showToast('任务已开始，状态切换为进行中', 'success')
  }

  const pinTodo = async (todo: Todo) => {
    if (isMobile) return // 桌面便签窗口仅在 Electron 中存在
    const ok = await runAction(() => window.api.setPinned(todo.id, !todo.pinned))
    if (ok) showToast(todo.pinned ? '已取消桌面便签' : '已固定到桌面便签', 'success')
  }

  const archiveTodo = async (todo: Todo) => {
    const ok = await runAction(() => window.api.archiveTodo(todo.id))
    if (ok) {
      setSelectedId(null)
      showToast('已归档，灰色显示且不会进入 AI 回顾', 'success')
    }
  }

  const restoreTodo = async (todo: Todo) => {
    const ok = await runAction(() => window.api.restoreTodo(todo.id))
    if (ok) showToast('已恢复到待办列表', 'success')
  }

  const requestDeleteForever = (todo: Todo) => {
    setConfirm({
      title: '永久删除待办',
      message: `「${todo.title}」将被永久删除，无法恢复。归档才是默认的删除方式。`,
      label: '永久删除',
      danger: true,
      action: async () => {
        const ok = await runAction(() => window.api.deleteTodoForever(todo.id))
        if (ok) {
          setSelectedId(null)
          showToast('已永久删除', 'success')
        }
      }
    })
  }

  const startPomodoro = (todo: Todo) => {
    if (todo.archivedAt) return showToast('归档的待办需要先恢复', 'error')
    if (todo.completedAt) return showToast('已完成的待办不能开始专注', 'error')
    const appState = stateRef.current
    if (!appState) return
    const minutes = Math.max(1, appState.settings.pomodoro.focusMinutes)
    setPomodoro({
      todoId: todo.id,
      phase: 'focus',
      total: minutes * 60,
      remaining: minutes * 60,
      running: true,
      endsAt: Date.now() + minutes * 60 * 1000,
      completedFocus: 0
    })
    setPomodoroOpen(true)
    if (!todo.startedAt) {
      void runAction(() => window.api.startTodo(todo.id))
      showToast('已进入专注，任务同时标记为进行中', 'success')
    } else {
      showToast('已进入专注模式', 'success')
    }
  }

  const togglePomodoroRun = () => {
    setPomodoro((previous) => {
      if (!previous) return previous
      if (previous.running) {
        const remaining = previous.endsAt
          ? Math.max(0, Math.ceil((previous.endsAt - Date.now()) / 1000))
          : previous.remaining
        return { ...previous, running: false, endsAt: null, remaining }
      }
      return { ...previous, running: true, endsAt: Date.now() + previous.remaining * 1000 }
    })
  }

  const resetPomodoro = () => {
    setPomodoro((previous) =>
      previous ? { ...previous, remaining: previous.total, running: false, endsAt: null } : previous
    )
    completingRef.current = false
  }

  const skipPomodoro = () => {
    const current = pomodoroRef.current
    const appState = stateRef.current
    if (!current || !appState) return
    const nextPhase = current.phase === 'focus' ? 'break' : 'focus'
    const minutes =
      nextPhase === 'focus'
        ? appState.settings.pomodoro.focusMinutes
        : appState.settings.pomodoro.breakMinutes
    const total = Math.max(1, Math.round(minutes)) * 60
    setPomodoro({ ...current, phase: nextPhase, total, remaining: total, running: false, endsAt: null })
    completingRef.current = false
  }

  const closePomodoro = () => {
    setPomodoro(null)
    setPomodoroOpen(false)
    completingRef.current = false
  }

  const saveSettings = async (settings: AppSettings): Promise<{ ok: boolean; warning?: string }> => {
    try {
      const result = await window.api.updateSettings(settings)
      setState(result.state)
      return { ok: true, warning: result.warning }
    } catch (error) {
      showToast(cleanError(error), 'error')
      return { ok: false }
    }
  }

  const quickUpdateSettings = async (patch: Partial<AppSettings>) => {
    try {
      const result = await window.api.updateSettings(patch)
      setState(result.state)
      if (result.warning) showToast(result.warning, 'error')
    } catch (error) {
      showToast(cleanError(error), 'error')
    }
  }

  const openGroupMenu = (event: React.MouseEvent, groupId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const group = state?.groups.find((item) => item.id === groupId)
    if (!group) return
    const items: MenuItem[] = [
      {
        id: 'rename',
        label: '重命名分组',
        icon: <SettingsIcon size={15} />,
        onClick: () => setGroupDialog({ mode: 'rename', groupId, initial: group.name })
      },
      {
        id: 'delete',
        label: '删除分组',
        icon: <TrashIcon size={15} />,
        danger: true,
        disabled: groupId === DEFAULT_GROUP_ID,
        onClick: () => {
          setConfirm({
            title: '删除分组',
            message: `删除「${group.name}」后，其中的待办会移入收件箱。`,
            label: '删除分组',
            danger: true,
            action: async () => {
              const ok = await runAction(() => window.api.deleteGroup(groupId))
              if (ok) {
                if (view === `group:${groupId}`) setView('all')
                showToast('分组已删除，待办已移入收件箱', 'success')
              }
            }
          })
        }
      }
    ]
    setContext({ x: event.clientX, y: event.clientY, items })
  }

  const exportTodoMarkdown = useCallback(
    async (todo: Todo) => {
      const result = await window.api.exportMarkdown({ scope: 'selected', todoIds: [todo.id] })
      showToast(result.message, result.ok ? 'success' : 'error')
    },
    [showToast]
  )

  const openTodoMenu = (event: React.MouseEvent, todo: Todo) => {
    event.preventDefault()
    event.stopPropagation()
    const items: MenuItem[] = []
    if (!todo.archivedAt) {
      items.push(
        {
          id: 'complete',
          label: todo.completedAt ? '取消完成' : '标记完成',
          icon: <CheckIcon size={15} />,
          onClick: () => void toggleTodo(todo, !todo.completedAt)
        },
        {
          id: 'start',
          label: '开始任务',
          icon: <PlayIcon size={13} />,
          disabled: Boolean(todo.completedAt || todo.startedAt),
          onClick: () => void startTodo(todo)
        },
        {
          id: 'focus',
          label: '开始番茄专注',
          icon: <TimerIcon size={15} />,
          disabled: Boolean(todo.completedAt),
          onClick: () => startPomodoro(todo)
        }
      )
      if (!isMobile) {
        items.push({
          id: 'pin',
          label: todo.pinned ? '取消桌面便签' : '固定到桌面便签',
          icon: <PinIcon size={15} filled={todo.pinned} />,
          onClick: () => void pinTodo(todo)
        })
      }
      items.push(
        { id: 'sep-1', type: 'separator' },
        {
          id: 'move',
          label: '移动到分组',
          children: (state?.groups ?? []).map((group) => ({
            id: `move-${group.id}`,
            label: group.name,
            checked: todo.groupId === group.id,
            onClick: () => void updateTodo(todo.id, { groupId: group.id })
          }))
        },
        { id: 'sep-2', type: 'separator' },
        {
          id: 'edit',
          label: '打开详情',
          icon: <SettingsIcon size={15} />,
          onClick: () => setSelectedId(todo.id)
        },
        {
          id: 'export-md',
          label: '导出为 Markdown',
          icon: <DownloadIcon size={15} />,
          onClick: () => void exportTodoMarkdown(todo)
        },
        {
          id: 'archive',
          label: '归档',
          icon: <ArchiveIcon size={15} />,
          onClick: () => void archiveTodo(todo)
        }
      )
    } else {
      items.push(
        {
          id: 'restore',
          label: '恢复待办',
          icon: <ResetIcon size={15} />,
          onClick: () => void restoreTodo(todo)
        },
        {
          id: 'delete',
          label: '永久删除',
          icon: <TrashIcon size={15} />,
          danger: true,
          onClick: () => requestDeleteForever(todo)
        }
      )
    }
    setContext({ x: event.clientX, y: event.clientY, items })
  }

  const activeGroup = view.startsWith('group:') ? state?.groups.find((group) => `group:${group.id}` === view) : undefined
  const defaultGroupId = activeGroup?.id ?? DEFAULT_GROUP_ID

  const listData = useMemo(() => {
    if (!state) {
      return { sections: [] as TodoSection[], archived: [] as Todo[], activeCount: 0 }
    }
    const query = search.trim().toLowerCase()
    const groupNames = new Map(state.groups.map((group) => [group.id, group.name.toLowerCase()]))
    const matches = (todo: Todo) => {
      if (!query) return true
      return (
        todo.title.toLowerCase().includes(query) ||
        todo.content.toLowerCase().includes(query) ||
        (groupNames.get(todo.groupId) ?? '').includes(query)
      )
    }
    const active = state.todos.filter((todo) => !todo.archivedAt && matches(todo))
    const archivedAll = state.todos.filter((todo) => todo.archivedAt && matches(todo))
    let activeFiltered = active
    let archivedFiltered: Todo[] = []

    if (view === 'all') {
      archivedFiltered = archivedAll
    } else if (view === 'not_started') {
      activeFiltered = active.filter((todo) => !todo.startedAt && !todo.completedAt)
    } else if (view === 'in_progress') {
      activeFiltered = active.filter((todo) => todo.startedAt && !todo.completedAt)
    } else if (view === 'overdue') {
      activeFiltered = active.filter((todo) => isOverdue(todo, now))
    } else if (view === 'completed') {
      activeFiltered = active.filter((todo) => Boolean(todo.completedAt))
    } else if (view === 'archived') {
      activeFiltered = []
      archivedFiltered = archivedAll
    } else if (view.startsWith('group:')) {
      const groupId = view.slice(6)
      activeFiltered = active.filter((todo) => todo.groupId === groupId)
      archivedFiltered = archivedAll.filter((todo) => todo.groupId === groupId)
    }

    activeFiltered = [...activeFiltered].sort((a, b) => sortTodos(a, b))
    archivedFiltered = [...archivedFiltered].sort((a, b) => sortTodos(a, b, true))

    let sections: TodoSection[] = []
    if (view === 'all') {
      sections = state.groups
        .map((group) => ({
          key: group.id,
          group,
          todos: activeFiltered.filter((todo) => todo.groupId === group.id)
        }))
        .filter((section) => section.todos.length > 0)
    } else if (view.startsWith('group:') && activeGroup) {
      sections = [{ key: activeGroup.id, group: activeGroup, todos: activeFiltered }]
    } else if (view !== 'archived') {
      sections = [{ key: 'flat', todos: activeFiltered }]
    }

    return {
      sections,
      archived: archivedFiltered,
      activeCount: activeFiltered.length
    }
  }, [state, search, view, now, activeGroup])

  if (!state) {
    return (
      <div className="splash">
        <div className="splash-glow" />
        <TomatoIcon size={58} />
        <h1>番茄待办</h1>
        <span className="spinner" />
      </div>
    )
  }

  const selectedTodo = selectedId ? state.todos.find((todo) => todo.id === selectedId) : undefined
  const pomodoroTodo = pomodoro ? state.todos.find((todo) => todo.id === pomodoro.todoId) : undefined
  const viewTitle =
    view === 'all'
      ? '全部待办'
      : view === 'not_started'
        ? '未开始'
        : view === 'in_progress'
          ? '进行中'
          : view === 'overdue'
            ? '未完成'
            : view === 'completed'
              ? '已完成'
              : view === 'archived'
                ? '已归档'
                : activeGroup?.name ?? '分组'
  const viewSubtitle =
    view === 'archived'
      ? '归档不是删除，灰色显示且不会进入 AI 回顾'
      : view === 'overdue'
        ? '超过期望完成时间且尚未完成的任务'
        : view === 'in_progress'
          ? '已点击开始或进入番茄专注的任务'
          : view === 'completed'
            ? '勾选完成时自动记录实际完成时间'
            : '按紧急程度与期望完成时间排序'
  const inProgressCount = state.todos.filter(
    (todo) => !todo.archivedAt && todo.startedAt && !todo.completedAt
  ).length
  const overdueCount = state.todos.filter(
    (todo) => !todo.archivedAt && isOverdue(todo, now)
  ).length
  const syncState: SyncIndicatorSource = {
    enabled: state.settings.webdav.enabled,
    status: state.settings.webdav.lastStatus,
    lastSyncAt: state.settings.webdav.lastSyncAt,
    lastError: state.settings.webdav.lastError
  }
  /** 手机端顶部栏只在真正配置了 WebDAV 时显示同步状态 */
  const showSyncPill = isMobile && state.settings.webdav.enabled && Boolean(state.settings.webdav.url.trim())

  const syncNow = async () => {
    if (syncBusy) return
    setSyncBusy(true)
    try {
      const result = await window.api.syncWebDAV()
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      showToast(cleanError(error), 'error')
    } finally {
      setSyncBusy(false)
    }
  }

  const todoListElement = (
    <TodoList
      sections={listData.sections}
      archivedTodos={listData.archived}
      archivedOnly={view === 'archived'}
      showGroupHeaders={view === 'all'}
      emptyText={
        view === 'archived'
          ? '还没有归档的待办'
          : search
            ? '没有匹配的待办'
            : view === 'completed'
              ? '还没有完成的待办'
              : '这里空空如也'
      }
      selectedId={selectedId}
      now={now}
      onSelect={setSelectedId}
      onToggle={toggleTodo}
      onStart={startTodo}
      onPin={pinTodo}
      onPomodoro={startPomodoro}
      onContext={openTodoMenu}
      onRestore={restoreTodo}
      onDeleteForever={requestDeleteForever}
    />
  )

  const detailPanelElement = selectedTodo ? (
    <DetailPanel
      todo={selectedTodo}
      state={state}
      now={now}
      onClose={() => setSelectedId(null)}
      onUpdate={updateTodo}
      onToggle={toggleTodo}
      onStart={startTodo}
      onPin={pinTodo}
      onPomodoro={startPomodoro}
      onArchive={archiveTodo}
      onRestore={restoreTodo}
      onDeleteForever={requestDeleteForever}
    />
  ) : null

  return (
    <div className={`app-root ${isMobile ? 'mobile-app' : ''}`}>
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <div className="noise" />
      {isMobile ? (
        <div className="mobile-shell">
          <header className="mobile-topbar">
            <button
              className="mobile-title-btn"
              onClick={() => setViewSheet(true)}
              data-testid="mobile-view-trigger"
            >
              <span className="mobile-title">{viewTitle}</span>
              <ChevronDownIcon size={15} />
            </button>
            <div className="mobile-topbar-actions">
              {showSyncPill && (
                <button
                  className={`mobile-sync-pill ${syncBusy ? 'idle' : syncState.status}`}
                  onClick={() => void syncNow()}
                  title={syncStatusDetail(syncState)}
                  aria-label={syncStatusDetail(syncState)}
                  data-testid="mobile-sync"
                >
                  {syncBusy ? (
                    <span className="spinner" />
                  ) : syncState.status === 'error' ? (
                    <CloudOffIcon size={13} />
                  ) : syncState.status === 'success' ? (
                    <CloudCheckIcon size={13} />
                  ) : (
                    <CloudIcon size={13} />
                  )}
                  <span className="mobile-sync-text">
                    {syncBusy ? '同步中' : syncStatusLabel(syncState)}
                  </span>
                </button>
              )}
              <button
                className={`header-icon-btn ${searchOpen ? 'active' : ''}`}
                onClick={() => {
                  setSearchOpen((value) => !value)
                  window.setTimeout(() => searchRef.current?.focus(), 30)
                }}
                title="搜索"
                data-testid="mobile-search-toggle"
              >
                {searchOpen ? <XIcon size={17} /> : <SearchIcon size={17} />}
              </button>
              <button
                className="header-icon-btn"
                onClick={() => setAiOpen(true)}
                title="AI 回顾"
                data-testid="mobile-ai"
              >
                <SparklesIcon size={18} />
              </button>
            </div>
          </header>

          {searchOpen && (
            <div className="mobile-search">
              <SearchIcon size={16} />
              <input
                ref={searchRef}
                placeholder="搜索标题或内容…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid="search-input"
              />
              {search && (
                <button className="search-clear" onClick={() => setSearch('')} aria-label="清空搜索">
                  <XIcon size={13} />
                </button>
              )}
            </div>
          )}

          <div className="mobile-summary">
            <span className="summary-pill">
              <strong>{listData.activeCount}</strong>
              {view === 'archived' ? ' 条归档' : ' 条待办'}
            </span>
            <span className="summary-pill blue">
              <PlayIcon size={11} />
              进行中 {inProgressCount}
            </span>
            <span className="summary-pill red">
              <AlertIcon size={12} />
              未完成 {overdueCount}
            </span>
          </div>

          <main className="mobile-main">{todoListElement}</main>

          {view !== 'archived' && (
            <button
              className="mobile-fab"
              onClick={() => setComposerSheet(true)}
              aria-label="新建待办"
              data-testid="mobile-fab"
            >
              <PlusIcon size={24} />
            </button>
          )}

          <nav className="mobile-tabbar" data-testid="mobile-tabbar">
            <button
              className={`mobile-tab ${!view.startsWith('group:') ? 'active' : ''}`}
              onClick={() => setView('all')}
              data-testid="mobile-tab-todos"
            >
              <LayersIcon size={19} />
              <span>待办</span>
            </button>
            <button
              className={`mobile-tab ${view.startsWith('group:') ? 'active' : ''}`}
              onClick={() => setViewSheet(true)}
              data-testid="mobile-tab-groups"
            >
              <FolderIcon size={19} />
              <span>分组</span>
            </button>
            <button className="mobile-tab" onClick={() => setAiOpen(true)} data-testid="mobile-tab-ai">
              <SparklesIcon size={19} />
              <span>回顾</span>
            </button>
            <button
              className="mobile-tab"
              onClick={() => setSettingsOpen(true)}
              data-testid="mobile-tab-settings"
            >
              <SettingsIcon size={19} />
              <span>我的</span>
            </button>
          </nav>

          {detailPanelElement}
        </div>
      ) : (
        <>
          <TitleBar
            maximized={maximized}
            syncState={syncState}
            miniTimer={
              pomodoro && !pomodoroOpen ? (
                <PomodoroMini session={pomodoro} todo={pomodoroTodo} onOpen={() => setPomodoroOpen(true)} />
              ) : undefined
            }
            onMinimize={() => void window.api.windowMinimize()}
            onToggleMaximize={() => void window.api.windowToggleMaximize().then(setMaximized)}
            onClose={() => void window.api.windowClose()}
          />
          <div className="app-layout">
            <Sidebar
              state={state}
              view={view}
              onView={setView}
              onAddGroup={() => setGroupDialog({ mode: 'add' })}
              onGroupMenu={openGroupMenu}
              onOpenAI={() => setAiOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
            <main className="main-pane">
              <header className="main-header">
                <div className="view-heading">
                  <span className="view-eyebrow">
                    {view === 'archived' ? 'ARCHIVE' : view.startsWith('group:') ? 'GROUP' : 'WORKSPACE'}
                  </span>
                  <h1>{viewTitle}</h1>
                  <p>{viewSubtitle}</p>
                </div>
                <div className="header-actions">
                  <div className="search-box">
                    <SearchIcon size={16} />
                    <input
                      ref={searchRef}
                      placeholder="搜索标题或内容…  Ctrl+F"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      data-testid="search-input"
                    />
                    {search && (
                      <button className="search-clear" onClick={() => setSearch('')} aria-label="清空搜索">
                        <XIcon size={13} />
                      </button>
                    )}
                  </div>
                  <button className="header-icon-btn ai" onClick={() => setAiOpen(true)} title="AI 回顾" data-testid="header-ai">
                    <SparklesIcon size={18} />
                  </button>
                  <button
                    className="header-icon-btn"
                    onClick={() =>
                      void quickUpdateSettings({
                        general: {
                          ...state.settings.general,
                          theme:
                            state.settings.general.theme === 'dark'
                              ? 'light'
                              : state.settings.general.theme === 'light'
                                ? 'system'
                                : 'dark'
                        }
                      })
                    }
                    title={
                      themeSetting === 'dark'
                        ? '当前深色，点击切换浅色'
                        : themeSetting === 'light'
                          ? '当前浅色，点击跟随系统'
                          : `当前跟随系统（${effectiveTheme === 'dark' ? '深色' : '浅色'}），点击切换深色`
                    }
                    data-testid="theme-toggle"
                  >
                    {themeSetting === 'dark' ? (
                      <MoonIcon size={17} />
                    ) : themeSetting === 'light' ? (
                      <SunIcon size={17} />
                    ) : (
                      <SystemIcon size={17} />
                    )}
                  </button>
                  <button className="header-icon-btn" onClick={() => setSettingsOpen(true)} title="设置" data-testid="header-settings">
                    <SettingsIcon size={18} />
                  </button>
                </div>
              </header>

              <div className="main-scroll">
                <div className="list-summary">
                  <div className="summary-pills">
                    <span className="summary-pill">
                      <strong>{listData.activeCount}</strong>
                      {view === 'archived' ? ' 条归档' : ' 条待办'}
                    </span>
                    <span className="summary-pill blue">
                      <PlayIcon size={11} />
                      进行中 {inProgressCount}
                    </span>
                    <span className="summary-pill red">
                      <AlertIcon size={12} />
                      未完成 {overdueCount}
                    </span>
                    {state.settings.webdav.enabled && (
                      <span className={`summary-pill ${state.settings.webdav.lastStatus === 'error' ? 'red' : 'green'}`}>
                        <TimerIcon size={11} />
                        {state.settings.webdav.lastStatus === 'success' ? 'WebDAV 已同步' : 'WebDAV 待同步'}
                      </span>
                    )}
                  </div>
                  <span className="summary-hint">
                    {search ? `搜索「${search}」` : `${state.groups.length} 个分组 · 归档不计入 AI`}
                  </span>
                </div>

                {view !== 'archived' && (
                  <TodoComposer ref={composerRef} groups={state.groups} defaultGroupId={defaultGroupId} onAdd={addTodo} />
                )}

                {todoListElement}
              </div>
            </main>

            {detailPanelElement}
          </div>
        </>
      )}

      {isMobile && pomodoro && !pomodoroOpen && (
        <div className="mobile-pomodoro-pill">
          <PomodoroMini session={pomodoro} todo={pomodoroTodo} onOpen={() => setPomodoroOpen(true)} />
        </div>
      )}

      {isMobile && (
        <>
          <BottomSheet
            open={viewSheet}
            title="视图与分组"
            subtitle="切换状态视图或按分组筛选"
            onClose={() => setViewSheet(false)}
          >
            <MobileViewSheet
              state={state}
              view={view}
              onView={(next) => {
                setView(next)
                setViewSheet(false)
              }}
              onAddGroup={() => {
                setViewSheet(false)
                setGroupDialog({ mode: 'add' })
              }}
              onGroupMenu={(event, groupId) => {
                setViewSheet(false)
                openGroupMenu(event, groupId)
              }}
            />
          </BottomSheet>

          <BottomSheet
            open={composerSheet}
            title="新建待办"
            subtitle="填好标题回车即可添加"
            tall
            onClose={() => setComposerSheet(false)}
          >
            <div className="sheet-composer">
              <TodoComposer
                ref={composerRef}
                groups={state.groups}
                defaultGroupId={defaultGroupId}
                onAdd={async (input) => {
                  const ok = await addTodo(input)
                  if (ok) setComposerSheet(false)
                  return ok
                }}
              />
            </div>
          </BottomSheet>
        </>
      )}

      <AIPanel
        open={aiOpen}
        state={state}
        onClose={() => setAiOpen(false)}
        onOpenSettings={() => {
          setAiOpen(false)
          setSettingsOpen(true)
        }}
        onToast={showToast}
      />

      <SettingsModal
        open={settingsOpen}
        settings={state.settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onToast={showToast}
        onCheckUpdates={() => checkUpdates(true)}
      />

      {pomodoro && pomodoroOpen && (
        <PomodoroOverlay
          session={pomodoro}
          todo={pomodoroTodo}
          onToggleRun={togglePomodoroRun}
          onReset={resetPomodoro}
          onSkip={skipPomodoro}
          onClose={closePomodoro}
          onCollapse={() => setPomodoroOpen(false)}
        />
      )}

      {context && (
        <ContextMenu x={context.x} y={context.y} items={context.items} onClose={() => setContext(null)} />
      )}

      <NameDialog
        open={Boolean(groupDialog)}
        title={groupDialog?.mode === 'rename' ? '重命名分组' : '新增分组'}
        initialValue={groupDialog?.initial ?? ''}
        placeholder="例如：工作、生活、阅读"
        submitLabel={groupDialog?.mode === 'rename' ? '保存' : '创建'}
        onClose={() => setGroupDialog(null)}
        onSubmit={async (name) => {
          try {
            if (groupDialog?.mode === 'rename' && groupDialog.groupId) {
              const next = await window.api.updateGroup(groupDialog.groupId, { name })
              setState(next)
              showToast('分组已重命名', 'success')
            } else {
              const next = await window.api.addGroup(name)
              setState(next)
              showToast('分组已创建', 'success')
            }
          } catch (error) {
            showToast(cleanError(error), 'error')
            throw error
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.label}
        danger={confirm?.danger}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          await confirm.action()
        }}
      />

      <UpdateDialog
        version={availableUpdate}
        onClose={() => setAvailableUpdate(null)}
        onIgnore={async () => {
          if (!availableUpdate || !stateRef.current) return
          try {
            const result = await window.api.updateSettings({
              general: {
                ...stateRef.current.settings.general,
                ignoredUpdateVersion: availableUpdate
              }
            })
            setState(result.state)
            setAvailableUpdate(null)
          } catch (error) {
            showToast(cleanError(error), 'error')
          }
        }}
        onOpenRelease={async () => {
          try {
            await window.api.openExternal(RELEASES_URL)
            setAvailableUpdate(null)
          } catch (error) {
            showToast(cleanError(error), 'error')
          }
        }}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />

      {security?.locked && security.hasPassword && <LockOverlay />}
    </div>
  )
}
