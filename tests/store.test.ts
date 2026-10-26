import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppStore } from '../src/main/store'
import { loadStateFile } from '../src/main/persistence'
import { createTodo, setPinned } from '../src/shared/operations'
import { DEFAULT_GROUP_ID } from '../src/shared/defaults'

const dirs: string[] = []

function makeStore(): AppStore {
  const dir = mkdtempSync(join(tmpdir(), 'tomato-store-test-'))
  dirs.push(dir)
  return new AppStore(join(dir, 'data.json'))
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('AppStore 状态与设置', () => {
  it('mutate 修改后会写入磁盘并广播新状态', () => {
    const store = makeStore()
    let notified = 0
    store.onStateChanged = () => {
      notified += 1
    }
    const item = store.mutate((state) => createTodo(state, { title: '落盘任务' }))
    expect(notified).toBe(1)
    const loaded = loadStateFile(store.file)
    expect(loaded.state.todos[0].id).toBe(item.id)
    expect(loaded.state.todos[0].title).toBe('落盘任务')
    store.dispose()
  })

  it('更新 WebDAV 草稿设置时深合并，不影响 AI 设置', () => {
    const store = makeStore()
    store.updateSettings({ ai: { ...store.getState().settings.ai, apiKey: 'sk-keep' } })
    const result = store.updateSettings({
      webdav: {
        enabled: true,
        url: 'https://dav.example.com/',
        remotePath: 'backup/todo.json'
      }
    })
    expect(result.state.settings.ai.apiKey).toBe('sk-keep')
    expect(result.state.settings.webdav.enabled).toBe(true)
    expect(result.state.settings.webdav.url).toBe('https://dav.example.com/')
    expect(result.state.settings.webdav.remotePath).toBe('backup/todo.json')
    expect(result.state.settings.webdav.username).toBe('')
    expect(loadStateFile(store.file).state.settings.webdav.url).toBe('https://dav.example.com/')
    store.dispose()
  })

  it('从远端恢复时覆盖待办与分组、取消固定，但保留本机密钥和 WebDAV 配置', () => {
    const store = makeStore()
    const local = store.mutate((state) => createTodo(state, { title: '本地任务' }))
    store.mutate((state) => setPinned(state, local.id, true))
    store.updateSettings({
      ai: { ...store.getState().settings.ai, apiKey: 'sk-local' },
      webdav: { enabled: true, url: 'https://dav.example.com/', remotePath: 'data.json' }
    })

    const result = store.replaceTodosFromRemote({
      groups: [
        { id: DEFAULT_GROUP_ID, name: '收件箱', color: '#ff625c', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'remote-group', name: '远端分组', color: '#49d49d', createdAt: '2026-01-01T00:00:00.000Z' }
      ],
      todos: [
        {
          id: 'remote-todo',
          title: '远端任务',
          content: '来自备份',
          groupId: 'remote-group',
          urgency: 'urgent',
          pinned: true,
          startedAt: null,
          completedAt: null,
          archivedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })

    expect(result.ok).toBe(true)
    const state = store.getState()
    expect(state.todos).toHaveLength(1)
    expect(state.todos[0].title).toBe('远端任务')
    expect(state.todos[0].groupId).toBe('remote-group')
    expect(state.todos[0].pinned).toBe(false)
    expect(state.groups.some((group) => group.id === 'remote-group')).toBe(true)
    expect(state.settings.ai.apiKey).toBe('sk-local')
    expect(state.settings.webdav.url).toBe('https://dav.example.com/')
    expect(state.settings.webdav.lastStatus).toBe('success')
    expect(state.settings.webdav.lastSyncAt).toBeTruthy()
    store.dispose()
  })

  it('远端数据格式不正确时不覆盖本地数据', () => {
    const store = makeStore()
    const item = store.mutate((state) => createTodo(state, { title: '保留我' }))
    const result = store.replaceTodosFromRemote('bad')
    expect(result.ok).toBe(false)
    expect(store.getState().todos.some((todo) => todo.id === item.id)).toBe(true)
    store.dispose()
  })
})

describe('AppStore 应用重置', () => {
  it('resetApp 清空待办、分组与全部设置并广播', () => {
    const store = makeStore()
    store.mutate((state) => createTodo(state, { title: '将被清除' }))
    store.updateSettings({
      ai: { ...store.getState().settings.ai, apiKey: 'sk-wiped' },
      security: { passwordHash: 'scrypt$aa$bb', autoLockMinutes: 30 }
    })
    let notified = 0
    store.onStateChanged = () => {
      notified += 1
    }
    store.resetApp()
    const state = store.getState()
    expect(state.todos).toHaveLength(0)
    expect(state.groups).toHaveLength(1)
    expect(state.groups[0].id).toBe(DEFAULT_GROUP_ID)
    expect(state.settings.ai.apiKey).toBe('')
    expect(state.settings.security.passwordHash).toBe('')
    expect(notified).toBe(1)
    const loaded = loadStateFile(store.file)
    expect(loaded.state.todos).toHaveLength(0)
    expect(loaded.state.settings.security.passwordHash).toBe('')
    store.dispose()
  })
})
