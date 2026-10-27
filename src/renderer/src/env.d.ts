/** 构建时注入的应用版本号（来自 package.json） */
declare const __APP_VERSION__: string

import type { TomatoAPI } from '../../shared/api'

declare global {
  interface Window {
    api: TomatoAPI
  }

  /** 构建时注入的应用版本号（来自 package.json） */
  // eslint-disable-next-line no-var
  var __APP_VERSION__: string
}

export {}
