import type { AISettings } from './types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AICallOptions {
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export function resolveAIEndpoint(baseUrl: string, provider: AISettings['provider']): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('请填写 AI 接口地址')
  if (provider === 'openai') {
    if (/\/chat\/completions$/i.test(base)) return base
    return `${base}/chat/completions`
  }
  if (/\/messages$/i.test(base)) return base
  return `${base}/messages`
}

export function resolveModelsEndpoint(baseUrl: string): string {
  const base = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/messages$/i, '')
  if (!base) throw new Error('请填写 AI 接口地址')
  return `${base}/models`
}

function authHeaders(settings: AISettings): Record<string, string> {
  if (!settings.apiKey.trim()) throw new Error('请填写 API 密钥')
  if (settings.provider === 'anthropic') {
    return {
      'x-api-key': settings.apiKey.trim(),
      'anthropic-version': '2023-06-01'
    }
  }
  return { Authorization: `Bearer ${settings.apiKey.trim()}` }
}

function extractErrorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string
      message?: string
    }
    if (typeof parsed.error === 'string') return parsed.error
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message
    if (typeof parsed.message === 'string') return parsed.message
  } catch {
    // ignore
  }
  return body.replace(/\s+/g, ' ').slice(0, 500)
}

export async function callAIChat(
  settings: AISettings,
  messages: ChatMessage[],
  options: AICallOptions = {}
): Promise<string> {
  if (!settings.model.trim()) throw new Error('请填写模型名称')
  const endpoint = resolveAIEndpoint(settings.baseUrl, settings.provider)
  const fetchImpl = options.fetchImpl ?? fetch
  const maxTokens = options.maxTokens ?? 1600
  const temperature = options.temperature ?? 0.4
  const timeoutMs = options.timeoutMs ?? 90000

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(settings)
  }

  let body: Record<string, unknown>
  if (settings.provider === 'anthropic') {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    body = {
      model: settings.model.trim(),
      max_tokens: maxTokens,
      temperature,
      system: system || undefined,
      messages: messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content }))
    }
  } else {
    body = {
      model: settings.model.trim(),
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false
    }
  }

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('AI 请求超时，请检查网络或接口地址')
    }
    throw new Error(`无法连接 AI 接口：${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  if (!response.ok) {
    const detail = extractErrorText(text)
    if (response.status === 404) {
      throw new Error(
        `AI 接口路径不存在（HTTP 404）：${detail}。请确认 Base URL 通常以 /v1 结尾，并在「OpenAI 兼容 / Anthropic 兼容」之间选择正确的协议。`
      )
    }
    if (
      response.status === 503 ||
      /model_not_found|No available channel|模型不存在|model not found/i.test(detail)
    ) {
      throw new Error(
        `模型不可用（HTTP ${response.status}）：${detail}。请点击「获取模型」从接口返回的列表中选择可用模型。`
      )
    }
    throw new Error(`AI 请求失败（HTTP ${response.status}）：${detail}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('AI 接口返回的不是有效 JSON')
  }

  if (settings.provider === 'anthropic') {
    const content = (payload as { content?: { type?: string; text?: string }[] }).content
    const result = Array.isArray(content)
      ? content
          .filter((item) => item.type === 'text' && typeof item.text === 'string')
          .map((item) => item.text)
          .join('')
      : ''
    if (!result.trim()) throw new Error('AI 接口没有返回文本内容')
    return result.trim()
  }

  // OpenAI 兼容网关的 reasoning 模型通常把思考过程放在 reasoning_content，
  // 最终回答仍在 content。思考过程不应作为回顾结果展示，但可据此给出准确报错。
  const choices = (payload as {
    choices?: {
      finish_reason?: unknown
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
    }[]
  }).choices
  const choice = choices?.[0]
  const rawContent = choice?.message?.content
  let result = ''
  if (typeof rawContent === 'string') {
    result = rawContent
  } else if (Array.isArray(rawContent)) {
    result = rawContent
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof (part as { text?: string }).text === 'string') {
          return (part as { text: string }).text
        }
        return ''
      })
      .join('')
  }
  if (!result.trim()) {
    const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning
    const hasReasoning = typeof reasoning === 'string' && reasoning.trim().length > 0
    const wasTruncated = choice?.finish_reason === 'length'
    if (hasReasoning || wasTruncated) {
      throw new Error(
        `AI 模型${hasReasoning ? '只返回了思考过程，' : ''}尚未生成最终文本${
          wasTruncated ? '（输出长度已用尽）' : ''
        }。请提高输出长度，或在模型 / 网关中关闭思考模式后重试。`
      )
    }
    throw new Error('AI 接口没有返回文本内容')
  }
  return result.trim()
}

export async function listAIModels(
  settings: AISettings,
  fetchImpl?: typeof fetch
): Promise<string[]> {
  const endpoint = resolveModelsEndpoint(settings.baseUrl)
  const implementation = fetchImpl ?? fetch
  let response: Response
  try {
    response = await implementation(endpoint, {
      method: 'GET',
      headers: authHeaders(settings),
      signal: AbortSignal.timeout(20000)
    })
  } catch (error) {
    throw new Error(
      `无法获取模型列表：${error instanceof Error ? error.message : String(error)}`
    )
  }
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`获取模型失败（HTTP ${response.status}）：${extractErrorText(text)}`)
  }
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('模型列表返回的不是有效 JSON')
  }
  const data = (payload as { data?: { id?: unknown }[] }).data
  const models = Array.isArray(data)
    ? data
        .map((item) => (item && typeof item.id === 'string' ? item.id : ''))
        .filter((id) => Boolean(id))
    : []
  if (models.length === 0) throw new Error('接口没有返回可用模型')
  return [...new Set(models)]
}

export async function testAIConnection(settings: AISettings, fetchImpl?: typeof fetch): Promise<string> {
  return callAIChat(
    settings,
    [
      {
        role: 'user',
        content: '这是一次连接测试。请只回复四个字：连接成功'
      }
    ],
    // reasoning 模型会先消耗 token 生成 reasoning_content；32 token 经常不够走到最终回答。
    { maxTokens: 512, temperature: 0, timeoutMs: 60000, fetchImpl }
  )
}
