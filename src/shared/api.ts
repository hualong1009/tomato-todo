import type {
  AddTodoInput,
  AIModelsResult,
  AIRequestResult,
  AppEvent,
  AppSettings,
  AppState,
  McpInfo,
  ResetResult,
  SecurityActionResult,
  SecurityState,
  SettingsUpdateResult,
  SummaryRange,
  UpdateTodoPatch,
  WebDAVSettings,
  WebDAVSyncResult,
  WebDAVTestResult
} from './types'

export interface TomatoAPI {
  platform: string
  getState(): Promise<AppState>
  onStateChanged(callback: (state: AppState) => void): () => void
  onEvent(callback: (event: AppEvent) => void): () => void
  onMaximizedChanged(callback: (maximized: boolean) => void): () => void

  addTodo(input: AddTodoInput): Promise<AppState>
  updateTodo(id: string, patch: UpdateTodoPatch): Promise<AppState>
  toggleTodo(id: string, completed: boolean): Promise<AppState>
  startTodo(id: string): Promise<AppState>
  archiveTodo(id: string): Promise<AppState>
  restoreTodo(id: string): Promise<AppState>
  deleteTodoForever(id: string): Promise<AppState>
  recordFocus(id: string, minutes: number): Promise<AppState>
  setPinned(id: string, pinned: boolean): Promise<AppState>

  addGroup(name: string): Promise<AppState>
  updateGroup(id: string, patch: { name?: string; color?: string }): Promise<AppState>
  deleteGroup(id: string): Promise<AppState>

  updateSettings(patch: Partial<AppSettings>): Promise<SettingsUpdateResult>
  testAI(ai: AppSettings['ai']): Promise<AIRequestResult>
  listAIModels(ai: AppSettings['ai']): Promise<AIModelsResult>
  summarise(range: SummaryRange): Promise<AIRequestResult>

  testWebDAV(settings: WebDAVSettings): Promise<WebDAVTestResult>
  uploadWebDAV(): Promise<WebDAVSyncResult>
  restoreWebDAV(): Promise<WebDAVSyncResult>

  getMcpInfo(): Promise<McpInfo>

  getSecurityState(): Promise<SecurityState>
  onSecurityChanged(callback: (state: SecurityState) => void): () => void
  reportActivity(): void
  unlock(password: string): Promise<SecurityActionResult>
  lockNow(): Promise<SecurityActionResult>
  setSecurityPassword(input: { currentPassword?: string; newPassword?: string }): Promise<SecurityActionResult>
  resetApp(password?: string): Promise<ResetResult>
  closeSticky(todoId: string): Promise<AppState>
  openMainWithTodo(todoId: string): Promise<void>

  copyText(text: string): Promise<void>
  notify(title: string, body: string): Promise<void>
  openExternal(url: string): Promise<void>

  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<boolean>
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>
}
