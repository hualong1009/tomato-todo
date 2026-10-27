import { describe, expect, it } from 'vitest'
import { keyboardViewportBounds } from '../src/renderer/src/utils/keyboardViewport'

describe('手机底部面板的键盘可见区域', () => {
  it('键盘未打开时贴近屏幕底部', () => {
    expect(keyboardViewportBounds(800, 800, { offsetTop: 0, height: 800 }, 0)).toEqual({
      top: 0,
      bottom: 0
    })
  })

  it('adjustResize 已缩小 WebView 时不再次抬高面板', () => {
    expect(keyboardViewportBounds(480, 800, { offsetTop: 0, height: 480 }, 320)).toEqual({
      top: 0,
      bottom: 0
    })
  })

  it('只有 visualViewport 缩小时避开键盘', () => {
    expect(keyboardViewportBounds(800, 800, { offsetTop: 0, height: 480 }, 0)).toEqual({
      top: 0,
      bottom: 320
    })
  })

  it('只有原生 IME inset 时避开键盘', () => {
    expect(keyboardViewportBounds(800, 800, { offsetTop: 0, height: 800 }, 320)).toEqual({
      top: 0,
      bottom: 320
    })
  })

  it('部分缩小后仅避让键盘剩余的空间，并考虑 visualViewport 偏移', () => {
    expect(keyboardViewportBounds(650, 800, { offsetTop: 20, height: 500 }, 320)).toEqual({
      top: 20,
      bottom: 170
    })
  })

  it('键盘关闭时恢复原布局', () => {
    expect(keyboardViewportBounds(800, 800, { offsetTop: 0, height: 800 }, 0).bottom).toBe(0)
  })
})
