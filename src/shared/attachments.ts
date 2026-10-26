/** 单个附件大小上限（10MB）：附件随 JSON 备份内嵌 base64，过大会拖垮同步。 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/** 把字节数格式化为可读文本。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** 从 data URL 中取出 MIME 与 base64 主体。 */
export function splitDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl.trim())
  if (!match) return null
  const mime = match[1] || 'application/octet-stream'
  const base64 = match[2] ? match[3] : ''
  return { mime, base64: base64.replace(/\s/g, '') }
}

/** 根据 MIME 与文件名推断附件扩展名（用于保存对话框默认文件名）。 */
export function attachmentExtension(name: string, mime: string): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(name)
  if (fromName) return fromName[1].toLowerCase()
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/json': 'json',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
  }
  return map[mime] ?? 'bin'
}
