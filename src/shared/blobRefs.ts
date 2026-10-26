import type { Attachment, Todo } from './types'

/**
 * 附件/图片外置引用。
 *
 * WebDAV 备份时把正文内嵌图片与附件从 JSON 里抽出来，单独存成
 * `blobs/<sha256 前 16 位>.<ext>`，JSON 里只留 `blob:<文件名>` 引用：
 * - 单文件体积从 MB 级降到 KB 级，绕开 WebDAV 单文件限制；
 * - 内容寻址天然去重，同一张图/同一个附件只上传一次。
 * 本地数据模型不变（仍是内嵌 data URL），只在同步时做转换。
 */
export const BLOB_PREFIX = 'blob:'

/** 匹配 Markdown 图片中的外置引用：![alt](blob:xxxxxxxxxxxxxxxx.webp) */
const BLOB_IMAGE_PATTERN = /!\[([^\]]*)\]\(blob:([^)\s]+)\)/g

/** 文件名里只会出现这些字符（哈希 + 扩展名）。 */
function isBlobName(value: string): boolean {
  return /^[a-z0-9]{8,64}\.[a-z0-9]{1,8}$/i.test(value)
}

/** 收集待办里所有外置引用的 blob 文件名（去重）。 */
export function collectBlobRefs(todos: Todo[]): string[] {
  const found = new Set<string>()
  for (const todo of todos) {
    for (const match of todo.content.matchAll(BLOB_IMAGE_PATTERN)) {
      const name = match[2]
      if (isBlobName(name)) found.add(name)
    }
    for (const attachment of todo.attachments ?? []) {
      if (attachment.data.startsWith(BLOB_PREFIX)) {
        const name = attachment.data.slice(BLOB_PREFIX.length)
        if (isBlobName(name)) found.add(name)
      }
    }
  }
  return [...found]
}

/** 引用是否指向外置 blob。 */
export function isBlobRef(value: string): boolean {
  return value.startsWith(BLOB_PREFIX)
}

/** 把正文里的 blob 引用换回 data URL；缺失的引用保持原样，便于提示。 */
export function inlineBlobRefs(content: string, resolve: (name: string) => string | null): string {
  return content.replace(BLOB_IMAGE_PATTERN, (match, alt: string, name: string) => {
    const dataUrl = resolve(name)
    return dataUrl ? `![${alt}](${dataUrl})` : match
  })
}

/** 把附件里的 blob 引用换回 data URL。 */
export function inlineAttachmentRefs(
  attachments: Attachment[],
  resolve: (name: string) => string | null
): Attachment[] {
  return attachments.map((attachment) => {
    if (!isBlobRef(attachment.data)) return attachment
    const name = attachment.data.slice(BLOB_PREFIX.length)
    const dataUrl = resolve(name)
    return dataUrl ? { ...attachment, data: dataUrl } : attachment
  })
}

/** 统计待办里仍未解析的外置引用数量（用于恢复后的提示）。 */
export function countUnresolvedRefs(todos: Todo[]): number {
  return collectBlobRefs(todos).length > 0
    ? todos.reduce((total, todo) => {
        const contentRefs = [...todo.content.matchAll(BLOB_IMAGE_PATTERN)].filter((match) =>
          isBlobName(match[2])
        ).length
        const attachmentRefs = (todo.attachments ?? []).filter((item) => isBlobRef(item.data)).length
        return total + contentRefs + attachmentRefs
      }, 0)
    : 0
}

/** 把正文里的内嵌图片替换为外置引用（refFor 返回 blob 文件名）。 */
export function replaceImagesWithRefs(
  content: string,
  refFor: (dataUrl: string) => string
): string {
  return content.replace(
    /!\[([^\]]*)\]\((data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+)\)/gi,
    (_match, alt: string, dataUrl: string) => `![${alt}](${BLOB_PREFIX}${refFor(dataUrl)})`
  )
}
