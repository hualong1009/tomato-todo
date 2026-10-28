import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  clampSyncInterval,
  decideWebDAVSync,
  localFingerprint,
  shouldAutoSync,
  shouldSyncOnChange
} from '../src/shared/webdavSync'
import type { WebDAVSettings } from '../src/shared/types'
import { createDefaultState } from '../src/main/persistence'
import { createTodo, setCompleted } from '../src/shared/operations'
import { syncStatusDetail, syncStatusLabel } from '../src/shared/syncStatus'
import { makeState } from './helpers'

function webdav(overrides: Partial<WebDAVSettings> = {}): WebDAVSettings {
  return { ...createDefaultState().settings.webdav, enabled: true, url: 'https://dav.test/', ...overrides }
}

describe('同步间隔设置', () => {
  it('未设置时默认 5 分钟，0 表示关闭', () => {
    expect(clampSyncInterval(undefined)).toBe(DEFAULT_SYNC_INTERVAL_MINUTES)
    expect(clampSyncInterval(null)).toBe(DEFAULT_SYNC_INTERVAL_MINUTES)
    expect(clampSyncInterval(0)).toBe(0)
    expect(clampSyncInterval(-3)).toBe(0)
    expect(clampSyncInterval('')).toBe(DEFAULT_SYNC_INTERVAL_MINUTES)
  })

  it('非标准值就近归一到允许的选项', () => {
    expect(clampSyncInterval(3)).toBe(5)
    expect(clampSyncInterval('15')).toBe(15)
    expect(clampSyncInterval(17)).toBe(15)
    expect(clampSyncInterval(100)).toBe(60)
  })

  it('只有启用 WebDAV 且间隔大于 0 时才自动同步', () => {
    expect(shouldAutoSync(webdav({ syncIntervalMinutes: 5 }))).toBe(true)
    expect(shouldAutoSync(webdav({ syncIntervalMinutes: 0 }))).toBe(false)
    expect(shouldAutoSync(webdav({ enabled: false, syncIntervalMinutes: 5 }))).toBe(false)
    expect(shouldAutoSync(webdav({ url: '   ', syncIntervalMinutes: 5 }))).toBe(false)
  })
})

describe('本机内容指纹', () => {
  it('待办变化会改变指纹，仅设置变化不会', () => {
    const state = makeState()
    const before = localFingerprint(state)
    expect(localFingerprint(state)).toBe(before)

    state.settings.general.theme = 'light'
    expect(localFingerprint(state)).toBe(before)

    const todo = createTodo(state, { title: '改指纹' })
    const afterAdd = localFingerprint(state)
    expect(afterAdd).not.toBe(before)

    setCompleted(state, todo.id, true)
    expect(localFingerprint(state)).not.toBe(afterAdd)
  })

  it('字段顺序不同不影响指纹（避免每次都判定为「有改动」）', () => {
    const a = { id: 'g1', name: 'A', color: '#000', createdAt: 't' }
    const b = { createdAt: 't', color: '#000', name: 'A', id: 'g1' }
    expect(localFingerprint({ groups: [a] as never, todos: [] } as never)).toBe(
      localFingerprint({ groups: [b] as never, todos: [] } as never)
    )
  })
})

