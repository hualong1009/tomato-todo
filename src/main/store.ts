import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import type {
  AppSettings,
  AppState,
  LocalBackupSettings,
  SettingsUpdateResult,
  WebDAVSettings,
  WebDAVSyncResult
} from '../shared/types'
import { decideWebDAVSync, localFingerprint, shouldAutoSync } from '../shared/webdavSync'
import { createDefaultState, loadStateFile, normaliseState, saveStateFile } from './persistence'
import { downloadFromWebDAV, uploadToWebDAV } from './webdav'

type Listener = (state: AppState) => void

export type SettingsPatch = Partial<Omit<AppSettings, 'webdav' | 'localBackup'>> & {
  webdav?: Partial<WebDAVSettings>
  localBackup?: Partial<LocalBackupSettings>
}

export class AppStore {
  private state: AppState
  private lastMtime = 0
  private watcher: FSWatcher | null = null
  private watchTimer: NodeJS.Timeout | null = null
  private webdavTimer: NodeJS.Timeout | null = null
  private webdavKickTimer: NodeJS.Timeout | null = null
  private syncTimer: NodeJS.Timeout | null = null
  private startupKick: NodeJS.Timeout | null = null
  private webdavInFlight = false
  private webdavQueued = false
  private lastAutoSyncAt = 0
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
    this.startAutoSync()
  }

  getState(): AppState {
    return this.state
  }

  dispose(): void {
    this.disposed = true
    if (this.watchTimer) clearTimeout(this.watchTimer)
    if (this.webdavTimer) clearTimeout(this.webdavTimer)
    if (this.webdavKickTimer) clearTimeout(this.webdavKickTimer)
    if (this.syncTimer) clearInterval(this.syncTimer)
    if (this.startupKick) clearTimeout(this.startupKick)
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
        security: { ...this.state.settings.security, ...(patch.security ?? {}) },
        localBackup: { ...this.state.settings.localBackup, ...(patch.localBackup ?? {}) }
      }
    })
    this.state.settings = merged.settings
    this.persist()
    // 设置变更（尤其是刚填好 WebDAV 地址 / 改同步间隔）后先同步一次，
    // 由 decideWebDAVSync 决定上传还是拉取，避免新设备把空数据覆盖到远端。
    this.kickAutoSync()
    this.onStateChanged?.(this.state)
    return { state: this.state }
  }

  /** 完全重置应用：待办、分组与全部设置（含管理员密码、AI / WebDAV 配置）恢复默认。 */
  resetApp(): void {
    this.state = createDefaultState()
    this.persist()
    this.onStateChanged?.(this.state)
  }

  replaceTodosFromRemote(
    raw: unknown,
    source = 'WebDAV',
    meta: { remoteSavedAt?: string } = {}
  ): { ok: boolean; message: string } {
    if (!raw || typeof raw !== 'object') return { ok: false, message: `${source}数据格式不正确` }
    const remote = normaliseState({
      groups: (raw as { groups?: unknown }).groups,
      todos: (raw as { todos?: unknown }).todos,
      settings: this.state.settings
    })
    this.state = {
      version: 1,
      groups: remote.groups,
      todos: remote.todos,
      settings: this.state.settings
    }
    this.closePinnedState()
    // 取消固定后的数据就是「与远端一致」的基准，记下指纹避免下次同步重复上传。
    this.state.settings = {
      ...this.state.settings,
      webdav: {
        ...this.state.settings.webdav,
        lastStatus: 'success',
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        lastSyncedHash: localFingerprint(this.state),
        lastRemoteSavedAt:
          meta.remoteSavedAt ?? this.state.settings.webdav.lastRemoteSavedAt ?? null
      }
    }
    this.lastAutoSyncAt = Date.now()
    this.persist()
    this.onStateChanged?.(this.state)
    return { ok: true, message: `已从${source}恢复待办数据` }
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

  private applyWebdavResult(result: WebDAVSyncResult, localHash?: string): void {
    const webdav = this.state.settings.webdav
    webdav.lastStatus = result.ok ? 'success' : 'error'
    webdav.lastError = result.ok ? null : result.message
    if (result.ok) {
      webdav.lastSyncAt = result.at ?? new Date().toISOString()
      if (localHash) webdav.lastSyncedHash = localHash
      if (result.remoteSavedAt) webdav.lastRemoteSavedAt = result.remoteSavedAt
      this.lastAutoSyncAt = Date.now()
    }
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
    // 指纹在 await 之前取：上传过程中继续编辑会有新改动，下次同步会再上传
    const localHash = localFingerprint(this.state)
    let result: WebDAVSyncResult
    try {
      result = await uploadToWebDAV(config, this.state, this.fetchImpl)
    } finally {
      this.webdavInFlight = false
    }
    this.applyWebdavResult(result, result.ok ? localHash : undefined)
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
    const applied = this.replaceTodosFromRemote(result.raw, 'WebDAV', {
      remoteSavedAt: result.savedAt
    })
    if (!applied.ok) return { ok: false, message: applied.message }
    return {
      ok: true,
      message: applied.message,
      at: new Date().toISOString(),
      remoteSavedAt: result.savedAt,
      action: 'download'
    }
  }

  /**
   * 双向同步：先读远端 savedAt 判断哪边有新数据，再决定上传 / 拉取 / 什么都不做。
   * 定时同步、应用启动、设置变更后都走这里。
   */
  async syncWebDAV(options: { notify?: boolean } = {}): Promise<WebDAVSyncResult> {
    const config = this.state.settings.webdav
    if (!config.enabled) return { ok: false, message: 'WebDAV 同步未启用' }
    if (!config.url.trim()) return { ok: false, message: '请先配置 WebDAV 地址' }
    if (this.webdavInFlight) {
      this.webdavQueued = true
      return { ok: true, message: '正在同步，稍后会自动同步最新数据', action: 'none' }
    }
    this.webdavInFlight = true
    let result: WebDAVSyncResult
    try {
      result = await this.runSync(options.notify !== false)
    } finally {
      this.webdavInFlight = false
    }
    if (this.webdavQueued) {
      this.webdavQueued = false
      this.scheduleWebdavUpload(600)
    }
    return result
  }

  private async runSync(notify: boolean): Promise<WebDAVSyncResult> {
    const config = this.state.settings.webdav
    const localHash = localFingerprint(this.state)
    // 先只读主备份文件的 savedAt，不下载 blobs/，避免每次定时同步都拉一遍附件
    const preview = await downloadFromWebDAV(config, this.fetchImpl, { inlineAssets: false })
    if (!preview.ok && preview.status !== 404) {
      const failed: WebDAVSyncResult = { ok: false, message: preview.message, action: 'none' }
      this.applyWebdavResult(failed)
      return failed
    }
    const decision = decideWebDAVSync({
      localHash,
      lastSyncedHash: config.lastSyncedHash,
      remoteSavedAt: preview.ok ? preview.savedAt : null,
      lastRemoteSavedAt: config.lastRemoteSavedAt,
      lastSyncAt: config.lastSyncAt
    })

    if (decision.action === 'download') {
      const full = await downloadFromWebDAV(config, this.fetchImpl)
      if (!full.ok) {
        const failed: WebDAVSyncResult = { ok: false, message: full.message, action: 'none' }
        this.applyWebdavResult(failed)
        return failed
      }
      const applied = this.replaceTodosFromRemote(full.raw, 'WebDAV', {
        remoteSavedAt: full.savedAt
      })
      if (!applied.ok) {
        const failed: WebDAVSyncResult = { ok: false, message: applied.message, action: 'none' }
        this.applyWebdavResult(failed)
        return failed
      }
      this.onToast?.('已从 WebDAV 拉取其他设备的更新', 'info')
      return {
        ok: true,
        message: '已从 WebDAV 拉取其他设备的更新',
        at: new Date().toISOString(),
        remoteSavedAt: full.savedAt,
        action: 'download'
      }
    }

    if (decision.action === 'upload') {
      const uploaded = await uploadToWebDAV(config, this.state, this.fetchImpl)
      this.applyWebdavResult(uploaded, uploaded.ok ? localHash : undefined)
      // 定时同步失败不弹提示（每 5 分钟一次会打扰），错误看设置页里的「上次错误」
      if (!uploaded.ok && notify) {
        this.onToast?.(`WebDAV 同步失败：${uploaded.message}`, 'error')
      }
      if (uploaded.ok && decision.conflict) {
        this.onToast?.('本机与远端都有改动，已保留本机数据并覆盖远端', 'info')
      }
      return { ...uploaded, action: 'upload' }
    }

    const current: WebDAVSyncResult = {
      ok: true,
      message: '已是最新',
      at: new Date().toISOString(),
      remoteSavedAt: preview.savedAt,
      action: 'none'
    }
    this.applyWebdavResult(current)
    return current
  }

  /** 定时双向同步：每 60 秒检查一次，按设置的间隔执行。 */
  private startAutoSync(): void {
    this.syncTimer = setInterval(() => {
      void this.autoSyncTick()
    }, 60_000)
    // 不阻止进程退出（单测里创建的 store 不该挂住 node）
    this.syncTimer.unref?.()
    this.startupKick = setTimeout(() => {
      void this.autoSyncTick(true)
    }, 4000)
    this.startupKick.unref?.()
  }

  /** 设置变更后尽快同步一次（延迟合并，避免边输入地址边发请求）。 */
  private kickAutoSync(delay = 1500): void {
    if (this.disposed) return
    if (this.webdavKickTimer) clearTimeout(this.webdavKickTimer)
    this.webdavKickTimer = setTimeout(() => {
      this.webdavKickTimer = null
      void this.autoSyncTick(true)
    }, delay)
    this.webdavKickTimer.unref?.()
  }

  private async autoSyncTick(force = false): Promise<void> {
    if (this.disposed) return
    const config = this.state.settings.webdav
    if (!shouldAutoSync(config)) return
    const intervalMs = config.syncIntervalMinutes * 60_000
    if (!force && Date.now() - this.lastAutoSyncAt < intervalMs) return
    this.lastAutoSyncAt = Date.now()
    await this.syncWebDAV({ notify: false })
  }
}
