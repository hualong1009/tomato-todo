// 移动端 Web 版冒烟测试：手机视口打开 dist-mobile，验证移动专属布局、持久化与导出。
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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: `http://127.0.0.1:${port}`
  })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForSelector('.mobile-shell')

  // 移动端结构：没有桌面标题栏、没有侧栏，改为底部标签栏 + 悬浮按钮
  check('没有 Electron 标题栏', (await page.locator('.titlebar').count()) === 0)
  check('没有侧栏抽屉', (await page.locator('.sidebar-shell').count()) === 0)
  check('底部标签栏存在', (await page.locator('[data-testid="mobile-tabbar"]').count()) === 1)
  check('悬浮新建按钮存在', (await page.locator('[data-testid="mobile-fab"]').count()) === 1)

  // 视图 / 分组底部面板
  await page.click('[data-testid="mobile-tab-groups"]')
  await page.waitForSelector('[data-testid="bottom-sheet"]')
  check('分组面板打开', (await page.locator('[data-testid="mobile-view-overdue"]').count()) === 1)
  await page.click('[data-testid="mobile-view-overdue"]')
  await page.waitForSelector('[data-testid="bottom-sheet"]', { state: 'detached' })
  check('选择视图后面板关闭', (await page.locator('.mobile-title').innerText()) === '未完成')
  await page.click('[data-testid="mobile-tab-todos"]')
  check('回到全部视图', (await page.locator('.mobile-title').innerText()) === '全部待办')

  // 悬浮按钮 → 新建待办面板
  await page.click('[data-testid="mobile-fab"]')
  await page.waitForSelector('.sheet-composer [data-testid="composer-title"]')
  check('新建面板打开', true)
  await page.fill('.sheet-composer [data-testid="composer-title"]', '移动端任务')
  await page.click('.sheet-composer [data-testid="composer-submit"]')
  await page.waitForSelector('[data-testid="todo-item"]')
  check(
    '新增待办成功',
    (await page.locator('[data-testid="todo-item"] .todo-title').first().innerText()).includes('移动端任务')
  )

  // 本地持久化（刷新后仍在）
  await page.waitForFunction(() => Boolean(window.localStorage.getItem('CapacitorStorage.tomato-todo-data')))
  await page.reload()
  await page.waitForSelector('[data-testid="todo-item"]')
  check('刷新后待办仍存在', (await page.locator('[data-testid="todo-item"]').count()) === 1)

  // 详情面板全屏 + 富文本编辑器
  await page.click('[data-testid="todo-item"]')
  await page.waitForSelector('[data-testid="detail-panel"]')
  const detail = await page.locator('[data-testid="detail-panel"]').boundingBox()
  check('详情面板全屏显示', Boolean(detail && detail.width >= 380 && detail.height >= 700))
  check('详情默认是 Markdown 预览', (await page.locator('[data-testid="detail-content-view"]').count()) === 1)
  await page.click('[data-testid="detail-edit"]')
  await page.waitForSelector('[data-testid="rich-tool-bold"]')
  check('富文本工具栏存在', (await page.locator('[data-testid="rich-tool-bold"]').count()) === 1)
  await page.fill('[data-testid="detail-content"]', '普通文字')
  await page.locator('[data-testid="detail-content"]').evaluate((element) => {
    element.setSelectionRange(0, 4)
  })
  await page.click('[data-testid="rich-tool-bold"]')
  const contentValue = await page.locator('[data-testid="detail-content"]').inputValue()
  check('工具栏插入 Markdown 加粗', contentValue === '**普通文字**')
  await page.click('[data-testid="rich-mode-preview"]')
  await page.waitForSelector('[data-testid="rich-preview"] strong')
  check('预览渲染加粗', true)
  await page.click('[data-testid="rich-mode-edit"]')
  // 附件：编辑态可添加，保存后预览态可下载
  await page.setInputFiles('[data-testid="attachment-input"]', {
    name: '说明.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('附件内容', 'utf8')
  })
  await page.waitForSelector('[data-testid="attachment-item"]')
  check('编辑态可添加附件', (await page.locator('[data-testid="attachment-item"]').count()) === 1)
  await page.click('[data-testid="detail-save"]')
  await page.waitForSelector('[data-testid="detail-content-view"]')
  check('保存后回到预览', (await page.locator('[data-testid="detail-content"]').count()) === 0)
  check(
    '预览态保留附件且可下载',
    (await page.locator('[data-testid="attachment-download"]').count()) === 1
  )
  check('预览态没有删除按钮', (await page.locator('[data-testid="attachment-remove"]').count()) === 0)
  await page.click('[data-testid="detail-close"]')

  // 长按/更多菜单在手机端是底部操作面板
  await page.click('[data-testid="todo-more"]')
  await page.waitForSelector('.action-sheet')
  check('右键菜单渲染为操作面板', (await page.locator('[data-testid="context-cancel"]').count()) === 1)
  await page.click('[data-testid="context-cancel"]')

  // 设置：隐藏桌面专属标签，提供本地备份入口
  await page.click('[data-testid="mobile-tab-settings"]')
  await page.waitForSelector('[data-testid="settings-modal"]')
  check('隐藏安全标签', (await page.locator('[data-testid="settings-tab-security"]').count()) === 0)
  check('隐藏 MCP 标签', (await page.locator('[data-testid="settings-tab-mcp"]').count()) === 0)
  check('本地备份标签存在', (await page.locator('[data-testid="settings-tab-localbackup"]').count()) === 1)
  const settingsBox = await page.locator('[data-testid="settings-modal"]').boundingBox()
  check('设置面板全屏', Boolean(settingsBox && settingsBox.width >= 380))
  await page.click('[data-testid="settings-tab-general"]')
  await page.waitForSelector('[data-testid="setting-theme-dark"]')
  check('隐藏全局快捷键设置', (await page.locator('[data-testid="setting-hotkey-record"]').count()) === 0)
  check('隐藏托盘设置', (await page.locator('[data-testid="setting-close-to-tray"]').count()) === 0)

  // 手机端导出 Markdown：复制到剪贴板
  await page.click('[data-testid="settings-tab-localbackup"]')
  await page.waitForSelector('[data-testid="setting-export-md-all"]')
  await page.click('[data-testid="setting-export-md-all"]')
  await page.waitForFunction(async () => {
    const text = await navigator.clipboard.readText()
    return text.includes('移动端任务')
  })
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  check('导出 Markdown 到剪贴板', clipboard.includes('## ') && clipboard.includes('移动端任务'))
  await page.click('[data-testid="modal-close"]')

  console.log('Mobile web smoke passed')
} finally {
  await browser.close()
  server.close()
}
