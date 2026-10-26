import { createDefaultState } from '../src/main/persistence'
import type { AppState } from '../src/shared/types'

export function makeState(): AppState {
  return createDefaultState()
}
