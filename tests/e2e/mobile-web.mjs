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
  const { version: currentVersion } = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  let remoteVersion = currentVersion
  await page.route('https://api.github.com/repos/hualong1009/tomato-todo/releases/latest', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: `v${remoteVersion}` }) })
  )
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

  // 模拟 Android 边到边 WebView：键盘只通过原生 IME inset 通知，
  // 布局/visualViewport 暂未缩小。面板必须抬到键盘之上，不能把整块
  // 键盘高度误写进 --safe-bottom 导致表单被遮挡（#11）。
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-bottom', '24px')
    document.documentElement.style.setProperty('--keyboard-inset', '320px')
    window.dispatchEvent(new Event('tomato:insets'))
  })
  await page.waitForFunction(() => {
    const sheet = document.querySelector('.sheet-composer')?.closest('.sheet')
    return sheet && sheet.getBoundingClientRect().bottom <= window.innerHeight - 315
  })
  const keyboardLayout = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet-composer')?.closest('.sheet')
    const header = sheet?.querySelector('.sheet-head')
    return {
      sheetBottom: sheet?.getBoundingClientRect().bottom ?? Infinity,
      headerTop: header?.getBoundingClientRect().top ?? -1,
      panelHeight: sheet?.getBoundingClientRect().height ?? Infinity
    }
  })
  check('输入法弹出时表单保持在可见区域且标题避开状态栏',
    keyboardLayout.sheetBottom <= 844 - 315 && keyboardLayout.headerTop >= 0 && keyboardLayout.panelHeight < 524)
  await page.fill('.sheet-composer [data-testid="composer-title"]', '移动端任务')
  await page.locator('.sheet-composer [data-testid="composer-submit"]').scrollIntoViewIfNeeded()
  const submitBox = await page.locator('.sheet-composer [data-testid="composer-submit"]').boundingBox()
  check('输入法打开时添加按钮仍可见可点', Boolean(submitBox && submitBox.y + submitBox.height < 844 - 315))
  await page.click('.sheet-composer [data-testid="composer-submit"]')
  await page.waitForSelector('[data-testid="todo-item"]')
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--keyboard-inset', '0px')
    document.documentElement.style.removeProperty('--safe-bottom')
    window.dispatchEvent(new Event('tomato:insets'))
  })
  check(
    '新增待办成功',
    (await page.locator('[data-testid="todo-item"] .todo-title').first().innerText()).includes('移动端任务')
  )
  check('手机待办卡片没有桌面便签按钮', (await page.locator('[data-testid="todo-pin"]').count()) === 0)

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
  check('手机详情不显示固定便签和桌面便签样式',
    (await page.locator('[data-testid="detail-pin"]').count()) === 0 &&
    (await page.locator('.detail-note-style').count()) === 0)
  // 详情里的分组 / 紧急程度下拉：手机端点选项必须立刻生效
  // （曾经因为状态快照引用不变，React 跳过重渲染，看起来像「点了没反应」）
  await page.evaluate(() => window.api.addGroup('字节项目'))
  await page.waitForTimeout(200)
  const groupTrigger = page.locator('[data-testid="detail-group"]')
  const groupTriggerBox = await groupTrigger.boundingBox()
  await groupTrigger.tap()
  const groupMenu = page.locator('[data-testid="detail-group-menu"]')
  await groupMenu.waitFor()
  const groupMenuBox = await groupMenu.boundingBox()
  check('手机端分组弹层对齐触发按钮',
    Math.abs(groupMenuBox.x - groupTriggerBox.x) < 8 &&
    groupMenuBox.y > groupTriggerBox.y)
  // 新建的分组排在最后，选它
  await groupMenu.locator('.dropdown-option').last().tap()
  await page.waitForTimeout(300)
  check('手机端可选择所属分组',
    (await groupTrigger.innerText()).includes('字节项目'))
  const urgencyTrigger = page.locator('[data-testid="detail-urgency"]')
  const beforeUrgency = await urgencyTrigger.innerText()
  await urgencyTrigger.tap()
  await page.locator('[data-testid="detail-urgency-menu"]').waitFor()
  await page.locator('[data-testid="detail-urgency-menu"] .dropdown-option').last().tap()
  await page.waitForTimeout(300)
  check('手机端可选择紧急程度',
    (await urgencyTrigger.innerText()) !== beforeUrgency)

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
  // 正文插图：图片是 base64，编码后远超 5 万字符，不能算进「正文文字上限」
  const noise = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 1200
    const context = canvas.getContext('2d')
    const image = context.createImageData(1200, 1200)
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.random() * 255
      image.data[i + 1] = Math.random() * 255
      image.data[i + 2] = Math.random() * 255
      image.data[i + 3] = 255
    }
    context.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png')
  })
  const pngBuffer = Buffer.from(noise.split(',')[1], 'base64')
  check('测试图片编码后远超 5 万字符', pngBuffer.length * 1.37 > 50_000)
  await page.setInputFiles('[data-testid="rich-image-input"]', {
    name: 'noise.png',
    mimeType: 'image/png',
    buffer: pngBuffer
  })
  await page.waitForFunction(() => {
    const value = document.querySelector('[data-testid="detail-content"]')?.value ?? ''
    return value.includes('data:image/')
  })
  const withImage = await page.locator('[data-testid="detail-content"]').inputValue()
  check('大图已插入正文', withImage.length > 50_000)
  check('插入大图不报错', (await page.locator('.rich-hint.error').count()) === 0)
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
  check('带大图的正文保存成功并渲染图片',
    (await page.locator('[data-testid="detail-content-view"] img').count()) === 1)
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
  check('手机操作面板不显示固定到桌面便签',
    !(await page.locator('.action-sheet').innerText()).includes('桌面便签'))
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
  await page.click('[data-testid="settings-tab-webdav"]')
  check('手机端可填写 WebDAV 加密密码',
    (await page.locator('[data-testid="setting-webdav-encryption"]').count()) === 1)
  check('手机端可配置图片与附件拆分',
    (await page.locator('[data-testid="setting-webdav-split-assets"]').count()) === 1)
  check('手机端可设置定时双向同步',
    (await page.locator('[data-testid="setting-webdav-sync-interval"]').count()) === 1)
  check('手机端可手动双向同步',
    (await page.locator('[data-testid="setting-webdav-sync"]').count()) === 1)

  // 配置好 WebDAV 后：顶部栏显示同步状态，点一下立即同步，改动后自动同步
  let davPuts = 0
  await page.route('https://dav.tomato.test/**', async (route) => {
    const method = route.request().method()
    if (method === 'PUT') {
      davPuts += 1
      return route.fulfill({ status: 201, body: '' })
    }
    if (method === 'GET') return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 201, body: '' })
  })
  check('未配置 WebDAV 时不显示同步状态',
    (await page.locator('[data-testid="mobile-sync"]').count()) === 0)
  await page.fill('[data-testid="setting-webdav-url"]', 'https://dav.tomato.test/root/')
  await page.fill('[data-testid="setting-webdav-path"]', 'tomato-todo/data.json')
  // 开关是隐藏的原生 checkbox：点它的 label 才会真正切换
  await page
    .locator('[data-testid="setting-webdav-enabled"]')
    .evaluate((el) => el.closest('label')?.click())
  await page.click('[data-testid="settings-save"]')
  await page.click('[data-testid="modal-close"]')
  await page.waitForSelector('[data-testid="mobile-sync"]')
  check('配置 WebDAV 后顶部栏出现同步状态',
    (await page.locator('[data-testid="mobile-sync"]').count()) === 1)
  // 保存设置会触发一次补同步：远端没有备份 → 上传
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="mobile-sync"]')?.textContent?.includes('已同步'), null,
    { timeout: 8000 })
  check('保存后自动完成首次同步',
    (await page.locator('[data-testid="mobile-sync"]').innerText()).startsWith('已同步'))
  check('首次同步上传了主备份文件', davPuts >= 1)

  // 改动待办后自动同步（不需要点同步按钮）
  const putsBeforeEdit = davPuts
  await page.click('[data-testid="mobile-tab-todos"]')
  await page.click('[data-testid="mobile-fab"]')
  await page.fill('.sheet-composer [data-testid="composer-title"]', '改完自动同步的待办')
  await page.locator('.sheet-composer [data-testid="composer-submit"]').scrollIntoViewIfNeeded()
  await page.click('.sheet-composer [data-testid="composer-submit"]')
  await page.waitForTimeout(2400)
  check('改动待办后自动同步', davPuts > putsBeforeEdit)

  // 点同步按钮再手动同步一次
  const putsBeforeTap = davPuts
  await page.click('[data-testid="mobile-sync"]')
  await page.waitForSelector('[data-testid="toast"]')
  await page.waitForTimeout(1200)
  check('点击同步状态立即同步', davPuts > putsBeforeTap)
  // 后续步骤仍要操作设置面板，重新打开
  await page.click('[data-testid="mobile-tab-settings"]')
  await page.waitForSelector('[data-testid="settings-modal"]')

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

  // 重启后自动检测新版本 → 忽略此版本 → 下次启动不再弹出；手动检查仍可查看。
  remoteVersion = currentVersion.replace(/\d+$/, (patch) => String(Number(patch) + 1))
  await page.click('[data-testid="modal-close"]')
  await page.reload()
  await page.waitForSelector('[data-testid="update-dialog"]', { timeout: 10000 })
  check('启动后自动发现新版本', (await page.locator('[data-testid="update-dialog"]').innerText()).includes(remoteVersion))
  await page.click('[data-testid="update-ignore"]')
  await page.waitForSelector('[data-testid="update-dialog"]', { state: 'detached' })
  await page.waitForFunction((version) =>
    window.localStorage.getItem('CapacitorStorage.tomato-todo-data')?.includes(`"ignoredUpdateVersion":"${version}"`),
    remoteVersion
  )
  await page.reload()
  await page.waitForSelector('.mobile-shell')
  await page.waitForTimeout(2200)
  check('重启后忽略的版本不再弹窗', (await page.locator('[data-testid="update-dialog"]').count()) === 0)
  await page.click('[data-testid="mobile-tab-settings"]')
  await page.click('[data-testid="settings-tab-about"]')
  await page.click('[data-testid="setting-check-updates"]')
  await page.waitForSelector('[data-testid="update-dialog"]')
  check('手动检查可重新查看忽略的版本', true)
  await page.evaluate(() => {
    window.open = (url) => { window.__lastUpdateUrl = url; return null }
  })
  await page.click('[data-testid="update-open-release"]')
  check('去更新打开本项目发布页', (await page.evaluate(() => window.__lastUpdateUrl)) ===
    'https://github.com/hualong1009/tomato-todo/releases/latest')

  console.log('Mobile web smoke passed')
} finally {
  await browser.close()
  server.close()
}
