import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDefaultState,
  loadStateFile,
  normaliseState,
  saveStateFile
} from '../src/main/persistence'
import { DEFAULT_GROUP_ID, DEFAULT_PROMPT_TEMPLATE } from '../src/shared/defaults'

const tempDirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tomato-todo-test-'))
  tempDirs.push(dir)
  return join(dir, 'data.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('持久化与数据迁移', () => {
  it('空数据返回默认分组、空待办和默认设置', () => {
    const state = normaliseState(undefined)
    expect(state.groups[0].id).toBe(DEFAULT_GROUP_ID)
    expect(state.todos).toEqual([])
    expect(state.settings.promptTemplate).toBe(DEFAULT_PROMPT_TEMPLATE)
    expect(state.settings.webdav.enabled).toBe(false)
    expect(state.settings.webdav.lastStatus).toBe('idle')
  })

  it('迁移旧版 completed / archived 布尔字段为时间戳', () => {
    const state = normaliseState({
      todos: [
        {
          id: 'legacy',
          title: '旧数据',
          completed: true,
          archived: true,
          updatedAt: '2025-06-01T08:00:00.000Z'
        }
      ]
    })
    const item = state.todos[0]
    expect(item.completedAt).toBe('2025-06-01T08:00:00.000Z')
    expect(item.archivedAt).toBe('2025-06-01T08:00:00.000Z')
    expect(item.focusLog).toEqual([])
    expect(item.urgency).toBe('medium')
    expect(item.groupId).toBe(DEFAULT_GROUP_ID)
  })

  it('确保收件箱存在，未知分组回落到收件箱，补齐焦点日志统计', () => {
    const state = normaliseState({
      groups: [{ id: 'custom', name: '自定义', color: '#112233' }],
      todos: [
        {
          id: 't1',
          title: '任务',
          groupId: 'missing-group',
          focusLog: [
            { at: '2026-01-01T00:00:00.000Z', minutes: 25 },
            { at: '2026-01-02T00:00:00.000Z', minutes: 25 }
          ]
        }
      ]
    })
    expect(state.groups.some((group) => group.id === DEFAULT_GROUP_ID)).toBe(true)
    expect(state.todos[0].groupId).toBe(DEFAULT_GROUP_ID)
    expect(state.todos[0].pomodoroCount).toBe(2)
    expect(state.todos[0].focusMinutes).toBe(50)
  })

  it('校验并修正 AI、番茄钟、主题、快捷键和 WebDAV 设置', () => {
    const state = normaliseState({
      settings: {
        ai: { provider: 'unknown', baseUrl: '', model: '' },
        promptTemplate: '  ',
        pomodoro: { focusMinutes: 999, breakMinutes: -2 },
        general: { hotkey: '   ', theme: 'neon' },
        webdav: {
          enabled: 1,
          autoUpload: false,
          url: 'https://dav.example.com/',
          remotePath: '',
          lastStatus: 'weird',
          lastSyncAt: 123,
          lastError: 456
        }
      }
    })
    expect(state.settings.ai.provider).toBe('openai')
    expect(state.settings.ai.baseUrl).toContain('openai')
    expect(state.settings.ai.model).toBeTruthy()
    expect(state.settings.promptTemplate).toBe(DEFAULT_PROMPT_TEMPLATE)
    expect(state.settings.pomodoro).toEqual({ focusMinutes: 180, breakMinutes: 1 })
    expect(state.settings.general.theme).toBe('dark')
    expect(state.settings.general.hotkey).toBe('CommandOrControl+Shift+Space')
    expect(state.settings.webdav.enabled).toBe(true)
    expect(state.settings.webdav.autoUpload).toBe(false)
    expect(state.settings.webdav.remotePath).toBe('tomato-todo/data.json')
    expect(state.settings.webdav.lastStatus).toBe('idle')
    expect(state.settings.webdav.lastSyncAt).toBeNull()
    expect(state.settings.webdav.lastError).toBeNull()
  })

  it('焦点日志最多保留最近 1000 条', () => {
    const focusLog = Array.from({ length: 1200 }, (_, index) => ({
      at: new Date(2026, 0, 1, 0, index).toISOString(),
      minutes: 25
    }))
    const state = normaliseState({ todos: [{ id: 't', title: '长日志', focusLog }] })
    expect(state.todos[0].focusLog).toHaveLength(1000)
  })

  it('保存后可以完整读取，并自动创建父目录', () => {
    const file = tempFile()
    const state = createDefaultState()
    state.settings.ai.apiKey = 'sk-test'
    state.settings.webdav.url = 'https://dav.example.com/'
    const mtime = saveStateFile(file, state)
    expect(mtime).toBeGreaterThan(0)
    const loaded = loadStateFile(file)
    expect(loaded.exists).toBe(true)
    expect(loaded.state.settings.ai.apiKey).toBe('sk-test')
    expect(loaded.state.settings.webdav.url).toBe('https://dav.example.com/')
  })

  it('损坏的 JSON 会备份为 .corrupt-* 并回落到默认数据', () => {
    const file = tempFile()
    writeFileSync(file, '{ this is not json', 'utf8')
    const loaded = loadStateFile(file)
    expect(loaded.exists).toBe(true)
    expect(loaded.state.todos).toEqual([])
    const backups = readdirSync(join(file, '..')).filter((name) => name.includes('.corrupt-'))
    expect(backups.length).toBe(1)
    expect(readFileSync(file, 'utf8')).toContain('not json')
  })

  it('不存在的文件不会创建文件', () => {
    const file = tempFile()
    const loaded = loadStateFile(file)
    expect(loaded.exists).toBe(false)
    expect(existsSync(file)).toBe(false)
  })
})

describe('安全设置持久化', () => {
  it('默认包含未设置的密码与 5 分钟自动锁定', () => {
    const state = loadStateFile(join(tmpdir(), `missing-${Date.now()}.json`)).state
    expect(state.settings.security.passwordHash).toBe('')
    expect(state.settings.security.autoLockMinutes).toBe(5)
    expect(state.settings.general.closeToTray).toBe(true)
    expect(state.settings.webdav.encryptionPassword).toBe('')
  })

  it('规范化越界的自动锁定时间并保留密码哈希', () => {
    const state = normaliseState({
      groups: [],
      todos: [],
      settings: {
        security: { passwordHash: 'scrypt$abc$def', autoLockMinutes: 9999 }
      }
    })
    expect(state.settings.security.autoLockMinutes).toBe(240)
    expect(state.settings.security.passwordHash).toBe('scrypt$abc$def')
  })

  it('closeToTray 默认开启，显式 false 保留', () => {
    expect(normaliseState({}).settings.general.closeToTray).toBe(true)
    expect(
      normaliseState({ settings: { general: { closeToTray: false } } }).settings.general.closeToTray
    ).toBe(false)
  })
})
