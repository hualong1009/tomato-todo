/**
 * Web / Capacitor 版 `window.api` 实现。
 *
 * 桌面端由 Electron preload 注入 `window.api`；在手机（Capacitor）或普通浏览器里
 * 没有主进程，因此这里用同一份共享业务逻辑 + Preferences 存储实现相同接口，
 * 让渲染端组件完全不需要区分平台。
 */
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import type { TomatoAPI } from '../../../shared/api'
import { callAIChat, listAIModels, testAIConnection } from '../../../shared/aiClient'
import {
  createRemotePayload,
  createRemotePayloadWith,
  parseRemotePayload,
  type RemotePayload
} from '../../../shared/backup'
import { browserBackupFormatVersion, decryptBrowserBackup, encryptBrowserBackup } from '../../../shared/browserBackupCrypto'
import { externaliseAssets } from '../../../shared/blobSync'
import { createDefaultState, normaliseState } from '../../../shared/normalise'
import {
  archiveTodo,
  createGroup,
  createTodo,
  deleteGroup,
  deleteTodoPermanently,
  recordFocus,
  restoreTodo,
  setCompleted,
  setPinned,
  startTodo,
  updateGroup,
  updateTodo
} from '../../../shared/operations'
import { buildExportMarkdown } from '../../../shared/markdownExport'
import { splitDataUrl } from '../../../shared/attachments'
import { collectBlobRefs, inlineAttachmentRefs, inlineBlobRefs } from '../../../shared/blobRefs'
import { buildWidgetSummary } from '../../../shared/widget'
import { buildSummaryContext } from '../../../shared/summary'
import {
  decideWebDAVSync,
  localFingerprint,
  shouldAutoSync,
  shouldSyncOnChange
} from '../../../shared/webdavSync'
import { evaluateRelease, LATEST_RELEASE_API } from '../../../shared/updates'
import type {
  AddTodoInput,
  AIRequestResult,
  AIModelsResult,
  AppEvent,
  AppSettings,
  AppState,
  FileActionResult,
  MarkdownExportInput,
  McpInfo,
  ResetResult,
  SecurityActionResult,
  SecurityState,
  SettingsUpdateResult,
  SummaryDates,
  SummaryRange,
  Todo,
  UpdateTodoPatch,
  WebDAVSettings,
  WebDAVSyncResult,
  WebDAVTestResult
} from '../../../shared/types'

const STORAGE_KEY = 'tomato-todo-data'
const SAVE_DEBOUNCE_MS = 250
/** 加密备份文件头（TTENC1 = 旧格式，TTENC2 = gzip 压缩后的新格式）。 */
const ENCRYPTED_MAGICS = ['TTENC1', 'TTENC2'] as const

function looksEncrypted(text: string): boolean {
  const head = text.trimStart()
  return ENCRYPTED_MAGICS.some((magic) => head.startsWith(magic))
}

const stateListeners = new Set<(state: AppState) => void>()
const eventListeners = new Set<(event: AppEvent) => void>()

function emitToast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
  for (const listener of eventListeners) listener({ type: 'toast', message, tone })
}

let state: AppState = createDefaultState()

/**
 * 桌面小组件通道：原生侧插件负责把摘要写进 SharedPreferences 并刷新 RemoteViews。
 * 非原生环境（浏览器预览）没有这个插件，调用会被静默忽略。
 */
const widgetPlugin = Capacitor.isNativePlatform()
  ? registerPlugin<{ update(options: { summary: string }): Promise<void> }>('TomatoWidget')
  : null

const externalPlugin = Capacitor.isNativePlatform()
  ? registerPlugin<{ open(options: { url: string }): Promise<void> }>('TomatoExternal')
  : null

interface SafeAreaInsets {
  top: number
  bottom: number
  /** IME inset from screen bottom (0 while keyboard is hidden), separate from system bar */
  ime?: number
  left: number
  right: number
}

/**
 * 系统栏外观通道：让状态栏/手势条跟随应用主题（透明沉浸式 + 图标明暗）。
 * activateWebViewInsets：Web 层就绪后接管 insets 留白——原生返回当前 insets
 * 并清掉自己的 padding，让应用背景（含渐变）绘制到系统栏底下，与界面无缝；
 * 之后 insets 变化（旋转/键盘/手势条）通过 safeArea 事件持续推送。
 */
const themePlugin = Capacitor.isNativePlatform()
  ? registerPlugin<{
      apply(options: { scheme: string }): Promise<void>
      activateWebViewInsets(): Promise<SafeAreaInsets>
      addListener(
        eventName: 'safeArea',
        listener: (data: SafeAreaInsets) => void
      ): Promise<{ remove: () => void }>
    }>('TomatoTheme')
  : null
let lastScheme: string | null = null

function applySafeAreaInsets(data: SafeAreaInsets): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--safe-top', `${data.top}px`)
  root.style.setProperty('--safe-bottom', `${data.bottom}px`)
  root.style.setProperty('--safe-left', `${data.left}px`)
  root.style.setProperty('--safe-right', `${data.right}px`)
  // --safe-bottom 只能表示手势条，不能混入键盘高度；浮层另行避让 IME。
  // IME inset 从窗口底部量到键盘顶部（含手势条）；整段都必须避开。
  root.style.setProperty('--keyboard-inset', `${Math.max(0, data.ime ?? 0)}px`)
  window.dispatchEvent(new Event('tomato:insets'))
}

let insetsSetup = false

