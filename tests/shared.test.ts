import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUP_ID } from '../src/shared/defaults'
import {
  archiveTodo,
  createGroup,
  createTodo,
  deleteGroup,
  getGroup,
  recordFocus,
  restoreTodo,
  setCompleted,
  setPinned,
  startTodo,
  updateGroup,
  updateTodo
} from '../src/shared/operations'
import { buildSummaryContext } from '../src/shared/summary'
import { getTodoStatus, isOverdue, taskMatchesStatus } from '../src/shared/todoUtils'
import type { AddTodoInput, Todo } from '../src/shared/types'
import { makeState } from './helpers'

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    title: '示例',
    content: '',
    groupId: DEFAULT_GROUP_ID,
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
    focusLog: [],
    stickyColor: '#fff1a8',
    stickyOpacity: 0.94,
    ...overrides
  }
}

describe('todo 状态推导', () => {
  const now = Date.parse('2026-02-10T12:00:00.000Z')

  it('按开始 / 完成 / 期望时间推导四种状态', () => {
    expect(getTodoStatus(todo(), now)).toBe('not_started')
    expect(getTodoStatus(todo({ startedAt: '2026-02-01T00:00:00.000Z' }), now)).toBe('in_progress')
    expect(
      getTodoStatus(
        todo({
          startedAt: '2026-02-01T00:00:00.000Z',
          expectedAt: '2026-02-02T00:00:00.000Z'
        }),
        now
      )
    ).toBe('overdue')
    expect(getTodoStatus(todo({ completedAt: '2026-02-03T00:00:00.000Z' }), now)).toBe('completed')
  })

  it('已完成或已归档不会被判定为逾期', () => {
    const overdue = todo({ expectedAt: '2026-02-02T00:00:00.000Z' })
    expect(isOverdue(overdue, now)).toBe(true)
    expect(isOverdue({ ...overdue, completedAt: '2026-02-03T00:00:00.000Z' }, now)).toBe(false)
    expect(isOverdue({ ...overdue, archivedAt: '2026-02-03T00:00:00.000Z' }, now)).toBe(false)
  })

  it('进行中视图包含已逾期的进行中任务，归档任务不进入任何状态视图', () => {
    const inProgressOverdue = todo({
      startedAt: '2026-02-01T00:00:00.000Z',
      expectedAt: '2026-02-02T00:00:00.000Z'
    })
    expect(taskMatchesStatus(inProgressOverdue, 'in_progress', now)).toBe(true)
    expect(taskMatchesStatus(inProgressOverdue, 'overdue', now)).toBe(true)
    expect(
      taskMatchesStatus(
        { ...inProgressOverdue, archivedAt: '2026-02-04T00:00:00.000Z' },
        'all',
        now
      )
    ).toBe(false)
  })
})

describe('分组操作', () => {
  it('创建、重命名、改色分组，并拒绝重名', () => {
    const state = makeState()
    const group = createGroup(state, '工作', '#5aa2ff')
    expect(group.name).toBe('工作')
    expect(group.color).toBe('#5aa2ff')
    expect(getGroup(state, '工作')?.id).toBe(group.id)
    expect(() => createGroup(state, '工作')).toThrow('已存在同名分组')

    updateGroup(state, group.id, { name: '项目', color: '#49d49d' })
    expect(getGroup(state, '项目')?.color).toBe('#49d49d')
    expect(() => updateGroup(state, group.id, { name: '收件箱' })).toThrow('已存在同名分组')
  })

  it('收件箱不可删除，删除其他分组时待办移入收件箱', () => {
    const state = makeState()
    const group = createGroup(state, '临时')
    const item = createTodo(state, { title: '任务', groupId: group.id })
    expect(() => deleteGroup(state, DEFAULT_GROUP_ID)).toThrow('默认收件箱不能删除')
    deleteGroup(state, group.id)
    expect(state.todos.find((entry) => entry.id === item.id)?.groupId).toBe(DEFAULT_GROUP_ID)
    expect(state.groups.some((entry) => entry.id === group.id)).toBe(false)
  })
})

