import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptBackup, encryptBackup } from '../src/main/backupCrypto'
import { createDefaultState } from '../src/main/persistence'
import {
  buildRemoteFileUrl,
  createRemotePayload,
  downloadFromWebDAV,
  testWebDAV,
  uploadToWebDAV
} from '../src/main/webdav'
import { createRemotePayloadWith } from '../src/shared/backup'
import { createTodo } from '../src/shared/operations'
import type { WebDAVSettings } from '../src/shared/types'
import { makeState } from './helpers'

function settings(overrides: Partial<WebDAVSettings> = {}): WebDAVSettings {
  return {
    enabled: true,
    url: 'https://dav.example.com/remote.php/dav/files/me/',
    remotePath: 'tomato-todo/data.json',
    username: 'me',
    password: 'secret',
    autoUpload: true,
    syncIntervalMinutes: 5,
    encryptionPassword: '',
    lastSyncAt: null,
    lastStatus: 'idle',
    lastError: null,
    ...overrides
  }
}

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  rawBody?: Uint8Array
}

function mockFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const headers = Object.fromEntries(new Headers(init?.headers).entries())
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
        rawBody: init?.body instanceof Uint8Array ? init.body : undefined
      }
      calls.push(call)
      return handler(call)
    })
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WebDAV URL 与载荷', () => {
  it('拼接服务器地址与相对远端路径', () => {
    expect(buildRemoteFileUrl(settings())).toBe(
      'https://dav.example.com/remote.php/dav/files/me/tomato-todo/data.json'
    )
    expect(buildRemoteFileUrl(settings({ url: 'https://dav.example.com/dav' }))).toBe(
      'https://dav.example.com/dav/tomato-todo/data.json'
    )
    expect(buildRemoteFileUrl(settings({ remotePath: '/backups/todo.json' }))).toBe(
      'https://dav.example.com/remote.php/dav/files/me/backups/todo.json'
    )
  })

  it('允许远端路径直接是绝对 URL', () => {
    expect(buildRemoteFileUrl(settings({ remotePath: 'https://other.example.com/a.json' }))).toBe(
      'https://other.example.com/a.json'
    )
  })

  it('拒绝空地址、非法协议和空路径', () => {
    expect(() => buildRemoteFileUrl(settings({ url: '' }))).toThrow('服务器地址')
    expect(() => buildRemoteFileUrl(settings({ url: 'ftp://example.com/' }))).toThrow('http')
    expect(() => buildRemoteFileUrl(settings({ url: 'not a url' }))).toThrow('格式不正确')
    expect(() => buildRemoteFileUrl(settings({ remotePath: '  ' }))).toThrow('远端文件路径')
  })

  it('备份载荷只包含分组与待办，不泄露设置和密钥', () => {
    const state = createDefaultState()
    state.settings.ai.apiKey = 'sk-secret'
    state.settings.webdav.password = 'dav-secret'
    createTodo(state, { title: '需要备份' })
    const payload = createRemotePayload(state)
    expect(payload).toContain('需要备份')
    expect(payload).toContain('"app": "tomato-todo"')
    expect(payload).not.toContain('sk-secret')
    expect(payload).not.toContain('dav-secret')
    expect(payload).not.toContain('promptTemplate')
    expect(payload).not.toContain('settings')
  })
})

