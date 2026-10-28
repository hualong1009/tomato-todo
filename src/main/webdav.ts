import { createRemotePayload, createRemotePayloadWith } from '../shared/backup'
import type {
  AppState,
  Todo,
  WebDAVSettings,
  WebDAVSyncResult,
  WebDAVTestResult
} from '../shared/types'
import { decryptBackup, encryptBackup, isEncryptedBackup } from './backupCrypto'
import { externaliseAssets } from './blobSync'
import { collectBlobRefs, inlineAttachmentRefs, inlineBlobRefs } from '../shared/blobRefs'

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'

/** 探测/建目录等轻量请求的超时时间。 */
const META_TIMEOUT_MS = 20000
/** 上传下载整份备份的超时时间；备份可能含内嵌图片，给足时间。 */
export const TRANSFER_TIMEOUT_MS = 120000
/** 传输类请求失败后的重试次数（网络抖动/超时各重试一次）。 */
const TRANSFER_RETRIES = 1

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true
  return /fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|terminated/i.test(error.message)
}

/** 传输请求：使用长超时，网络类失败自动重试一次。 */
async function transferRequest(doFetch: () => Promise<Response>): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= TRANSFER_RETRIES; attempt += 1) {
    try {
      return await doFetch()
    } catch (error) {
      lastError = error
      if (attempt === TRANSFER_RETRIES || !isRetryableError(error)) break
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('WebDAV 请求失败')
}

function normaliseBaseUrl(value: string): URL {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('请填写 WebDAV 服务器地址')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('WebDAV 服务器地址格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('WebDAV 地址必须使用 http 或 https')
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
  return url
}

export function buildRemoteFileUrl(settings: WebDAVSettings): string {
  const base = normaliseBaseUrl(settings.url)
  const remotePath = settings.remotePath.trim()
  if (!remotePath) throw new Error('请填写远端文件路径')
  if (/^https?:\/\//i.test(remotePath)) {
    return new URL(remotePath).toString()
  }
  return new URL(remotePath.replace(/^\/+/, ''), base).toString()
}

function parentUrl(fileUrl: string): string {
  const url = new URL(fileUrl)
  const parts = url.pathname.split('/')
  parts.pop()
  url.pathname = `${parts.join('/')}/`
  return url.toString()
}

function authHeaders(settings: WebDAVSettings): Record<string, string> {
  if (!settings.username && !settings.password) return {}
  const token = Buffer.from(`${settings.username}:${settings.password}`, 'utf8').toString('base64')
  return { Authorization: `Basic ${token}` }
}

/** 把字节数格式化成可读文本（用于同步结果提示）。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function describeStatus(status: number): string {
  if (status === 401) return '认证失败（401），请检查用户名和密码'
  if (status === 403) return '没有访问权限（403）'
  if (status === 404) return '路径不存在（404）'
  if (status === 405) return '服务器不允许该 WebDAV 操作（405）'
  if (status === 409) return '父目录不存在（409）'
  if (status === 507) return 'WebDAV 存储空间不足（507）'
  return `WebDAV 请求失败（HTTP ${status}）`
}

async function propfind(
  url: string,
  settings: WebDAVSettings,
  fetchImpl: typeof fetch
): Promise<Response> {
  return fetchImpl(url, {
    method: 'PROPFIND',
    headers: {
      ...authHeaders(settings),
      Depth: '0',
      'Content-Type': 'application/xml; charset=utf-8'
    },
    body: PROPFIND_BODY,
    signal: AbortSignal.timeout(META_TIMEOUT_MS)
  })
}

export async function testWebDAV(
  settings: WebDAVSettings,
  fetchImpl: typeof fetch = fetch
): Promise<WebDAVTestResult> {
  try {
    normaliseBaseUrl(settings.url)
    const fileUrl = buildRemoteFileUrl(settings)
    const dirUrl = parentUrl(fileUrl)
    const response = await propfind(dirUrl, settings, fetchImpl)
    if (response.ok || response.status === 207) {
      return {
        ok: true,
        message: 'WebDAV 连接成功，远端目录可用',
        status: response.status
      }
    }
    if (response.status === 404) {
      const base = normaliseBaseUrl(settings.url).toString()
      const baseResponse = await propfind(base, settings, fetchImpl)
      if (baseResponse.ok || baseResponse.status === 207) {
        return {
          ok: true,
          message: 'WebDAV 连接成功；远端目录尚不存在，首次同步时会自动创建',
          status: baseResponse.status
        }
      }
      return {
        ok: false,
        message: describeStatus(baseResponse.status),
        status: baseResponse.status
      }
    }
    return { ok: false, message: describeStatus(response.status), status: response.status }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'WebDAV 连接失败'
    }
  }
}

function directoryUrls(baseUrl: string, fileUrl: string): string[] {
  const base = new URL(baseUrl)
  const file = new URL(fileUrl)
  const baseParts = base.pathname.split('/').filter(Boolean)
  const fileParts = file.pathname.split('/').filter(Boolean)
  fileParts.pop()
  if (file.origin !== base.origin || fileParts.length < baseParts.length) {
    return [parentUrl(fileUrl)]
  }
  if (baseParts.some((part, index) => fileParts[index] !== part)) {
    return [parentUrl(fileUrl)]
  }
  const urls: string[] = []
  let path = `/${baseParts.join('/')}`
  if (path !== '/' && !path.endsWith('/')) path += '/'
  for (const segment of fileParts.slice(baseParts.length)) {
    path += `${segment}/`
    urls.push(`${base.origin}${path}`)
  }
  return urls
}

async function ensureRemoteDirectory(
  settings: WebDAVSettings,
  fileUrl: string,
  fetchImpl: typeof fetch
): Promise<void> {
  const baseUrl = normaliseBaseUrl(settings.url)
  const urls = directoryUrls(baseUrl.toString(), fileUrl)
  for (const url of urls) {
    const response = await fetchImpl(url, {
      method: 'MKCOL',
      headers: authHeaders(settings),
      signal: AbortSignal.timeout(META_TIMEOUT_MS)
    })
    if (response.status === 401) throw new Error(describeStatus(401))
    if (response.status === 403) throw new Error(describeStatus(403))
    if (response.status === 409) {
      throw new Error('WebDAV 父目录不存在，无法创建远端目录')
    }
    if (response.status === 201 || response.status === 200 || response.status === 204) continue
    if (response.status === 405) continue
    if (response.status >= 500) throw new Error(describeStatus(response.status))
  }
}

export { createRemotePayload } from '../shared/backup'

/** 列出 blobs/ 目录下已经存在的文件名（内容寻址，已存在就不用重传）。 */
async function listRemoteBlobs(
  settings: WebDAVSettings,
  blobsUrl: string,
  fetchImpl: typeof fetch
): Promise<Set<string>> {
  const response = await fetchImpl(blobsUrl, {
    method: 'PROPFIND',
    headers: {
      ...authHeaders(settings),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8'
    },
    body:
      '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>',
    signal: AbortSignal.timeout(META_TIMEOUT_MS)
  })
  const names = new Set<string>()
  if (!response.ok && response.status !== 207) return names
  const xml = await response.text()
  for (const match of xml.matchAll(/<[^>]*D?:?href[^>]*>([^<]+)<\/[^>]*href>/gi)) {
    const raw = match[1]
    const name = decodeURIComponent(raw.split('/').filter(Boolean).pop() ?? '')
    if (name) names.add(name)
  }
  return names
}

interface BlobUploadResult {
  payload: string
  uploaded: number
  reused: number
  failed: string | null
}

/** 把图片/附件上传到 blobs/（已存在则跳过），并生成带引用清单的 manifest。 */
async function uploadAssets(
  settings: WebDAVSettings,
  state: AppState,
  fileUrl: string,
  blobs: Map<string, string>,
  fetchImpl: typeof fetch
): Promise<BlobUploadResult> {
  const blobsUrl = new URL('blobs/', parentUrl(fileUrl)).toString()
  const encrypting = Boolean(settings.encryptionPassword)
  await ensureRemoteDirectory(settings, new URL('placeholder', blobsUrl).toString(), fetchImpl)
  const existing = await listRemoteBlobs(settings, blobsUrl, fetchImpl)

  let uploaded = 0
  let reused = 0
  for (const [name, dataUrl] of blobs) {
    if (existing.has(name)) {
      // 同一内容寻址文件可能曾用其他密码（或明文）上传。
      // 只复用当前设置能正确读回的文件，否则重新加密同名 blob。
      try {
        const previous = await transferRequest(() => fetchImpl(`${blobsUrl}${name}`, {
          method: 'GET',
          headers: authHeaders(settings),
          signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS)
        }))
        if (previous.ok) {
          const bytes = Buffer.from(await previous.arrayBuffer())
          const encrypted = isEncryptedBackup(bytes)
          const text = encrypted ? decryptBackup(bytes, settings.encryptionPassword) : bytes.toString('utf8')
          if (encrypted === encrypting && text === dataUrl) {
            reused += 1
            continue
          }
        }
      } catch {
        // 旧文件不能解密/读取时重传，避免主备份引用错误加密版本。
      }
    }
    const body: Buffer | string = encrypting
      ? encryptBackup(dataUrl, settings.encryptionPassword)
      : dataUrl
    const response = await transferRequest(() =>
      fetchImpl(`${blobsUrl}${name}`, {
        method: 'PUT',
        headers: {
          ...authHeaders(settings),
          'Content-Type': encrypting ? 'application/octet-stream' : 'text/plain; charset=utf-8'
        },
        body,
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS)
      })
    )
    if (!response.ok && response.status !== 201 && response.status !== 204) {
      return {
        payload: '',
        uploaded,
        reused,
        failed: `上传附件 ${name} 失败：${describeStatus(response.status)}`
      }
    }
    uploaded += 1
  }

  return {
    payload: '',
    uploaded,
    reused,
    failed: null
  }
}