function setupWebViewInsets(): void {
  if (!themePlugin || insetsSetup) return
  insetsSetup = true
  themePlugin
    .activateWebViewInsets()
    .then(applySafeAreaInsets)
    .catch(() => { insetsSetup = false })
  themePlugin
    .addListener('safeArea', (data) => {
      applySafeAreaInsets(data)
    })
    .catch(() => { insetsSetup = false })
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function effectiveScheme(): 'dark' | 'light' {
  const theme = state.settings.general.theme
  if (theme === 'light') return 'light'
  if (theme === 'dark') return 'dark'
  return systemPrefersDark() ? 'dark' : 'light'
}

function syncTheme(): void {
  if (!themePlugin) return
  const scheme = effectiveScheme()
  if (scheme === lastScheme) return
  lastScheme = scheme
  void themePlugin.apply({ scheme }).catch(() => {
    // 启动早期桥接暂不可用时，后续保存同一主题仍可重试。
    if (lastScheme === scheme) lastScheme = null
  })
}

// 「跟随系统」时，系统深浅色变化要即时同步到系统栏
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', () => {
      if (state.settings.general.theme === 'system') syncTheme()
    })
  } catch {
    /* 旧 WebView 不支持 addEventListener */
  }
}

function syncWidget(): void {
  if (!widgetPlugin) return
  try {
    const summary = JSON.stringify(buildWidgetSummary(state))
    void widgetPlugin.update({ summary }).catch(() => undefined)
  } catch {
    /* 小组件刷新失败不影响主流程 */
  }
}
let loadPromise: Promise<void> | null = null
let saveTimer: number | undefined

/**
 * 返回状态快照。
 *
 * 状态操作是原地修改 `state` 的，如果直接把同一个对象交出去，React 的
 * `setState` 会因为 `Object.is` 相等而跳过重渲染——手机端就会出现「下拉框
 * 选了分组但界面还是旧值」。所以每次都返回新的对象 / 数组引用。
 */
function snapshot(): AppState {
  return { ...state, groups: [...state.groups], todos: [...state.todos] }
}

function emit(): void {
  persistSoon()
  syncWidget()
  syncTheme()
  setupWebViewInsets()
  for (const listener of stateListeners) listener(snapshot())
}

function persistNow(): Promise<void> {
  return Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(state) }).catch(() => undefined)
}

function persistSoon(): void {
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void persistNow()
    }, SAVE_DEBOUNCE_MS)
    return
  }
  void persistNow()
}

function loadState(): Promise<void> {
  if (!loadPromise) {
    loadPromise = Preferences.get({ key: STORAGE_KEY })
      .then(({ value }: { value: string | null }) => {
        if (!value) return
        try {
          state = normaliseState(JSON.parse(value))
        } catch {
          state = createDefaultState()
        }
      })
      .catch(() => {
        state = createDefaultState()
      })
      .then(() => {
        // 首次安装没有已存数据，也必须把默认/系统主题应用到状态栏，
        // 并启用 WebView insets；不能在 value 为 null 时提前跳过。
        syncTheme()
        syncWidget()
        setupWebViewInsets()
        // Store 加载完成后启动定时双向同步（未启用 WebDAV 时自动跳过）
        startAutoSync()
      })
  }
  return loadPromise as Promise<void>
}

function mutate(fn: (draft: AppState) => unknown): AppState {
  fn(state)
  emit()
  scheduleWebDAVUpload()
  return snapshot()
}

function mergeSettings(patch: Partial<AppSettings>): AppSettings {
  const current = state.settings
  return normaliseState({
    ...state,
    settings: {
      ...current,
      ...patch,
      ai: { ...current.ai, ...(patch.ai ?? {}) },
      pomodoro: { ...current.pomodoro, ...(patch.pomodoro ?? {}) },
      general: { ...current.general, ...(patch.general ?? {}) },
      webdav: { ...current.webdav, ...(patch.webdav ?? {}) },
      security: { ...current.security, ...(patch.security ?? {}) }
    }
  }).settings
}

async function readClipboardText(): Promise<string> {
  try {
    return (await navigator.clipboard.readText()) ?? ''
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ */
/* 网络：原生环境走 CapacitorHttp（绕过 WebView 的 CORS），浏览器走 fetch */
/* ------------------------------------------------------------------ */

const nativeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const headers: Record<string, string> = {}
  new Headers(init?.headers ?? {}).forEach((value, key) => {
    headers[key] = value
  })
  const bodyInit = init?.body
  const data =
    typeof bodyInit === 'string'
      ? bodyInit
      : bodyInit instanceof Uint8Array
        ? new TextDecoder().decode(bodyInit)
        : undefined
  const response = await CapacitorHttp.request({
    url,
    method: (init?.method ?? 'GET').toUpperCase(),
    headers,
    data,
    responseType: 'text',
    connectTimeout: 20000,
    readTimeout: 180000
  })
  const text =
    typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null)
  return new Response([204, 205, 304].includes(response.status) ? null : text, {
    status: response.status,
    headers: (response.headers ?? {}) as Record<string, string>
  })
}

const request: typeof fetch = Capacitor.isNativePlatform()
  ? (nativeFetch as typeof fetch)
  : ((input, init) => window.fetch(input as RequestInfo, init))

/* ------------------------------------------------------------------ */
/* WebDAV（与桌面端互通：TTENC2 + 内容寻址 blobs + 手动/自动上传）          */
/* ------------------------------------------------------------------ */

