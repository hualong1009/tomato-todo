import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import type {
  AppSettings,
  AppState,
  SettingsUpdateResult,
  WebDAVSettings,
  WebDAVSyncResult
} from '../shared/types'
import { createDefaultState, loadStateFile, normaliseState, saveStateFile } from './persistence'
import { downloadFromWebDAV, uploadToWebDAV } from './webdav'

type Listener = (state: AppState) => void

export type SettingsPatch = Partial<Omit<AppSettings, 'webdav'>> & {
  webdav?: Partial<WebDAVSettings>
}

export class AppStore {
  private state: AppState
  private lastMtime = 0
  private watcher: FSWatcher | null = null
  private watchTimer: NodeJS.Timeout | null = null
  private webdavTimer: NodeJS.Timeout | null = null
  private webdavInFlight = false
  private webdavQueued = false
  private disposed = false
  onStateChanged: Listener | null = null
  onToast: ((message: string, tone?: 'info' | 'success' | 'error') => void) | null = null

  constructor(
    readonly file: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const loaded = loadStateFile(file)
    this.state = loaded.state
    this.lastMtime = loaded.mtimeMs
    if (!loaded.exists) this.persist()
    this.startWatcher()
  }

  getState(): AppState {
    return this.state
  }

  dispose(): void {
    this.disposed = true
    if (this.watchTimer) clearTimeout(this.watchTimer)
    if (this.webdavTimer) clearTimeout(this.webdavTimer)
    this.watcher?.close()
    this.watcher = null
  }

  mutate<T>(fn: (state: AppState) => T): T {
    this.refreshIfNewer()
    const result = fn(this.state)
    this.persist()
    this.scheduleWebdavUpload()
    this.onStateChanged?.(this.state)
    return result
  }

  updateSettings(patch: SettingsPatch): SettingsUpdateResult {
    const merged = normaliseState({
      ...this.state,
      settings: {
        ...this.state.settings,
        ...patch,
        ai: { ...this.state.settings.ai, ...(patch.ai ?? {}) },
        pomodoro: { ...this.state.settings.pomodoro, ...(patch.pomodoro ?? {}) },
        general: { ...this.state.settings.general, ...(patch.general ?? {}) },
        webdav: { ...this.state.settings.webdav, ...(patch.webdav ?? {}) },
        security: { ...this.state.settings.security, ...(patch.security ?? {}) }
      }
    })
    this.state.settings = merged.settings
    this.persist()
    this.scheduleWebdavUpload()
    this.onStateChanged?.(this.state)
    return { state: this.state }
  }

  /** 完全重置应用：待办、分组与全部设置（含管理员密码、AI / WebDAV 配置）恢复默认。 */
  resetApp(): void {
    this.state = createDefaultState()
    this.persist()
    this.onStateChanged?.(this.state)
  }

  replaceTodosFromRemote(raw: unknown): { ok: boolean; message: string } {
    if (!raw || typeof raw !== 'object') return { ok: false, message: '远端数据格式不正确' }
    const remote = normaliseState({
      groups: (raw as { groups?: unknown }).groups,
      todos: (raw as { todos?: unknown }).todos,
      settings: this.state.settings
    })
    this.state = {
      version: 1,
      groups: remote.groups,
      todos: remote.todos,
      settings: {
        ...this.state.settings,
        webdav: {
          ...this.state.settings.webdav,
          lastStatus: 'success',
          lastSyncAt: new Date().toISOString(),
          lastError: null
        }
      }
    }
    this.closePinnedState()
    this.persist()
    this.onStateChanged?.(this.state)
    return { ok: true, message: '已从 WebDAV 恢复待办数据' }
  }

  private closePinnedState(): void {
    for (const todo of this.state.todos) todo.pinned = false
  }

  private persist(): void {
    this.lastMtime = saveStateFile(this.file, this.state)
  }

  private refreshIfNewer(): void {
    const loaded = loadStateFile(this.file)
    if (loaded.exists && loaded.mtimeMs > this.lastMtime + 0.5) {
      this.state = loaded.state
      this.lastMtime = loaded.mtimeMs
    }
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(dirname(this.file), (_event, filename) => {
        if (filename && filename !== basename(this.file)) return
        if (this.watchTimer) clearTimeout(this.watchTimer)
        this.watchTimer = setTimeout(() => {
          try {
            const loaded = loadStateFile(this.file)
            if (!loaded.exists) return
            if (loaded.mtimeMs <= this.lastMtime + 0.5) return
            this.state = loaded.state
            this.lastMtime = loaded.mtimeMs
            this.onStateChanged?.(this.state)
            this.scheduleWebdavUpload()
          } catch {
            // 文件可能正在被替换，等待下一次事件
          }
        }, 160)
      })
    } catch {
      this.watcher = null
    }
  }

  scheduleWebdavUpload(delay = 1600): void {
    if (this.disposed) return
    const config = this.state.settings.webdav
    if (!config.enabled || !config.autoUpload || !config.url.trim()) return
    if (this.webdavTimer) clearTimeout(this.webdavTimer)
    this.webdavTimer = setTimeout(() => {
      this.webdavTimer = null
      void this.uploadToWebDAV()
    }, delay)
  }

  private applyWebdavResult(result: WebDAVSyncResult): void {
    const webdav = this.state.settings.webdav
    webdav.lastStatus = result.ok ? 'success' : 'error'
    webdav.lastError = result.ok ? null : result.message
    if (result.ok) webdav.lastSyncAt = result.at ?? new Date().toISOString()
    this.persist()
    this.onStateChanged?.(this.state)
  }

  async uploadToWebDAV(): Promise<WebDAVSyncResult> {
    const config = this.state.settings.webdav
    if (!config.enabled) return { ok: false, message: 'WebDAV 同步未启用' }
    if (this.webdavInFlight) {
      this.webdavQueued = true
      return { ok: true, message: '正在同步，稍后将自动保存最新数据' }
    }
    this.webdavInFlight = true
    let result: WebDAVSyncResult
    try {
      result = await uploadToWebDAV(config, this.state, this.fetchImpl)
    } finally {
      this.webdavInFlight = false
    }
    this.applyWebdavResult(result)
    if (!result.ok) this.onToast?.(`WebDAV 同步失败：${result.message}`, 'error')
    if (this.webdavQueued) {
      this.webdavQueued = false
      this.scheduleWebdavUpload(500)
    }
    return result
  }

  async restoreFromWebDAV(): Promise<WebDAVSyncResult> {
    const config = this.state.settings.webdav
    if (!config.url.trim()) return { ok: false, message: '请先配置 WebDAV 地址' }
    const result = await downloadFromWebDAV(config, this.fetchImpl)
    if (!result.ok) {
      config.lastStatus = 'error'
      config.lastError = result.message
      this.persist()
      this.onStateChanged?.(this.state)
      return { ok: false, message: result.message }
    }
    const applied = this.replaceTodosFromRemote(result.raw)
    if (!applied.ok) return { ok: false, message: applied.message }
    return { ok: true, message: applied.message, at: new Date().toISOString() }
  }
}
