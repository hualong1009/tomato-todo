import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptBackup } from '../src/main/backupCrypto'
import { blobNameFor } from '../src/shared/blobSync'

/**
 * Web / Capacitor 适配层测试。
 *
 * `@capacitor/preferences` 用内存 Map 替代（等价于手机上的 Preferences 存储），
 * `@capacitor/core` 的 CapacitorHttp 用可控的 mock 替代原生 HTTP 桥。
 */
const h = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  request: vi.fn(),
  binaryPut: vi.fn(),
  binaryGet: vi.fn(),
  binaryRequest: vi.fn(),
  externalOpen: vi.fn(),
  themeApply: vi.fn(),
  insetsActivate: vi.fn()
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({
      value: h.storage.has(key) ? (h.storage.get(key) as string) : null
    }),
    set: async ({ key, value }: { key: string; value: string }) => {
      h.storage.set(key, value)
    },
    remove: async ({ key }: { key: string }) => {
      h.storage.delete(key)
    }
  }
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'android',
    isNativePlatform: () => true
  },
  CapacitorHttp: {
    request: (...args: unknown[]) => h.request(...args)
  },
  registerPlugin: () => ({
    put: (...args: unknown[]) => h.binaryPut(...args),
    get: (...args: unknown[]) => h.binaryGet(...args),
    request: (...args: unknown[]) => h.binaryRequest(...args),
    open: (...args: unknown[]) => h.externalOpen(...args),
    update: async () => undefined,
    apply: (...args: unknown[]) => h.themeApply(...args),
    activateWebViewInsets: (...args: unknown[]) => h.insetsActivate(...args),
    addListener: async () => ({ remove: () => undefined })
  })
}))

const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

async function freshApi() {
  vi.resetModules()
  const { createCapacitorApi } = await import('../src/renderer/src/platform/capacitorApi')
  return createCapacitorApi()
}

function respond(data: unknown, status = 200) {
  h.request.mockResolvedValueOnce({ status, data, headers: {} })
}

/** Android WebDAV 原生插件总是把原始下载字节经桥接编码为 base64。 */
function respondBytes(data: Uint8Array, status = 200) {
  h.binaryGet.mockResolvedValueOnce({ status, data: Buffer.from(data).toString('base64') })
}

function respondDAV(status: number, data = '') {
  h.binaryRequest.mockResolvedValueOnce({ status, data })
}

beforeEach(() => {
  h.storage.clear()
  h.request.mockReset()
  h.binaryPut.mockReset()
  h.binaryGet.mockReset()
  h.binaryRequest.mockReset()
  h.externalOpen.mockReset()
  h.themeApply.mockReset().mockResolvedValue(undefined)
  h.insetsActivate.mockReset().mockResolvedValue({ top: 40, bottom: 30, left: 0, right: 0 })
})

