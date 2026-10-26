/**
 * 独立的 MCP 入口（不依赖 Electron）。
 *
 * Windows 上 Electron 主进程的 stdin/stdout 管道不可用（数据事件不触发），
 * 因此 stdio MCP 服务器需要用 `ELECTRON_RUN_AS_NODE=1` 以纯 Node 模式启动本文件：
 *
 *   ELECTRON_RUN_AS_NODE=1 <electron.exe|安装后的exe> <mcp-entry.cjs>
 *
 * 该入口会在构建时打包成完全自包含的 out/mcp-entry.cjs。
 */
import { join } from 'node:path'
import { runMcpStdio } from './stdio'

function resolveDataFile(): string {
  if (process.env.TOMATO_USER_DATA) {
    return join(process.env.TOMATO_USER_DATA, 'tomato-todo-data.json')
  }
  // 与主进程 userData 保持一致：appData/tomato-todo/tomato-todo-data.json
  const appData = process.env.APPDATA ?? process.env.HOME ?? process.cwd()
  return join(appData, 'tomato-todo', 'tomato-todo-data.json')
}

const dataFile = resolveDataFile()

runMcpStdio(dataFile, () => process.exit(0)).catch((error: unknown) => {
  process.stderr.write(
    `[tomato-todo-mcp] 启动失败: ${error instanceof Error ? error.stack : String(error)}\n`
  )
  process.exit(1)
})
