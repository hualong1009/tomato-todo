import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray
} from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { splitDataUrl } from '../shared/attachments'
import type {
  AddTodoInput,
  AIRequestResult,
  AISettings,
  AppEvent,
  AppSettings,
  FileActionResult,
  MarkdownExportInput,
  SecurityActionResult,
  SecurityState,
  SummaryRange,
  UpdateTodoPatch,
  WebDAVSettings
} from '../shared/types'
import { buildSummaryContext } from '../shared/summary'
import {
  archiveTodo,
  createGroup,
  createTodo,
  deleteGroup,
  deleteTodoPermanently,
  recordFocus,
  restoreTodo,
  setPinned,
  startTodo,
  updateGroup,
  updateTodo
} from '../shared/operations'
import { callAIChat, listAIModels, testAIConnection } from '../shared/aiClient'
import { appFetch } from './appFetch'
import {
  backupBeforeImport,
  normaliseMarkdownPath,
  readLocalBackupFile,
  writeLocalBackupFile,
  writeMarkdownExport
} from './localBackup'
import { hashPassword, verifyPassword } from './security'
import { AppStore, type SettingsPatch } from './store'
import { testWebDAV } from './webdav'

const isMcpMode = process.argv.includes('--mcp')
if (process.env.TOMATO_USER_DATA) {
  app.setPath('userData', process.env.TOMATO_USER_DATA)
} else {
  // 统一 dev 与安装版数据目录：productName 会把 userData 变成“番茄待办”，
  // 强制固定为 appData/tomato-todo，保证桌面版、MCP、独立入口共享同一份数据
  app.setPath('userData', join(app.getPath('appData'), 'tomato-todo'))
}
if (isMcpMode) app.disableHardwareAcceleration()

const dataFile = () => join(app.getPath('userData'), 'tomato-todo-data.json')

let store: AppStore | null = null
let mainWindow: BrowserWindow | null = null
let isQuitting = false
let pendingWarning: string | null = null
const stickyWindows = new Map<string, BrowserWindow>()
let tray: Tray | null = null
let trayHideNotified = false
let locked = false
let lastActivity = Date.now()
let lockTimer: NodeJS.Timeout | null = null

function getIconPath(): string | undefined {
  const candidates = [
    join(__dirname, '../renderer/icon.png'),
    join(app.getAppPath(), 'build/icon.png'),
    join(process.resourcesPath, 'icon.png')
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function sendEvent(event: AppEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:event', event)
  }
}

function broadcastState(): void {
  if (!store) return
  const state = store.getState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('state:changed', state)
  }
}

function getSecurityState(): SecurityState {
  const security = store?.getState().settings.security
  return {
    locked,
    hasPassword: Boolean(security?.passwordHash),
    autoLockMinutes: security?.autoLockMinutes ?? 0
  }
}

function broadcastSecurity(): void {
  const state = getSecurityState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('security:changed', state)
  }
}

function lockApp(): void {
  if (!store || locked) return
  if (!store.getState().settings.security.passwordHash) return
  locked = true
  // 便签窗口包含待办内容，锁定时隐藏（不关闭，解锁后恢复）
  for (const window of stickyWindows.values()) {
    if (!window.isDestroyed()) window.hide()
  }
  broadcastSecurity()
  rebuildTrayMenu()
}

function createTray(): void {
  if (tray) return
  const iconPath = getIconPath()
  if (!iconPath) return
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }))
  tray.setToolTip('番茄待办')
  tray.on('click', () => {
    lastActivity = Date.now()
    toggleMainWindow()
  })
  tray.on('double-click', () => {
    lastActivity = Date.now()
    toggleMainWindow()
  })
  rebuildTrayMenu()
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const template: Array<Electron.MenuItemConstructorOptions> = [
    { label: '显示主窗口', click: () => toggleMainWindow() }
  ]
  if (store?.getState().settings.security.passwordHash) {
    template.push({ label: '立即锁定', click: () => lockApp() })
  }
  template.push(
    { type: 'separator' },
    {
      label: '退出番茄待办',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  )
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function notifyTrayHide(): void {
  if (trayHideNotified || !tray || process.platform !== 'win32') return
  trayHideNotified = true
  tray.displayBalloon({
    title: '番茄待办',
    content: '应用已最小化到系统托盘，按快捷键或点击托盘图标可再次打开。'
  })
}

function loadRenderer(window: BrowserWindow, route = ''): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    window.loadURL(`${devUrl}${route ? `#${route}` : ''}`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), route ? { hash: route.slice(1) } : undefined)
  }
}