describe('Web 适配层：状态与持久化', () => {
  it('全新安装（Preferences 无数据）也会同步系统主题与 WebView insets', async () => {
    const api = await freshApi()
    const state = await api.getState()
    expect(state.todos).toHaveLength(0)
    expect(state.groups).toHaveLength(1)
    expect(api.platform).toBe('android')
    expect(state.settings.general.theme).toBe('system')
    // 无 window 的测试环境视为系统浅色；旧逻辑在 value 为 null 时会提前 return。
    expect(h.themeApply).toHaveBeenCalledWith({ scheme: 'light' })
    expect(h.insetsActivate).toHaveBeenCalledTimes(1)
  })

  it('已有数据与损坏数据启动时也能同步对应主题', async () => {
    const initial = await freshApi()
    const saved = await initial.getState()
    saved.settings.general.theme = 'dark'
    h.storage.set('tomato-todo-data', JSON.stringify(saved))
    h.themeApply.mockClear()
    h.insetsActivate.mockClear()
    const reloaded = await freshApi()
    await reloaded.getState()
    expect(h.themeApply).toHaveBeenCalledWith({ scheme: 'dark' })
    expect(h.insetsActivate).toHaveBeenCalledTimes(1)

    h.storage.set('tomato-todo-data', '{invalid')
    h.themeApply.mockClear()
    h.insetsActivate.mockClear()
    const fallback = await freshApi()
    await fallback.getState()
    expect(h.themeApply).toHaveBeenCalledWith({ scheme: 'light' })
    expect(h.insetsActivate).toHaveBeenCalledTimes(1)
  })

  it('新增待办会写入存储并广播', async () => {
    const api = await freshApi()
    const seen: number[] = []
    api.onStateChanged((next) => seen.push(next.todos.length))
    const state = await api.addTodo({ title: '手机待办', groupId: 'inbox' })
    expect(state.todos[0].title).toBe('手机待办')
    expect(seen).toEqual([1])
    await flush()
    expect(h.storage.get('tomato-todo-data')).toContain('手机待办')
  })

  it('重新加载模块后能恢复已保存的待办', async () => {
    const api = await freshApi()
    await api.addTodo({ title: '持久化任务', groupId: 'inbox' })
    await flush()
    const reloaded = await freshApi()
    const state = await reloaded.getState()
    expect(state.todos[0].title).toBe('持久化任务')
  })

  it('完成 / 归档 / 恢复 / 永久删除 流程', async () => {
    const api = await freshApi()
    const created = await api.addTodo({ title: '流程任务', groupId: 'inbox' })
    const id = created.todos[0].id
    let state = await api.toggleTodo(id, true)
    expect(state.todos[0].completedAt).toBeTruthy()
    state = await api.archiveTodo(id)
    expect(state.todos[0].archivedAt).toBeTruthy()
    state = await api.restoreTodo(id)
    expect(state.todos[0].archivedAt).toBeNull()
    state = await api.deleteTodoForever(id)
    expect(state.todos).toHaveLength(0)
  })

  it('更新设置时深合并，不影响其他字段', async () => {
    const api = await freshApi()
    const first = await api.updateSettings({
      ai: { ...(await api.getState()).settings.ai, apiKey: 'sk-1' }
    })
    expect(first.state.settings.ai.apiKey).toBe('sk-1')
    const second = await api.updateSettings({
      general: { ...first.state.settings.general, theme: 'light' }
    })
    expect(second.state.settings.general.theme).toBe('light')
    expect(second.state.settings.ai.apiKey).toBe('sk-1')
  })

  it('resetApp 清空全部数据与设置', async () => {
    const api = await freshApi()
    await api.addTodo({ title: '将被清除', groupId: 'inbox' })
    await api.updateSettings({ ai: { ...(await api.getState()).settings.ai, apiKey: 'sk-x' } })
    const result = await api.resetApp()
    expect(result.ok).toBe(true)
    const state = await api.getState()
    expect(state.todos).toHaveLength(0)
    expect(state.settings.ai.apiKey).toBe('')
  })
})

describe('Web 适配层：GitHub Releases 更新', () => {
  it('使用原生 HTTP 检查最新版本，并通过系统浏览器打开发布页', async () => {
    vi.stubGlobal('__APP_VERSION__', '1.2.7')
    const api = await freshApi()
    respond({ tag_name: 'v1.2.8', html_url: 'https://evil.test' })
    expect(await api.checkForUpdates()).toEqual({
      status: 'available', version: '1.2.8',
      url: 'https://github.com/hualong1009/tomato-todo/releases/latest'
    })
    expect(h.request.mock.calls[0][0]).toMatchObject({
      method: 'GET', url: 'https://api.github.com/repos/hualong1009/tomato-todo/releases/latest'
    })
    h.externalOpen.mockResolvedValueOnce(undefined)
    await api.openExternal('https://github.com/hualong1009/tomato-todo/releases/latest')
    expect(h.externalOpen).toHaveBeenCalledWith({
      url: 'https://github.com/hualong1009/tomato-todo/releases/latest'
    })
    vi.unstubAllGlobals()
  })

  it('断网时返回错误而不影响应用', async () => {
    vi.stubGlobal('__APP_VERSION__', '1.2.7')
    const api = await freshApi()
    h.request.mockRejectedValueOnce(new Error('offline'))
    expect((await api.checkForUpdates()).status).toBe('error')
    vi.unstubAllGlobals()
  })
})

