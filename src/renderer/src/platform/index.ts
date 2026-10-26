import type { TomatoAPI } from '../../../shared/api'
import { hasNativeApi } from './state'

export { hasNativeApi, isMobile, isCapacitorNative } from './state'

/**
 * 保证 `window.api` 可用：
 * - Electron 里 preload 已注入，直接复用；
 * - Capacitor / 浏览器里动态加载 Web 适配层并挂到 window.api 上。
 *
 * 使用动态 import，避免桌面端打包时把 Capacitor 插件代码一起塞进主包。
 */
export async function ensureApi(): Promise<TomatoAPI> {
  const existing = (window as Window & { api?: TomatoAPI }).api
  if (hasNativeApi && existing) return existing

  const { createCapacitorApi } = await import('./capacitorApi')
  const api = createCapacitorApi()
  ;(window as Window & { api?: TomatoAPI }).api = api
  return api
}
