import { chromium } from 'playwright-core'
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
await page.goto('http://localhost:5199')
await sleep(1500)

// Force overflow: add many nodes so the body scrolls
await page.evaluate(() => {
  const s = window.__STORE__
  const data = [{ type: 'layout', name: 'grp', x: 200, y: 200 }]
  for (let i = 0; i < 40; i++) {
    data.push({ type: 'table', name: `t_${i}`, group: 'grp', fields: [{ name: 'id', type: 'bigint' }], x: 250, y: 250 + i * 20 })
  }
  s.load(data, { layout: false, fit: true })
})
await sleep(400)

const info = await page.evaluate(() => {
  const body = document.querySelector('.layers-body')
  if (!body) return { found: false }
  const cs = getComputedStyle(body)
  const rect = body.getBoundingClientRect()
  return {
    found: true,
    overflowY: cs.overflowY,
    scrollbarWidth: cs.scrollbarWidth,
    scrollbarColor: cs.scrollbarColor,
    contain: cs.contain,
    clientHeight: body.clientHeight,
    scrollHeight: body.scrollHeight,
    clientWidth: body.clientWidth,
    scrollWidth: body.scrollWidth,
    rect: { w: rect.width, h: rect.height },
  }
})
console.log('BODY:', JSON.stringify(info, null, 2))

// Check ::-webkit-scrollbar via a probe element with same styles
const probe = await page.evaluate(() => {
  const body = document.querySelector('.layers-body')
  const cs = getComputedStyle(body, '::-webkit-scrollbar')
  return {
    width: cs.width,
    display: cs.display,
    background: cs.backgroundColor,
  }
})
console.log('WEBKIT SCROLLBAR:', JSON.stringify(probe, null, 2))

const thumb = await page.evaluate(() => {
  const body = document.querySelector('.layers-body')
  const cs = getComputedStyle(body, '::-webkit-scrollbar-thumb')
  return {
    background: cs.backgroundColor,
    borderRadius: cs.borderRadius,
    border: cs.border,
    backgroundClip: cs.backgroundClip,
  }
})
console.log('WEBKIT THUMB:', JSON.stringify(thumb, null, 2))

// Screenshot the layers panel
await page.screenshot({ path: 'scrollcheck.png', fullPage: false })
const layers = await page.locator('.layers').boundingBox()
if (layers) {
  await page.screenshot({ path: 'scrollcheck.png', clip: layers })
}
console.log('screenshot saved')

await browser.close()
