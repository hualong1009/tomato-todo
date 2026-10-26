import { createHash } from 'node:crypto'
import { BLOB_PREFIX, replaceImagesWithRefs } from '../shared/blobRefs'
import { splitDataUrl } from '../shared/attachments'
import type { Todo } from '../shared/types'

/** 附件外置后的 blob：文件名 -> data URL 原始内容 */
export type BlobMap = Map<string, string>

export interface ExternalisedAssets {
  todos: Todo[]
  blobs: BlobMap
}

function extensionForDataUrl(mime: string): string {
  const normalised = mime.toLowerCase()
  if (normalised.includes('png')) return 'png'
  if (normalised.includes('jpeg') || normalised.includes('jpg')) return 'jpg'
  if (normalised.includes('webp')) return 'webp'
  if (normalised.includes('gif')) return 'gif'
  if (normalised.includes('svg')) return 'svg'
  if (normalised.includes('pdf')) return 'pdf'
  if (normalised.includes('zip')) return 'zip'
  if (normalised.includes('json')) return 'json'
  if (normalised.includes('markdown')) return 'md'
  if (normalised.includes('plain')) return 'txt'
  if (normalised.includes('word')) return 'docx'
  if (normalised.includes('sheet') || normalised.includes('excel')) return 'xlsx'
  if (normalised.includes('presentation') || normalised.includes('powerpoint')) return 'pptx'
  return 'bin'
}

/** 内容寻址：同一份内容永远得到同一个文件名，因此天然去重。 */
export function blobNameFor(dataUrl: string): string {
  const hash = createHash('sha256').update(dataUrl).digest('hex').slice(0, 16)
  const mime = splitDataUrl(dataUrl)?.mime ?? 'application/octet-stream'
  return `${hash}.${extensionForDataUrl(mime)}`
}

/**
 * 把待办里的图片与附件抽成 blob，正文/附件字段改写为 `blob:<文件名>` 引用。
 * 返回的 todos 是副本，不修改传入数据。
 */
export function externaliseAssets(todos: Todo[]): ExternalisedAssets {
  const blobs: BlobMap = new Map()
  const register = (dataUrl: string): string => {
    const name = blobNameFor(dataUrl)
    if (!blobs.has(name)) blobs.set(name, dataUrl)
    return name
  }

  const nextTodos = todos.map((todo) => {
    const content = replaceImagesWithRefs(todo.content, register)
    const attachments = todo.attachments.map((attachment) => {
      if (!attachment.data.startsWith('data:') || !splitDataUrl(attachment.data)) return attachment
      return { ...attachment, data: `${BLOB_PREFIX}${register(attachment.data)}` }
    })
    return { ...todo, content, attachments }
  })

  return { todos: nextTodos, blobs }
}
