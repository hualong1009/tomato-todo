// 移动端 Web 版冒烟测试：手机视口打开 dist-mobile，验证移动布局、持久化与设置裁剪。
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve('dist-mobile')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  let filePath = join(root, decodeURIComponent(url.pathname))
  if (extname(filePath) === '') filePath = join(filePath, 'index.html')
  try {
    const body = await readFile(filePath)
    response.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('not found')
  }
})

await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port

const check = (name, condition) => {
  if (!condition) throw new Error('FAIL: ' + name)
  console.log('ok -', name)
}

// 复用系统安装的 Chrome，避免 playwright-core 需要额外下载浏览器
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  })
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForSelector('.composer')

  // 桌面专属元素不应出现
  check('没有 Electron 标题栏', (await page.locator('.titlebar').count()) === 0)

  // 抽屉侧栏
  const shell = page.locator('.sidebar-shell')
  const before = await shell.boundingBox()
  check('侧栏默认收起', Boolean(before && before.x < -50))
  await page.click('[data-testid="mobile-menu"]')
  await page.waitForSelector('.sidebar-shell.open')
  await page.waitForFunction(() => {
    const element = document.querySelector('.sidebar-shell')
    return element ? element.getBoundingClientRect().x > -2 : false
  })
  const after = await shell.boundingBox()
  check('点击菜单后侧栏滑出', Boolean(after && Math.abs(after.x) < 2))
  await page.click('.nav-backdrop', { position: { x: 350, y: 400 } })

  // 添加待办
  await page.fill('[data-testid="composer-title"]', '移动端任务')
  await page.click('[data-testid="composer-submit"]')
  await page.waitForSelector('[data-testid="todo-item"]')
  check(
    '新增待办成功',
    (await page.locator('[data-testid="todo-item"] .todo-title').first().innerText()).includes('移动端任务')
  )

  // 本地持久化（刷新后仍在）—— 存储写入有 250ms 防抖
  await page.waitForFunction(() => Boolean(window.localStorage.getItem('CapacitorStorage.tomato-todo-data')))
  const stored = await page.evaluate(() => localStorage.getItem('CapacitorStorage.tomato-todo-data'))
  check('数据写入本地存储', Boolean(stored && stored.includes('移动端任务')))
  await page.reload()
  await page.waitForSelector('[data-testid="todo-item"]')
  check('刷新后待办仍存在', (await page.locator('[data-testid="todo-item"]').count()) === 1)

  // 详情面板占满整屏
  await page.click('[data-testid="todo-item"]')
  await page.waitForSelector('[data-testid="detail-panel"]')
  const detail = await page.locator('[data-testid="detail-panel"]').boundingBox()
  check('详情面板全屏显示', Boolean(detail && detail.width >= 380 && detail.height >= 700))
  await page.click('[data-testid="detail-close"]')

  // 设置里隐藏桌面专属标签
  await page.click('[data-testid="header-settings"]')
  await page.waitForSelector('[data-testid="settings-modal"]')
  check('隐藏安全标签', (await page.locator('[data-testid="settings-tab-security"]').count()) === 0)
  check('隐藏 MCP 标签', (await page.locator('[data-testid="settings-tab-mcp"]').count()) === 0)
  await page.click('[data-testid="settings-tab-general"]')
  await page.waitForSelector('[data-testid="setting-theme-dark"]')
  check('隐藏全局快捷键设置', (await page.locator('[data-testid="setting-hotkey-record"]').count()) === 0)
  check('隐藏托盘设置', (await page.locator('[data-testid="setting-close-to-tray"]').count()) === 0)
  await page.click('[data-testid="modal-close"]')

  console.log('Mobile web smoke passed')
} finally {
  await browser.close()
  server.close()
}
