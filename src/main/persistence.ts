import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppState } from '../shared/types'
import { createDefaultState, normaliseState } from '../shared/normalise'

export { createDefaultState, normaliseState } from '../shared/normalise'

export interface LoadedState {
  state: AppState
  exists: boolean
  mtimeMs: number
}

export function loadStateFile(file: string): LoadedState {
  if (!existsSync(file)) {
    return { state: createDefaultState(), exists: false, mtimeMs: 0 }
  }
  try {
    const content = readFileSync(file, 'utf8')
    const state = normaliseState(JSON.parse(content))
    return { state, exists: true, mtimeMs: statSync(file).mtimeMs }
  } catch (error) {
    try {
      copyFileSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      // 保留原始文件，失败时不影响应用启动
    }
    process.stderr.write(`[tomato-todo] 数据文件读取失败，已使用默认数据: ${String(error)}\n`)
    return { state: createDefaultState(), exists: true, mtimeMs: statSync(file).mtimeMs }
  }
}

export function saveStateFile(file: string, state: AppState): number {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(temp, file)
  return statSync(file).mtimeMs
}
