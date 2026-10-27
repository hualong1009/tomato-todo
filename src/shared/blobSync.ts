import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { BLOB_PREFIX, replaceImagesWithRefs } from './blobRefs'
import { splitDataUrl } from './attachments'
import type { Todo } from './types'

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

/** 与桌面端相同的内容寻址算法：UTF-8 data URL 的 SHA-256 前 16 位 + 扩展名。 */
export function blobNameFor(dataUrl: string): string {
  const hash = bytesToHex(sha256(new TextEncoder().encode(dataUrl))).slice(0, 16)
  const mime = splitDataUrl(dataUrl)?.mime ?? 'application/octet-stream'
  return `${hash}.${extensionForDataUrl(mime)}`
}

/** 把待办中的内嵌图片/附件抽成 blob；返回副本，不修改原待办。 */
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
