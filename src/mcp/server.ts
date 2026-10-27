import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { callAIChat } from '../shared/aiClient'
import { URGENCY_META } from '../shared/defaults'
import {
  archiveTodo,
  createGroup,
  createTodo,
  ensureGroup,
  getGroup,
  recordFocus,
  restoreTodo,
  startTodo,
  updateGroup,
  updateTodo
} from '../shared/operations'
import type { AppState, Group, SummaryRange, Todo, Urgency } from '../shared/types'
import { getTodoStatus, isOverdue, STATUS_META } from '../shared/todoUtils'
import { buildSummaryContext } from '../shared/summary'
import { TodoFileStore } from './todoFileStore'

const URGENCY_VALUES = ['low', 'medium', 'high', 'urgent'] as const
const STATUS_VALUES = [
  'all',
  'not_started',
  'in_progress',
  'completed',
  'overdue',
  'archived'
] as const

function jsonResult(data: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  }
}

function errorResult(error: unknown): {
  content: { type: 'text'; text: string }[]
  isError: true
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          null,
          2
        )
      }
    ],
    isError: true
  }
}

function groupName(state: AppState, groupId: string): string {
  return state.groups.find((group) => group.id === groupId)?.name ?? '未分组'
}

function serialiseGroup(group: Group, state: AppState): Record<string, unknown> {
  return {
    id: group.id,
    name: group.name,
    color: group.color,
    todoCount: state.todos.filter((todo) => todo.groupId === group.id && !todo.archivedAt).length,
    archivedCount: state.todos.filter((todo) => todo.groupId === group.id && todo.archivedAt).length
  }
}

function serialiseTodo(
  state: AppState,
  todo: Todo,
  options: { fullContent?: boolean } = {}
): Record<string, unknown> {
  const status = getTodoStatus(todo)
  const content = options.fullContent ? todo.content : todo.content.slice(0, 1000)
  return {
    id: todo.id,
    title: todo.title,
    content,
    contentTruncated: !options.fullContent && todo.content.length > 1000,
    groupId: todo.groupId,
    group: groupName(state, todo.groupId),
    urgency: todo.urgency,
    urgencyLabel: URGENCY_META[todo.urgency].label,
    status,
    statusLabel: STATUS_META[status].label,
    overdue: isOverdue(todo),
    archived: Boolean(todo.archivedAt),
    expectedAt: todo.expectedAt,
    startedAt: todo.startedAt,
    completedAt: todo.completedAt,
    archivedAt: todo.archivedAt,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    pinned: todo.pinned,
    pomodoroCount: todo.pomodoroCount,
    focusMinutes: todo.focusMinutes,
    recentFocusSessions: todo.focusLog.slice(-5),
    // 附件只暴露元信息，避免把 base64 内容塞进 MCP 响应
    attachments: todo.attachments.map((item) => ({
      id: item.id,
      name: item.name,
      mime: item.mime,
      size: item.size,
      createdAt: item.createdAt
    }))
  }
}

function matchStatus(todo: Todo, status: (typeof STATUS_VALUES)[number]): boolean {
  if (status === 'all') return true
  if (status === 'archived') return Boolean(todo.archivedAt)
  if (todo.archivedAt) return false
  if (status === 'completed') return Boolean(todo.completedAt)
  if (status === 'overdue') return isOverdue(todo)
  if (status === 'in_progress') return Boolean(todo.startedAt) && !todo.completedAt
  if (status === 'not_started') return !todo.startedAt && !todo.completedAt
  return true
}