export async function uploadToWebDAV(
  settings: WebDAVSettings,
  state: AppState,
  fetchImpl: typeof fetch = fetch
): Promise<WebDAVSyncResult> {
  try {
    const fileUrl = buildRemoteFileUrl(settings)
    await ensureRemoteDirectory(settings, fileUrl, fetchImpl)
    const encrypting = Boolean(settings.encryptionPassword)

    // 图片/附件外置：单文件从 MB 级降到 KB 级，绕开 WebDAV 单文件限制
    const splitAssets = settings.splitAssets !== false
    const externalised = splitAssets ? externaliseAssets(state.todos) : null
    const todos = externalised ? externalised.todos : state.todos
    const blobs = externalised?.blobs ?? new Map<string, string>()
    let uploaded = 0
    let reused = 0
    if (blobs.size > 0) {
      const result = await uploadAssets(settings, state, fileUrl, blobs, fetchImpl)
      if (result.failed) return { ok: false, message: result.failed }
      uploaded = result.uploaded
      reused = result.reused
    }

    const savedAt = new Date().toISOString()
    const payload = externalised
      ? createRemotePayloadWith(state, todos, savedAt)
      : createRemotePayload(state, savedAt)
    const rawSize = Buffer.byteLength(payload, 'utf8')
    const body: Buffer | string = encrypting
      ? encryptBackup(payload, settings.encryptionPassword)
      : payload
    const bodySize = typeof body === 'string' ? rawSize : body.byteLength
    const response = await transferRequest(() =>
      fetchImpl(fileUrl, {
        method: 'PUT',
        headers: {
          ...authHeaders(settings),
          'Content-Type': encrypting
            ? 'application/octet-stream'
            : 'application/json; charset=utf-8'
        },
        body,
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS)
      })
    )
    if (response.ok || response.status === 201 || response.status === 204) {
      const savedText = `${formatSize(bodySize)}${encrypting ? `（原始 ${formatSize(rawSize)}）` : ''}`
      const assetNote =
        blobs.size > 0 ? `，外置 ${blobs.size} 个图片/附件（新传 ${uploaded}、复用 ${reused}）` : ''
      return {
        ok: true,
        message: encrypting
          ? `已加密压缩保存到 WebDAV，共 ${savedText}${assetNote}`
          : `已保存到 WebDAV，共 ${savedText}${assetNote}`,
        at: new Date().toISOString(),
        remoteSavedAt: savedAt,
        action: 'upload'
      }
    }
    return { ok: false, message: describeStatus(response.status) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'WebDAV 上传失败'
    }
  }
}

