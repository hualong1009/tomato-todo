// 管理员密码 / 自动锁定 / 应用重置 / 关闭到托盘 的端到端验证。
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app
const userData = mkdtempSync(join(tmpdir(), 'tomato-sec-'))
app = await electron.launch({ args: ['.'], env: { ...process.env, TOMATO_USER_DATA: userData } })
const page = await app.firstWindow()
await page.waitForSelector('.composer')

const check = (name, cond) => {
  if (!cond) throw new Error('FAIL: ' + name)
  console.log('ok -', name)
}

try {
  // --- 初始状态：未设置密码 ---
  let security = await page.evaluate(() => window.api.getSecurityState())
  check('初始未设置密码且未锁定', security.hasPassword === false && security.locked === false)

  // --- 设置管理员密码 ---
  const setPassword = await page.evaluate(() =>
    window.api.setSecurityPassword({ newPassword: 'test1234' })
  )
  check('设置密码成功', setPassword.ok && setPassword.state.hasPassword)
  check('默认自动锁定 5 分钟', setPassword.state.autoLockMinutes === 5)

  // --- 立即锁定 ---
  const locked = await page.evaluate(() => window.api.lockNow())
  check('立即锁定成功', locked.ok && locked.state.locked)
  await page.waitForSelector('[data-testid="lock-overlay"]')
  await page.waitForSelector('[data-testid="lock-password"]')
  check('锁定遮罩已显示', true)

  // --- 错误密码被拒绝 ---
  await page.fill('[data-testid="lock-password"]', 'wrong-pass')
  await page.click('[data-testid="lock-unlock"]')
  await page.waitForSelector('[data-testid="lock-error"]')
  check('错误密码被拒绝', true)

  // --- 正确密码解锁 ---
  await page.fill('[data-testid="lock-password"]', 'test1234')
  await page.click('[data-testid="lock-unlock"]')
  await page.waitForSelector('[data-testid="lock-overlay"]', { state: 'detached' })
  security = await page.evaluate(() => window.api.getSecurityState())
  check('正确密码解锁', security.locked === false)

  // --- 设置界面安全 tab ---
  await page.keyboard.press('Control+,')
  await page.waitForSelector('[data-testid="settings-modal"]')
  await page.click('[data-testid="settings-tab-security"]')
  await page.waitForSelector('[data-testid="setting-security-next"]')
  check('安全设置 tab 渲染', true)
  await page.click('[data-testid="modal-close"]')

  // --- 添加待办后测试重置 ---
  await page.fill('[data-testid="composer-title"]', 'reset-me')
  await page.click('[data-testid="composer-submit"]')
  await page.waitForSelector('[data-testid="todo-list"]')

  const badReset = await page.evaluate(() => window.api.resetApp('bad-pass'))
  check('错误密码不能重置', badReset.ok === false)
  let todos = await page.evaluate(() => window.api.getState().then((s) => s.todos.length))
  check('数据未被清空', todos === 1)

  const reset = await page.evaluate(() => window.api.resetApp('test1234'))
  check('正确密码重置成功', reset.ok)
  todos = await page.evaluate(() => window.api.getState().then((s) => s.todos.length))
  check('待办已清空', todos === 0)
  security = await page.evaluate(() => window.api.getSecurityState())
  check('重置后管理员密码已清除', security.hasPassword === false)

  // --- 关闭按钮最小化到托盘 ---
  await page.waitForSelector('.composer')
  await page.click('[data-testid="window-close"]')
  await page.waitForTimeout(800)
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), destroyed: w.isDestroyed() }))
  )
  const main = windows.find((w) => !w.destroyed)
  check('关闭后主窗口隐藏但未销毁', Boolean(main && !main.visible))
  check('应用进程存活', app.process() !== null && !app.process().killed)

  console.log('Security / reset / tray e2e passed')
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
}
