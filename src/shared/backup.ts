import type { AppState, Group, Todo } from './types'

export interface RemotePayload {
  version: number
  app: 'tomato-todo'
  savedAt: string
  groups: Group[]
  todos: Todo[]
}

/** WebDAV 备份内容：只包含待办与分组，不包含任何密钥或本机设置。 */
export function createRemotePayload(state: AppState): string {
  return JSON.stringify(
    {
      version: 1,
      app: 'tomato-todo',
      savedAt: new Date().toISOString(),
      groups: state.groups,
      todos: state.todos
    },
    null,
    2
  )
}

/** 解析远端备份文本，结构不合法时返回 null。 */
export function parseRemotePayload(text: string): RemotePayload | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<RemotePayload>
  if (!Array.isArray(source.todos)) return null
  return {
    version: typeof source.version === 'number' ? source.version : 1,
    app: 'tomato-todo',
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : new Date().toISOString(),
    groups: Array.isArray(source.groups) ? source.groups : [],
    todos: source.todos
  }
}