describe('Web 适配层：AI 与 WebDAV', () => {
  it('summarise 通过原生 HTTP 调用 AI 接口', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.updateSettings({
      ai: { ...base.ai, provider: 'openai', baseUrl: 'https://gw.test/v1', apiKey: 'sk-1', model: 'm1' }
    })
    await api.addTodo({ title: '周报任务', groupId: 'inbox' })
    respond({ choices: [{ message: { content: '## 本周总结' } }] })
    const result = await api.summarise('week')
    expect(result.ok).toBe(true)
    expect(result.content).toBe('## 本周总结')
    const call = h.request.mock.calls[0][0] as { url: string; method: string }
    expect(call.url).toBe('https://gw.test/v1/chat/completions')
    expect(call.method).toBe('POST')
  })

  it('summarise 在未配置 API Key 时给出提示', async () => {
    const api = await freshApi()
    const result = await api.summarise('week')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('API 密钥')
  })

  it('listAIModels 解析模型列表', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    const ai = { ...base.ai, provider: 'openai' as const, baseUrl: 'https://gw.test/v1', apiKey: 'sk-1' }
    respond({ data: [{ id: 'qwen3' }, { id: 'Qwen3-32B' }] })
    const result = await api.listAIModels(ai)
    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['qwen3', 'Qwen3-32B'])
  })

  it('上传备份时写入明文 JSON，且不包含密钥', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.updateSettings({
      ai: { ...base.ai, apiKey: 'sk-secret' },
      webdav: {
        ...base.webdav,
        url: 'https://dav.test/remote/',
        remotePath: 'tomato-todo/data.json',
        enabled: true
      }
    })
    await api.addTodo({ title: '备份任务', groupId: 'inbox' })
    respondDAV(201) // MKCOL tomato-todo/
    respond('', 201) // PUT data.json
    const result = await api.uploadWebDAV()
    expect(result.ok).toBe(true)
    expect(h.binaryRequest.mock.calls[0][0].method).toBe('MKCOL')
    const call = h.request.mock.calls[0][0] as { url: string; method: string; data: string }
    expect(call.method).toBe('PUT')
    expect(call.url).toBe('https://dav.test/remote/tomato-todo/data.json')
    expect(call.data).toContain('备份任务')
    expect(call.data).not.toContain('sk-secret')
  })

  it('未填写加密密码时提示设置密码，并保留本机数据', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.addTodo({ title: '本机任务' })
    await api.updateSettings({
      webdav: { ...base.webdav, url: 'https://dav.test/remote/', remotePath: 'data.json' }
    })
    respondBytes(encryptBackup('{"groups":[],"todos":[]}', 'pass'))
    const result = await api.restoreWebDAV()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('加密密码')
    expect((await api.getState()).todos[0].title).toBe('本机任务')
  })

  it('恢复备份时替换待办但保留本机设置', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.updateSettings({
      ai: { ...base.ai, apiKey: 'sk-keep' },
      webdav: { ...base.webdav, url: 'https://dav.test/remote/', remotePath: 'data.json' }
    })
    respondBytes(new TextEncoder().encode(JSON.stringify(
      {
        version: 1,
        app: 'tomato-todo',
        savedAt: '2026-01-01T00:00:00.000Z',
        groups: [{ id: 'inbox', name: '收件箱', color: '#ff6b6b', createdAt: '2026-01-01T00:00:00.000Z' }],
        todos: [
          {
            id: 'remote-1',
            title: '远端来的中文任务 🍅',
            content: '',
            groupId: 'inbox',
            urgency: 'medium',
            expectedAt: null,
            startedAt: null,
            completedAt: null,
            archivedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            pinned: false,
            pomodoroCount: 0,
            focusMinutes: 0,
            focusLog: []
          }
        ]
      }
    )))
    const result = await api.restoreWebDAV()
    expect(result.ok).toBe(true)
    const state = await api.getState()
    expect(state.todos[0].title).toBe('远端来的中文任务 🍅')
    expect(state.settings.ai.apiKey).toBe('sk-keep')
    expect(h.binaryGet).toHaveBeenCalledTimes(1)
    expect(h.request).not.toHaveBeenCalled()
  })

  it('原生桥返回非 base64 文本时安全报错，不覆盖本机数据', async () => {
    const api = await freshApi()
    const original = await api.addTodo({ title: '本机任务' })
    await api.updateSettings({ webdav: {
      ...original.settings.webdav, url: 'https://dav.test/remote/', remotePath: 'data.json'
    } })
    h.binaryGet.mockResolvedValueOnce({ status: 200, data: '中文错误体' })
    const result = await api.restoreWebDAV()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('编码异常')
    expect((await api.getState()).todos[0].title).toBe('本机任务')
  })

  it('远端文件非法时拒绝导入', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.updateSettings({
      webdav: { ...base.webdav, url: 'https://dav.test/remote/', remotePath: 'data.json' }
    })
    respondBytes(new TextEncoder().encode('<html>not found</html>'))
    const result = await api.restoreWebDAV()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('不是有效的待办数据')
  })

  it('恢复桌面端 TTENC2 主文件和加密 blobs，同时保留本机设置', async () => {
    const api = await freshApi()
    const initial = await api.addTodo({ title: '旧本机任务' })
    const settings = initial.settings
    const imageName = 'aaaaaaaaaaaaaaaa.webp'
    const attachmentName = 'bbbbbbbbbbbbbbbb.bin'
    const imageData = 'data:image/webp;base64,QUJD'
    const attachmentData = 'data:application/octet-stream;base64,REVG'
    const todo = {
      ...initial.todos[0],
      id: 'from-desktop',
      title: '跨设备的加密任务',
      content: `图片 ![示例](blob:${imageName})`,
      attachments: [{
        id: 'attachment-1', name: '资料.bin', mime: 'application/octet-stream',
        size: 3, data: `blob:${attachmentName}`, createdAt: new Date().toISOString()
      }]
    }
    await api.updateSettings({
      ai: { ...settings.ai, apiKey: 'sk-local-only' },
      webdav: {
        ...settings.webdav,
        url: 'https://dav.test/remote/', remotePath: 'tomato-todo/data.json',
        encryptionPassword: '🍅 测试密码'
      }
    })
    respondBytes(encryptBackup(JSON.stringify({
      version: 2, app: 'tomato-todo', savedAt: '2026-01-01T00:00:00.000Z',
      groups: initial.groups, todos: [todo], assets: [{ name: imageName }, { name: attachmentName }]
    }), '🍅 测试密码'))
    respondBytes(encryptBackup(imageData, '🍅 测试密码'))
    respondBytes(encryptBackup(attachmentData, '🍅 测试密码'))
    const result = await api.restoreWebDAV()
    expect(result.ok).toBe(true)
    const restored = await api.getState()
    expect(restored.todos).toHaveLength(1)
    expect(restored.todos[0].title).toBe('跨设备的加密任务')
    expect(restored.todos[0].content).toContain(`![示例](${imageData})`)
    expect(restored.todos[0].attachments[0].data).toBe(attachmentData)
    expect(restored.settings.ai.apiKey).toBe('sk-local-only')
    expect(restored.settings.webdav.encryptionPassword).toBe('🍅 测试密码')
    expect(restored.settings.webdav.lastStatus).toBe('success')
    expect(restored.settings.webdav.lastSyncAt).toBeTruthy()
    expect(h.binaryGet.mock.calls.map(([call]) => call.url)).toEqual([
      'https://dav.test/remote/tomato-todo/data.json',
      `https://dav.test/remote/tomato-todo/blobs/${imageName}`,
      `https://dav.test/remote/tomato-todo/blobs/${attachmentName}`
    ])
    expect(h.request).not.toHaveBeenCalled()
  })

  it('密码错误或外置加密资源损坏时不会覆盖本机待办', async () => {
    const api = await freshApi()
    const original = await api.addTodo({ title: '本机任务不应丢失' })
    await api.updateSettings({ webdav: {
      ...original.settings.webdav, url: 'https://dav.test/remote/',
      remotePath: 'data.json', encryptionPassword: '错误密码'
    } })
    const encrypted = encryptBackup(JSON.stringify({
      app: 'tomato-todo', groups: original.groups, todos: []
    }), '正确密码')
    respondBytes(encrypted)
    const wrongPassword = await api.restoreWebDAV()
    expect(wrongPassword.ok).toBe(false)
    expect(wrongPassword.message).toContain('密码不正确')
    expect((await api.getState()).todos[0].title).toBe('本机任务不应丢失')

    const settings = (await api.getState()).settings.webdav
    await api.updateSettings({ webdav: { ...settings, encryptionPassword: '正确密码' } })
    const blob = 'cccccccccccccccc.webp'
    respondBytes(encryptBackup(JSON.stringify({
      app: 'tomato-todo', groups: original.groups,
      todos: [{ ...original.todos[0], content: `![图](blob:${blob})` }]
    }), '正确密码'))
    respondBytes(encryptBackup('data:image/webp;base64,QUJD', '另一密码'))
    const brokenBlob = await api.restoreWebDAV()
    expect(brokenBlob.ok).toBe(false)
    expect(brokenBlob.message).toContain('密码不正确')
    expect((await api.getState()).todos[0].content).toBe('')
  })

  it('设置加密密码后可生成桌面端能读取的 TTENC2 主备份', async () => {
    const api = await freshApi()
    const settings = (await api.getState()).settings.webdav
    await api.updateSettings({ webdav: {
      ...settings, url: 'https://dav.test/root/', remotePath: 'tomato-todo/data.json',
      encryptionPassword: '🍅 shared-password'
    } })
    await api.addTodo({ title: '手机端修改后的任务' })
    respondDAV(201) // 创建远端目录
    h.binaryPut.mockResolvedValueOnce({ status: 201 })
    const result = await api.uploadWebDAV()
    expect(result.ok).toBe(true)
    const put = h.binaryPut.mock.calls[0][0] as { url: string; headers: Record<string, string>; data: string }
    expect(put.url).toBe('https://dav.test/root/tomato-todo/data.json')
    expect(put.headers['Content-Type']).toBe('application/octet-stream')
    const { decryptBackup } = await import('../src/main/backupCrypto')
    const saved = JSON.parse(decryptBackup(Buffer.from(put.data, 'base64'), '🍅 shared-password'))
    expect(saved.todos[0].title).toBe('手机端修改后的任务')
    expect(saved.groups.length).toBeGreaterThan(0)
    expect(saved).not.toHaveProperty('settings')
    expect(h.binaryRequest.mock.calls.map(([call]) => call.method)).toEqual(['MKCOL'])
  })

  it('外置图片与附件先于主文件上传，桌面端可解密全部资源', async () => {
    const api = await freshApi()
    const image = 'data:image/png;base64,QUJD'
    const attachment = 'data:application/pdf;base64,REVG'
    const base = (await api.getState()).settings.webdav
    await api.updateSettings({ webdav: {
      ...base, url: 'https://dav.test/root/', remotePath: 'tomato-todo/data.json',
      encryptionPassword: 'shared-secret'
    } })
    await api.addTodo({
      title: '移动端图片与附件', content: `![截图](${image})`,
      attachments: [{ id: 'att-1', name: '报告.pdf', mime: 'application/pdf',
        size: 3, data: attachment, createdAt: new Date().toISOString() }]
    })
    respondDAV(201) // MKCOL tomato-todo/
    respondDAV(405) // 目录已存在
    respondDAV(201) // MKCOL blobs/
    respondDAV(207, '<d:multistatus xmlns:d="DAV:"/>') // PROPFIND blobs/
    h.binaryPut.mockResolvedValue({ status: 201 })
    const result = await api.uploadWebDAV()
    expect(result.ok).toBe(true)
    expect(h.binaryPut).toHaveBeenCalledTimes(3) // 图片、附件、主文件
    const puts = h.binaryPut.mock.calls.map(([options]) => options as { url: string; data: string })
    const { decryptBackup } = await import('../src/main/backupCrypto')
    const decoded = puts.map((item) => decryptBackup(Buffer.from(item.data, 'base64'), 'shared-secret'))
    expect(decoded).toContain(image)
    expect(decoded).toContain(attachment)
    const main = JSON.parse(decoded[2])
    expect(main.version).toBe(2)
    expect(main.todos[0].content).toMatch(/!\[截图\]\(blob:[a-f0-9]{16}\.png\)/)
    expect(main.todos[0].attachments[0].data).toMatch(/^blob:[a-f0-9]{16}\.pdf$/)
    expect(main.assets).toHaveLength(2)
    expect(puts[2].url).toBe('https://dav.test/root/tomato-todo/data.json')
    expect((await api.getState()).todos[0].content).toContain(image) // 本地仍自包含

    // 真正通过桌面端的恢复逻辑读取手机上传的全部密文，验证双向互通。
    const { downloadFromWebDAV } = await import('../src/main/webdav')
    const stored = new Map(puts.map((item) => [item.url, Buffer.from(item.data, 'base64')]))
    const desktop = await downloadFromWebDAV((await api.getState()).settings.webdav,
      async (input) => {
        const bytes = stored.get(String(input))
        return bytes ? new Response(bytes, { status: 200 }) : new Response(null, { status: 404 })
      })
    expect(desktop.ok).toBe(true)
    const desktopTodos = (desktop.raw as { todos: Array<{ content: string; attachments: Array<{ data: string }> }> }).todos
    expect(desktopTodos[0].content).toContain(image)
    expect(desktopTodos[0].attachments[0].data).toBe(attachment)
  })

  it('已有同名资源使用旧密码时重新加密，避免主文件引用不可解密资源', async () => {
    const api = await freshApi()
    const image = 'data:image/png;base64,QUJD'
    const name = blobNameFor(image)
    const initial = (await api.getState()).settings.webdav
    await api.updateSettings({ webdav: {
      ...initial, url: 'https://dav.test/root/', remotePath: 'data.json',
      encryptionPassword: 'new-password'
    } })
    await api.addTodo({ title: '图片', content: `![图](${image})` })
    respondDAV(201) // MKCOL blobs/
    respondDAV(207, `<d:href>/root/blobs/${name}</d:href>`)
    respondBytes(encryptBackup(image, 'old-password'))
    h.binaryPut.mockResolvedValue({ status: 201 })
    const result = await api.uploadWebDAV()
    expect(result.ok).toBe(true)
    expect(h.binaryPut).toHaveBeenCalledTimes(2) // 重传图片，再传主文件
    const first = h.binaryPut.mock.calls[0][0] as { url: string; data: string }
    expect(first.url).toBe(`https://dav.test/root/blobs/${name}`)
    const { decryptBackup } = await import('../src/main/backupCrypto')
    expect(decryptBackup(Buffer.from(first.data, 'base64'), 'new-password')).toBe(image)
  })

  it('附件上传失败时不写远端主文件，且自动上传会在待办变动后触发', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings.webdav
    await api.updateSettings({ webdav: {
      ...base, url: 'https://dav.test/root/', remotePath: 'data.json',
      encryptionPassword: 'pass', enabled: false
    } })
    await api.addTodo({ title: '含附件', attachments: [{ id: '1', name: 'x', mime: 'text/plain',
      size: 3, data: 'data:text/plain;base64,QUJD', createdAt: new Date().toISOString() }] })
    respondDAV(201) // MKCOL blobs/
    respondDAV(207, '<d:multistatus xmlns:d="DAV:"/>')
    h.binaryPut.mockResolvedValueOnce({ status: 507 })
    const failed = await api.uploadWebDAV()
    expect(failed.ok).toBe(false)
    expect(h.binaryPut).toHaveBeenCalledTimes(1)
    expect((await api.getState()).settings.webdav.lastStatus).toBe('error')

    const settings = (await api.getState()).settings.webdav
    await api.updateSettings({ webdav: { ...settings, enabled: true, autoUpload: true, splitAssets: false } })
    // 无需显式调用 uploadWebDAV：本地编辑自动排队上传。
    h.binaryPut.mockResolvedValueOnce({ status: 201 })
    await api.addTodo({ title: '自动同步的新待办' })
    await new Promise((resolve) => setTimeout(resolve, 1900))
    expect(h.binaryPut).toHaveBeenCalledTimes(2)
    expect((await api.getState()).settings.webdav.lastStatus).toBe('success')
  })

  it('双向同步：远端有更新且本机无改动时拉取远端', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings.webdav
    await api.updateSettings({
      webdav: {
        ...base,
        url: 'https://dav.test/remote/',
        remotePath: 'data.json',
        enabled: true,
        autoUpload: false,
        splitAssets: false
      }
    })
    const remote = JSON.stringify({
      version: 1,
      app: 'tomato-todo',
      savedAt: '2026-01-02T00:00:00.000Z',
      groups: [{ id: 'inbox', name: '收件箱', color: '#ff6b6b', createdAt: '2026-01-01T00:00:00.000Z' }],
      todos: [
        {
          id: 'remote-sync-1',
          title: '另一台设备改的',
          content: '',
          groupId: 'inbox',
          urgency: 'medium',
          expectedAt: null,
          startedAt: null,
          completedAt: null,
          archivedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          pinned: false,
          pomodoroCount: 0,
          focusMinutes: 0,
          focusLog: []
        }
      ]
    })
    // 先只读主文件判断有无变化，再下载一次内联资源
    respondBytes(new TextEncoder().encode(remote))
    respondBytes(new TextEncoder().encode(remote))
    const result = await api.syncWebDAV()
    expect(result.ok).toBe(true)
    expect(result.action).toBe('download')
    const state = await api.getState()
    expect(state.todos.map((todo) => todo.title)).toEqual(['另一台设备改的'])
    expect(state.settings.webdav.lastSyncedHash).toBeTruthy()
    expect(state.settings.webdav.lastRemoteSavedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('双向同步：本机改动且远端没变时上传', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings.webdav
    await api.updateSettings({
      webdav: {
        ...base,
        url: 'https://dav.test/remote/',
        remotePath: 'data.json',
        enabled: true,
        autoUpload: false,
        splitAssets: false
      }
    })
    await api.addTodo({ title: '手机新增' })
    h.binaryGet.mockResolvedValueOnce({ status: 404, data: '' })
    respondDAV(201) // MKCOL
    respond('', 201) // PUT
    const result = await api.syncWebDAV()
    expect(result.ok).toBe(true)
    expect(result.action).toBe('upload')
    const call = h.request.mock.calls[0][0] as { method: string; data: string }
    expect(call.method).toBe('PUT')
    expect(call.data).toContain('手机新增')
    expect((await api.getState()).settings.webdav.lastSyncedHash).toBeTruthy()

    // 再同步一次：两边一致，不再传输
    respondBytes(new TextEncoder().encode(call.data))
    const again = await api.syncWebDAV()
    expect(again.action).toBe('none')
  })

  it('双向同步：两端都改过时保留本机数据并覆盖远端', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings.webdav
    await api.updateSettings({
      webdav: {
        ...base,
        url: 'https://dav.test/remote/',
        remotePath: 'data.json',
        enabled: true,
        autoUpload: false,
        splitAssets: false
      }
    })
    const first = await api.addTodo({ title: '本机第一版' })
    // 建立同步基准：远端为空 → 上传
    h.binaryGet.mockResolvedValueOnce({ status: 404, data: '' })
    respondDAV(201)
    respond('', 201)
    await api.syncWebDAV()
    expect(first.todos[0].title).toBe('本机第一版')

    // 本机再改
    await api.addTodo({ title: '本机后续改动' })
    // 远端被另一台设备覆盖，且 savedAt 更新
    const remote = JSON.stringify({
      version: 1,
      app: 'tomato-todo',
      savedAt: new Date(Date.now() + 60_000).toISOString(),
      groups: [{ id: 'inbox', name: '收件箱', color: '#ff6b6b', createdAt: '2026-01-01T00:00:00.000Z' }],
      todos: []
    })
    respondBytes(new TextEncoder().encode(remote))
    respondDAV(201)
    respond('', 201)
    const result = await api.syncWebDAV()
    expect(result.ok).toBe(true)
    expect(result.action).toBe('upload')
    const put = h.request.mock.calls.at(-1)?.[0] as { method: string; data: string }
    expect(put.method).toBe('PUT')
    expect(put.data).toContain('本机后续改动')
    const state = await api.getState()
    expect(state.todos.map((todo) => todo.title)).toContain('本机后续改动')
  })
})

describe('Web 适配层：桌面专属功能降级', () => {
  it('安全相关接口在手机端为无密码且不可锁定', async () => {
    const api = await freshApi()
    const state = await api.getSecurityState()
    expect(state.hasPassword).toBe(false)
    expect(state.locked).toBe(false)
    const locked = await api.lockNow()
    expect(locked.ok).toBe(false)
    const setPassword = await api.setSecurityPassword({ newPassword: 'x' })
    expect(setPassword.ok).toBe(false)
  })

  it('窗口操作与 MCP 查询安全降级', async () => {
    const api = await freshApi()
    expect(await api.windowIsMaximized()).toBe(false)
    expect(await api.windowToggleMaximize()).toBe(false)
    const info = await api.getMcpInfo()
    expect(info.config).toContain('不支持 MCP')
  })

  it('取消固定只修改状态，不涉及桌面便签窗口', async () => {
    const api = await freshApi()
    const created = await api.addTodo({ title: '固定任务', groupId: 'inbox' })
    const pinned = await api.setPinned(created.todos[0].id, true)
    expect(pinned.todos[0].pinned).toBe(true)
    const unpinned = await api.closeSticky(created.todos[0].id)
    expect(unpinned.todos[0].pinned).toBe(false)
  })
})
