import type { TomatoAPI } from '../../shared/api'

declare global {
  interface Window {
    api: TomatoAPI
  }
}

export {}