function attachWindowEvents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (!devUrl && url.startsWith('file:')) return
    event.preventDefault()
  })
  window.on('maximize', () => window.webContents.send('window:maximized-changed', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized-changed', false))
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#0a0d16',
    icon: getIconPath(),
    title: '番茄待办',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  Menu.setApplicationMenu(null)
  attachWindowEvents(window)
  window.on('close', (event) => {
    // 默认关闭 = 最小化到系统托盘，可在设置中关闭该行为
    if (isQuitting || !store?.getState().settings.general.closeToTray) return
    event.preventDefault()
    window.hide()
    notifyTrayHide()
  })
  window.on('ready-to-show', () => {
    window.show()
    if (pendingWarning) {
      window.webContents.send('app:event', {
        type: 'toast',
        message: pendingWarning,
        tone: 'error'
      })
      pendingWarning = null
    }
  })
  window.on('closed', () => {
    mainWindow = null
    if (!isQuitting) app.quit()
  })
  loadRenderer(window)
  return window
}

function defaultStickyBounds(): { x: number; y: number; width: number; height: number } {
  const area = screen.getPrimaryDisplay().workArea
  const width = 340
  const height = 300
  const offset = Math.min(stickyWindows.size * 26, 180)
  return {
    width,
    height,
    x: Math.max(area.x + 20, area.x + area.width - width - 28 - offset),
    y: Math.max(area.y + 20, area.y + 70 + offset)
  }
}

function boundsVisible(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      bounds.x + bounds.width > area.x &&
      bounds.x < area.x + area.width &&
      bounds.y + bounds.height > area.y &&
      bounds.y < area.y + area.height
    )
  })
}

function createStickyWindow(todoId: string): void {
  if (!store) return
  const existing = stickyWindows.get(todoId)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }
  const todo = store.getState().todos.find((item) => item.id === todoId)
  if (!todo || !todo.pinned || todo.archivedAt) return

  const saved = todo.stickyBounds
  const bounds = saved && boundsVisible(saved) ? saved : defaultStickyBounds()
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 250,
    minHeight: 200,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    show: false,
    title: todo.title,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  window.setAlwaysOnTop(true, 'floating')
  attachWindowEvents(window)
  stickyWindows.set(todoId, window)

  let saveTimer: NodeJS.Timeout | null = null
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (window.isDestroyed() || !store) return
      const next = window.getBounds()
      const current = store.getState().todos.find((item) => item.id === todoId)?.stickyBounds
      if (
        current &&
        current.x === next.x &&
        current.y === next.y &&
        current.width === next.width &&
        current.height === next.height
      ) {
        return
      }
      store.mutate((state) => {
        const item = state.todos.find((entry) => entry.id === todoId)
        if (item) item.stickyBounds = next
      })
    }, 500)
  }
  window.on('moved', persistBounds)
  window.on('resized', persistBounds)
  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (saveTimer) clearTimeout(saveTimer)
    stickyWindows.delete(todoId)
    if (!isQuitting && store) {
      const item = store.getState().todos.find((entry) => entry.id === todoId)
      if (item?.pinned) {
        store.mutate((state) => {
          const target = state.todos.find((entry) => entry.id === todoId)
          if (target) {
            target.pinned = false
            target.updatedAt = new Date().toISOString()
          }
        })
      }
    }
  })

  loadRenderer(window, `/sticky/${todoId}`)
}

function syncStickyWindows(): void {
  if (!store) return
  const state = store.getState()
  for (const [todoId, window] of [...stickyWindows.entries()]) {
    const todo = state.todos.find((item) => item.id === todoId)
    if (!todo || !todo.pinned || todo.archivedAt) {
      if (!window.isDestroyed()) window.close()
    }
  }
  for (const todo of state.todos) {
    if (todo.pinned && !todo.archivedAt && !stickyWindows.has(todo.id)) {
      createStickyWindow(todo.id)
    }
  }
}

