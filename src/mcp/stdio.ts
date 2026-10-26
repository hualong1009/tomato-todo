import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createTodoMcpServer } from './server'

export async function runMcpStdio(dataFile: string, onClose?: () => void): Promise<void> {
  const server = createTodoMcpServer(dataFile)
  const transport = new StdioServerTransport()
  transport.onclose = () => {
    onClose?.()
  }
  transport.onerror = (error) => {
    process.stderr.write(`[tomato-todo-mcp] ${error.message}\n`)
  }
  await server.connect(transport)
  process.stderr.write(`[tomato-todo-mcp] ready, data: ${dataFile}\n`)
}
