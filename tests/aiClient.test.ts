import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  callAIChat,
  listAIModels,
  resolveAIEndpoint,
  resolveModelsEndpoint,
  testAIConnection
} from '../src/shared/aiClient'
import type { AISettings } from '../src/shared/types'

function settings(overrides: Partial<AISettings> = {}): AISettings {
  return {
    provider: 'openai',
    baseUrl: 'https://llm.example.com/v1',
    apiKey: 'sk-test',
    model: 'Qwen3-32B',
    ...overrides
  }
}

function mockFetch(response: Response | (() => Response)) {
  const calls: { url: string; init?: RequestInit; headers: Record<string, string> }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push({
        url,
        init,
        headers: Object.fromEntries(new Headers(init?.headers).entries())
      })
      return typeof response === 'function' ? response() : response
    })
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AI 接口地址解析', () => {
  it('OpenAI 兼容默认追加 /chat/completions，并容忍完整地址', () => {
    expect(resolveAIEndpoint('https://llm.example.com/v1', 'openai')).toBe(
      'https://llm.example.com/v1/chat/completions'
    )
    expect(resolveAIEndpoint('https://llm.example.com/v1/', 'openai')).toBe(
      'https://llm.example.com/v1/chat/completions'
    )
    expect(resolveAIEndpoint('https://llm.example.com/v1/chat/completions', 'openai')).toBe(
      'https://llm.example.com/v1/chat/completions'
    )
  })

  it('Anthropic 兼容默认追加 /messages', () => {
    expect(resolveAIEndpoint('https://llm.example.com/v1', 'anthropic')).toBe(
      'https://llm.example.com/v1/messages'
    )
    expect(resolveAIEndpoint('https://llm.example.com/v1/messages', 'anthropic')).toBe(
      'https://llm.example.com/v1/messages'
    )
  })

  it('模型列表地址会去掉具体请求路径', () => {
    expect(resolveModelsEndpoint('https://llm.example.com/v1')).toBe(
      'https://llm.example.com/v1/models'
    )
    expect(resolveModelsEndpoint('https://llm.example.com/v1/chat/completions')).toBe(
      'https://llm.example.com/v1/models'
    )
    expect(resolveModelsEndpoint('https://llm.example.com/v1/messages/')).toBe(
      'https://llm.example.com/v1/models'
    )
  })
})

describe('获取模型列表', () => {
  it('解析 OpenAI / 网关返回的 data[].id 并去重', async () => {
    const calls = mockFetch(
      new Response(
        JSON.stringify({
          data: [{ id: 'Qwen3-32B' }, { id: 'Qwen3-8B' }, { id: 'Qwen3-32B' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const models = await listAIModels(settings())
    expect(models).toEqual(['Qwen3-32B', 'Qwen3-8B'])
    expect(calls[0].url).toBe('https://llm.example.com/v1/models')
    expect(calls[0].headers.authorization).toBe('Bearer sk-test')
  })

  it('Anthropic 模式使用 x-api-key 请求模型列表', async () => {
    const calls = mockFetch(
      new Response(JSON.stringify({ data: [{ id: 'Qwen3-32B' }] }), { status: 200 })
    )
    await listAIModels(settings({ provider: 'anthropic' }))
    expect(calls[0].headers['x-api-key']).toBe('sk-test')
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01')
  })

  it('没有模型或请求失败时给出可读错误', async () => {
    mockFetch(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await expect(listAIModels(settings())).rejects.toThrow('没有返回可用模型')

    mockFetch(new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 }))
    await expect(listAIModels(settings())).rejects.toThrow('获取模型失败')
  })
})

describe('AI 对话调用', () => {
  it('解析 OpenAI 响应文本', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '连接成功' } }]
        }),
        { status: 200 }
      )
    )
    await expect(testAIConnection(settings())).resolves.toBe('连接成功')
  })

  it('reasoning 模型有最终 content 时只返回最终回答，并给连接测试足够输出空间', async () => {
    const calls = mockFetch(
      new Response(
        JSON.stringify({
          choices: [{
            finish_reason: 'stop',
            message: { reasoning_content: '先判断这是连接测试。', content: '连接成功' }
          }]
        }),
        { status: 200 }
      )
    )
    await expect(testAIConnection(settings())).resolves.toBe('连接成功')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(expect.objectContaining({
      max_tokens: 512,
      temperature: 0
    }))
  })

  it('reasoning 模型在最终回答前耗尽输出时给出可操作提示', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          choices: [{
            finish_reason: 'length',
            message: { reasoning_content: '这里是尚未完成的思考。', content: null }
          }]
        }),
        { status: 200 }
      )
    )
    await expect(callAIChat(settings(), [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /只返回了思考过程.*输出长度已用尽/
    )
  })

  it('解析 Anthropic 响应文本', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: '连接' },
            { type: 'text', text: '成功' }
          ]
        }),
        { status: 200 }
      )
    )
    await expect(testAIConnection(settings({ provider: 'anthropic' }))).resolves.toBe('连接成功')
  })

  it('404 时提示检查 Base URL 与协议类型', async () => {
    mockFetch(new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 }))
    await expect(
      callAIChat(settings(), [{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('接口路径不存在')
  })

  it('模型不存在时提示获取模型列表', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          error: {
            code: 'model_not_found',
            message: 'No available channel for model gpt-4o-mini'
          }
        }),
        { status: 503 }
      )
    )
    await expect(
      callAIChat(settings({ model: 'gpt-4o-mini' }), [{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('获取模型')
  })
})