function filterTodos(
  state: AppState,
  args: {
    query?: string
    group?: string
    status?: (typeof STATUS_VALUES)[number]
    includeArchived?: boolean
    limit?: number
  }
): Todo[] {
  const query = args.query?.trim().toLowerCase()
  const group = args.group ? getGroup(state, args.group) : undefined
  if (args.group && !group) throw new Error(`分组不存在：${args.group}`)
  const status = args.status ?? 'all'
  const includeArchived = args.includeArchived === true || status === 'archived'

  const filtered = state.todos.filter((todo) => {
    if (!includeArchived && todo.archivedAt) return false
    if (group && todo.groupId !== group.id) return false
    if (!matchStatus(todo, status)) return false
    if (query) {
      const haystack = `${todo.title}\n${todo.content}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })

  filtered.sort((a, b) => {
    if (Boolean(a.archivedAt) !== Boolean(b.archivedAt)) return a.archivedAt ? 1 : -1
    if (Boolean(a.completedAt) !== Boolean(b.completedAt)) return a.completedAt ? 1 : -1
    if (!a.completedAt && !b.completedAt) {
      const urgency = URGENCY_META[b.urgency].rank - URGENCY_META[a.urgency].rank
      if (urgency !== 0) return urgency
      const aExpected = a.expectedAt ? Date.parse(a.expectedAt) : Number.MAX_SAFE_INTEGER
      const bExpected = b.expectedAt ? Date.parse(b.expectedAt) : Number.MAX_SAFE_INTEGER
      if (aExpected !== bExpected) return aExpected - bExpected
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })

  return filtered.slice(0, Math.min(500, Math.max(1, args.limit ?? 100)))
}

export function createTodoMcpServer(dataFile: string): McpServer {
  const store = new TodoFileStore(dataFile)
  const server = new McpServer(
    { name: 'tomato-todo', version: '1.0.0' },
    {
      instructions:
        'Tomato Todo 桌面待办应用的数据接口。待办支持标题、内容、用户分组、紧急程度、期望完成时间、开始时间、实际完成时间和归档。' +
        '归档等价于删除，归档事项默认不会出现在列表、搜索、统计和 AI 回顾中；需要查看时显式设置 include_archived 或 status=archived。' +
        '所有时间为 ISO 8601 字符串。调用 update_todo 时传入 completed=true 会写入实际完成时间，传入 started=true 会写入开始时间。' +
        'summarise_todos 会使用应用内配置的 AI 接口生成待办回顾。'
    }
  )

  server.registerTool(
    'list_todos',
    {
      title: '列出待办',
      description:
        'List todos with optional keyword, group and status filters. Archived todos are excluded by default. Statuses: all, not_started, in_progress, completed, overdue, archived.',
      inputSchema: {
        query: z.string().optional().describe('Keyword matched against title and content (case-insensitive).'),
        group: z.string().optional().describe('Group name or group id.'),
        status: z.enum(STATUS_VALUES).optional().describe('Filter by workflow status. Default: all.'),
        include_archived: z.boolean().optional().describe('Include archived todos. Default false.'),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum number of items. Default 100.')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        const state = store.read()
        const todos = filterTodos(state, {
          query: args.query,
          group: args.group,
          status: args.status,
          includeArchived: args.include_archived,
          limit: args.limit
        })
        return jsonResult({
          ok: true,
          count: todos.length,
          total: state.todos.length,
          todos: todos.map((todo) => serialiseTodo(state, todo))
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'search_todos',
    {
      title: '搜索待办',
      description:
        'Search todos by keyword in title and content. Archived todos are excluded unless include_archived=true.',
      inputSchema: {
        query: z.string().min(1).describe('Search keyword.'),
        include_archived: z.boolean().optional().describe('Include archived todos. Default false.'),
        limit: z.number().int().min(1).max(200).optional()
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        const state = store.read()
        const todos = filterTodos(state, {
          query: args.query,
          status: 'all',
          includeArchived: args.include_archived,
          limit: args.limit ?? 50
        })
        return jsonResult({
          ok: true,
          query: args.query,
          count: todos.length,
          todos: todos.map((todo) => serialiseTodo(state, todo))
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'get_todo',
    {
      title: '获取待办详情',
      description: 'Get one todo by id, including its full content and recent focus sessions.',
      inputSchema: {
        id: z.string().min(1).describe('Todo id.')
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        const state = store.read()
        const todo = state.todos.find((item) => item.id === args.id)
        if (!todo) throw new Error(`待办不存在：${args.id}`)
        return jsonResult({ ok: true, todo: serialiseTodo(state, todo, { fullContent: true }) })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'add_todo',
    {
      title: '新增待办',
      description:
        'Create a todo. `group` accepts a group name or id; a new group is created automatically if the name does not exist. expected_at accepts ISO 8601.',
      inputSchema: {
        title: z.string().min(1).describe('Todo title.'),
        content: z.string().optional().describe('Detailed content / notes.'),
        group: z.string().optional().describe('Group name or id. Default: 收件箱.'),
        urgency: z.enum(URGENCY_VALUES).optional().describe('low | medium | high | urgent. Default medium.'),
        expected_at: z
          .union([z.string(), z.null()])
          .optional()
          .describe('Expected completion time (ISO 8601) or null.')
      }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          const todo = createTodo(state, {
            title: args.title,
            content: args.content,
            groupId: args.group,
            urgency: args.urgency as Urgency | undefined,
            expectedAt: args.expected_at
          })
          return { state, todo }
        })
        return jsonResult({
          ok: true,
          message: '待办已创建',
          todo: serialiseTodo(result.state, result.todo, { fullContent: true })
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'update_todo',
    {
      title: '修改待办',
      description:
        'Update fields of a todo. completed=true records the actual completion time; started=true records the start time. archived=true archives instead of deleting. expected_at=null clears the expected time. group creates a missing group automatically.',
      inputSchema: {
        id: z.string().min(1),
        title: z.string().min(1).optional(),
        content: z.string().optional(),
        group: z.string().optional().describe('Target group name or id.'),
        urgency: z.enum(URGENCY_VALUES).optional(),
        expected_at: z.union([z.string(), z.null()]).optional(),
        completed: z.boolean().optional(),
        started: z.boolean().optional(),
        archived: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          let groupId: string | undefined
          if (args.group !== undefined) groupId = ensureGroup(state, args.group).id
          const todo = updateTodo(state, args.id, {
            title: args.title,
            content: args.content,
            groupId,
            urgency: args.urgency as Urgency | undefined,
            expectedAt: args.expected_at,
            completed: args.completed,
            started: args.started,
            archived: args.archived
          })
          return { state, todo }
        })
        return jsonResult({
          ok: true,
          message: '待办已更新',
          todo: serialiseTodo(result.state, result.todo, { fullContent: true })
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'start_todo',
    {
      title: '开始待办',
      description: 'Mark a todo as in progress and record its actual start time.',
      inputSchema: { id: z.string().min(1) }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          const todo = startTodo(state, args.id)
          return { state, todo }
        })
        return jsonResult({ ok: true, todo: serialiseTodo(result.state, result.todo) })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'complete_todo',
    {
      title: '完成 / 取消完成待办',
      description:
        'Set completion state. completed=true (default) records the actual completion timestamp; false clears it.',
      inputSchema: {
        id: z.string().min(1),
        completed: z.boolean().optional().describe('Default true.')
      }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          const todo = updateTodo(state, args.id, { completed: args.completed !== false })
          return { state, todo }
        })
        return jsonResult({ ok: true, todo: serialiseTodo(result.state, result.todo) })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'archive_todo',
    {
      title: '归档待办',
      description:
        'Archive a todo (the default delete semantics). Archived todos are grey in the UI and excluded from AI reviews. Use restore_todo to unarchive.',
      inputSchema: { id: z.string().min(1) },
      annotations: { destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          const todo = archiveTodo(state, args.id)
          return { state, todo }
        })
        return jsonResult({
          ok: true,
          message: '待办已归档',
          todo: serialiseTodo(result.state, result.todo)
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'restore_todo',
    {
      title: '恢复归档待办',
      description: 'Restore an archived todo back to the active list.',
      inputSchema: { id: z.string().min(1) },
      annotations: { idempotentHint: true }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          const todo = restoreTodo(state, args.id)
          return { state, todo }
        })
        return jsonResult({
          ok: true,
          message: '待办已恢复',
          todo: serialiseTodo(result.state, result.todo)
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'record_focus',
    {
      title: '记录专注',
      description:
        'Record a completed focus session for a todo. This also marks the todo as in progress if it has not started.',
      inputSchema: {
        id: z.string().min(1),
        minutes: z.number().int().min(1).max(600)
      }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          const todo = recordFocus(state, args.id, args.minutes)
          return { state, todo }
        })
        return jsonResult({ ok: true, todo: serialiseTodo(result.state, result.todo) })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'list_groups',
    {
      title: '列出分组',
      description: 'List user-defined todo groups with active and archived counts.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async () => {
      try {
        const state = store.read()
        return jsonResult({
          ok: true,
          groups: state.groups.map((group) => serialiseGroup(group, state))
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'add_group',
    {
      title: '新增分组',
      description: 'Create a user-defined todo group.',
      inputSchema: {
        name: z.string().min(1).max(40),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Hex color like #7aa2ff.')
      }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          const group = createGroup(state, args.name, args.color)
          return { state, group }
        })
        return jsonResult({
          ok: true,
          group: serialiseGroup(result.group, result.state)
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'update_group',
    {
      title: '修改分组',
      description: 'Rename or recolor a group.',
      inputSchema: {
        id: z.string().min(1),
        name: z.string().min(1).max(40).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
      },
      annotations: { idempotentHint: true }
    },
    async (args) => {
      try {
        const result = store.mutate((state) => {
          const group = updateGroup(state, args.id, { name: args.name, color: args.color })
          return { state, group }
        })
        return jsonResult({ ok: true, group: serialiseGroup(result.group, result.state) })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'get_overview',
    {
      title: '获取待办概览',
      description: 'Get counts by status, urgency and group, excluding archived todos unless specified.',
      inputSchema: {
        include_archived: z.boolean().optional()
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        const state = store.read()
        const todos = state.todos.filter(
          (todo) => args.include_archived === true || !todo.archivedAt
        )
        const active = todos.filter((todo) => !todo.archivedAt)
        const now = Date.now()
        return jsonResult({
          ok: true,
          total: todos.length,
          active: active.length,
          archived: state.todos.filter((todo) => todo.archivedAt).length,
          notStarted: active.filter((todo) => !todo.startedAt && !todo.completedAt).length,
          inProgress: active.filter((todo) => todo.startedAt && !todo.completedAt).length,
          completed: active.filter((todo) => todo.completedAt).length,
          overdue: active.filter((todo) => isOverdue(todo, now)).length,
          pinned: active.filter((todo) => todo.pinned).length,
          urgency: Object.fromEntries(
            URGENCY_VALUES.map((urgency) => [
              urgency,
              active.filter((todo) => todo.urgency === urgency).length
            ])
          ),
          groups: state.groups.map((group) => serialiseGroup(group, state)),
          generatedAt: new Date().toISOString()
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  server.registerTool(
    'summarise_todos',
    {
      title: 'AI 总结待办',
      description:
        'Generate an AI review of todos for a time range (day, week, month, year or a custom date range), same as the in-app "AI 回顾" panel. Uses the AI provider configured in app settings; archived todos are excluded. Returns an error if the AI provider is not configured.',
      inputSchema: {
        range: z
          .enum(['day', 'week', 'month', 'year', 'custom'])
          .optional()
          .describe('Summary time range. Default: week.'),
        start: z
          .string()
          .optional()
          .describe('Custom range start date (YYYY-MM-DD), local time. Required when range is custom.'),
        end: z
          .string()
          .optional()
          .describe('Custom range end date (YYYY-MM-DD, inclusive). Required when range is custom.')
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      try {
        const state = store.read()
        const settings = state.settings.ai
        if (!settings.baseUrl.trim() || !settings.apiKey.trim() || !settings.model.trim()) {
          throw new Error('尚未配置 AI 接口：请先在应用的「设置 → AI 接口」中填写 Base URL、API 密钥和模型')
        }
        const range: SummaryRange = args.range ?? 'week'
        const context = buildSummaryContext(
          state,
          range,
          Date.now(),
          range === 'custom' ? { start: args.start ?? '', end: args.end ?? '' } : undefined
        )
        const content = await callAIChat(
          settings,
          [
            {
              role: 'system',
              content:
                '你是个人生产力回顾助手。严格依据用户提供的数据输出中文 Markdown，不编造不存在的事实。'
            },
            { role: 'user', content: context.prompt }
          ],
          { timeoutMs: 120000 }
        )
        return jsonResult({
          ok: true,
          range,
          start: context.rangeStart,
          end: context.rangeEnd,
          model: settings.model,
          generatedAt: new Date().toISOString(),
          content
        })
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  return server
}
