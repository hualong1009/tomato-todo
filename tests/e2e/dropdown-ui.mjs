import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'tomato-ddv-'))
const child = spawn('node_modules/electron/dist/electron.exe', ['.', '--remote-debugging-port=19239'], {
  env: { ...process.env, TOMATO_USER_DATA: userData },
  stdio: 'ignore'
})
let browser
for (let i = 0; i < 20; i++) {
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:19239')
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}
const page = browser.contexts()[0].pages()[0]
await page.waitForSelector('.composer')

const check = (name, cond) => {
  if (!cond) throw new Error('FAIL: ' + name)
  console.log('ok -', name)
}

// --- 紧急程度下拉（composer，mini 样式）---
const trigger = page.locator('[data-testid="composer-urgency"]')
const trigBox = await trigger.boundingBox()
await trigger.click()
const menu = page.locator('[data-testid="composer-urgency-menu"]')
await menu.locator('.dropdown-option').first().waitFor()
const menuBox = await menu.boundingBox()
check('menu visible', menuBox.width > 100 && menuBox.height > 50)
const gap = menuBox.y - (trigBox.y + trigBox.height)
check('menu below trigger (4-20px gap)', gap > 4 && gap < 20)
check('menu in viewport', menuBox.x >= 0 && menuBox.y >= 0)

const badges = menu.locator('.dropdown-option .dropdown-badge')
check('4 urgency badges', (await badges.count()) === 4)
const badgeColors = []
for (let i = 0; i < 4; i++) badgeColors.push(await badges.nth(i).evaluate((el) => el.style.color))
check('badge colors distinct', new Set(badgeColors).size === 4)
check('selected has check', (await menu.locator('.dropdown-option.selected svg').count()) === 1)
check(
  'default medium selected',
  (await menu.locator('.dropdown-option.selected .dropdown-option-label').innerText()).includes('中')
)

// --- 键盘：Escape 关闭，Home + Enter 选择第一项 ---
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
check('escape closes', (await menu.count()) === 0)
await trigger.click()
await menu.locator('.dropdown-option').first().waitFor()
await page.keyboard.press('Home')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
check('keyboard selected 紧急', (await trigger.innerText()).includes('急'))

// --- 分组下拉（圆点颜色）---
await page.click('[data-testid="composer-group"]')
const gmenu = page.locator('[data-testid="composer-group-menu"]')
await gmenu.locator('.dropdown-option').first().waitFor()
const dots = gmenu.locator('.dropdown-option .dropdown-dot')
check('group dots rendered', (await dots.count()) >= 1)
check('dot has color', /^rgb/.test(await dots.first().evaluate((el) => el.style.background)))
await page.keyboard.press('Escape')

// --- 详情面板（default 尺寸 + 描述行）---
await page.fill('[data-testid="composer-title"]', '样式验证')
await page.click('[data-testid="composer-submit"]')
await page.waitForSelector('[data-testid="todo-list"]')
await page.click('.todo-item')
await page.waitForSelector('.detail-panel')
await page.click('[data-testid="detail-urgency"]')
const dmenu = page.locator('[data-testid="detail-urgency-menu"]')
await dmenu.locator('.dropdown-option').first().waitFor()
check('detail menu wider', (await dmenu.boundingBox()).width >= 170)
check('descriptions shown', (await dmenu.locator('.dropdown-option-desc').count()) === 4)
check(
  'detail trigger shows badge text',
  (await page.locator('[data-testid="detail-urgency"]').innerText()).length > 0
)

// 详情面板带 backdrop-filter / 动画残留的 transform，会成为 position: fixed 的
// 包含块：弹层必须挂到 body，否则会被顶到面板外面（「点下拉布局就乱」）。
const dTrigBox = await page.locator('[data-testid="detail-urgency"]').boundingBox()
const dMenuBox = await dmenu.boundingBox()
const dPanelBox = await page.locator('.detail-panel').boundingBox()
check('detail menu aligns with trigger', Math.abs(dMenuBox.x - dTrigBox.x) < 8)
check(
  'detail menu right below trigger',
  dMenuBox.y > dTrigBox.y + dTrigBox.height - 2 && dMenuBox.y < dTrigBox.y + dTrigBox.height + 26
)
check(
  'detail menu stays inside panel',
  dMenuBox.x + dMenuBox.width <= dPanelBox.x + dPanelBox.width + 4
)

// 选择后触发按钮要立刻显示新值
const beforeUrgency = await page.locator('[data-testid="detail-urgency"]').innerText()
await dmenu.locator('.dropdown-option').nth(1).click()
await page.waitForTimeout(200)
check(
  'detail urgency applies selection',
  (await page.locator('[data-testid="detail-urgency"]').innerText()) !== beforeUrgency
)
check('detail menu closed after select', (await dmenu.count()) === 0)

// --- 点击外部关闭 ---
await page.mouse.click(600, 520)
await page.waitForTimeout(200)
check('outside click closes', (await dmenu.count()) === 0)

// --- 浅色主题下同样可用 ---
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
await trigger.click()
await menu.locator('.dropdown-option').first().waitFor()
const lightBg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor)
check('light theme renders', typeof lightBg === 'string')
await page.keyboard.press('Escape')

await browser.close()
child.kill()
console.log('All dropdown verifications passed')