function toggleMainWindow(): void {
  lastActivity = Date.now()
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function registerHotkey(accelerator: string): boolean {
  try {
    globalShortcut.unregisterAll()
    return globalShortcut.register(accelerator, toggleMainWindow)
  } catch {
    return false
  }
}

function setupInitialHotkey(): void {
  if (!store) return
  const accelerator = store.getState().settings.general.hotkey
  if (!registerHotkey(accelerator)) {
    const fallback = 'CommandOrControl+Shift+Space'
    if (accelerator !== fallback && registerHotkey(fallback)) {
      pendingWarning = `快捷键「${accelerator}」注册失败，已临时使用 ${fallback}。请在设置中更换。`
    } else {
      pendingWarning = `快捷键「${accelerator}」注册失败，可能被其他应用占用。请在设置中更换。`
    }
  }
}

function registerIpc(): void {
  if (!store) return
  const appStore = store

  ipcMain.handle('state:get', () => appStore.getState())

  ipcMain.handle('todo:add', (_event, input: AddTodoInput) => {
    appStore.mutate((state) => createTodo(state, input))
    return appStore.getState()
  })

  ipcMain.handle('todo:update', (_event, id: string, patch: UpdateTodoPatch) => {
    appStore.mutate((state) => updateTodo(state, id, patch))
    return appStore.getState()
  })

  ipcMain.handle('todo:toggle', (_event, id: string, completed: boolean) => {
    appStore.mutate((state) => updateTodo(state, id, { completed }))
    return appStore.getState()
  })

  ipcMain.handle('todo:start', (_event, id: string) => {
    appStore.mutate((state) => startTodo(state, id))
    return appStore.getState()
  })

  ipcMain.handle('todo:archive', (_event, id: string) => {
    appStore.mutate((state) => archiveTodo(state, id))
    return appStore.getState()
  })

  ipcMain.handle('todo:restore', (_event, id: string) => {
    appStore.mutate((state) => restoreTodo(state, id))
    return appStore.getState()
  })

  ipcMain.handle('todo:delete-forever', (_event, id: string) => {
    appStore.mutate((state) => deleteTodoPermanently(state, id))
    return appStore.getState()
  })

  ipcMain.handle('todo:record-focus', (_event, id: string, minutes: number) => {
    appStore.mutate((state) => recordFocus(state, id, minutes))
    return appStore.getState()
  })

  ipcMain.handle('todo:set-pinned', (_event, id: string, pinned: boolean) => {
    appStore.mutate((state) => setPinned(state, id, pinned))
    return appStore.getState()
  })

  ipcMain.handle('group:add', (_event, name: string) => {
    appStore.mutate((state) => createGroup(state, name))
    return appStore.getState()
  })

  ipcMain.handle('group:update', (_event, id: string, patch: { name?: string; color?: string }) => {
    appStore.mutate((state) => updateGroup(state, id, patch))
    return appStore.getState()
  })

  ipcMain.handle('group:delete', (_event, id: string) => {
    appStore.mutate((state) => deleteGroup(state, id))
    return appStore.getState()
  })

  ipcMain.handle('settings:update', (_event, rawPatch: Partial<AppSettings>) => {
    const patch: SettingsPatch = JSON.parse(JSON.stringify(rawPatch ?? {}))
    if (patch.webdav) {
      delete patch.webdav.lastSyncAt
      delete patch.webdav.lastStatus
      delete patch.webdav.lastError
    }
    let warning: string | undefined
    const currentHotkey = appStore.getState().settings.general.hotkey
    const nextHotkey = patch.general?.hotkey?.trim()
    if (nextHotkey && nextHotkey !== currentHotkey) {
      if (registerHotkey(nextHotkey)) {
        // 新快捷键已生效
      } else {
        registerHotkey(currentHotkey)
        patch.general = { ...(patch.general ?? ({} as AppSettings['general'])), hotkey: currentHotkey }
        warning = `快捷键「${nextHotkey}」注册失败，可能被其他应用占用，已保留原快捷键。`
      }
    }
    const result = appStore.updateSettings(patch)
    lastActivity = Date.now()
    rebuildTrayMenu()
    return { ...result, warning }
  })

  ipcMain.handle('ai:test', async (_event, ai: AISettings): Promise<AIRequestResult> => {
    try {
      const content = await testAIConnection(ai, appFetch)
      return { ok: true, content, generatedAt: new Date().toISOString(), model: ai.model }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'AI 连接测试失败' }
    }
  })

  ipcMain.handle('ai:models', async (_event, ai: AISettings) => {
    try {
      const models = await listAIModels(ai, appFetch)
      return { ok: true, models }
    } catch (error) {
      return {
        ok: false,
        models: [],
        error: error instanceof Error ? error.message : '获取模型列表失败'
      }
    }
  })

  ipcMain.handle('ai:summarise', async (_event, range: SummaryRange): Promise<AIRequestResult> => {
    if (!['week', 'month', 'year'].includes(range)) {
      return { ok: false, error: '时间范围不正确' }
    }
    const settings = appStore.getState().settings.ai
    if (!settings.apiKey.trim()) {
      return { ok: false, error: '请先在设置中配置 AI 接口和 API 密钥' }
    }
    try {
      const context = buildSummaryContext(appStore.getState(), range)
      const content = await callAIChat(
        settings,
        [
          {
            role: 'system',
            content:
              '你是个人生产力回顾助手。严格依据用户提供的数据输出中文 Markdown，不编造不存在的事实。'
          },
          { role: 'user', content: context.prompt }
        ],
        { fetchImpl: appFetch }
      )
      return {
        ok: true,
        content,
        generatedAt: new Date().toISOString(),
        model: settings.model
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'AI 总结生成失败' }
    }
  })

  ipcMain.handle('webdav:test', async (_event, settings: WebDAVSettings) => testWebDAV(settings, appFetch))
  ipcMain.handle('webdav:upload', async () => appStore.uploadToWebDAV())
  ipcMain.handle('webdav:restore', async () => {
    const result = await appStore.restoreFromWebDAV()
    if (result.ok) syncStickyWindows()
    return result
  })


  ipcMain.handle('export:markdown', async (event, input: MarkdownExportInput): Promise<FileActionResult> => {
    const state = appStore.getState()
    const scope = input?.scope === 'selected' ? 'selected' : 'all'
    const todoIds = scope === 'selected' ? (input.todoIds ?? []) : null
    if (scope === 'selected' && (!todoIds || todoIds.length === 0)) {
      return { ok: false, message: '没有选中要导出的待办' }
    }
    let target = input?.path?.trim() ?? ''
    if (!target) {
      const window = BrowserWindow.fromWebContents(event.sender)
      const stamp = new Date().toISOString().slice(0, 10)
      const suggested = scope === 'selected'
        ? `番茄待办-${stamp}.md`
        : `番茄待办全部-${stamp}.md`
      const result = await dialog.showSaveDialog(window ?? mainWindow ?? undefined!, {
        title: '导出为 Markdown',
        defaultPath: join(app.getPath('documents'), suggested),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, message: '已取消导出' }
      target = result.filePath
    }
    try {
      const written = writeMarkdownExport(target, state, todoIds, {
        includeArchived: input?.includeArchived !== false,
        title: scope === 'selected' ? '番茄待办导出' : '番茄待办 · 全部待办'
      })
      const imageNote = written.imageCount > 0 ? `，${written.imageCount} 张图片写入 attachments/` : ''
      const fileNote = written.attachmentCount > 0 ? `，${written.attachmentCount} 个附件一并导出` : ''
      return {
        ok: true,
        message: `已导出 ${written.todoCount} 条待办到 ${basename(written.path)}${imageNote}${fileNote}`,
        path: written.path
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '导出 Markdown 失败' }
    }
  })

  ipcMain.handle('attachment:save', async (event, input: { name: string; dataUrl: string }): Promise<FileActionResult> => {
    const name = (input?.name ?? '').trim() || 'attachment'
    const parts = splitDataUrl(input?.dataUrl ?? '')
    if (!parts || !parts.base64) return { ok: false, message: '附件内容无效，无法保存' }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(window ?? mainWindow ?? undefined!, {
      title: '保存附件',
      defaultPath: join(app.getPath('downloads'), name),
      filters: [{ name: '全部文件', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, message: '已取消保存' }
    try {
      writeFileSync(result.filePath, Buffer.from(parts.base64, 'base64'))
      return { ok: true, message: `已保存到 ${basename(result.filePath)}`, path: result.filePath }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '保存附件失败' }
    }
  })

  ipcMain.handle('backup:export', async (event, options?: { path?: string }): Promise<FileActionResult> => {
    const state = appStore.getState()
    const password = state.settings.localBackup.password
    if (!password.trim()) {
      return { ok: false, message: '请先在设置中填写本地备份密码，备份会用它加密' }
    }
    let target = options?.path?.trim() ?? ''
    if (!target) {
      const window = BrowserWindow.fromWebContents(event.sender)
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const result = await dialog.showSaveDialog(window ?? mainWindow ?? undefined!, {
        title: '导出本地加密备份',
        defaultPath: join(app.getPath('documents'), `番茄待办备份-${stamp}.ttbak`),
        filters: [{ name: '番茄待办备份', extensions: ['ttbak'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, message: '已取消备份' }
      target = result.filePath
    }
    try {
      const written = writeLocalBackupFile(target, state, password)
      const now = new Date().toISOString()
      appStore.updateSettings({
        localBackup: { ...state.settings.localBackup, lastBackupAt: now }
      })
      return {
        ok: true,
        message: `已导出加密备份 ${basename(written.path)}（${Math.round(written.size / 1024)} KB）`,
        path: written.path
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '导出本地备份失败' }
    }
  })

  ipcMain.handle('backup:import', async (event, options?: { path?: string }): Promise<FileActionResult> => {
    const state = appStore.getState()
    let source = options?.path?.trim() ?? ''
    if (!source) {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(window ?? mainWindow ?? undefined!, {
        title: '导入本地备份',
        properties: ['openFile'],
        filters: [
          { name: '番茄待办备份', extensions: ['ttbak', 'json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, message: '已取消导入' }
      }
      source = result.filePaths[0]
    }
    try {
      const payload = readLocalBackupFile(source, state.settings.localBackup.password)
      backupBeforeImport(dataFile())
      const applied = appStore.replaceTodosFromRemote(payload, '本地备份')
      if (!applied.ok) return { ok: false, message: applied.message }
      syncStickyWindows()
      return {
        ok: true,
        message: `已从 ${basename(source)} 导入 ${payload.todos.length} 条待办`,
        path: source
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '导入本地备份失败' }
    }
  })

  ipcMain.handle('mcp:info', () => {
    // Windows 上 Electron 主进程的 stdio 管道不可用，MCP 服务器必须
    // 以 ELECTRON_RUN_AS_NODE 模式运行自包含入口 out/mcp-entry.cjs
    const command = process.execPath
    const entry = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'mcp-entry.cjs')
      : join(app.getAppPath(), 'out', 'mcp-entry.cjs')
    const args = [entry]
    const config = JSON.stringify(
      {
        mcpServers: {
          'tomato-todo': { command, args, env: { ELECTRON_RUN_AS_NODE: '1' } }
        }
      },
      null,
      2
    )
    return { command, args, config, dataFile: dataFile() }
  })

  ipcMain.handle('security:get-state', () => getSecurityState())

  ipcMain.on('security:activity', () => {
    lastActivity = Date.now()
  })

  ipcMain.handle('security:unlock', (_event, password: unknown): SecurityActionResult => {
    if (!locked) return { ok: true, state: getSecurityState() }
    const hash = appStore.getState().settings.security.passwordHash
    if (!hash) {
      locked = false
      broadcastSecurity()
      return { ok: true, state: getSecurityState() }
    }
    if (verifyPassword(String(password ?? ''), hash)) {
      locked = false
      lastActivity = Date.now()
      for (const window of stickyWindows.values()) {
        if (!window.isDestroyed()) window.show()
      }
      broadcastSecurity()
      rebuildTrayMenu()
      return { ok: true, state: getSecurityState() }
    }
    return { ok: false, message: '密码不正确', state: getSecurityState() }
  })

  ipcMain.handle('security:lock', (): SecurityActionResult => {
    lockApp()
    return {
      ok: locked,
      message: locked ? undefined : '请先设置管理员密码',
      state: getSecurityState()
    }
  })

  ipcMain.handle(
    'security:set-password',
    (_event, input: { currentPassword?: string; newPassword?: string }): SecurityActionResult => {
      const security = appStore.getState().settings.security
      if (security.passwordHash) {
        if (!input.currentPassword || !verifyPassword(input.currentPassword, security.passwordHash)) {
          return { ok: false, message: '当前密码不正确', state: getSecurityState() }
        }
      }
      const newPassword = input.newPassword ?? ''
      if (newPassword) {
        if (newPassword.length < 4) {
          return { ok: false, message: '密码至少需要 4 位', state: getSecurityState() }
        }
        appStore.updateSettings({
          security: { ...security, passwordHash: hashPassword(newPassword) }
        })
        lastActivity = Date.now()
        broadcastSecurity()
        rebuildTrayMenu()
        return { ok: true, message: '管理员密码已更新', state: getSecurityState() }
      }
      if (locked) {
        return { ok: false, message: '请先解锁应用', state: getSecurityState() }
      }
      appStore.updateSettings({
        security: { ...security, passwordHash: '' }
      })
      broadcastSecurity()
      rebuildTrayMenu()
      return { ok: true, message: '管理员密码已清除', state: getSecurityState() }
    }
  )

  ipcMain.handle('app:reset', (_event, password?: string) => {
    const security = appStore.getState().settings.security
    if (security.passwordHash) {
      if (!password || !verifyPassword(password, security.passwordHash)) {
        return { ok: false, message: '管理员密码不正确' }
      }
    }
    appStore.resetApp()
    locked = false
    lastActivity = Date.now()
    broadcastSecurity()
    rebuildTrayMenu()
    setupInitialHotkey()
    return { ok: true, message: '应用已重置' }
  })

  ipcMain.handle('sticky:close', (_event, todoId: string) => {
    const window = stickyWindows.get(todoId)
    const todo = appStore.getState().todos.find((item) => item.id === todoId)
    if (todo?.pinned) appStore.mutate((state) => setPinned(state, todoId, false))
    if (window && !window.isDestroyed()) window.close()
    return appStore.getState()
  })

  ipcMain.handle('sticky:open-main', (_event, todoId: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('app:event', { type: 'select-todo', todoId })
  })

  ipcMain.handle('app:copy', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
  })

  ipcMain.handle('app:notify', (_event, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title: String(title), body: String(body), icon: getIconPath() }).show()
    }
  })

  ipcMain.handle('app:open-external', async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

function setupApp(): void {
  app.setAppUserModelId('com.tomato.todo')
  Menu.setApplicationMenu(null)
  store = new AppStore(dataFile(), appFetch)
  store.onStateChanged = () => {
    broadcastState()
    syncStickyWindows()
  }
  store.onToast = (message, tone = 'info') => sendEvent({ type: 'toast', message, tone })
  registerIpc()
  mainWindow = createMainWindow()
  syncStickyWindows()
  setupInitialHotkey()
  createTray()

  lockTimer = setInterval(() => {
    if (!store || locked) return
    const security = store.getState().settings.security
    if (
      security.passwordHash &&
      security.autoLockMinutes > 0 &&
      Date.now() - lastActivity >= security.autoLockMinutes * 60_000
    ) {
      lockApp()
    }
  }, 10_000)

  app.on('before-quit', () => {
    isQuitting = true
  })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    if (lockTimer) clearInterval(lockTimer)
    tray?.destroy()
    tray = null
    store?.dispose()
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  app.on('activate', () => {
    if (!mainWindow) mainWindow = createMainWindow()
    mainWindow.show()
  })
}

if (!isMcpMode) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (!mainWindow) mainWindow = createMainWindow()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    })
    app.whenReady().then(() => setupApp())
  }
} else {
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide()
    const { runMcpStdio } = await import('../mcp/stdio')
    await runMcpStdio(dataFile(), () => app.quit())
  })
}