export async function downloadFromWebDAV(
  settings: WebDAVSettings,
  fetchImpl: typeof fetch = fetch,
  options: { inlineAssets?: boolean } = {}
): Promise<{
  ok: boolean
  message: string
  raw?: unknown
  at?: string
  /** 远端备份的 savedAt，用于判断远端是否被其他设备更新 */
  savedAt?: string
  /** HTTP 状态码，404 表示远端还没有备份（不是错误） */
  status?: number
}> {
  try {
    const fileUrl = buildRemoteFileUrl(settings)
    const response = await transferRequest(() =>
      fetchImpl(fileUrl, {
        method: 'GET',
        headers: authHeaders(settings),
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS)
      })
    )
    if (response.status === 404) {
      return { ok: false, message: '远端还没有备份文件', status: 404 }
    }
    if (!response.ok) {
      return { ok: false, message: describeStatus(response.status), status: response.status }
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    let text: string
    if (isEncryptedBackup(buffer)) {
      try {
        text = decryptBackup(buffer, settings.encryptionPassword)
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? `${error.message}，请检查设置中的 WebDAV 加密密码`
              : '解密备份失败，请检查加密密码'
        }
      }
    } else {
      text = buffer.toString('utf8')
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return { ok: false, message: '远端文件不是有效的待办数据' }
    }

    const savedAt =
      typeof (raw as { savedAt?: unknown }).savedAt === 'string'
        ? ((raw as { savedAt: string }).savedAt)
        : undefined

    // 外置资源：把 blob 引用换回内嵌 data URL（本地模型保持自包含）。
    // 双向同步先只读 savedAt 判断有无变化，这时不下载 blobs，避免每次都拉一遍附件。
    const payloadTodos = (raw as { todos?: Todo[] }).todos
    if (options.inlineAssets !== false && Array.isArray(payloadTodos)) {
      const refs = collectBlobRefs(payloadTodos)
      if (refs.length > 0) {
        const blobsUrl = new URL('blobs/', parentUrl(fileUrl)).toString()
        const cache = new Map<string, string | null>()
        let missing = 0
        for (const name of refs) {
          const blobResponse = await fetchImpl(`${blobsUrl}${name}`, {
            method: 'GET',
            headers: authHeaders(settings),
            signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS)
          })
          if (!blobResponse.ok) {
            cache.set(name, null)
            missing += 1
            continue
          }
          const blobBuffer = Buffer.from(await blobResponse.arrayBuffer())
          if (isEncryptedBackup(blobBuffer)) {
            try {
              cache.set(name, decryptBackup(blobBuffer, settings.encryptionPassword))
            } catch {
              cache.set(name, null)
              missing += 1
            }
          } else {
            cache.set(name, blobBuffer.toString('utf8'))
          }
        }
        const resolve = (name: string): string | null => cache.get(name) ?? null
        ;(raw as { todos: Todo[] }).todos = payloadTodos.map((todo) => ({
          ...todo,
          content: inlineBlobRefs(todo.content, resolve),
          attachments: inlineAttachmentRefs(todo.attachments ?? [], resolve)
        }))
        if (missing > 0) {
          return {
            ok: true,
            message: `已读取备份，但有 ${missing} 个图片/附件下载失败（远端缺失或密码不符）`,
            raw,
            at: new Date().toISOString(),
            savedAt
          }
        }
      }
    }
    return { ok: true, message: '已从 WebDAV 读取备份', raw, at: new Date().toISOString(), savedAt }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'WebDAV 下载失败'
    }
  }
}
