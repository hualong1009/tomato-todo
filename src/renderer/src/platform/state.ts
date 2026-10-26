/**
 * 运行环境判定。
 *
 * Electron 里 preload 会在页面加载前把 `window.api` 注入；
 * Capacitor（安卓/iOS）或普通浏览器里没有 preload，需要安装 Web 版适配层。
 * 这些常量必须在安装适配层之前完成求值，因此放在独立模块顶层。
 */
const runtimeWindow = window as Window & { api?: unknown }

export const hasNativeApi = typeof window !== 'undefined' && Boolean(runtimeWindow.api)

/** 是否运行在 Capacitor 原生壳或移动端浏览器里（无 Electron preload）。 */
export const isMobile = !hasNativeApi

/** 是否运行在 Capacitor 原生容器中（手机 App），而不是普通浏览器预览。 */
export function isCapacitorNative(): boolean {
  const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor
  return Boolean(capacitor?.isNativePlatform?.())
}