describe('测试 WebDAV 可用性', () => {
  it('父目录 PROPFIND 返回 207 时连接成功', async () => {
    const calls = mockFetch(() => new Response('', { status: 207 }))
    const result = await testWebDAV(settings())
    expect(result.ok).toBe(true)
    expect(result.status).toBe(207)
    expect(result.message).toContain('连接成功')
    expect(calls[0].method).toBe('PROPFIND')
    expect(calls[0].url).toBe('https://dav.example.com/remote.php/dav/files/me/tomato-todo/')
    expect(calls[0].headers.depth).toBe('0')
    expect(calls[0].headers.authorization).toBe(
      `Basic ${Buffer.from('me:secret').toString('base64')}`
    )
  })

  it('父目录 404 时回退探测服务器根地址，成功则提示首次同步会创建目录', async () => {
    const calls = mockFetch((call) =>
      new Response('', { status: call.url.endsWith('/tomato-todo/') ? 404 : 207 })
    )
    const result = await testWebDAV(settings())
    expect(result.ok).toBe(true)
    expect(result.message).toContain('尚不存在')
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('https://dav.example.com/remote.php/dav/files/me/')
  })

  it('认证失败返回可读错误', async () => {
    mockFetch(() => new Response('', { status: 401 }))
    const result = await testWebDAV(settings())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('认证失败')
  })

  it('网络异常不会抛出，而是返回错误信息', async () => {
    mockFetch(() => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    const result = await testWebDAV(settings())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('ENOTFOUND')
  })
})

describe('上传到 WebDAV', () => {
  it('先 MKCOL 创建缺失目录，再 PUT 备份文件', async () => {
    const state = makeState()
    createTodo(state, { title: '上传任务' })
    const calls = mockFetch((call) => {
      if (call.method === 'MKCOL') return new Response('', { status: 201 })
      return new Response('', { status: 201 })
    })
    const result = await uploadToWebDAV(settings(), state)
    expect(result.ok).toBe(true)
    expect(result.at).toBeTruthy()
    expect(calls.map((call) => call.method)).toEqual(['MKCOL', 'PUT'])
    expect(calls[0].url).toBe('https://dav.example.com/remote.php/dav/files/me/tomato-todo/')
    expect(calls[1].url).toBe(
      'https://dav.example.com/remote.php/dav/files/me/tomato-todo/data.json'
    )
    expect(calls[1].headers['content-type']).toContain('application/json')
    expect(calls[1].body).toContain('上传任务')
    // 上传时写入的 savedAt 会作为「远端版本」返回，双向同步靠它判断远端有没有变
    expect(result.remoteSavedAt).toBeTruthy()
    expect(JSON.parse(calls[1].body as string).savedAt).toBe(result.remoteSavedAt)
  })

  it('已有目录 MKCOL 返回 405 时继续上传', async () => {
    const calls = mockFetch((call) =>
      new Response(null, { status: call.method === 'MKCOL' ? 405 : 204 })
    )
    const result = await uploadToWebDAV(settings(), makeState())
    expect(result.ok).toBe(true)
    expect(calls.map((call) => call.method)).toEqual(['MKCOL', 'PUT'])
  })

  it('上传失败返回 HTTP 状态错误', async () => {
    mockFetch((call) =>
      new Response('', { status: call.method === 'MKCOL' ? 201 : 507 })
    )
    const result = await uploadToWebDAV(settings(), makeState())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('空间不足')
  })

  it('MKCOL 认证失败立即终止，不发送 PUT', async () => {
    const calls = mockFetch(() => new Response('', { status: 401 }))
    const result = await uploadToWebDAV(settings(), makeState())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('认证失败')
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })
})

describe('从 WebDAV 下载', () => {
  it('读取并解析 JSON 备份', async () => {
    const payload = createRemotePayload(makeState())
    mockFetch(() => new Response(payload, { status: 200 }))
    const result = await downloadFromWebDAV(settings())
    expect(result.ok).toBe(true)
    expect(result.raw).toMatchObject({ app: 'tomato-todo' })
    expect(result.at).toBeTruthy()
  })

  it('远端没有文件时返回友好提示', async () => {
    mockFetch(() => new Response('', { status: 404 }))
    const result = await downloadFromWebDAV(settings())
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
    expect(result.message).toContain('还没有备份文件')
  })

  it('只读 savedAt 时（inlineAssets: false）不下载 blobs/', async () => {
    const state = makeState()
    createTodo(state, {
      title: '带图片',
      attachments: [
        {
          id: 'a1',
          name: 'pixel.png',
          mime: 'image/png',
          size: 3,
          data: 'data:image/png;base64,QUJD',
          createdAt: new Date().toISOString()
        }
      ]
    })
    const todos = (await import('../src/shared/blobSync')).externaliseAssets(state.todos)
    const payload = createRemotePayloadWith(state, todos.todos)
    const calls = mockFetch(() => new Response(payload, { status: 200 }))
    const result = await downloadFromWebDAV(settings(), undefined, { inlineAssets: false })
    expect(result.ok).toBe(true)
    expect(result.savedAt).toBeTruthy()
    expect(calls.filter((call) => call.url.includes('/blobs/'))).toHaveLength(0)
  })

  it('远端内容不是 JSON 时拒绝导入', async () => {
    mockFetch(() => new Response('<html>not json</html>', { status: 200 }))
    const result = await downloadFromWebDAV(settings())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('不是有效的待办数据')
  })
})

describe('WebDAV 备份加密', () => {
  it('设置加密密码后上传的是二进制密文，不是明文 JSON', async () => {
    const state = makeState()
    const calls = mockFetch(() => new Response(null, { status: 201 }))
    const result = await uploadToWebDAV(settings({ encryptionPassword: 'enc-pass' }), state)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('已加密压缩保存到 WebDAV')
    const put = calls.find((call) => call.method === 'PUT')
    expect(put).toBeTruthy()
    expect(put?.rawBody).toBeInstanceOf(Uint8Array)
    expect(put?.headers['content-type']).toBe('application/octet-stream')
    const bytes = Buffer.from(put!.rawBody!)
    expect(bytes.subarray(0, 6).toString('utf8')).toBe('TTENC2')
    expect(bytes.toString('utf8')).not.toContain('"todos"')
  })

  it('下载时自动解密加密备份', async () => {
    const state = makeState()
    createTodo(state, { title: '加密备份任务' })
    const encrypted = encryptBackup(createRemotePayload(state), 'enc-pass')
    mockFetch(() => new Response(encrypted, { status: 200 }))
    const result = await downloadFromWebDAV(settings({ encryptionPassword: 'enc-pass' }))
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result.raw)).toContain('加密备份任务')
  })

  it('加密密码错误时给出可读错误', async () => {
    const encrypted = encryptBackup(createRemotePayload(makeState()), 'enc-pass')
    mockFetch(() => new Response(encrypted, { status: 200 }))
    const result = await downloadFromWebDAV(settings({ encryptionPassword: 'wrong-pass' }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain('解密失败')
  })

  it('未设置密码时下载加密备份提示需要密码', async () => {
    const encrypted = encryptBackup(createRemotePayload(makeState()), 'enc-pass')
    mockFetch(() => new Response(encrypted, { status: 200 }))
    const result = await downloadFromWebDAV(settings())
    expect(result.ok).toBe(false)
    expect(result.message).toContain('加密密码')
  })

  it('未加密的明文 JSON 备份仍然可以恢复（兼容旧备份）', async () => {
    const state = makeState()
    createTodo(state, { title: '旧版明文备份' })
    mockFetch(() => new Response(createRemotePayload(state), { status: 200 }))
    const result = await downloadFromWebDAV(settings())
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result.raw)).toContain('旧版明文备份')
  })
})