describe('双向同步决策', () => {
  it('远端还没有备份时上传本机数据', () => {
    const decision = decideWebDAVSync({
      localHash: 'h1',
      lastSyncedHash: null,
      remoteSavedAt: null,
      lastRemoteSavedAt: null,
      lastSyncAt: null
    })
    expect(decision.action).toBe('upload')
    expect(decision.conflict).toBe(false)
  })

  it('新设备首次配置时以远端为准，不会用空数据覆盖远端', () => {
    const decision = decideWebDAVSync({
      localHash: 'local',
      lastSyncedHash: null,
      remoteSavedAt: '2026-10-28T10:00:00.000Z',
      lastRemoteSavedAt: null,
      lastSyncAt: null
    })
    expect(decision.action).toBe('download')
  })

  it('老版本升级：本机上次上传时间不早于远端时上传本机数据', () => {
    const decision = decideWebDAVSync({
      localHash: 'local',
      lastSyncedHash: null,
      remoteSavedAt: '2026-10-28T10:00:00.000Z',
      lastRemoteSavedAt: null,
      lastSyncAt: '2026-10-28T10:00:01.000Z'
    })
    expect(decision.action).toBe('upload')
  })

  it('本机有改动、远端没变时上传', () => {
    const decision = decideWebDAVSync({
      localHash: 'changed',
      lastSyncedHash: 'synced',
      remoteSavedAt: '2026-10-28T10:00:00.000Z',
      lastRemoteSavedAt: '2026-10-28T10:00:00.000Z',
      lastSyncAt: '2026-10-28T10:00:01.000Z'
    })
    expect(decision).toEqual(expect.objectContaining({ action: 'upload', conflict: false }))
  })

  it('本机没改、远端更新时拉取', () => {
    const decision = decideWebDAVSync({
      localHash: 'same',
      lastSyncedHash: 'same',
      remoteSavedAt: '2026-10-28T11:00:00.000Z',
      lastRemoteSavedAt: '2026-10-28T10:00:00.000Z',
      lastSyncAt: '2026-10-28T10:00:01.000Z'
    })
    expect(decision).toEqual(expect.objectContaining({ action: 'download', conflict: false }))
  })

  it('两端都改过时保留本机数据并覆盖远端，同时标记冲突', () => {
    const decision = decideWebDAVSync({
      localHash: 'local-new',
      lastSyncedHash: 'synced',
      remoteSavedAt: '2026-10-28T11:00:00.000Z',
      lastRemoteSavedAt: '2026-10-28T10:00:00.000Z',
      lastSyncAt: '2026-10-28T10:00:01.000Z'
    })
    expect(decision).toEqual(expect.objectContaining({ action: 'upload', conflict: true }))
  })

  it('两边一致时不传输', () => {
    const decision = decideWebDAVSync({
      localHash: 'same',
      lastSyncedHash: 'same',
      remoteSavedAt: '2026-10-28T10:00:00.000Z',
      lastRemoteSavedAt: '2026-10-28T10:00:00.000Z',
      lastSyncAt: '2026-10-28T10:00:01.000Z'
    })
    expect(decision.action).toBe('none')
  })
})

describe('改动后自动同步', () => {
  it('开启「变动后自动同步」且已配置地址时才自动上传', () => {
    expect(shouldSyncOnChange(webdav({ autoUpload: true }))).toBe(true)
    expect(shouldSyncOnChange(webdav({ autoUpload: false }))).toBe(false)
    expect(shouldSyncOnChange(webdav({ autoUpload: true, enabled: false }))).toBe(false)
    expect(shouldSyncOnChange(webdav({ autoUpload: true, url: '  ' }))).toBe(false)
  })

  it('与定时同步开关相互独立：关掉定时同步仍然改动即同步', () => {
    expect(shouldSyncOnChange(webdav({ autoUpload: true, syncIntervalMinutes: 0 }))).toBe(true)
    expect(shouldAutoSync(webdav({ autoUpload: true, syncIntervalMinutes: 0 }))).toBe(false)
  })
})

describe('同步状态文案（桌面标题栏 / 手机顶部栏共用）', () => {
  it('未启用 / 失败 / 等待 / 已同步', () => {
    expect(syncStatusLabel({ enabled: false, status: 'idle', lastSyncAt: null })).toBe('WebDAV 未启用')
    expect(syncStatusLabel({ enabled: true, status: 'error', lastSyncAt: null })).toBe('同步失败')
    expect(syncStatusLabel({ enabled: true, status: 'idle', lastSyncAt: null })).toBe('等待同步')
    const at = new Date(2026, 9, 28, 9, 5, 0).toISOString()
    expect(syncStatusLabel({ enabled: true, status: 'success', lastSyncAt: at })).toBe('已同步 · 09:05')
  })

  it('详情文案给出原因与操作提示', () => {
    expect(syncStatusDetail({ enabled: false, status: 'idle', lastSyncAt: null })).toContain('去设置')
    expect(
      syncStatusDetail({ enabled: true, status: 'error', lastSyncAt: null, lastError: 'HTTP 401' })
    ).toBe('上次同步失败：HTTP 401，点击可重试')
    expect(syncStatusDetail({ enabled: true, status: 'idle', lastSyncAt: null })).toContain('立即同步')
  })
})
