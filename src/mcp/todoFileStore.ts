import type { AppState } from '../shared/types'
import { loadStateFile, saveStateFile } from '../main/persistence'

/**
 * MCP 进程与桌面应用共享同一个 JSON 数据文件。
 * 每次工具调用都重新读取磁盘，避免两个进程之间读到过期数据。
 */
export class TodoFileStore {
  constructor(readonly file: string) {}

  read(): AppState {
    return loadStateFile(this.file).state
  }

  write(state: AppState): void {
    saveStateFile(this.file, state)
  }

  mutate<T>(fn: (state: AppState) => T): T {
    const state = this.read()
    const result = fn(state)
    this.write(state)
    return result
  }
}
