// 开发模式下启动 stdio MCP 服务器（ELECTRON_RUN_AS_NODE 纯 Node 模式）。
// 已安装的应用请直接使用设置页「MCP 接入」中给出的配置。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const entry = resolve(root, 'out', 'mcp-entry.cjs')
const electron = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe')

if (!existsSync(entry)) {
  console.error('未找到 out/mcp-entry.cjs，请先执行 npm run build')
  process.exit(1)
}

const child = spawn(electron, [entry], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
})
child.on('exit', (code) => process.exit(code ?? 0))
