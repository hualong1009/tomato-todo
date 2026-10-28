import { collectBlobRefs } from './blobRefs'
import type { AppState, Group, Todo } from './types'

export interface RemoteAsset {
  /** blobs/ 目录下的文件名（内容寻址） */
  name: string
  /** 原始字节数，便于恢复时校验 */
  size?: number
}

export interface RemotePayload {
  version: number
  app: 'tomato-todo'
  savedAt: string
  groups: Group[]
  todos: Todo[]
  /** 外置的图片/附件清单；为空表示所有内容都内嵌在 todos 里 */
  assets?: RemoteAsset[]
}

/**
 * WebDAV 备份内容：只包含待办与分组，不包含任何密钥或本机设置。
 * `savedAt` 可由调用方指定，便于上传后把同一个时间戳记为「远端版本」。
 */
export function createRemotePayload(state: AppState, savedAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      version: 1,
      app: 'tomato-todo',
      savedAt,
      groups: state.groups,
      todos: state.todos
    },
    null,
    2
  )
}

/** 生成带外置资源清单的备份内容（WebDAV 拆分同步用）。 */
export function createRemotePayloadWith(
  state: AppState,
  todos: Todo[],
  savedAt = new Date().toISOString()
): string {
  const assets = collectBlobRefs(todos).map((name) => ({ name }))
  return JSON.stringify(
    {
      version: 2,
      app: 'tomato-todo',
      savedAt,
      groups: state.groups,
      todos,
      assets
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
    todos: source.todos,
    assets: Array.isArray(source.assets)
      ? source.assets.filter((item): item is RemoteAsset =>
          Boolean(item && typeof item === 'object' && typeof (item as RemoteAsset).name === 'string')
        )
      : []
  }
}
