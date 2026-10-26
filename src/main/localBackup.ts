import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { splitDataUrl } from '../shared/attachments'
import { createRemotePayload, parseRemotePayload, type RemotePayload } from '../shared/backup'
import { buildExportMarkdown } from '../shared/markdownExport'
import type { AppState } from '../shared/types'
import { decryptBackup, encryptBackup, isEncryptedBackup } from './backupCrypto'

const MARKDOWN_EXTENSION = '.md'

export interface MarkdownFileResult {
  path: string
  todoCount: number
  imageCount: number
  /** 随 Markdown 一起落盘的附件数量 */
  attachmentCount: number
}

function decodeImageDataUrl(dataUrl: string): { data: Buffer; extension: string } | null {
  const match = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return null
  const mime = match[1].toLowerCase()
  const extension = mime.includes('jpeg') || mime.includes('jpg')
    ? 'jpg'
    : mime.includes('webp')
      ? 'webp'
      : mime.includes('gif')
        ? 'gif'
        : mime.includes('svg')
          ? 'svg'
          : 'png'
  return { data: Buffer.from(match[2].replace(/\s/g, ''), 'base64'), extension }
}

/** 确定导出文件路径：没有扩展名时补 .md。 */
export function normaliseMarkdownPath(file: string): string {
  return extname(file) ? file : `${file}${MARKDOWN_EXTENSION}`
}

/**
 * 把待办导出为 Markdown 文件；正文里的内嵌图片会写到同名 attachments 目录，
 * Markdown 中的链接改写为相对路径，方便直接分享整个文件夹。
 */
export function writeMarkdownExport(
  file: string,
  state: AppState,
  todoIds: string[] | null,
  options: { includeArchived?: boolean; title?: string } = {}
): MarkdownFileResult {
  const target = normaliseMarkdownPath(file)
  const built = buildExportMarkdown(state, todoIds, options)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, built.markdown, 'utf8')

  let imageCount = 0
  let attachmentCount = 0
  if (built.images.length > 0 || built.files.length > 0) {
    const assetsDir = join(dirname(target), 'attachments')
    mkdirSync(assetsDir, { recursive: true })
    for (const image of built.images) {
      const decoded = decodeImageDataUrl(image.dataUrl)
      if (!decoded) continue
      writeFileSync(join(assetsDir, image.name), decoded.data)
      imageCount += 1
    }
    for (const file of built.files) {
      const decoded = splitDataUrl(file.dataUrl)
      if (!decoded || !decoded.base64) continue
      writeFileSync(join(assetsDir, file.name), Buffer.from(decoded.base64, 'base64'))
      attachmentCount += 1
    }
  }

  const todoCount = todoIds
    ? state.todos.filter((todo) => todoIds.includes(todo.id)).length
    : state.todos.filter((todo) => options.includeArchived !== false || !todo.archivedAt).length

  return { path: target, todoCount, imageCount, attachmentCount }
}

export interface LocalBackupFileResult {
  path: string
  encrypted: boolean
  size: number
}

/**
 * 导出本地备份文件。设置密码后整份数据用 AES-256-GCM 加密
 * （与 WebDAV 加密备份同一种 TTENC1 格式，两边可以互相导入）。
 */
export function writeLocalBackupFile(
  file: string,
  state: AppState,
  password: string
): LocalBackupFileResult {
  const payload = createRemotePayload(state)
  const target = extname(file) ? file : `${file}.ttbak`
  mkdirSync(dirname(target), { recursive: true })
  if (password.trim()) {
    const encrypted = encryptBackup(payload, password)
    writeFileSync(target, encrypted)
    return { path: target, encrypted: true, size: encrypted.byteLength }
  }
  writeFileSync(target, payload, 'utf8')
  return { path: target, encrypted: false, size: Buffer.byteLength(payload, 'utf8') }
}

/** 读取本地备份文件：自动识别加密/明文，解析出待办与分组。 */
export function readLocalBackupFile(file: string, password: string): RemotePayload {
  if (!existsSync(file)) throw new Error(`文件不存在：${basename(file)}`)
  const raw = readFileSync(file)
  if (isEncryptedBackup(raw)) {
    if (!password.trim()) throw new Error('该备份已加密，请先在设置中填写本地备份密码')
    const text = decryptBackup(raw, password)
    const payload = parseRemotePayload(text)
    if (!payload) throw new Error('备份内容不是有效的待办数据')
    return payload
  }
  const text = raw.toString('utf8')
  const payload = parseRemotePayload(text)
  if (!payload) throw new Error('备份内容不是有效的待办数据')
  return payload
}

/** 导入前自动留一份原始文件副本，避免误覆盖后无法回溯。 */
export function backupBeforeImport(file: string): string | null {
  try {
    if (!existsSync(file)) return null
    const copy = `${file}.before-import-${Date.now()}`
    copyFileSync(file, copy)
    return copy
  } catch {
    return null
  }
}
