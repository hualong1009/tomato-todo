import { ATTACHMENT_MAX_BYTES, formatBytes, splitDataUrl } from '@shared/attachments'
import type { Attachment } from '@shared/types'

/** 渲染进程侧：把用户选择的 File 读成附件对象（二进制以 data URL 形式内嵌）。 */
export async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(`附件 ${file.name} 超过 ${formatBytes(ATTACHMENT_MAX_BYTES)}，请压缩后再上传`)
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error(`读取附件失败：${file.name}`))
    reader.readAsDataURL(file)
  })
  const mime = file.type || splitDataUrl(data)?.mime || 'application/octet-stream'
  return {
    id: createAttachmentId(),
    name: file.name || '未命名附件',
    mime,
    size: file.size,
    data,
    createdAt: new Date().toISOString()
  }
}

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `att-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}
