import { describe, expect, it } from 'vitest'
import { buildWidgetSummary, formatWidgetMeta, isWidgetOverdue } from '../src/shared/widget'
import { createTodo, updateTodo } from '../src/shared/operations'
import { makeState } from './helpers'

const NOW = new Date('2026-02-15T10:00:00')

describe('桌面小组件摘要', () => {
  it('只统计未完成、未归档的待办，按最近更新倒序，最多 5 条', () => {
    const state = makeState()
    createTodo(state, { title: '第一条', groupId: 'inbox' })
    const second = createTodo(state, { title: '第二条', groupId: 'inbox' })
    const third = createTodo(state, { title: '第三条', groupId: 'inbox' })
    updateTodo(state, second.id, { completed: true })
    updateTodo(state, third.id, { archived: true })

    const summary = buildWidgetSummary(state, { now: NOW })
    expect(summary.total).toBe(1)
    expect(summary.items.map((item) => item.title)).toEqual(['第一条'])
  })

  it('最近更新的排前面，超出上限的截断', () => {
    const state = makeState()
    for (let i = 1; i <= 7; i++) {
      const todo = createTodo(state, { title: `任务 ${i}`, groupId: 'inbox' })
      updateTodo(state, todo.id, { updatedAt: new Date(NOW.getTime() + i * 60000).toISOString() })
    }
    const summary = buildWidgetSummary(state, { now: NOW })
    expect(summary.total).toBe(7)
    expect(summary.items).toHaveLength(5)
    expect(summary.items[0].title).toBe('任务 7')
    expect(summary.items[4].title).toBe('任务 3')
  })

  it('摘要里包含紧急程度颜色和逾期标记，不含正文与附件', () => {
    const state = makeState()
    const todo = createTodo(state, {
      title: '带图任务',
      content: '![截图](data:image/png;base64,xxxx)',
      groupId: 'inbox',
      urgency: 'urgent'
    })
    updateTodo(state, todo.id, {
      expectedAt: new Date(NOW.getTime() - 3600_000).toISOString(),
      attachments: [{ id: 'a', name: 'a.pdf', mime: 'application/pdf', size: 9, data: 'data:application/pdf;base64,x', createdAt: NOW.toISOString() }]
    })

    const summary = buildWidgetSummary(state, { now: NOW })
    expect(summary.overdue).toBe(1)
    expect(summary.items[0].color).toBe('#ff4d6d')
    expect(summary.items[0].overdue).toBe(true)
    expect(summary.items[0].meta).toBe('今天 09:00')
    expect(JSON.stringify(summary)).not.toContain('base64')
  })

  it('formatWidgetMeta 输出今天 / 明天 / 具体日期', () => {
    const state = makeState()
    const today = createTodo(state, { title: '今天截止', groupId: 'inbox' })
    updateTodo(state, today.id, { expectedAt: '2026-02-15T18:30:00' })
    const tomorrow = createTodo(state, { title: '明天截止', groupId: 'inbox' })
    updateTodo(state, tomorrow.id, { expectedAt: '2026-02-16T09:05:00' })
    const later = createTodo(state, { title: '下个月截止', groupId: 'inbox' })
    updateTodo(state, later.id, { expectedAt: '2026-03-02T09:00:00' })
    const plain = createTodo(state, { title: '无时间', groupId: 'inbox' })

    const summary = buildWidgetSummary(state, { now: NOW })
    const meta = (title: string) => summary.items.find((item) => item.title === title)?.meta
    expect(meta('今天截止')).toBe('今天 18:30')
    expect(meta('明天截止')).toBe('明天 09:05')
    expect(meta('下个月截止')).toBe('03-02 09:00')
    expect(meta('无时间')).toBe('未开始')
  })

  it('isWidgetOverdue：完成/归档不逾期，未来不逾期', () => {
    const state = makeState()
    const overdue = createTodo(state, { title: '逾期', groupId: 'inbox' })
    updateTodo(state, overdue.id, { expectedAt: '2026-02-14T09:00:00' })
    const future = createTodo(state, { title: '未来', groupId: 'inbox' })
    updateTodo(state, future.id, { expectedAt: '2026-02-20T09:00:00' })
    const done = createTodo(state, { title: '已完成', groupId: 'inbox' })
    updateTodo(state, done.id, { completed: true, expectedAt: '2026-02-14T09:00:00' })

    expect(isWidgetOverdue(overdue, NOW)).toBe(true)
    expect(isWidgetOverdue(future, NOW)).toBe(false)
    expect(isWidgetOverdue(done, NOW)).toBe(false)
  })

  it('空数据时给出可序列化的空摘要', () => {
    const summary = buildWidgetSummary(makeState(), { now: NOW })
    expect(summary.total).toBe(0)
    expect(summary.items).toEqual([])
    expect(JSON.parse(JSON.stringify(summary)).total).toBe(0)
  })
})