describe('待办操作', () => {
  it('创建时清洗标题、默认值与期望时间', () => {
    const state = makeState()
    const item = createTodo(state, {
      title: '  写周报  ',
      content: '整理本周进展',
      urgency: 'high',
      expectedAt: '2026-03-01T10:00:00+08:00'
    })
    expect(item.title).toBe('写周报')
    expect(item.groupId).toBe(DEFAULT_GROUP_ID)
    expect(item.urgency).toBe('high')
    expect(item.expectedAt).toBe('2026-03-01T02:00:00.000Z')
    expect(item.completedAt).toBeNull()
    expect(item.focusLog).toEqual([])
  })

  it('拒绝空标题、超长标题、非法紧急程度和非法时间', () => {
    const state = makeState()
    expect(() => createTodo(state, { title: '   ' })).toThrow('待办标题不能为空')
    expect(() => createTodo(state, { title: 'x'.repeat(301) })).toThrow('300')
    expect(() =>
      createTodo(state, { title: '测试', urgency: 'bad' as AddTodoInput['urgency'] })
    ).toThrow('紧急程度')
    expect(() => createTodo(state, { title: '测试', expectedAt: 'not-a-date' })).toThrow('时间格式')
  })

  it('开始任务记录开始时间，完成后记录实际完成时间', () => {
    const state = makeState()
    const item = createTodo(state, { title: '实现功能' })
    startTodo(state, item.id)
    expect(item.startedAt).toBeTruthy()
    const startedAt = item.startedAt

    setCompleted(state, item.id, true)
    expect(item.completedAt).toBeTruthy()
    expect(item.startedAt).toBe(startedAt)
    expect(() => startTodo(state, item.id)).toThrow('已完成的待办不能开始')

    setCompleted(state, item.id, false)
    expect(item.completedAt).toBeNull()
    expect(item.startedAt).toBe(startedAt)
  })

  it('直接完成未开始的任务时会补齐开始时间', () => {
    const state = makeState()
    const item = createTodo(state, { title: '直接完成' })
    setCompleted(state, item.id, true)
    expect(item.startedAt).toBe(item.completedAt)
  })

  it('归档会取消固定，恢复后重新出现在列表', () => {
    const state = makeState()
    const item = createTodo(state, { title: '旧任务' })
    setPinned(state, item.id, true)
    expect(item.pinned).toBe(true)
    archiveTodo(state, item.id)
    expect(item.archivedAt).toBeTruthy()
    expect(item.pinned).toBe(false)
    expect(() => setPinned(state, item.id, true)).toThrow('归档的待办不能固定')
    restoreTodo(state, item.id)
    expect(item.archivedAt).toBeNull()
  })

  it('更新便签透明度会夹在 25% 到 100%，窗口尺寸有下限', () => {
    const state = makeState()
    const item = createTodo(state, { title: '便签' })
    updateTodo(state, item.id, {
      stickyOpacity: 0.05,
      stickyBounds: { x: 0, y: 0, width: 10, height: 10 }
    })
    expect(item.stickyOpacity).toBe(0.25)
    expect(item.stickyBounds).toMatchObject({ width: 240, height: 180 })
    updateTodo(state, item.id, { stickyOpacity: 3 })
    expect(item.stickyOpacity).toBe(1)
  })

  it('专注记录累计次数、分钟和日志，归档或完成后拒绝记录', () => {
    const state = makeState()
    const item = createTodo(state, { title: '专注' })
    recordFocus(state, item.id, 25)
    recordFocus(state, item.id, 25)
    expect(item.pomodoroCount).toBe(2)
    expect(item.focusMinutes).toBe(50)
    expect(item.focusLog).toHaveLength(2)
    expect(item.startedAt).toBeTruthy()

    setCompleted(state, item.id, true)
    expect(() => recordFocus(state, item.id, 25)).toThrow('已完成')
  })
})

describe('AI 回顾上下文', () => {
  const now = Date.parse('2026-02-10T12:00:00.000Z')

  it('排除归档事项，统计完成率、专注与逾期，并替换模板占位符', () => {
    const state = makeState()
    state.settings.promptTemplate =
      '{{range}}|{{total}}|{{completedCount}}|{{pendingCount}}|{{overdueCount}}|{{focusMinutes}}|{{todos}}'
    const completed = createTodo(state, { title: '已完成任务', content: '第一行\n第二行' })
    recordFocus(state, completed.id, 25)
    completed.focusLog = [{ at: '2026-02-09T10:00:00.000Z', minutes: 25 }]
    setCompleted(state, completed.id, true)
    completed.completedAt = new Date('2026-02-09T10:00:00.000Z').toISOString()

    const overdue = createTodo(state, {
      title: '逾期任务',
      urgency: 'urgent',
      expectedAt: '2026-02-01T00:00:00.000Z'
    })

    const archived = createTodo(state, { title: '归档任务' })
    archiveTodo(state, archived.id)

    const context = buildSummaryContext(state, 'week', now)
    expect(context.total).toBe(2)
    expect(context.completedCount).toBe(1)
    expect(context.pendingCount).toBe(1)
    expect(context.overdueCount).toBe(1)
    expect(context.focusMinutes).toBe(25)
    expect(context.focusSessions).toBe(1)
    expect(context.completionRate).toBe('50.0%')
    expect(context.prompt).toContain('最近 1 周|2|1|1|1|25|')
    expect(context.prompt).not.toContain('归档任务')
    expect(context.todosMarkdown).toContain('逾期任务')
    expect(context.todosMarkdown).toContain('\n')
    expect(context.todosMarkdown).not.toContain('\\n')
    expect(context.urgencyStats).toContain('紧急 1')
    expect(context.relevantTodos[0].id).toBe(overdue.id)
  })
})
