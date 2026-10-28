/**
 * 移动端返回键（Android 返回手势 / 返回键）支持。
 *
 * Capacitor 8 的 BridgeActivity 不再接管返回键：没有注册 `backButton` 监听时，
 * 按返回会直接把 Activity 关掉（应用退出）。这里维护一个「最后打开的浮层在最上层」
 * 的栈，返回键先关闭最上层浮层，一直退到根视图后才退出应用——与 Android 常见体验一致。
 *
 * 浮层组件（Modal / BottomSheet / 抽屉 / 右键菜单等）用 `useBackDismiss` 接入；
 * 应用根组件用 `installBackButton` 安装监听，并处理「搜索 → 分组视图 → 退出」这些根级步骤。
 */
import { useEffect, useRef } from 'react'
import { isCapacitorNative } from './state'

type DismissHandler = () => void

interface OverlayEntry {
  id: number
  dismiss: DismissHandler
}

/** 已打开的浮层，越靠后越在上层（后打开的先关闭）。 */
const overlays: OverlayEntry[] = []
let overlaySeq = 0

/** 注册一个可被返回键关闭的浮层，返回取消注册函数。 */
export function pushOverlay(dismiss: DismissHandler): () => void {
  const id = ++overlaySeq
  overlays.push({ id, dismiss })
  return () => {
    const index = overlays.findIndex((entry) => entry.id === id)
    if (index >= 0) overlays.splice(index, 1)
  }
}

/** 关闭最后打开的浮层；没有任何浮层时返回 false。 */
export function dismissTopOverlay(): boolean {
  // 先出栈再关闭：即使关闭回调里又打开了新浮层（比如设置 → 新建分组），
  // 下次返回也不会重复关已经关掉的旧浮层。
  const top = overlays.pop()
  if (!top) return false
  top.dismiss()
  return true
}

/** 当前打开的浮层数量。 */
export function overlayCount(): number {
  return overlays.length
}

/** 清空浮层栈（测试用）。 */
export function resetOverlays(): void {
  overlays.length = 0
  overlaySeq = 0
}

/**
 * 浮层组件用它接入返回键：`active` 为真时，返回键调用 `dismiss`。
 * 注意不要用在「密码锁定」这类不允许返回关闭的界面上（见 App 里的锁定判断）。
 */
export function useBackDismiss(active: boolean, dismiss: DismissHandler): void {
  const latest = useRef(dismiss)
  latest.current = dismiss
  useEffect(() => {
    if (!active) return
    return pushOverlay(() => latest.current())
  }, [active])
}

/**
 * 安装 Android 返回键监听。只有 Capacitor 原生容器里才生效，
 * 桌面端 / 浏览器预览下返回 null（不改变原有行为）。
 */
export async function installBackButton(handler: () => void): Promise<(() => void) | null> {
  if (!isCapacitorNative()) return null
  try {
    const { App } = await import('@capacitor/app')
    const listener = await App.addListener('backButton', () => handler())
    return () => {
      void listener.remove()
    }
  } catch {
    // 插件没同步进原生工程时不影响启动，返回空实现
    return null
  }
}

/** 没有可返回的界面时退出应用（等价于系统默认返回行为）。 */
export async function exitMobileApp(): Promise<void> {
  if (!isCapacitorNative()) return
  try {
    const { App } = await import('@capacitor/app')
    await App.exitApp()
  } catch {
    // 插件不可用时忽略：返回键已经消费掉，不做额外处理
  }
}
