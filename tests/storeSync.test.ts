import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from '../src/main/store'
import { createRemotePayload } from '../src/shared/backup'
import { createTodo } from '../src/shared/operations'
import { makeState } from './helpers'

/**
 * 桌面端双向同步：主进程 AppStore 与一个内存版 WebDAV 服务器对接，
 * 覆盖「本机改动上传 / 远端更新拉取 / 两端冲突 / 无变化不传输」。
 */
const dirs: string[] = []

function makeStore(fetchImpl: typeof fetch): AppStore {
  const dir = mkdtempSync(join(tmpdir(), 'tomato-sync-test-'))
  dirs.push(dir)
  return new AppStore(join(dir, 'data.json'), fetchImpl)
}

afterEach(() => {
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface DavServer {
  body: string | null
  puts: number
  gets: number
  fetch: typeof fetch
}

function davServer(initial: string | null = null): DavServer {
  const server = { body: initial, puts: 0, gets: 0 } as DavServer
  server.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'MKCOL') return new Response('', { status: 201 })
    if (method === 'PUT') {
      server.puts += 1
      server.body = typeof init?.body === 'string' ? init.body : ''
      return new Response('', { status: 201 })
    }
    if (method === 'GET') {
      server.gets += 1
      return server.body
        ? new Response(server.body, { status: 200 })
        : new Response('', { status: 404 })
    }
    return new Response('', { status: 405 })
  }) as typeof fetch
  return server
}

function configure(store: AppStore) {
  return store.updateSettings({
    webdav: {
      enabled: true,
      url: 'https://dav.test/root/',
      remotePath: 'tomato-todo/data.json',
      // 关掉「变动后立即上传」，让测试只观察显式调用的双向同步
      autoUpload: false,
      syncIntervalMinutes: 5
    }
  })
}

describe('桌面端 WebDAV 双向同步', () => {
  it('远端没有备份时上传本机数据，并记录同步基准', async () => {
    const server = davServer()
    const store = makeStore(server.fetch)
    configure(store)
    store.mutate((state) => createTodo(state, { title: '桌面新增' }))

    const result = await store.syncWebDAV()
    expect(result.ok).toBe(true)
    expect(result.action).toBe('upload')
    expect(server.body).toContain('桌面新增')

    const webdav = store.getState().settings.webdav
    expect(webdav.lastStatus).toBe('success')
    expect(webdav.lastSyncedHash).toBeTruthy()
    expect(webdav.lastRemoteSavedAt).toBeTruthy()
    store.dispose()
  })

  it('上传后再同步不会重复传输', async () => {
    const server = davServer()
    const store = makeStore(server.fetch)
    configure(store)
    store.mutate((state) => createTodo(state, { title: '只传一次' }))

    await store.syncWebDAV()
    expect(server.puts).toBe(1)
    const second = await store.syncWebDAV()
    expect(second.ok).toBe(true)
    expect(second.action).toBe('none')
    expect(server.puts).toBe(1)
    store.dispose()
  })

  it('本机没改、远端被其他设备更新时自动拉取', async () => {
    const remote = makeState()
    createTodo(remote, { title: '手机改的' })
    const server = davServer(createRemotePayload(remote))
    const store = makeStore(server.fetch)
    configure(store)

    const result = await store.syncWebDAV()
    expect(result.ok).toBe(true)
    expect(result.action).toBe('download')
    expect(store.getState().todos.map((todo) => todo.title)).toEqual(['手机改的'])
    expect(result.remoteSavedAt).toBeTruthy()
    store.dispose()
  })

  it('两端都有改动时保留本机数据并覆盖远端', async () => {
    const server = davServer()
    const store = makeStore(server.fetch)
    configure(store)
    store.mutate((state) => createTodo(state, { title: '第一版' }))
    await store.syncWebDAV()

    store.mutate((state) => createTodo(state, { title: '本机后续改动' }))
    const other = makeState()
    createTodo(other, { title: '其他设备的改动' })
    server.body = createRemotePayload(other, new Date(Date.now() + 60_000).toISOString())

    const result = await store.syncWebDAV()
    expect(result.ok).toBe(true)
    expect(result.action).toBe('upload')
    expect(server.body).toContain('本机后续改动')
    expect(server.body).not.toContain('其他设备的改动')
    expect(store.getState().todos.map((todo) => todo.title)).toContain('本机后续改动')
    store.dispose()
  })

  it('本机改动后约 1.6 秒自动同步，且直接上传不先读远端', async () => {
    vi.useFakeTimers()
    const server = davServer()
    const store = makeStore(server.fetch)
    store.updateSettings({ webdav: {
      enabled: true,
      url: 'https://dav.test/root/',
      remotePath: 'tomato-todo/data.json',
      autoUpload: true,
      syncIntervalMinutes: 5
    } })
    // 先建立同步基准（远端为空 → 上传）
    await store.syncWebDAV()
    expect(server.puts).toBe(1)
    // 让「设置变更后 1.5 秒补同步」先跑完，避免影响后面的计数
    await vi.advanceTimersByTimeAsync(1600)

    const getsBefore = server.gets
    const putsBefore = server.puts
    store.mutate((state) => createTodo(state, { title: '改完立刻同步' }))
    await vi.advanceTimersByTimeAsync(1700)
    expect(server.puts).toBe(putsBefore + 1)
    expect(server.body).toContain('改完立刻同步')
    // 已经知道本机有改动，不需要再探测远端
    expect(server.gets).toBe(getsBefore)
    expect(store.getState().settings.webdav.lastStatus).toBe('success')
    store.dispose()
  })

  it('关闭「变动后自动同步」后，改动不会自动上传', async () => {
    vi.useFakeTimers()
    const server = davServer()
    const store = makeStore(server.fetch)
    // configure() 里 autoUpload: false
    configure(store)
    await vi.advanceTimersByTimeAsync(1600)
    const putsBefore = server.puts
    store.mutate((state) => createTodo(state, { title: '只存本地' }))
    // 1800ms 已超过 1.6 秒的自动同步延迟；总时长仍小于启动补同步的 4 秒
    await vi.advanceTimersByTimeAsync(1800)
    expect(server.puts).toBe(putsBefore)
    store.dispose()
  })

  it('关掉定时同步后，本机改动仍然会立即同步', async () => {
    vi.useFakeTimers()
    const server = davServer()
    const store = makeStore(server.fetch)
    store.updateSettings({ webdav: {
      enabled: true,
      url: 'https://dav.test/root/',
      remotePath: 'tomato-todo/data.json',
      autoUpload: true,
      syncIntervalMinutes: 0
    } })
    store.mutate((state) => createTodo(state, { title: '定时关掉也要传' }))
    await vi.advanceTimersByTimeAsync(1700)
    expect(server.puts).toBe(1)
    expect(server.body).toContain('定时关掉也要传')
    store.dispose()
  })

  it('未启用 WebDAV 时同步直接返回提示，不发请求', async () => {
    const server = davServer()
    const store = makeStore(server.fetch)
    const result = await store.syncWebDAV()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('未启用')
    expect(server.puts).toBe(0)
    store.dispose()
  })
})
