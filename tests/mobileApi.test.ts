import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Web / Capacitor 适配层测试。
 *
 * `@capacitor/preferences` 用内存 Map 替代（等价于手机上的 Preferences 存储），
 * `@capacitor/core` 的 CapacitorHttp 用可控的 mock 替代原生 HTTP 桥。
 */
const h = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  request: vi.fn()
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
    update: async () => undefined,
    apply: async () => undefined
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

beforeEach(() => {
  h.storage.clear()
  h.request.mockReset()
})

describe('Web 适配层：状态与持久化', () => {
  it('初始状态为默认分组与空待办', async () => {
    const api = await freshApi()
    const state = await api.getState()
    expect(state.todos).toHaveLength(0)
    expect(state.groups).toHaveLength(1)
    expect(api.platform).toBe('android')
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
    respond('', 201)
    const result = await api.uploadWebDAV()
    expect(result.ok).toBe(true)
    const call = h.request.mock.calls[0][0] as { url: string; method: string; data: string }
    expect(call.method).toBe('PUT')
    expect(call.url).toBe('https://dav.test/remote/tomato-todo/data.json')
    expect(call.data).toContain('备份任务')
    expect(call.data).not.toContain('sk-secret')
  })

  it('远端是加密备份时给出明确提示', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.updateSettings({
      webdav: { ...base.webdav, url: 'https://dav.test/remote/', remotePath: 'data.json' }
    })
    respond('TTENC1xxxxxxxx', 200)
    const result = await api.restoreWebDAV()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('加密备份')
  })

  it('恢复备份时替换待办但保留本机设置', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.updateSettings({
      ai: { ...base.ai, apiKey: 'sk-keep' },
      webdav: { ...base.webdav, url: 'https://dav.test/remote/', remotePath: 'data.json' }
    })
    respond(
      JSON.stringify({
        version: 1,
        app: 'tomato-todo',
        savedAt: '2026-01-01T00:00:00.000Z',
        groups: [{ id: 'inbox', name: '收件箱', color: '#ff6b6b', createdAt: '2026-01-01T00:00:00.000Z' }],
        todos: [
          {
            id: 'remote-1',
            title: '远端来的任务',
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
      }),
      200
    )
    const result = await api.restoreWebDAV()
    expect(result.ok).toBe(true)
    const state = await api.getState()
    expect(state.todos[0].title).toBe('远端来的任务')
    expect(state.settings.ai.apiKey).toBe('sk-keep')
  })

  it('远端文件非法时拒绝导入', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.updateSettings({
      webdav: { ...base.webdav, url: 'https://dav.test/remote/', remotePath: 'data.json' }
    })
    respond('<html>not found</html>', 200)
    const result = await api.restoreWebDAV()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('不是有效的待办数据')
  })

  it('设置加密密码时拒绝上传（手机端不支持）', async () => {
    const api = await freshApi()
    const base = (await api.getState()).settings
    await api.updateSettings({
      webdav: {
        ...base.webdav,
        url: 'https://dav.test/remote/',
        remotePath: 'data.json',
        encryptionPassword: 'pass'
      }
    })
    const result = await api.uploadWebDAV()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('暂不支持加密备份')
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