function remoteFileUrl(settings: WebDAVSettings): string {
  const input = settings.url.trim()
  if (!input) throw new Error('请填写 WebDAV 服务器地址')
  let base: URL
  try {
    base = new URL(input)
  } catch {
    throw new Error('WebDAV 服务器地址格式不正确')
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('WebDAV 地址必须使用 http 或 https')
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  const remotePath = settings.remotePath.trim()
  if (!remotePath) throw new Error('请填写远端文件路径')
  if (/^https?:\/\//i.test(remotePath)) return new URL(remotePath).toString()
  return new URL(remotePath.replace(/^\/+/, ''), base).toString()
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)))
  }
  return btoa(chunks.join(''))
}

function authHeaders(settings: WebDAVSettings): Record<string, string> {
  if (!settings.username && !settings.password) return {}
  return { Authorization: `Basic ${bytesToBase64(new TextEncoder().encode(`${settings.username}:${settings.password}`))}` }
}

/** Android 7 也需原样写入二进制，不能通过 CapacitorHttp 把密文转成 UTF-8。 */
const binaryPlugin = Capacitor.isNativePlatform()
  ? registerPlugin<{
      put(options: { url: string; data: string; headers: Record<string, string> }): Promise<{ status: number }>
      get(options: { url: string; headers: Record<string, string> }): Promise<{ status: number; data: string }>
      request(options: { url: string; method: 'MKCOL' | 'PROPFIND'; data?: string; headers: Record<string, string> }): Promise<{ status: number; data: string }>
    }>('TomatoWebDAVBinary')
  : null

/** Android 原生 OkHttp 总是返回原始字节的 base64，不依赖服务器 Content-Type。
 * CapacitorHttp 即使指定 arraybuffer，在 application/json 响应时也会先解析
 * 成文本/对象；对含中文的明文误用 atob 会报 Latin1 错误，密文也会损坏。 */
async function downloadWebDAVBytes(url: string, headers: Record<string, string>): Promise<{
  status: number
  bytes: Uint8Array
}> {
  if (binaryPlugin) {
    const response = await binaryPlugin.get({ url, headers })
    if (response.status < 200 || response.status >= 300) {
      return { status: response.status, bytes: new Uint8Array() }
    }
    let binary: string
    try {
      binary = atob(response.data)
    } catch {
      throw new Error('WebDAV 下载内容编码异常')
    }
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { status: response.status, bytes }
  }
  const response = await request(url, { method: 'GET', headers })
  return {
    status: response.status,
    bytes: response.ok ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array()
  }
}

async function decodeWebDAVBytes(bytes: Uint8Array, password: string): Promise<string> {
  return browserBackupFormatVersion(bytes)
    ? decryptBrowserBackup(bytes, password)
    : new TextDecoder().decode(bytes)
}

async function testWebDAV(settings: WebDAVSettings): Promise<WebDAVTestResult> {
  let url: string
  try {
    url = remoteFileUrl(settings)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'WebDAV 配置不正确' }
  }
  try {
    const response = await request(url, { method: 'GET', headers: authHeaders(settings) })
    if (response.status === 200) return { ok: true, message: '连接成功，已找到远端备份', status: 200 }
    if (response.status === 404) {
      return { ok: true, message: '连接成功，远端暂无备份（上传时会创建文件）', status: 404 }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: '认证失败，请检查用户名和密码', status: response.status }
    }
    return { ok: false, message: `服务器返回 HTTP ${response.status}`, status: response.status }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '无法连接 WebDAV 服务器' }
  }
}

function parentUrl(fileUrl: string): string {
  return new URL('.', fileUrl).toString()
}

/** 按服务器根地址逐级创建备份目录（MKCOL 405 表示目录已存在）。 */
async function ensureRemoteDirectory(settings: WebDAVSettings, fileUrl: string): Promise<void> {
  const base = new URL(settings.url.trim())
  const file = new URL(fileUrl)
  const baseParts = base.pathname.split('/').filter(Boolean)
  const fileParts = file.pathname.split('/').filter(Boolean)
  fileParts.pop()
  let directories: string[]
  if (base.origin !== file.origin || baseParts.some((part, index) => fileParts[index] !== part)) {
    directories = [parentUrl(fileUrl)]
  } else {
    let path = `/${baseParts.join('/')}`
    if (!path.endsWith('/')) path += '/'
    directories = fileParts.slice(baseParts.length).map((part) => {
      path += `${part}/`
      return `${file.origin}${path}`
    })
  }
  for (const directory of directories) {
    const headers = authHeaders(settings)
    const status = binaryPlugin
      ? (await binaryPlugin.request({ url: directory, method: 'MKCOL', headers })).status
      : (await request(directory, { method: 'MKCOL', headers })).status
    if (![200, 201, 204, 405].includes(status)) {
      throw new Error(`创建 WebDAV 目录失败（HTTP ${status}）`)
    }
  }
}

/** 内容寻址去重：只在目录不存在或文件缺失时上传。 */
async function listRemoteBlobs(settings: WebDAVSettings, url: string): Promise<Set<string>> {
  const headers = { ...authHeaders(settings), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }
  const data = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>'
  const response = binaryPlugin
    ? await binaryPlugin.request({ url, method: 'PROPFIND', headers, data })
    : await request(url, { method: 'PROPFIND', headers, body: data }).then(async (result) => ({
        status: result.status, data: await result.text()
      }))
  const names = new Set<string>()
  if (response.status < 200 || response.status >= 300) return names
  const xml = response.data
  for (const match of xml.matchAll(/<[^>]*D?:?href[^>]*>([^<]+)<\/[^>]*href>/gi)) {
    const name = decodeURIComponent(match[1].split('/').filter(Boolean).pop() ?? '')
    if (name) names.add(name)
  }
  return names
}

