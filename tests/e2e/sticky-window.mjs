import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

// 回归测试 #7：固定便签的小窗必须渲染 StickyNote 而不是整个应用。
// loadFile 的 hash 选项不带开头斜杠会导致路由匹配失败，把完整应用渲染进便签窗。
const userData = mkdtempSync(join(tmpdir(), 'tomato-sticky-'))
const errors = []
let app

try {
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TOMATO_USER_DATA: userData }
  })

  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.waitForSelector('.composer', { timeout: 30000 })

  // 新建一个待办并固定为便签
  await page.fill('[data-testid="composer-title"]', '便签回归任务')
  await page.click('[data-testid="composer-submit"]')
  await page.waitForTimeout(300)
  const todoId = await page.evaluate(async () => {
    const state = await window.api.getState()
    return state ? state.todos[0].id : null
  })
  assert.ok(todoId, '应能拿到新建待办的 id')
  await page.evaluate((id) => window.api.setPinned(id, true), todoId)

  // 等待便签小窗出现
  const stickyPage = await app
    .waitForEvent('window', { timeout: 10000 })
    .catch(() => null)
  assert.ok(stickyPage, '固定待办后应弹出便签小窗')
  await stickyPage.waitForSelector('[data-testid="sticky-note"]', { timeout: 10000 })

  // 小窗里是便签，不是整个应用（#7 回归点）
  assert.equal(await stickyPage.locator('.composer').count(), 0, '便签小窗不应渲染主界面输入框')
  assert.equal(await stickyPage.locator('.sidebar-shell').count(), 0, '便签小窗不应渲染侧栏')
  assert.match(await stickyPage.locator('[data-testid="sticky-note"]').innerText(), /便签回归任务/)

  // 便签小窗的路由正确（#/sticky/ 或 #sticky/，两种都接受）
  assert.match(await stickyPage.evaluate(() => window.location.hash), /^#\/?sticky\//)

  // 点击便签「跳转主界面」：应显示主窗口并选中该待办，而不是新开整个应用
  const windowCountBefore = app.windows().length
  await stickyPage.click('[data-testid="sticky-open-main"]')
  await page.waitForTimeout(500)
  assert.equal(app.windows().length, windowCountBefore, '跳转主界面不应新开窗口')

  console.log('Sticky window E2E passed: 小窗渲染便签而非整个应用')
} finally {
  await app?.close().catch(() => undefined)
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* Windows 上偶发文件占用，忽略 */
  }
  if (errors.length > 0) {
    console.error('页面错误：', errors)
    process.exit(1)
  }
}
