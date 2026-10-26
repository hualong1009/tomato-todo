// 打包入口验证：ELECTRON_RUN_AS_NODE 模式下通过真实 stdio 管道跑一遍 MCP 协议。
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const entry = join(root, 'out', 'mcp-entry.cjs')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(entry)) throw new Error('请先执行 npm run build 生成 out/mcp-entry.cjs')
if (!existsSync(electron)) throw new Error('未找到 electron.exe')

const userData = mkdtempSync(join(tmpdir(), 'tomato-mcp-e2e-'))
const child = spawn(electron, [entry], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TOMATO_USER_DATA: userData },
  stdio: ['pipe', 'pipe', 'pipe']
})
child.stderr.setEncoding('utf-8')
child.stderr.on('data', (d) => process.stderr.write(`[stderr] ${d}`))

let buffer = ''
const pending = new Map()
child.stdout.setEncoding('utf-8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const message = JSON.parse(line)
    const resolvePending = pending.get(message.id)
    if (resolvePending) {
      pending.delete(message.id)
      resolvePending(message)
    }
  }
})

const request = (id, method, params) =>
  new Promise((res, rej) => {
    pending.set(id, res)
    setTimeout(() => rej(new Error(`MCP 请求超时: ${method}`)), 20000)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')

try {
  const init = await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'tomato-e2e', version: '1.0.0' }
  })
  if (!init.result?.serverInfo?.name) throw new Error('initialize 未返回 serverInfo')
  console.log('stdio MCP server:', init.result.serverInfo.name)

  notify('notifications/initialized', {})
  const tools = await request(2, 'tools/list', {})
  const names = tools.result.tools.map((tool) => tool.name)
  for (const required of ['add_todo', 'search_todos', 'complete_todo']) {
    if (!names.includes(required)) throw new Error(`缺少工具: ${required}`)
  }
  console.log('tools/list OK:', names.join(', '))

  const added = await request(3, 'tools/call', {
    name: 'add_todo',
    arguments: { title: 'stdio 管道验证', content: 'ELECTRON_RUN_AS_NODE 模式' }
  })
  if (added.result.isError) throw new Error('add_todo 失败: ' + JSON.stringify(added.result))
  const search = await request(4, 'tools/call', { name: 'search_todos', arguments: { query: '管道' } })
  if (!JSON.stringify(search.result).includes('stdio 管道验证')) throw new Error('search 未找到新增待办')
  console.log('add/search OK')

  child.stdin.end()
  await new Promise((res) => child.on('exit', res))
  console.log('Electron MCP stdio smoke passed (ELECTRON_RUN_AS_NODE)')
} catch (error) {
  child.kill()
  throw error
}