/** Android 原生插件负责二进制 PUT；浏览器预览使用标准 fetch。 */
async function putWebDAV(
  url: string,
  settings: WebDAVSettings,
  body: string | Uint8Array,
  contentType: string
): Promise<number> {
  const headers = { ...authHeaders(settings), 'Content-Type': contentType }
  if (body instanceof Uint8Array && binaryPlugin) {
    const result = await binaryPlugin.put({ url, headers, data: bytesToBase64(body) })
    return result.status
  }
  const response = await request(url, {
    method: 'PUT',
    headers,
    body: typeof body === 'string' ? body : new Blob([new Uint8Array(body)])
  })
  return response.status
}

let autoUploadTimer: ReturnType<typeof setTimeout> | null = null
let uploadInFlight = false
let uploadQueued = false

/**
 * 本机数据改动后（保存详情、勾选完成、改分组…）约 1.6 秒自动同步一次。
 * 已经有本机改动，所以跳过「先读远端」的探测，直接上传，少一次请求。
 */
function scheduleWebDAVUpload(delay = 1600): void {
  if (autoUploadTimer) clearTimeout(autoUploadTimer)
  autoUploadTimer = null
  if (!shouldSyncOnChange(state.settings.webdav)) return
  autoUploadTimer = setTimeout(() => {
    autoUploadTimer = null
    void syncWebDAV({ notify: false, dirty: true })
  }, delay)
}

async function performWebDAVUpload(settings: WebDAVSettings): Promise<WebDAVSyncResult> {
  try {
    const url = remoteFileUrl(settings)
    // 快照必须在任何 await 之前生成：上传中继续编辑时，后续变动由队列再上传。
    const externalised = settings.splitAssets !== false ? externaliseAssets(state.todos) : null
    const savedAt = new Date().toISOString()
    const payload = externalised
      ? createRemotePayloadWith(state, externalised.todos, savedAt)
      : createRemotePayload(state, savedAt)
    await ensureRemoteDirectory(settings, url)
    let uploaded = 0
    let reused = 0
    if (externalised && externalised.blobs.size > 0) {
      const blobsUrl = new URL('blobs/', parentUrl(url)).toString()
      await ensureRemoteDirectory(settings, `${blobsUrl}placeholder`)
      const existing = await listRemoteBlobs(settings, blobsUrl)
      for (const [name, dataUrl] of externalised.blobs) {
        if (existing.has(name)) {
          // 文件名仅由内容决定，服务器可能已有另一加密密码/明文版本。
          // 只有内容能用当前密码正确读回时才复用，避免主文件指向不可解密资源。
          try {
            const old = await downloadWebDAVBytes(`${blobsUrl}${name}`, authHeaders(settings))
            if (old.status >= 200 && old.status < 300 &&
                await decodeWebDAVBytes(old.bytes, settings.encryptionPassword) === dataUrl &&
                Boolean(browserBackupFormatVersion(old.bytes)) === Boolean(settings.encryptionPassword)) {
              reused += 1
              continue
            }
          } catch {
            // 不可读或密码变更：用当前配置重新上传同名资源。
          }
        }
        const body = settings.encryptionPassword
          ? await encryptBrowserBackup(dataUrl, settings.encryptionPassword)
          : dataUrl
        const status = await putWebDAV(
          `${blobsUrl}${name}`, settings, body,
          settings.encryptionPassword ? 'application/octet-stream' : 'text/plain; charset=utf-8'
        )
        if (status < 200 || status >= 300) {
          return { ok: false, message: `上传附件 ${name} 失败（HTTP ${status}）` }
        }
        uploaded += 1
      }
    }
    // 先传全部外置资源，最后写主文件；任何失败都不会更新远端主备份。
    const body = settings.encryptionPassword
      ? await encryptBrowserBackup(payload, settings.encryptionPassword)
      : payload
    const status = await putWebDAV(
      url, settings, body,
      settings.encryptionPassword ? 'application/octet-stream' : 'application/json; charset=utf-8'
    )
    if (status < 200 || status >= 300) {
      return { ok: false, message: `上传失败：HTTP ${status}` }
    }
    const assetNote = externalised && externalised.blobs.size > 0
      ? `，外置 ${externalised.blobs.size} 个图片/附件（新传 ${uploaded}、复用 ${reused}）`
      : ''
    return {
      ok: true,
      message: `${settings.encryptionPassword ? '已加密压缩保存' : '已保存'}到 WebDAV${assetNote}`,
      at: new Date().toISOString(),
      remoteSavedAt: savedAt,
      action: 'upload'
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '上传失败' }
  }
}

/** 记录一次同步结果：更新状态、本机指纹与远端版本戳，供下次判断是否需要传输。 */
function applyWebdavSyncResult(result: WebDAVSyncResult, localHash?: string): void {
  state.settings = mergeSettings({
    webdav: {
      ...state.settings.webdav,
      lastStatus: result.ok ? 'success' : 'error',
      lastError: result.ok ? null : result.message,
      lastSyncAt: result.ok
        ? result.at ?? new Date().toISOString()
        : state.settings.webdav.lastSyncAt,
      lastSyncedHash:
        result.ok && localHash ? localHash : state.settings.webdav.lastSyncedHash ?? null,
      lastRemoteSavedAt: result.remoteSavedAt ?? state.settings.webdav.lastRemoteSavedAt ?? null
    }
  })
  if (result.ok) lastAutoSyncAt = Date.now()
  emit()
}

