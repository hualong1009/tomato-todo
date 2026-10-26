import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_MAX_BYTES,
  attachmentExtension,
  formatBytes,
  splitDataUrl
} from '../src/shared/attachments'
import { normaliseState } from '../src/shared/normalise'
import { createTodo, updateTodo } from '../src/shared/operations'
import type { Attachment } from '../src/shared/types'
import { makeState } from './helpers'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att-1',
    name: '需求文档.pdf',
    mime: 'application/pdf',
    size: 128,
    data: 'data:application/pdf;base64,JVBERi0xLjQK',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('附件工具函数', () => {
  it('formatBytes 输出可读体积', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
    expect(formatBytes(Number.NaN)).toBe('—')
  })

  it('splitDataUrl 解析 mime 与 base64', () => {
    const parsed = splitDataUrl(`data:image/png;base64,${PNG_BASE64}`)
    expect(parsed?.mime).toBe('image/png')
    expect(parsed?.base64).toBe(PNG_BASE64)
    expect(splitDataUrl('not-a-data-url')).toBeNull()
  })

  it('attachmentExtension 优先用文件名后缀', () => {
    expect(attachmentExtension('报表.xlsx', 'application/octet-stream')).toBe('xlsx')
    expect(attachmentExtension('无后缀', 'application/pdf')).toBe('pdf')
    expect(attachmentExtension('未知', 'application/x-unknown')).toBe('bin')
  })

  it('附件大小上限是 10MB', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('附件的存储与更新', () => {
  it('新建待办默认没有附件', () => {
    const state = makeState()
    const todo = createTodo(state, { title: '无附件', groupId: 'inbox' })
    expect(todo.attachments).toEqual([])
  })

  it('updateTodo 可以整体替换附件列表', () => {
    const state = makeState()
    const todo = createTodo(state, { title: '带附件', groupId: 'inbox' })
    const attachment = makeAttachment()
    updateTodo(state, todo.id, { attachments: [attachment] })
    expect(state.todos[0].attachments).toHaveLength(1)
    expect(state.todos[0].attachments[0].name).toBe('需求文档.pdf')

    updateTodo(state, todo.id, { attachments: [] })
    expect(state.todos[0].attachments).toHaveLength(0)
  })

  it('normaliseState 保留附件并丢弃坏数据', () => {
    const state = normaliseState({
      groups: [{ id: 'inbox', name: '收集箱', color: '#888888', createdAt: '2026-01-01' }],
      todos: [
        {
          id: 't1',
          title: '带附件',
          attachments: [
            { id: 'a1', name: 'x.pdf', mime: 'application/pdf', size: 3, data: 'data:application/pdf;base64,AAA' },
            { id: 'a2', name: '坏数据（没有 data）' },
            null
          ]
        }
      ]
    })
    const attachments = state.todos[0].attachments
    expect(attachments).toHaveLength(1)
    expect(attachments[0].name).toBe('x.pdf')
    expect(attachments[0].createdAt).toBeTruthy()
  })

  it('旧数据没有 attachments 字段时补空数组', () => {
    const state = normaliseState({ todos: [{ id: 'legacy', title: '旧待办' }] })
    expect(state.todos[0].attachments).toEqual([])
  })
})
