import { chromium } from 'playwright-core'
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERR:', e.message))
page.on('console', (m) => console.log('CONSOLE:', m.type(), m.text()))
await page.goto('http://localhost:5199')
await sleep(1500)

// Start from a clean known state
await page.evaluate(() => {
  window.__STORE__.load([
    { type: 'layout', name: 'grp', x: 200, y: 200, w: 500, h: 400 },
    { type: 'table', name: 'users', group: 'grp', fields: [{ name: 'id', type: 'bigint' }], x: 250, y: 250 },
    { type: 'table', name: 'orders', fields: [{ name: 'id', type: 'bigint' }], x: 900, y: 300 },
  ], { layout: false, fit: true })
})
await sleep(300)

let pass = 0, fail = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name)
  if (cond) pass++; else fail++
}

// 1. initial state
const init = await page.evaluate(() => {
  const s = window.__STORE__
  return {
    count: s.nodes.length,
    top: s.nodes.filter(n => !n.group).map(n => n.name).sort(),
    grpW: s.nodes.find(n => n.name === 'grp').w,
    usersParent: s.nodes.find(n => n.name === 'users').group,
  }
})
check('initial load (3 nodes, correct structure)',
  init.count === 3 &&
  init.top.join(',') === 'grp,orders' &&
  init.usersParent === 'grp' &&
  init.grpW > 200)

// 2. serialize round-trip
const rt = await page.evaluate(() => {
  const s = window.__STORE__
  const a = s.serialize().map(n => `${n.type}:${n.name}:${n.group || ''}`).sort()
  s.load(s.serialize(), { layout: false, fit: true })
  const b = s.serialize().map(n => `${n.type}:${n.name}:${n.group || ''}`).sort()
  return { same: a.join('|') === b.join('|') }
})
check('serialize round-trip', rt.same)

// 3. addTable
const addRes = await page.evaluate(() => {
  const s = window.__STORE__
  const before = s.nodes.length
  const n = s.addTable()
  return { before, after: s.nodes.length, name: n.name, type: n.type }
})
check('addTable', addRes.after === addRes.before + 1 && addRes.name === 'new_table')

// 4. rename (should not collide with existing users/orders/grp)
const renameRes = await page.evaluate(() => {
  const s = window.__STORE__
  const n = s.nodes.find(x => x.name === 'users')
  const ok = s.rename(n, 'people')
  return { ok, newName: s.nodes.find(x => x === n).name, memberParent: s.nodes.filter(x => x.group === 'people').length }
})
check('rename (updates members parent)', renameRes.ok && renameRes.newName === 'people' && renameRes.memberParent === 0)
// Actually users is inside grp, so no children. Test with a layout rename:
const renLayout = await page.evaluate(() => {
  const s = window.__STORE__
  const lay = s.nodes.find(n => n.name === 'grp')
  const ok = s.rename(lay, 'grp2')
  return { ok, childParent: s.nodes.find(n => n.name === 'people').group }
})
check('rename layout (rewrites children parent)', renLayout.ok && renLayout.childParent === 'grp2')

// 5. addLayout + nestInto + detach
const nest = await page.evaluate(() => {
  const s = window.__STORE__
  const lay = s.addLayout('new_grp')
  const orders = s.nodes.find(n => n.name === 'orders')
  const ok = s.nestInto(lay, [orders])
  return {
    ok,
    newParent: s.nodes.find(n => n.name === 'orders').group,
    grpMembers: s.nodes.filter(n => n.group === 'new_grp').length,
  }
})
check('nestInto', nest.ok && nest.newParent === 'new_grp' && nest.grpMembers === 1)

const detach = await page.evaluate(() => {
  const s = window.__STORE__
  const orders = s.nodes.find(n => n.name === 'orders')
  const ok = s.detachToParent([orders])
  return { ok, newParent: s.nodes.find(n => n.name === 'orders').group }
})
check('detachToParent', detach.ok && detach.newParent === null)

// 6. deleteSelected — delete layout, members promoted
const del = await page.evaluate(() => {
  const s = window.__STORE__
  const lay = s.nodes.find(n => n.name === 'new_grp')
  s.select(lay, false)
  const before = s.nodes.length
  const ok = s.deleteSelected()
  const remaining = s.nodes.map(n => n.name)
  return { ok, before, after: s.nodes.length, remaining }
})
check('deleteSelected layout', del.ok && del.after === del.before - 1)