async function uploadWebDAV(): Promise<WebDAVSyncResult> {
  const settings = state.settings.webdav
  if (!settings.url.trim()) return { ok: false, message: '请先在设置中配置 WebDAV' }
  if (uploadInFlight) {
    uploadQueued = true
    return { ok: true, message: '正在同步，稍后将自动保存最新数据' }
  }
  uploadInFlight = true
  // 指纹在 await 之前取：上传过程中继续编辑会有新改动，下次同步会再上传
  const localHash = localFingerprint(state)
  let result: WebDAVSyncResult
  try {
    result = await performWebDAVUpload(settings)
  } finally {
    uploadInFlight = false
  }
  applyWebdavSyncResult(result, result.ok ? localHash : undefined)
  if (uploadQueued) {
    uploadQueued = false
    setTimeout(() => { void uploadWebDAV() }, 500)
  }
  return result
}

interface RemoteDownloadResult {
  ok: boolean
  message: string
  /** 404 表示远端还没有备份文件（首次同步用），不是错误 */
  status?: number
  payload?: RemotePayload
  todos?: Todo[]
  assetsNote?: string
}

/** 读取远端主备份；`inlineAssets` 为 false 时只取 savedAt / 待办，不下载 blobs/。 */
async function downloadRemotePayload(
  settings: WebDAVSettings,
  options: { inlineAssets?: boolean } = {}
): Promise<RemoteDownloadResult> {
  try {
    const url = remoteFileUrl(settings)
    const response = await downloadWebDAVBytes(url, authHeaders(settings))
    if (response.status === 404) {
      return { ok: false, status: 404, message: '远端没有找到备份文件' }
    }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, status: response.status, message: `下载失败：HTTP ${response.status}` }
    }
    const text = await decodeWebDAVBytes(response.bytes, settings.encryptionPassword)
    const payload = parseRemotePayload(text)
    if (!payload) return { ok: false, message: '远端文件不是有效的待办数据' }
    let todos = payload.todos
    let assetsNote = ''
    // 双向同步先只读主文件判断有无变化，这时不下 blobs/，避免每 5 分钟拉一遍附件
    const refs = options.inlineAssets === false ? [] : collectBlobRefs(todos)
    if (refs.length > 0) {
      // 桌面端可能把图片/附件外置成 blobs/（加密时每个 blob 也是 TTENC2）。
      const base = new URL('blobs/', url).toString()
      const cache = new Map<string, string | null>()
      let missing = 0
      for (const name of refs) {
        let blobResponse: Awaited<ReturnType<typeof downloadWebDAVBytes>>
        try {
          blobResponse = await downloadWebDAVBytes(`${base}${name}`, authHeaders(settings))
        } catch {
          cache.set(name, null)
          missing += 1
          continue
        }
        if (blobResponse.status < 200 || blobResponse.status >= 300) {
          cache.set(name, null)
          missing += 1
          continue
        }
        // 解密失败时中止整个恢复，不导入含损坏/未解密 blob 引用的半成品。
        cache.set(name, await decodeWebDAVBytes(blobResponse.bytes, settings.encryptionPassword))
      }
      const resolve = (name: string): string | null => cache.get(name) ?? null
      todos = todos.map((todo) => ({
        ...todo,
        content: inlineBlobRefs(todo.content, resolve),
        attachments: inlineAttachmentRefs(todo.attachments ?? [], resolve)
      }))
      if (missing > 0) assetsNote = `，${missing} 个图片/附件下载失败`
    }
    return { ok: true, message: '已读取远端备份', payload, todos, assetsNote }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '下载失败' }
  }
}

/** 把远端待办/分组应用到本机，并记下同步基准（本机指纹 + 远端 savedAt）。 */
function applyRemotePayload(payload: RemotePayload, todos: Todo[], remoteSavedAt?: string): void {
  state = normaliseState({
    groups: payload.groups,
    todos,
    settings: state.settings
  })
  applyWebdavSyncResult(
    {
      ok: true,
      message: '已从 WebDAV 读取备份',
      at: new Date().toISOString(),
      remoteSavedAt
    },
    localFingerprint(state)
  )
  // 拉取不触发自动上传：避免刚下载的数据立刻被覆盖回远端。
  lastAutoSyncAt = Date.now()
}

async function restoreWebDAV(): Promise<WebDAVSyncResult> {
  const settings = state.settings.webdav
  if (!settings.url.trim()) return { ok: false, message: '请先在设置中配置 WebDAV' }
  if (uploadInFlight) return { ok: false, message: '正在上传，请稍后再恢复远端备份' }
  if (autoUploadTimer) clearTimeout(autoUploadTimer)
  autoUploadTimer = null
  const remote = await downloadRemotePayload(settings)
  if (!remote.ok || !remote.payload || !remote.todos) {
    return { ok: false, message: remote.message }
  }
  applyRemotePayload(remote.payload, remote.todos, remote.payload.savedAt)
  await persistNow()
  return {
    ok: true,
    message: `已从 WebDAV 恢复（${remote.payload.todos.length} 条待办）${remote.assetsNote ?? ''}`,
    at: new Date().toISOString(),
    remoteSavedAt: remote.payload.savedAt,
    action: 'download'
  }
}

/**
 * 双向同步：先读远端 savedAt 判断哪边有新数据，再决定上传 / 拉取 / 什么都不做。
 * 定时同步、切回前台、设置变更后都走这里。
 */
