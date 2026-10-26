/**
 * Web / Capacitor 版 `window.api` 实现。
 *
 * 桌面端由 Electron preload 注入 `window.api`；在手机（Capacitor）或普通浏览器里
 * 没有主进程，因此这里用同一份共享业务逻辑 + Preferences 存储实现相同接口，
 * 让渲染端组件完全不需要区分平台。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import type { TomatoAPI } from '../../../shared/api'
import { callAIChat, listAIModels, testAIConnection } from '../../../shared/aiClient'
import { createRemotePayload, parseRemotePayload } from '../../../shared/backup'
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
import { buildSummaryContext } from '../../../shared/summary'
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
  SummaryRange,
  UpdateTodoPatch,
  WebDAVSettings,
  WebDAVSyncResult,
  WebDAVTestResult
} from '../../../shared/types'

const STORAGE_KEY = 'tomato-todo-data'
const SAVE_DEBOUNCE_MS = 250
const ENCRYPTED_MAGIC = 'TTENC1'

const stateListeners = new Set<(state: AppState) => void>()
const eventListeners = new Set<(event: AppEvent) => void>()

let state: AppState = createDefaultState()
let loadPromise: Promise<void> | null = null
let saveTimer: number | undefined

function snapshot(): AppState {
  return state
}

function emit(): void {
  persistSoon()
  for (const listener of stateListeners) listener(state)
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
  }
  return loadPromise as Promise<void>
}

function mutate(fn: (draft: AppState) => unknown): AppState {
  fn(state)
  emit()
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
  return new Response(text, {
    status: response.status,
    headers: (response.headers ?? {}) as Record<string, string>
  })
}

const request: typeof fetch = Capacitor.isNativePlatform()
  ? (nativeFetch as typeof fetch)
  : ((input, init) => window.fetch(input as RequestInfo, init))

/* ------------------------------------------------------------------ */
/* WebDAV（手机端简化版：仅上传/下载明文 JSON 备份）                        */
/* ------------------------------------------------------------------ */

function remoteFileUrl(settings: WebDAVSettings): string {
  const base = settings.url.trim().replace(/\/+$/, '')
  if (!base) throw new Error('请填写 WebDAV 服务器地址')
  const remotePath = settings.remotePath.trim().replace(/^\/+/, '')
  if (!remotePath) throw new Error('请填写远端文件路径')
  return `${base}/${remotePath}`
}

function authHeaders(settings: WebDAVSettings): Record<string, string> {
  if (!settings.username && !settings.password) return {}
  return { Authorization: `Basic ${btoa(`${settings.username}:${settings.password}`)}` }
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

async function uploadWebDAV(): Promise<WebDAVSyncResult> {
  const settings = state.settings.webdav
  if (!settings.url.trim()) return { ok: false, message: '请先在设置中配置 WebDAV' }
  if (settings.encryptionPassword.trim()) {
    return { ok: false, message: '手机端暂不支持加密备份，请先清空加密密码' }
  }
  try {
    const url = remoteFileUrl(settings)
    const response = await request(url, {
      method: 'PUT',
      headers: { ...authHeaders(settings), 'Content-Type': 'application/json' },
      body: createRemotePayload(state)
    })
    if (response.status >= 200 && response.status < 300) {
      const at = new Date().toISOString()
      state.settings = mergeSettings({ webdav: { ...settings, lastSyncAt: at, lastStatus: 'success', lastError: null } })
      persistSoon()
      return { ok: true, message: '已备份到 WebDAV', at }
    }
    if (response.status === 404 || response.status === 409) {
      return {
        ok: false,
        message: '远端目录不存在，请先在电脑端的备份设置中完成一次上传以创建目录'
      }
    }
    return { ok: false, message: `上传失败：HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '上传失败' }
  }
}

async function restoreWebDAV(): Promise<WebDAVSyncResult> {
  const settings = state.settings.webdav
  if (!settings.url.trim()) return { ok: false, message: '请先在设置中配置 WebDAV' }
  try {
    const url = remoteFileUrl(settings)
    const response = await request(url, { method: 'GET', headers: authHeaders(settings) })
    if (response.status === 404) return { ok: false, message: '远端没有找到备份文件' }
    if (!response.ok) return { ok: false, message: `下载失败：HTTP ${response.status}` }
    const text = await response.text()
    if (text.trimStart().startsWith(ENCRYPTED_MAGIC)) {
      return { ok: false, message: '远端是加密备份，手机端暂不支持恢复加密备份' }
    }
    const payload = parseRemotePayload(text)
    if (!payload) return { ok: false, message: '远端文件不是有效的待办数据' }
    state = normaliseState({ groups: payload.groups, todos: payload.todos, settings: state.settings })
    emit()
    await persistNow()
    return {
      ok: true,
      message: `已从 WebDAV 恢复（${payload.todos.length} 条待办）`,
      at: payload.savedAt
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '恢复失败' }
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
      state.settings = mergeSettings(patch)
      emit()
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
    summarise: async (range: SummaryRange): Promise<AIRequestResult> => {
      await loadState()
      if (!['week', 'month', 'year'].includes(range)) return { ok: false, error: '时间范围不正确' }
      const ai = state.settings.ai
      if (!ai.apiKey.trim()) return { ok: false, error: '请先在设置中配置 AI 接口和 API 密钥' }
      try {
        const context = buildSummaryContext(state, range)
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
    restoreWebDAV,

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
      if (text.trimStart().startsWith(ENCRYPTED_MAGIC)) {
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
      window.open(url, '_blank')
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
