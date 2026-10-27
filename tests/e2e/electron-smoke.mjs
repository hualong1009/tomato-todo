import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const userData = mkdtempSync(join(tmpdir(), 'tomato-e2e-'))
const errors = []
let app

try {
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TOMATO_USER_DATA: userData }
  })

  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.waitForSelector('.composer', { timeout: 30000 })
  assert.equal(await page.title(), '番茄待办')
  assert.match(await page.locator('h1').first().innerText(), /全部待办/)

  // 新建待办
  await page.fill('[data-testid="composer-title"]', 'E2E 冒烟任务')
  await page.fill('[data-testid="composer-content"]', '验证桌面端主要交互')
  await page.click('[data-testid="composer-urgency"]')
  await page.click('[data-testid="composer-urgency-option-urgent"]')
  await page.click('[data-testid="composer-submit"]')
  await page.waitForSelector('[data-testid="todo-item"]')
  assert.equal(
    (await page.locator('[data-testid="todo-item"] .todo-title').first().innerText()).trim(),
    'E2E 冒烟任务'
  )
  assert.equal(await page.locator('[data-testid="todo-pin"]').count(), 1, '桌面端仍可固定便签')

  // 勾选完成并验证实际完成状态
  await page.click('[data-testid="todo-check"]')
  await page.waitForTimeout(250)
  assert.equal(
    await page.locator('[data-testid="todo-item"]').first().getAttribute('data-completed'),
    'true'
  )

  // 打开详情面板，切换状态和分组
  await page.click('[data-testid="todo-item"]')
  await page.waitForSelector('[data-testid="detail-panel"]')
  assert.equal(await page.locator('[data-testid="detail-pin"]').count(), 1, '桌面详情仍可固定便签')
  assert.equal(await page.locator('.detail-note-style').count(), 1, '桌面详情仍有便签样式')
  assert.equal(
    await page.locator('[data-testid="detail-title-view"]').innerText(),
    'E2E 冒烟任务'
  )
  // 详情默认是只读预览：编辑框不存在，点铅笔图标后才出现
  assert.equal(await page.locator('[data-testid="detail-content"]').count(), 0)
  await page.click('[data-testid="detail-edit"]')
  await page.waitForSelector('[data-testid="detail-content"]')
  await page.fill('[data-testid="detail-content"]', '预览改编辑的正文')
  await page.click('[data-testid="detail-save"]')
  await page.waitForSelector('[data-testid="detail-content-view"]')
  await page.waitForTimeout(250)
  assert.match(
    await page.locator('[data-testid="detail-content-view"]').innerText(),
    /预览改编辑的正文/
  )
  await page.click('[data-testid="detail-check"]')
  await page.waitForTimeout(250)
  assert.equal(await page.locator('[data-testid="detail-check"]').getAttribute('aria-checked'), 'false')

  // 番茄专注弹层
  await page.click('[data-testid="detail-pomodoro"]')
  await page.waitForSelector('[data-testid="pomodoro-overlay"]')
  assert.match(await page.locator('[data-testid="pomodoro-time"]').innerText(), /^\d{2}:\d{2}$/)
  await page.click('[data-testid="pomodoro-close"]')

  // 右键菜单
  await page.locator('[data-testid="todo-item"]').first().click({ button: 'right' })
  await page.waitForSelector('[data-testid="context-menu"]')
  await page.keyboard.press('Escape')

  // 归档与归档视图
  await page.click('[data-testid="detail-archive"]')
  await page.waitForTimeout(250)
  await page.click('[data-testid="archived-toggle"]')
  await page.waitForSelector('.archived-items [data-testid="todo-item"]')

  // 设置中的 WebDAV 与 MCP 页签
  await page.click('[data-testid="header-settings"]')
  await page.waitForSelector('[data-testid="settings-modal"]')
  await page.click('[data-testid="settings-tab-webdav"]')
  assert.equal(await page.locator('[data-testid="setting-webdav-url"]').isVisible(), true)
  await page.click('[data-testid="settings-tab-mcp"]')
  await page.waitForTimeout(300)
  assert.equal(await page.locator('[data-testid="setting-mcp-config"]').isVisible(), true)
  await page.click('[data-testid="modal-close"]')

  // AI 回顾面板（未配置接口时给出配置引导）
  await page.click('[data-testid="header-ai"]')
  await page.waitForSelector('[data-testid="ai-panel"]')
  assert.equal(await page.locator('.ai-config-warning').isVisible(), true)
  await page.click('[data-testid="ai-close"]')

  // 主题切换
  const before = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.click('[data-testid="theme-toggle"]')
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => document.documentElement.dataset.theme)
  assert.notEqual(before, after)

  // 全局搜索
  await page.fill('[data-testid="search-input"]', '不存在的关键词')
  await page.waitForTimeout(200)
  assert.match(await page.locator('.summary-hint').innerText(), /搜索/)
  await page.fill('[data-testid="search-input"]', '')

  assert.deepEqual(errors, [], `渲染进程存在错误: ${errors.join('\n')}`)
  console.log('Electron E2E smoke passed: create / complete / detail / pomodoro / context menu / archive / settings / AI / theme / search')
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
  rmSync(userData, { recursive: true, force: true })
}