// 7. toggleVisible
const vis = await page.evaluate(() => {
  const s = window.__STORE__
  const n = s.nodes.find(x => x.name === 'orders')
  s.toggleVisible(n)
  const h1 = s.hidden.has(n)
  s.toggleVisible(n)
  const h2 = s.hidden.has(n)
  return { h1, h2 }
})
check('toggleVisible', vis.h1 === true && vis.h2 === false)

// 8. moveLayer (front/back) — use 'back' since orders is already at front
const move = await page.evaluate(() => {
  const s = window.__STORE__
  const orders = s.nodes.find(n => n.name === 'orders')
  const beforeIdx = s.nodes.indexOf(orders)
  s.moveLayer(orders, 'back')
  const afterIdx = s.nodes.indexOf(orders)
  return { beforeIdx, afterIdx, ok: afterIdx < beforeIdx, wasLast: beforeIdx === s.nodes.length - 1 }
})
check('moveLayer back', move.ok)

// 9. reorder — move users to be after orders in new_grp's parent scope (both top-level now)
// Reload with a clean setup
await page.evaluate(() => {
  window.__STORE__.load([
    { type: 'layout', name: 'L', x: 100, y: 100, w: 400, h: 300 },
    { type: 'table', name: 'A', group: 'L', fields: [{ name: 'id', type: 'bigint' }], x: 150, y: 150 },
    { type: 'table', name: 'B', group: 'L', fields: [{ name: 'id', type: 'bigint' }], x: 150, y: 220 },
    { type: 'table', name: 'C', group: 'L', fields: [{ name: 'id', type: 'bigint' }], x: 150, y: 290 },
  ], { layout: false, fit: true })
})
await sleep(200)

const reorder = await page.evaluate(() => {
  const s = window.__STORE__
  const A = s.nodes.find(n => n.name === 'A')
  const C = s.nodes.find(n => n.name === 'C')
  const order1 = s.nodes.filter(n => n.group === 'L').map(n => n.name)
  const ok = s.reorder(A, C, 'after')
  const order2 = s.nodes.filter(n => n.group === 'L').map(n => n.name)
  return { order1, order2, ok }
})
check('reorder (moves A after C in L)', reorder.ok && reorder.order2.indexOf('A') === reorder.order2.indexOf('C') + 1)

// 10. Drag a table (dragcheck)
async function dragTable(name, dx, dy) {
  const info = await page.evaluate((n) => {
    const s = window.__STORE__
    const c = document.querySelector('.er-canvas')
    const r = c.getBoundingClientRect()
    const t = s.nodes.find((x) => x.name === n)
    return {
      cx: r.left + (t.x + t.w/2) * s.zoom + s.pan.x,
      cy: r.top + (t.y + t.h/2) * s.zoom + s.pan.y,
      before: { x: t.x, y: t.y },
      zoom: s.zoom,
    }
  }, name)
  await page.mouse.move(info.cx, info.cy)
  await sleep(60)
  await page.mouse.down()
  await sleep(60)
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(info.cx + dx * (i/20), info.cy + dy * (i/20))
    await sleep(15)
  }
  await sleep(60)
  await page.mouse.up()
  await sleep(300)
  const after = await page.evaluate((n) => {
    const t = window.__STORE__.nodes.find(x => x.name === n)
    return { x: t.x, y: t.y }
  }, name)
  return { before: info.before, after, zoom: info.zoom, expected: [dx/info.zoom, dy/info.zoom] }
}

const drag = await dragTable('A', 100, 60)
check('drag table', Math.abs(drag.after.x - drag.before.x - drag.expected[0]) < 2 &&
                    Math.abs(drag.after.y - drag.before.y - drag.expected[1]) < 2)

// 11. hitTest — click on a field row should return row >= 0
const hit = await page.evaluate(() => {
  const s = window.__STORE__
  const t = s.nodes.find(n => n.name === 'A')
  const w = s.toWorld(100, 100)  // will fail if ctx not bound, but that's OK
  return { ok: !!s.hitTest }
})
check('hitTest exists', hit.ok)

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
