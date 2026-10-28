import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 手机端返回键（浮层栈 + Capacitor App 插件桥接）测试。
 *
 * `window` 在 node 环境下不存在，先打桩再动态导入模块；
 * `@capacitor/app` 用可控 mock 替代原生返回键事件。
 */
const h = vi.hoisted(() => ({
  native: { value: true },
  addListener: vi.fn(async (_event: string, _handler: () => void) => ({ remove: vi.fn() })),
  exitApp: vi.fn(async () => undefined)
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, handler: () => void) => h.addListener(event, handler),
    exitApp: () => h.exitApp()
  }
}))

vi.stubGlobal('window', {
  Capacitor: { isNativePlatform: () => h.native.value }
})

const back = await import('../src/renderer/src/platform/backNavigation')

beforeEach(() => {
  back.resetOverlays()
  h.native.value = true
  h.addListener.mockClear()
  h.exitApp.mockClear()
})

describe('浮层返回栈', () => {
  it('按打开顺序倒序关闭浮层', () => {
    const closed: string[] = []
    back.pushOverlay(() => closed.push('视图面板'))
    back.pushOverlay(() => closed.push('待办详情'))

    expect(back.overlayCount()).toBe(2)
    expect(back.dismissTopOverlay()).toBe(true)
    expect(closed).toEqual(['待办详情'])
    expect(back.dismissTopOverlay()).toBe(true)
    expect(closed).toEqual(['待办详情', '视图面板'])
  })

  it('没有浮层时返回 false，让调用方继续处理（关闭搜索 / 分组视图 / 退出）', () => {
    expect(back.dismissTopOverlay()).toBe(false)
    expect(back.overlayCount()).toBe(0)
  })

  it('浮层关闭后自动出栈，不会残留', () => {
    const closeSheet = back.pushOverlay(() => undefined)
    const closeDetail = back.pushOverlay(() => undefined)
    expect(back.overlayCount()).toBe(2)

    closeSheet()
    expect(back.overlayCount()).toBe(1)
    closeDetail()
    expect(back.overlayCount()).toBe(0)
    // 重复注销是安全的
    closeSheet()
    expect(back.overlayCount()).toBe(0)
  })
})

describe('Capacitor 返回键桥接', () => {
  it('原生环境下注册 backButton 监听，返回键触发回调', async () => {
    const onBack = vi.fn()
    const dispose = await back.installBackButton(onBack)

    expect(h.addListener).toHaveBeenCalledTimes(1)
    expect(h.addListener.mock.calls[0][0]).toBe('backButton')

    h.addListener.mock.calls[0][1]()
    expect(onBack).toHaveBeenCalledTimes(1)

    dispose?.()
  })

  it('非原生环境（桌面 / 浏览器预览）不注册监听', async () => {
    h.native.value = false
    const dispose = await back.installBackButton(() => undefined)
    expect(dispose).toBeNull()
    expect(h.addListener).not.toHaveBeenCalled()
  })

  it('根视图再次返回时退出应用', async () => {
    await back.exitMobileApp()
    expect(h.exitApp).toHaveBeenCalledTimes(1)
  })

  it('非原生环境不调用 exitApp', async () => {
    h.native.value = false
    await back.exitMobileApp()
    expect(h.exitApp).not.toHaveBeenCalled()
  })
})
