import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveStateFile } from '../src/main/persistence'
import { createTodoMcpServer } from '../src/mcp/server'
import type { AppState } from '../src/shared/types'
import { makeState } from './helpers'

function parse(result: unknown): any {
  const content = (result as { content?: { type: string; text?: string }[] }).content
  const text = content?.find((entry) => entry.type === 'text')?.text
  if (!text) throw new Error('MCP 返回内容为空')
  return JSON.parse(text)
}

describe('MCP stdio 兼容服务', () => {
  let dir: string
  let file: string
  let client: Client
  let server: ReturnType<typeof createTodoMcpServer>
  let state: AppState

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tomato-mcp-test-'))
    file = join(dir, 'data.json')
    state = makeState()
    saveStateFile(file, state)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    server = createTodoMcpServer(file)
    client = new Client({ name: 'tomato-test-client', version: '1.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  })

  async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return parse(await client.callTool({ name, arguments: args }))
  }

  it('暴露搜索、增改、开始、完成、归档、分组、专注和概览工具', async () => {
    const result = await client.listTools()
    const names = result.tools.map((tool) => tool.name)
    for (const expected of [
      'list_todos',
      'search_todos',
      'get_todo',
      'add_todo',
      'update_todo',
      'start_todo',
      'complete_todo',
      'archive_todo',
      'restore_todo',
      'record_focus',
      'list_groups',
      'add_group',
      'update_group',
      'get_overview'
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('新增待办时自动创建分组，并支持搜索与详情', async () => {
    const added = await call('add_todo', {
      title: '整理 MCP 文档',
      content: '补充工具说明',
      group: '文档',
      urgency: 'high',
      expected_at: '2026-04-01T10:00:00.000Z'
    })
    expect(added.ok).toBe(true)
    expect(added.todo.title).toBe('整理 MCP 文档')
    expect(added.todo.group).toBe('文档')
    expect(added.todo.urgency).toBe('high')

    const searched = await call('search_todos', { query: '工具说明' })
    expect(searched.count).toBe(1)
    expect(searched.todos[0].id).toBe(added.todo.id)

    const detail = await call('get_todo', { id: added.todo.id })
    expect(detail.todo.content).toBe('补充工具说明')

    const groups = await call('list_groups')
    expect(groups.groups.some((group: { name: string }) => group.name === '文档')).toBe(true)
  })

  it('开始、完成、归档、恢复会贯穿状态与统计', async () => {
    const added = await call('add_todo', { title: '状态流转' })
    const id = added.todo.id as string

    const started = await call('start_todo', { id })
    expect(started.todo.status).toBe('in_progress')
    expect(started.todo.startedAt).toBeTruthy()

    const completed = await call('complete_todo', { id })
    expect(completed.todo.status).toBe('completed')
    expect(completed.todo.completedAt).toBeTruthy()

    const completedList = await call('list_todos', { status: 'completed' })
    expect(completedList.count).toBe(1)

    const archived = await call('archive_todo', { id })
    expect(archived.todo.archived).toBe(true)
    const hidden = await call('list_todos')
    expect(hidden.count).toBe(0)
    const archivedList = await call('list_todos', { status: 'archived' })
    expect(archivedList.count).toBe(1)

    const restored = await call('restore_todo', { id })
    expect(restored.todo.archived).toBe(false)

    const overview = await call('get_overview')
    expect(overview.active).toBe(1)
    expect(overview.completed).toBe(1)
    expect(overview.archived).toBe(0)
  })

  it('修改待办分组和紧急程度，并记录专注会话', async () => {
    const added = await call('add_todo', { title: '专注任务' })
    const id = added.todo.id as string

    const updated = await call('update_todo', {
      id,
      group: '深度工作',
      urgency: 'urgent',
      expected_at: null
    })
    expect(updated.todo.group).toBe('深度工作')
    expect(updated.todo.urgency).toBe('urgent')

    const focused = await call('record_focus', { id, minutes: 25 })
    expect(focused.todo.pomodoroCount).toBe(1)
    expect(focused.todo.focusMinutes).toBe(25)
    expect(focused.todo.recentFocusSessions).toHaveLength(1)
    expect(focused.todo.startedAt).toBeTruthy()

    const overview = await call('get_overview')
    expect(overview.inProgress).toBe(1)
    expect(overview.urgency.urgent).toBe(1)
  })

  it('分组工具支持新增、重命名和改色', async () => {
    const created = await call('add_group', { name: '阅读', color: '#7aa2ff' })
    expect(created.group.name).toBe('阅读')
    const updated = await call('update_group', {
      id: created.group.id,
      name: '阅读清单',
      color: '#49d49d'
    })
    expect(updated.group.name).toBe('阅读清单')
    expect(updated.group.color).toBe('#49d49d')
  })

  it('错误通过 isError 文本返回而不是使进程崩溃', async () => {
    const result = await client.callTool({
      name: 'complete_todo',
      arguments: { id: 'not-exists' }
    })
    expect(result.isError).toBe(true)
    const parsed = parse(result)
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('待办不存在')
  })

  it('MCP 写入会落盘，下一次工具调用能读到最新数据', async () => {
    await call('add_todo', { title: '持久化验证' })
    const again = await call('list_todos')
    expect(again.todos[0].title).toBe('持久化验证')
  })
})
