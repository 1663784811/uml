import { chromium } from 'playwright-core'
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERR:', e.message))
await page.goto('http://localhost:5199')
await sleep(1500)
await page.evaluate(() => {
  const s = window.__STORE__
  s.load([
    { type: 'layout', name: 'users_group', x: 100, y: 100, describe: '用户分组' },
    { type: 'table', name: 'orders', group: 'users_group', fields: [{ name: 'id', type: 'bigint' }, { name: 'qty', type: 'int', nullable: true }], x: 150, y: 150, describe: '订单' },
    { type: 'table', name: 'log_table', fields: [{ name: 'id', type: 'bigint' }], x: 400, y: 100, describe: '日志表' },
    { type: 'layout', name: 'analytics', x: 600, y: 100, describe: '分析' },
  ], { layout: false, fit: true })
})
await sleep(500)
const box = await page.locator('.layers').boundingBox()
await page.screenshot({ path: 'view_current.png', clip: box })
console.log('saved view_current.png')
await browser.close()