async function syncWebDAV(options: { notify?: boolean; dirty?: boolean } = {}): Promise<WebDAVSyncResult> {
  const settings = state.settings.webdav
  if (!settings.enabled) return { ok: false, message: 'WebDAV 同步未启用' }
  if (!settings.url.trim()) return { ok: false, message: '请先在设置中配置 WebDAV' }
  if (uploadInFlight) {
    uploadQueued = true
    return { ok: true, message: '正在同步，稍后会自动同步最新数据', action: 'none' }
  }
  uploadInFlight = true
  try {
    return await runWebDAVSync(settings, options.notify !== false, options.dirty === true)
  } finally {
    uploadInFlight = false
    lastAutoSyncAt = Date.now()
    if (uploadQueued) {
      uploadQueued = false
      setTimeout(() => { void uploadWebDAV() }, 500)
    }
  }
}

async function runWebDAVSync(
  settings: WebDAVSettings,
  notify: boolean,
  dirty: boolean
): Promise<WebDAVSyncResult> {
  const localHash = localFingerprint(state)
  // 刚改过本机数据时直接上传，不用先读远端主文件（少一次请求，也省流量）
  const preview =
    dirty && settings.lastSyncedHash
      ? null
      : await downloadRemotePayload(settings, { inlineAssets: false })
  if (preview && !preview.ok && preview.status !== 404) {
    const failed: WebDAVSyncResult = { ok: false, message: preview.message, action: 'none' }
    applyWebdavSyncResult(failed)
    return failed
  }
  const decision = preview
    ? decideWebDAVSync({
        localHash,
        lastSyncedHash: settings.lastSyncedHash,
        remoteSavedAt: preview.ok ? preview.payload?.savedAt : null,
        lastRemoteSavedAt: settings.lastRemoteSavedAt,
        lastSyncAt: settings.lastSyncAt
      })
    : { action: 'upload' as const, conflict: false, reason: '本机有改动，直接上传' }

  if (decision.action === 'download') {
    const full = await downloadRemotePayload(settings)
    if (!full.ok || !full.payload || !full.todos) {
      const failed: WebDAVSyncResult = { ok: false, message: full.message, action: 'none' }
      applyWebdavSyncResult(failed)
      return failed
    }
    applyRemotePayload(full.payload, full.todos, full.payload.savedAt)
    await persistNow()
    emitToast('已从 WebDAV 拉取其他设备的更新', 'info')
    return {
      ok: true,
      message: '已从 WebDAV 拉取其他设备的更新',
      at: new Date().toISOString(),
      remoteSavedAt: full.payload.savedAt,
      action: 'download'
    }
  }

  if (decision.action === 'upload') {
    const uploaded = await performWebDAVUpload(settings)
    applyWebdavSyncResult(uploaded, uploaded.ok ? localHash : undefined)
    // 定时同步失败不弹提示（每隔几分钟一次会打扰），错误看设置页里的「上次错误」
    if (!uploaded.ok && notify) emitToast(`WebDAV 同步失败：${uploaded.message}`, 'error')
    if (uploaded.ok && decision.conflict) {
      emitToast('本机与远端都有改动，已保留本机数据并覆盖远端', 'info')
    }
    return { ...uploaded, action: 'upload' }
  }

  const current: WebDAVSyncResult = {
    ok: true,
    message: '已是最新',
    at: new Date().toISOString(),
    remoteSavedAt: preview?.payload?.savedAt,
    action: 'none'
  }
  applyWebdavSyncResult(current)
  return current
}

/* ------------------------------------------------------------------ */
/* 定时双向同步                                                        */
/* ------------------------------------------------------------------ */

let autoSyncTimer: ReturnType<typeof setInterval> | null = null
let autoSyncKickTimer: ReturnType<typeof setTimeout> | null = null
let lastAutoSyncAt = 0

/** 切后台时定时器会暂停，离开前把待上传的改动立刻发出去，避免改完就切走导致丢了这次同步。 */
function flushPendingWebDAVWork(): void {
  if (autoUploadTimer) {
    clearTimeout(autoUploadTimer)
    autoUploadTimer = null
    void syncWebDAV({ notify: false, dirty: true })
  }
  void persistNow()
}

async function maybeAutoSync(force = false): Promise<void> {
  const settings = state.settings.webdav
  if (!shouldAutoSync(settings)) return
  if (!force && Date.now() - lastAutoSyncAt < settings.syncIntervalMinutes * 60_000) return
  lastAutoSyncAt = Date.now()
  await syncWebDAV({ notify: false })
}

/** 设置变更后尽快同步一次（延迟合并，避免边输入地址边发请求）。 */
function scheduleAutoSyncKick(delay = 1500): void {
  // 定时同步没启动（单测 / 非 DOM 环境）时不做延迟同步
  if (!autoSyncTimer) return
  if (autoSyncKickTimer) clearTimeout(autoSyncKickTimer)
  autoSyncKickTimer = setTimeout(() => {
    autoSyncKickTimer = null
    void maybeAutoSync(true)
  }, delay)
}

