import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { blobNameFor, externaliseAssets } from '../src/main/blobSync'
import { createRemotePayloadWith, parseRemotePayload } from '../src/shared/backup'
import {
  collectBlobRefs,
  countUnresolvedRefs,
  inlineAttachmentRefs,
  inlineBlobRefs
} from '../src/shared/blobRefs'
import { createTodo, updateTodo } from '../src/shared/operations'
import type { Todo } from '../src/shared/types'
import { makeState } from './helpers'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PDF = 'data:application/pdf;base64,JVBERi0xLjQK'

function stateWithAssets(): { todos: Todo[] } {
  const state = makeState()
  const first = createTodo(state, {
    title: '带图与附件',
    content: `说明\n\n![截图](${PNG})\n\n再看一次\n\n![重复](${PNG})`,
    groupId: 'inbox'
  })
  updateTodo(state, first.id, {
    attachments: [
      {
        id: 'att-1',
        name: '报告.pdf',
        mime: 'application/pdf',
        size: 8,
        data: PDF,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
  })
  return state
}

describe('外置资源（blobs）', () => {
  it('同一份内容得到同一个 blob 文件名（去重）', () => {
    expect(blobNameFor(PNG)).toBe(blobNameFor(PNG))
    expect(blobNameFor(PNG)).not.toBe(blobNameFor(PDF))
    expect(blobNameFor(PNG)).toMatch(/^[a-f0-9]{16}\.png$/)
    expect(blobNameFor(PNG)).toBe(`${createHash('sha256').update(PNG).digest('hex').slice(0, 16)}.png`)
    expect(blobNameFor(PDF)).toMatch(/^[a-f0-9]{16}\.pdf$/)
  })

  it('外置后正文与附件只剩引用，重复图片只留一份', () => {
    const state = stateWithAssets()
    const { todos, blobs } = externaliseAssets(state.todos)
    expect(blobs.size).toBe(2) // 一张图（重复两次）+ 一个附件
    expect(todos[0].content).toContain('blob:')
    expect(todos[0].content).not.toContain('base64')
    expect(todos[0].attachments[0].data.startsWith('blob:')).toBe(true)
    expect(collectBlobRefs(todos)).toHaveLength(2)
    expect(countUnresolvedRefs(todos)).toBe(3) // 两处图片引用 + 一个附件引用
  })

  it('回填引用后恢复成原始 data URL', () => {
    const state = stateWithAssets()
    const { todos, blobs } = externaliseAssets(state.todos)
    const resolve = (name: string): string | null => blobs.get(name) ?? null
    const restored = todos.map((todo) => ({
      ...todo,
      content: inlineBlobRefs(todo.content, resolve),
      attachments: inlineAttachmentRefs(todo.attachments, resolve)
    }))
    expect(restored[0].content).toBe(state.todos[0].content)
    expect(restored[0].attachments[0].data).toBe(PDF)
    expect(countUnresolvedRefs(restored)).toBe(0)
  })

  it('缺失的 blob 保持引用但会统计出来', () => {
    const state = stateWithAssets()
    const { todos } = externaliseAssets(state.todos)
    const restored = todos.map((todo) => ({
      ...todo,
      content: inlineBlobRefs(todo.content, () => null),
      attachments: inlineAttachmentRefs(todo.attachments, () => null)
    }))
    expect(countUnresolvedRefs(restored)).toBe(3)
  })

  it('manifest 里记录 assets 清单，可被 parseRemotePayload 读出', () => {
    const state = stateWithAssets()
    const { todos, blobs } = externaliseAssets(state.todos)
    const payload = createRemotePayloadWith(state, todos)
    const parsed = parseRemotePayload(payload)
    expect(parsed?.assets).toHaveLength(blobs.size)
    expect(payload).not.toContain('base64')
  })

  it('没有图片/附件时不产生 assets', () => {
    const state = makeState()
    createTodo(state, { title: '纯文本', content: '只有文字', groupId: 'inbox' })
    const { todos, blobs } = externaliseAssets(state.todos)
    expect(blobs.size).toBe(0)
    const parsed = parseRemotePayload(createRemotePayloadWith(state, todos))
    expect(parsed?.assets).toEqual([])
  })
})
