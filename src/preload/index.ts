import { contextBridge, ipcRenderer } from 'electron'
import type { TomatoAPI } from '../shared/api'
import type {
  AppEvent,
  AppState,
  MarkdownExportInput,
  SummaryRange,
  UpdateTodoPatch,
  WebDAVSettings
} from '../shared/types'

const api: TomatoAPI = {
  platform: process.platform,

  getState: () => ipcRenderer.invoke('state:get'),
  onStateChanged: (callback: (state: AppState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  onEvent: (callback: (event: AppEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppEvent) => callback(payload)
    ipcRenderer.on('app:event', listener)
    return () => ipcRenderer.removeListener('app:event', listener)
  },
  onMaximizedChanged: (callback: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => ipcRenderer.removeListener('window:maximized-changed', listener)
  },

  addTodo: (input) => ipcRenderer.invoke('todo:add', input),
  updateTodo: (id: string, patch: UpdateTodoPatch) =>
    ipcRenderer.invoke('todo:update', id, patch),
  toggleTodo: (id: string, completed: boolean) => ipcRenderer.invoke('todo:toggle', id, completed),
  startTodo: (id: string) => ipcRenderer.invoke('todo:start', id),
  archiveTodo: (id: string) => ipcRenderer.invoke('todo:archive', id),
  restoreTodo: (id: string) => ipcRenderer.invoke('todo:restore', id),
  deleteTodoForever: (id: string) => ipcRenderer.invoke('todo:delete-forever', id),
  recordFocus: (id: string, minutes: number) =>
    ipcRenderer.invoke('todo:record-focus', id, minutes),
  setPinned: (id: string, pinned: boolean) => ipcRenderer.invoke('todo:set-pinned', id, pinned),

  addGroup: (name: string) => ipcRenderer.invoke('group:add', name),
  updateGroup: (id: string, patch) => ipcRenderer.invoke('group:update', id, patch),
  deleteGroup: (id: string) => ipcRenderer.invoke('group:delete', id),

  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  testAI: (ai) => ipcRenderer.invoke('ai:test', ai),
  listAIModels: (ai) => ipcRenderer.invoke('ai:models', ai),
  summarise: (range: SummaryRange) => ipcRenderer.invoke('ai:summarise', range),

  testWebDAV: (settings: WebDAVSettings) => ipcRenderer.invoke('webdav:test', settings),
  uploadWebDAV: () => ipcRenderer.invoke('webdav:upload'),
  restoreWebDAV: () => ipcRenderer.invoke('webdav:restore'),

  exportMarkdown: (input: MarkdownExportInput) => ipcRenderer.invoke('export:markdown', input),
  exportLocalBackup: (options?: { path?: string }) => ipcRenderer.invoke('backup:export', options),
  importLocalBackup: (options?: { path?: string }) => ipcRenderer.invoke('backup:import', options),

  getMcpInfo: () => ipcRenderer.invoke('mcp:info'),

  getSecurityState: () => ipcRenderer.invoke('security:get-state'),
  onSecurityChanged: (callback: (state: import('../shared/types').SecurityState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: import('../shared/types').SecurityState) => callback(state)
    ipcRenderer.on('security:changed', listener)
    return () => ipcRenderer.removeListener('security:changed', listener)
  },
  reportActivity: () => ipcRenderer.send('security:activity'),
  unlock: (password: string) => ipcRenderer.invoke('security:unlock', password),
  lockNow: () => ipcRenderer.invoke('security:lock'),
  setSecurityPassword: (input: { currentPassword?: string; newPassword?: string }) =>
    ipcRenderer.invoke('security:set-password', input),
  resetApp: (password?: string) => ipcRenderer.invoke('app:reset', password),
  closeSticky: (todoId: string) => ipcRenderer.invoke('sticky:close', todoId),
  openMainWithTodo: (todoId: string) => ipcRenderer.invoke('sticky:open-main', todoId),

  copyText: (text: string) => ipcRenderer.invoke('app:copy', text),
  notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', title, body),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),

  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized')
}

contextBridge.exposeInMainWorld('api', api)