function startAutoSync(): void {
  // 单测 / 非 DOM 环境不启动定时器：同步由测试显式调用，避免残留定时器干扰
  if (typeof document === 'undefined' || autoSyncTimer) return
  autoSyncTimer = setInterval(() => {
    void maybeAutoSync()
  }, 60_000)
  // 启动后先同步一次：另一台设备的更新可以立刻拿到
  setTimeout(() => { void maybeAutoSync(true) }, 4000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingWebDAVWork()
    else void maybeAutoSync()
  })
  if (Capacitor.isNativePlatform()) {
    // 部分机型切后台不触发 visibilitychange，原生 resume 更可靠
    void import('@capacitor/app')
      .then(({ App }) => {
        void App.addListener('resume', () => { void maybeAutoSync() })
      })
      .catch(() => undefined)
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

const noSecurity = (): SecurityState => ({
  locked: false,
  hasPassword: false,
  autoLockMinutes: 0
})

export function createCapacitorApi(): TomatoAPI {
  const api: TomatoAPI = {
    platform: Capacitor.getPlatform(),

    getState: async () => {
      await loadState()
      return snapshot()
    },
    onStateChanged: (callback) => {
      stateListeners.add(callback)
      return () => stateListeners.delete(callback)
    },
    onEvent: (callback) => {
      eventListeners.add(callback)
      return () => eventListeners.delete(callback)
    },
    onMaximizedChanged: () => () => undefined,

    addTodo: async (input: AddTodoInput) => {
      await loadState()
      return mutate((draft) => createTodo(draft, input))
    },
    updateTodo: async (id: string, patch: UpdateTodoPatch) => {
      await loadState()
      return mutate((draft) => updateTodo(draft, id, patch))
    },
    toggleTodo: async (id: string, completed: boolean) => {
      await loadState()
      return mutate((draft) => setCompleted(draft, id, completed))
    },
    startTodo: async (id: string) => {
      await loadState()
      return mutate((draft) => startTodo(draft, id))
    },
    archiveTodo: async (id: string) => {
      await loadState()
      return mutate((draft) => archiveTodo(draft, id))
    },
    restoreTodo: async (id: string) => {
      await loadState()
      return mutate((draft) => restoreTodo(draft, id))
    },
    deleteTodoForever: async (id: string) => {
      await loadState()
      return mutate((draft) => deleteTodoPermanently(draft, id))
    },
    recordFocus: async (id: string, minutes: number) => {
      await loadState()
      return mutate((draft) => recordFocus(draft, id, minutes))
    },
    setPinned: async (id: string, pinned: boolean) => {
      await loadState()
      return mutate((draft) => setPinned(draft, id, pinned))
    },

    addGroup: async (name: string) => {
      await loadState()
      return mutate((draft) => createGroup(draft, name))
    },
    updateGroup: async (id: string, patch: { name?: string; color?: string }) => {
      await loadState()
      return mutate((draft) => updateGroup(draft, id, patch))
    },
    deleteGroup: async (id: string) => {
      await loadState()
      return mutate((draft) => deleteGroup(draft, id))
    },

    updateSettings: async (patch: Partial<AppSettings>): Promise<SettingsUpdateResult> => {
      await loadState()
      const previous = state.settings.webdav
      state.settings = mergeSettings(patch)
      // 同步状态字段只由本适配层维护，界面里的旧值不能把刚写入的同步记录覆盖掉
      state.settings = mergeSettings({
        webdav: {
          ...state.settings.webdav,
          lastSyncAt: previous.lastSyncAt,
          lastStatus: previous.lastStatus,
          lastError: previous.lastError,
          lastSyncedHash: previous.lastSyncedHash ?? null,
          lastRemoteSavedAt: previous.lastRemoteSavedAt ?? null
        }
      })
      emit()
      // 刚填好地址 / 改了同步间隔：尽快同步一次（由决策逻辑决定上传还是拉取）
      scheduleAutoSyncKick()
      return { state: snapshot() }
    },
    testAI: async (ai): Promise<AIRequestResult> => {
      try {
        const content = await testAIConnection(ai, request)
        return { ok: true, content, generatedAt: new Date().toISOString(), model: ai.model }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'AI 连接测试失败' }
      }
    },
    listAIModels: async (ai): Promise<AIModelsResult> => {
      try {
        const models = await listAIModels(ai, request)
        return { ok: true, models }
      } catch (error) {
        return {
          ok: false,
          models: [],
          error: error instanceof Error ? error.message : '获取模型列表失败'
        }
      }
    },
    summarise: async (range: SummaryRange, dates?: SummaryDates): Promise<AIRequestResult> => {
      await loadState()
      if (!['day', 'week', 'month', 'year', 'custom'].includes(range)) return { ok: false, error: '时间范围不正确' }
      const ai = state.settings.ai
      if (!ai.apiKey.trim()) return { ok: false, error: '请先在设置中配置 AI 接口和 API 密钥' }
      try {
        const context = buildSummaryContext(state, range, Date.now(), dates)
        const content = await callAIChat(
          ai,
          [
            {
              role: 'system',
              content:
                '你是个人生产力回顾助手。严格依据用户提供的数据输出中文 Markdown，不编造不存在的事实。'
            },
            { role: 'user', content: context.prompt }
          ],
          { fetchImpl: request }
        )
        return { ok: true, content, generatedAt: new Date().toISOString(), model: ai.model }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'AI 总结生成失败' }
      }
    },

    testWebDAV,
    uploadWebDAV,
    syncWebDAV,
    restoreWebDAV,

    saveAttachment: async (input: { name: string; dataUrl: string }): Promise<FileActionResult> => {
      const name = (input?.name ?? '').trim() || 'attachment'
      const parts = splitDataUrl(input?.dataUrl ?? '')
      if (!parts || !parts.base64) return { ok: false, message: '附件内容无效，无法保存' }
      try {
        const binary = atob(parts.base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        const blob = new Blob([bytes], { type: parts.mime })
        const file = new File([blob], name, { type: parts.mime })
        const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> }
        if (nav.share && nav.canShare?.({ files: [file] })) {
          await nav.share({ files: [file], title: name })
          return { ok: true, message: `已分享 ${name}` }
        }
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = name
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        return { ok: true, message: `已保存 ${name}` }
      } catch (error) {
        const message = error instanceof Error ? error.message : '保存附件失败'
        if (/cancel|abort/i.test(message)) return { ok: false, message: '已取消保存' }
        return { ok: false, message }
      }
    },

    exportMarkdown: async (input: MarkdownExportInput): Promise<FileActionResult> => {
      await loadState()
      const scope = input.scope === 'selected' ? 'selected' : 'all'
      const todoIds = scope === 'selected' ? (input.todoIds ?? []) : null
      if (scope === 'selected' && (!todoIds || todoIds.length === 0)) {
        return { ok: false, message: '没有选中要导出的待办' }
      }
      const built = buildExportMarkdown(state, todoIds, {
        includeArchived: input.includeArchived !== false,
        title: scope === 'selected' ? '番茄待办导出' : '番茄待办 · 全部待办'
      })
      const count = todoIds ? todoIds.length : built.markdown.length
      try {
        await api.copyText(built.markdown)
        return {
          ok: true,
          message: `已复制 Markdown 到剪贴板（${todoIds ? `${count} 条待办` : '全部待办'}）`
        }
      } catch {
        return { ok: false, message: '复制到剪贴板失败' }
      }
    },

    exportLocalBackup: async (): Promise<FileActionResult> => {
      await loadState()
      if (!state.settings.localBackup.password.trim()) {
        return { ok: false, message: '请先在设置中填写本地备份密码，备份会用它加密' }
      }
      const payload = createRemotePayload(state)
      try {
        await api.copyText(payload)
        return {
          ok: true,
          message: '手机端暂不写文件：备份 JSON 已复制到剪贴板（未加密，请妥善保管）'
        }
      } catch {
        return { ok: false, message: '复制到剪贴板失败' }
      }
    },

    importLocalBackup: async (): Promise<FileActionResult> => {
      await loadState()
      const text = await readClipboardText()
      if (!text) return { ok: false, message: '剪贴板里没有备份内容' }
      if (looksEncrypted(text)) {
        return { ok: false, message: '剪贴板里是加密备份，手机端暂不支持解密，请在电脑端导入' }
      }
      const payload = parseRemotePayload(text)
      if (!payload) return { ok: false, message: '剪贴板内容不是有效的待办数据' }
      state = normaliseState({ groups: payload.groups, todos: payload.todos, settings: state.settings })
      emit()
      await persistNow()
      return { ok: true, message: `已导入 ${payload.todos.length} 条待办` }
    },

    getMcpInfo: async (): Promise<McpInfo> => ({
      command: '桌面端功能',
      args: [],
      config: '手机端不支持 MCP 服务，数据保存在本机 Preferences 中。',
      dataFile: 'Preferences: tomato-todo-data'
    }),

    getSecurityState: async () => noSecurity(),
    onSecurityChanged: () => () => undefined,
    reportActivity: () => undefined,
    unlock: async (): Promise<SecurityActionResult> => ({
      ok: true,
      state: noSecurity()
    }),
    lockNow: async (): Promise<SecurityActionResult> => ({
      ok: false,
      message: '手机端由系统锁屏保护，无需应用内锁定',
      state: noSecurity()
    }),
    setSecurityPassword: async (): Promise<SecurityActionResult> => ({
      ok: false,
      message: '手机端暂不支持应用内密码',
      state: noSecurity()
    }),
    resetApp: async (): Promise<ResetResult> => {
      await loadState()
      if (autoUploadTimer) clearTimeout(autoUploadTimer)
      autoUploadTimer = null
      uploadQueued = false
      state = createDefaultState()
      emit()
      await persistNow()
      return { ok: true, message: '已重置全部数据' }
    },

    closeSticky: async (todoId: string) => {
      await loadState()
      return mutate((draft) => setPinned(draft, todoId, false))
    },
    openMainWithTodo: async () => undefined,

    copyText: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const area = document.createElement('textarea')
        area.value = text
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
      }
    },
    notify: async () => undefined,
    openExternal: async (url: string) => {
      if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开 http 或 https 链接')
      if (externalPlugin) await externalPlugin.open({ url })
      else window.open(url, '_blank', 'noopener,noreferrer')
    },
    checkForUpdates: async () => {
      try {
        let raw: unknown
        if (Capacitor.isNativePlatform()) {
          const response = await CapacitorHttp.request({
            url: LATEST_RELEASE_API,
            method: 'GET',
            headers: { Accept: 'application/vnd.github+json' },
            responseType: 'json',
            connectTimeout: 8000,
            readTimeout: 10000
          })
          if (response.status !== 200) {
            return { status: 'error', message: `更新检查失败（HTTP ${response.status}）` }
          }
          raw = response.data
        } else {
          const response = await window.fetch(LATEST_RELEASE_API, {
            headers: { Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(10000)
          })
          if (!response.ok) {
            return { status: 'error', message: `更新检查失败（HTTP ${response.status}）` }
          }
          raw = await response.json()
        }
        return evaluateRelease(raw, __APP_VERSION__)
      } catch {
        return { status: 'error', message: '无法连接 GitHub，请检查网络后重试' }
      }
    },

    windowMinimize: async () => undefined,
    windowToggleMaximize: async () => false,
    windowClose: async () => undefined,
    windowIsMaximized: async () => false
  }

  return api
}

/** 测试用：暴露内部状态读取（不进入正式 API 接口）。 */
export const __testing = {
  storageKey: STORAGE_KEY,
  reset: () => {
    state = createDefaultState()
    loadPromise = null
    window.clearTimeout(saveTimer)
  }
}
