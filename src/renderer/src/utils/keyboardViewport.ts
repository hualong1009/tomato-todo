/**
 * 底部弹层在键盘打开时要限制在真实可见区域内。
 *
 * Android adjustResize 可能缩小 layout viewport，也可能只缩小 visualViewport；
 * edge-to-edge WebView 在部分设备上两者都不变，只收到原生 IME inset。
 * 先扣除 viewport 已缩小的高度，再把剩余键盘高度用于固定弹层定位，
 * 避免双重避让造成表单被顶出屏幕。
 */
export function keyboardViewportBounds(
  layoutHeight: number,
  baselineHeight: number,
  visual: { offsetTop: number; height: number } | null,
  keyboardInset: number
): { top: number; bottom: number } {
  const top = Math.max(0, visual?.offsetTop ?? 0)
  const visualBottom = Math.max(0, layoutHeight - top - (visual?.height ?? layoutHeight))
  const layoutShrink = Math.max(0, baselineHeight - layoutHeight)
  const remainingKeyboard = Math.max(0, keyboardInset - layoutShrink)
  return { top, bottom: Math.max(visualBottom, remainingKeyboard) }
}