describe('WebDAV 图片/附件拆分同步', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  function stateWithImage() {
    const state = makeState()
    createTodo(state, {
      title: '带图任务',
      content: `正文\n\n![截图](${PNG})`,
      groupId: 'inbox'
    })
    return state
  }

  it('上传时把图片拆到 blobs/，主文件里只剩引用', async () => {
    const state = stateWithImage()
    const calls = mockFetch((call) => {
      if (call.method === 'PROPFIND' && call.url.includes('/blobs/')) {
        return new Response(
          '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/blobs/</d:href></d:response></d:multistatus>',
          { status: 207 }
        )
      }
      return new Response(null, { status: 201 })
    })

    const result = await uploadToWebDAV(settings(), state)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('外置 1 个图片/附件')

    const blobPut = calls.find((call) => call.method === 'PUT' && call.url.includes('/blobs/'))
    expect(blobPut?.url).toMatch(/\/tomato-todo\/blobs\/[a-f0-9]{16}\.png$/)
    expect(blobPut?.body).toBe(PNG)

    const manifestPut = calls.find((call) => call.method === 'PUT' && call.url.endsWith('data.json'))
    expect(manifestPut?.body).toContain('blob:')
    expect(manifestPut?.body).not.toContain('base64')
    expect(manifestPut?.body).toContain('"assets"')
  })

  it('远端已存在的 blob 不会重复上传', async () => {
    const state = stateWithImage()
    const { blobs } = (await import('../src/main/blobSync')).externaliseAssets(state.todos)
    const existingName = [...blobs.keys()][0]
    const calls = mockFetch((call) => {
      if (call.method === 'PROPFIND' && call.url.includes('/blobs/')) {
        return new Response(
          `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/blobs/${existingName}</d:href></d:response></d:multistatus>`,
          { status: 207 }
        )
      }
      if (call.method === 'GET' && call.url.includes('/blobs/')) return new Response(PNG, { status: 200 })
      return new Response(null, { status: 201 })
    })

    const result = await uploadToWebDAV(settings(), state)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('复用 1')
    expect(calls.filter((call) => call.method === 'PUT' && call.url.includes('/blobs/'))).toHaveLength(0)
  })

  it('加密密码变更时重传已有 blob，保证双端可恢复', async () => {
    const state = stateWithImage()
    const { blobs } = (await import('../src/main/blobSync')).externaliseAssets(state.todos)
    const existingName = [...blobs.keys()][0]
    const calls = mockFetch((call) => {
      if (call.method === 'PROPFIND' && call.url.includes('/blobs/')) {
        return new Response(`<d:href>/blobs/${existingName}</d:href>`, { status: 207 })
      }
      if (call.method === 'GET' && call.url.includes('/blobs/')) {
        return new Response(encryptBackup(PNG, '旧密码'), { status: 200 })
      }
      return new Response(null, { status: 201 })
    })
    const result = await uploadToWebDAV(settings({ encryptionPassword: '新密码' }), state)
    expect(result.ok).toBe(true)
    const blobPut = calls.find((call) => call.method === 'PUT' && call.url.includes('/blobs/'))
    expect(blobPut?.rawBody).toBeDefined()
    expect(decryptBackup(Buffer.from(blobPut!.rawBody!), '新密码')).toBe(PNG)
  })

  it('恢复时下载 blobs 并回填成内嵌图片', async () => {
    const state = stateWithImage()
    const { todos, blobs } = (await import('../src/main/blobSync')).externaliseAssets(state.todos)
    const manifest = createRemotePayloadWith(state, todos)
    const [blobName, blobData] = [...blobs.entries()][0]
    mockFetch((call) => {
      if (call.method === 'GET' && call.url.endsWith('data.json')) {
        return new Response(manifest, { status: 200 })
      }
      if (call.method === 'GET' && call.url.includes('/blobs/')) {
        return new Response(blobData, { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const result = await downloadFromWebDAV(settings())
    expect(result.ok).toBe(true)
    const raw = result.raw as { todos: { content: string }[] }
    expect(raw.todos[0].content).toContain('data:image/png;base64,')
    expect(raw.todos[0].content).not.toContain('blob:')
  })

  it('blob 缺失时仍能恢复，并提示数量', async () => {
    const state = stateWithImage()
    const { todos } = (await import('../src/main/blobSync')).externaliseAssets(state.todos)
    const manifest = createRemotePayloadWith(state, todos)
    mockFetch((call) => {
      if (call.method === 'GET' && call.url.endsWith('data.json')) {
        return new Response(manifest, { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const result = await downloadFromWebDAV(settings())
    expect(result.ok).toBe(true)
    expect(result.message).toContain('1 个图片/附件下载失败')
  })

  it('关闭拆分开关时退化为单文件备份', async () => {
    const state = stateWithImage()
    const calls = mockFetch(() => new Response(null, { status: 201 }))
    const result = await uploadToWebDAV(settings({ splitAssets: false }), state)
    expect(result.ok).toBe(true)
    expect(calls.every((call) => !call.url.includes('/blobs/'))).toBe(true)
    const manifestPut = calls.find((call) => call.method === 'PUT' && call.url.endsWith('data.json'))
    expect(manifestPut?.body).toContain('base64')
  })
})
