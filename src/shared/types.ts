export type AIProvider = 'openai' | 'anthropic'

export type Urgency = 'low' | 'medium' | 'high' | 'urgent'

export type TodoStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue'

export type ThemeMode = 'dark' | 'light'

export type SummaryRange = 'week' | 'month' | 'year'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Group {
  id: string
  name: string
  color: string
  createdAt: string
}

export interface FocusSession {
  at: string
  minutes: number
}

/** 待办附件：二进制内容以 data URL（base64）内嵌，便于随 JSON 备份一起完整导出。 */
export interface Attachment {
  id: string
  /** 原始文件名，例如 需求文档.pdf */
  name: string
  /** MIME 类型，例如 application/pdf */
  mime: string
  /** 字节数（用于展示与校验） */
  size: number
  /** data:<mime>;base64,<...> */
  data: string
  createdAt: string
}

export interface Todo {
  id: string
  title: string
  content: string
  groupId: string
  urgency: Urgency
  /** 期望完成时间（ISO）。 */
  expectedAt: string | null
  /** 实际开始时间（ISO）。点击「开始」或启动番茄专注时写入。 */
  startedAt: string | null
  /** 实际完成时间（ISO）。勾选完成/标记完成时写入。 */
  completedAt: string | null
  /** 归档时间（ISO）。归档不等于删除。 */
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  pinned: boolean
  pomodoroCount: number
  focusMinutes: number
  focusLog: FocusSession[]
  stickyColor: string
  stickyOpacity: number
  stickyBounds?: WindowBounds
  /** 附件列表，可随备份完整导出 */
  attachments: Attachment[]
}

export interface AISettings {
  provider: AIProvider
  baseUrl: string
  apiKey: string
  model: string
}

export interface PomodoroSettings {
  focusMinutes: number
  breakMinutes: number
}

export interface GeneralSettings {
  hotkey: string
  theme: ThemeMode
  /** 关闭按钮最小化到系统托盘 */
  closeToTray: boolean
}

export type WebDAVStatus = 'idle' | 'success' | 'error'

export interface WebDAVSettings {
  enabled: boolean
  /** WebDAV 服务器根地址，例如 https://dav.example.com/remote.php/dav/files/me/ */
  url: string
  /** 相对于服务器地址的远端文件路径，例如 tomato-todo/data.json */
  remotePath: string
  username: string
  password: string
  autoUpload: boolean
  /** 非空时上传前用该密码加密备份，下载后用该密码解密 */
  encryptionPassword: string
  /** 是否把正文图片与附件拆成 blobs/ 单独上传（默认开启，避免单文件过大） */
  splitAssets?: boolean
  lastSyncAt: string | null
  lastStatus: WebDAVStatus
  lastError: string | null
}

export interface SecuritySettings {
  /** scrypt 哈希后的管理员密码，空字符串表示未设置 */
  passwordHash: string
  /** 空闲多少分钟后自动锁定，0 表示不自动锁定 */
  autoLockMinutes: number
}

export interface LocalBackupSettings {
  /** 本地加密备份使用的密码，空字符串表示未设置 */
  password: string
  /** 最近一次导出本地备份的时间 */
  lastBackupAt: string | null
}

export interface AppSettings {
  ai: AISettings
  promptTemplate: string
  pomodoro: PomodoroSettings
  general: GeneralSettings
  webdav: WebDAVSettings
  security: SecuritySettings
  localBackup: LocalBackupSettings
}

export interface AppState {
  version: number
  groups: Group[]
  todos: Todo[]
  settings: AppSettings
}

export interface AddTodoInput {
  title: string
  content?: string
  groupId?: string
  urgency?: Urgency
  expectedAt?: string | null
}

export interface UpdateTodoPatch {
  title?: string
  content?: string
  groupId?: string
  urgency?: Urgency
  expectedAt?: string | null
  completed?: boolean
  started?: boolean
  archived?: boolean
  stickyColor?: string
  stickyOpacity?: number
  stickyBounds?: WindowBounds
  attachments?: Attachment[]
}

export interface AIRequestResult {
  ok: boolean
  content?: string
  error?: string
  generatedAt?: string
  model?: string
}

export interface AIModelsResult {
  ok: boolean
  models: string[]
  error?: string
}

export interface SettingsUpdateResult {
  state: AppState
  warning?: string
}

export interface WebDAVTestResult {
  ok: boolean
  message: string
  status?: number
}

export interface WebDAVSyncResult {
  ok: boolean
  message: string
  at?: string
}

export interface MarkdownExportInput {
  /** all：导出全部待办；selected：只导出 todoIds 指定的待办 */
  scope: 'all' | 'selected'
  todoIds?: string[]
  /** 导出时是否包含已归档的待办，默认 true */
  includeArchived?: boolean
  /** 指定绝对路径时跳过保存对话框（用于批量/自动化场景） */
  path?: string
}

export interface FileActionResult {
  ok: boolean
  message: string
  path?: string
}

export interface McpInfo {
  command: string
  args: string[]
  config: string
  dataFile: string
}

export type AppEvent =
  | { type: 'select-todo'; todoId: string }
  | { type: 'toast'; message: string; tone?: 'info' | 'success' | 'error' }

export interface SecurityState {
  locked: boolean
  hasPassword: boolean
  autoLockMinutes: number
}

export interface SecurityActionResult {
  ok: boolean
  message?: string
  state: SecurityState
}

export interface ResetResult {
  ok: boolean
  message?: string
}
