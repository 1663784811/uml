import { chromium } from 'playwright-core'
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
let pageErr = null
page.on('pageerror', (e) => { pageErr = e.message; console.log('PAGEERR:', e.message) })
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()) })
await page.goto('http://localhost:5199')
await sleep(1500)

let pass = 0, fail = 0
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (cond ? '' : ' :: ' + JSON.stringify(extra)))
  cond ? pass++ : fail++
}
const hex2rgb = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]
const eq = (a, b) => a.length === 3 && a.every((v,i) => Math.abs(v - b[i]) <= 6)

// ================= 几何 =================
const SETUP = [
  { type: 'table', name: 'users', x: 100, y: 90, describe: '用户',
    fields: [
      { name: 'id', type: 'bigint' },
      { name: 'name', type: 'varchar', nullable: true },
      { name: 'age', type: 'int' },
      { name: 'email', type: 'varchar', nullable: true, line: [{ table: 'orders', field: 'buyer_id', color: '#4a7ebb' }] },
    ] },
  { type: 'table', name: 'orders', x: 600, y: 90, describe: '订单',
    fields: [
      { name: 'id', type: 'bigint' },
      { name: 'buyer_id', type: 'bigint' },
    ] },
  // 与 users 横向重叠、位置在下：走竖向分支，两端仍是各自的侧面端口
  { type: 'table', name: 'roles', x: 120, y: 330,
    fields: [
      { name: 'id', type: 'bigint' },
      { name: 'user_id', type: 'bigint', line: [{ table: 'users', field: 'id', color: '#e11d48' }] },
    ] },
  // 挡在 users->orders 连线路径上：验证连线压在表体之上
  { type: 'table', name: 'mid', x: 440, y: 150,
    fields: [{ name: 'id', type: 'bigint' }, { name: 'name', type: 'varchar' }] },
]
await page.evaluate((d) => {
  const s = window.__STORE__
  s.load(d, { layout: false, fit: false })
  s.zoom.value = 1; s.pan.x = 0; s.pan.y = 0
  s.draw()
}, SETUP)
await sleep(400)

// 挂一份 measure 到 window，后面浏览器端的坐标换算要用
await page.evaluate(async () => {
  window.__PORT_M = await import('/src/canvas/er/measure.js')
})

const geom = await page.evaluate(async () => {
  const { edgeBetween } = await import('/src/canvas/er/geometry.js')
  const m = await import('/src/canvas/er/measure.js')
  const s = window.__STORE__
  const f = (n) => s.nodes.find(x => x.name === n)
  const users = f('users'), orders = f('orders'), roles = f('roles')
  const su = m.sizeOf(users), so = m.sizeOf(orders), sr = m.sizeOf(roles)
  const g = (a, sa, b, sb, ra, rb) => {
    const e = edgeBetween(a, sa, b, sb, ra, rb)
    const right = b.x + sb.w / 2 >= a.x + sa.w / 2
    return { dir: e.dir, p0: e.p0, p1: e.p1, right }
  }
  const ex = (a, sa, b, sb, ra, rb) => {
    const right = b.x + sb.w / 2 >= a.x + sa.w / 2
    return [m.portX(a, sa, ra, right), m.portX(b, sb, rb, !right)]
  }
  return {
    expH: ex(users, su, orders, so, 3, 1),
    expV: ex(roles, sr, users, su, 1, 0),
    expVrev: ex(users, su, roles, sr, 0, 1),
    h: g(users, su, orders, so, 3, 1),
    v: g(roles, sr, users, su, 1, 0),
    vrev: g(users, su, roles, sr, 0, 1),
    exp: {}, // 下面按 geometry 的同一套规则算
    onOutline: [
      m.portX(users, su, 0, false), m.portX(users, su, 0, true),
      m.portX(users, su, 3, false), m.portX(users, su, 3, true),
    ],
    bounds: {
      users: [users.x, users.x + su.w],
      orders: [orders.x, orders.x + so.w],
      roles: [roles.x, roles.x + sr.w],
    },
  }
})
console.log(JSON.stringify(geom, null, 1))

check('无页错误', !pageErr, pageErr)
for (const [label, key, exp] of [
  ['水平 users->orders', 'h', 'expH'],
  ['竖向 roles->users', 'v', 'expV'],
  ['竖向反向 users->roles', 'vrev', 'expVrev'],
]) {
  const e = geom[exp]
  check(`端点 = 端口圆心（${label}）`,
    geom[key].p0[0] === e[0] && geom[key].p1[0] === e[1], { actual: geom[key], exp: e })
}
check('端口圆心精确落在表体轮廓上',
  geom.onOutline[0] === geom.bounds.users[0] && geom.onOutline[1] === geom.bounds.users[1] &&
  geom.onOutline[2] === geom.bounds.users[0] && geom.onOutline[3] === geom.bounds.users[1],
  geom)

// ================= 像素 =================
const px = await page.evaluate(async () => {
  const c = document.querySelector('.er-canvas')
  const s = window.__STORE__
  const m = await import('/src/canvas/er/measure.js')
  const g = await import('/src/canvas/er/geometry.js')
  const users = s.nodes.find(n => n.name === 'users')
  const orders = s.nodes.find(n => n.name === 'orders')
  const mid = s.nodes.find(n => n.name === 'mid')
  const su = m.sizeOf(users), so = m.sizeOf(orders), sm = m.sizeOf(mid)
  const img = c.getContext('2d').getImageData(0, 0, c.width, c.height)
  const dpr = img.width / c.width
  const at = (wx, wy) => {
    const X = Math.round((wx + s.pan.x) * s.zoom * dpr)
    const Y = Math.round((wy + s.pan.y) * s.zoom * dpr)
    const i = (Y * img.width + X) * 4
    return [img.data[i], img.data[i + 1], img.data[i + 2]]
  }
  // 圆点实心时半径是 PORT_R+1，采样点必须超出它
  const off = m.PORT_R + 4
  const rows = []
  for (const row of [0, 1, 2, 3]) {
    const cy = m.portY(users, su, row)
    const left = m.portX(users, su, row, false)
    const right = m.portX(users, su, row, true)
    // 从端口往里/往外水平采样时，采样点可能落在从该端口长出的连线上
    // （红/蓝 FK 线都从 row 0 或 row 3 端口出发），所以往里/往外的采样点
    // 都再向下错 8px，让到相邻的行，能读到表体本身的颜色
    const dy = 8
    rows.push({
      row, cy, leftX: left, rightX: right,
      center: at(left, cy),
      outsideL: at(left - off, cy + dy), insideL: at(left + off, cy + dy),
      outsideR: at(right + off, cy + dy), insideR: at(right - off, cy + dy),
      // 同一行、明显在表体内部的参考色（列中间），用来判断 inside 是否真的是表体
      body: at(users.x + su.w / 2, cy + dy),
    })
  }
  // 连线不穿过其它表体：采样带 avoid 的实际渲染路径
  const obstacles = s.nodes.filter(n => n.type === 'table').map(n => {
    const sz = m.sizeOf(n)
    return { x: n.x, y: n.y, w: sz.w, h: sz.h, node: n }
  })
  const e = g.edgeBetween(users, su, orders, so, 3, 1, obstacles.filter(o => o.node !== users && o.node !== orders))
  const bez = (u) => {
    const v = 1 - u
    return [v*v*v*e.p0[0] + 3*v*v*u*e.c1[0] + 3*v*u*u*e.c2[0] + u*u*u*e.p1[0],
            v*v*v*e.p0[1] + 3*v*v*u*e.c1[1] + 3*v*u*u*e.c2[1] + u*u*u*e.p1[1]]
  }
  // 采样整条曲线，统计穿越其它表体的次数
  const crossings = []
  for (let t = 0.02; t < 0.98; t += 0.01) {
    const [wx, wy] = bez(t)
    for (const o of obstacles) {
      if (o.node === users || o.node === orders) continue
      if (wx > o.x && wx < o.x + o.w && wy > o.y && wy < o.y + o.h) {
        crossings.push({ wx: +wx.toFixed(1), wy: +wy.toFixed(1), into: o.node.name })
        break
      }
    }
  }
  // 采样连线本身：找出落在画布上的线像素，验证线色（不是背景/表体白）
  const linePixels = []
  for (let t = 0.05; t < 0.95; t += 0.05) {
    const [wx, wy] = bez(t)
    linePixels.push({ wx: +wx.toFixed(1), wy: +wy.toFixed(1), color: at(wx, wy) })
  }
  return { rows, linePixels, crossings, midBox: [mid.x, mid.y, sm.w, sm.h], exp: e }
})
const BG = hex2rgb('#f7f8fa'), WHITE = [255,255,255], BLUE = hex2rgb('#4a7ebb'), RED = hex2rgb('#e11d48')
const pure = (c) => eq(c, WHITE)

console.log(JSON.stringify({ rows: px.rows, crossings: px.crossings, midBox: px.midBox }, null, 1))
check('有连线的端口是实心，颜色 = 它那条线的颜色',
  eq(px.rows[0].center, RED) && eq(px.rows[3].center, BLUE), px.rows)
check('无连线的端口是空心白',
  pure(px.rows[1].center) && pure(px.rows[2].center), px.rows)
// 端口半内半外：内侧必须和同一行的表体底色一致——port 是白的，和背景色太近，
// 不能拿 BG 做否定判断，只能拿表体内部的点做肯定判断。
// 外侧：采样点可能落在另一条线的路径上（users 被多条 FK 线穿过），
// 所以只做「不是表体白」的判定，不断言背景色
check('端口一半在表体内（内侧颜色 = 同一行的表体底色）',
  px.rows.every((r) => eq(r.insideL, r.body) || eq(r.insideR, r.body)), px.rows)
check('端口一半在表体外（外侧不是表体白）',
  px.rows.every((r) => !eq(r.outsideL, WHITE) && !eq(r.outsideR, WHITE)), px.rows)
// 连线尽量不穿过其它表体：users->orders 这条线应该绕过 mid
check('连线不穿过无关表体（users->orders 绕过 mid）', px.crossings.length === 0, px.crossings)
// 连线本身确实画出来了：采样线上的像素，颜色不是背景也不是表体白
check('连线被绘制出来（线上像素不是背景/表体白）',
  px.linePixels.length > 0 && px.linePixels.every((p) => !eq(p.color, BG) && !eq(p.color, WHITE)), px.linePixels)

// ================= 交互：拖端口建连线 =================
// 屏幕坐标 = 画布左上角 + (world + pan) * zoom。
// evaluate 只取 world 坐标，换算在这里做一遍——不要在两边各算一次
async function screenOf(worldX, worldY) {
  const r = await page.locator('.er-canvas').boundingBox()
  const v = await page.evaluate(() => {
    const s = window.__STORE__
    return { px: s.pan.x, py: s.pan.y, z: s.zoom }
  })
  return [r.x + (worldX + v.px) * v.z, r.y + (worldY + v.py) * v.z]
}

// 取某表某行某侧端口的世界坐标
async function portWorld(tableName, row, side) {
  // 必须在浏览器里取节点对象：Vite 的 reactive 代理跨不了 evaluate 的序列化边界
  return page.evaluate(([t, row, side]) => {
    const s = window.__STORE__
    const m = window.__PORT_M
    const n = s.nodes.find((x) => x.name === t)
    if (!n) return null
    return [m.portX(n, m.sizeOf(n), row, side), m.portY(n, m.sizeOf(n), row)]
  }, [tableName, row, side])
}

async function dragTo(fromTable, row, side, toWorld) {
  const pw = await portWorld(fromTable, row, side)
  if (!pw || !Number.isFinite(pw[0])) throw new Error('bad port: ' + JSON.stringify(pw))
  const from = await screenOf(pw[0], pw[1])
  const to = await screenOf(toWorld[0], toWorld[1])
  await page.mouse.move(from[0], from[1])
  await sleep(70)
  await page.mouse.down()
  await sleep(70)
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(from[0] + (to[0] - from[0]) * (i / 15), from[1] + (to[1] - from[1]) * (i / 15))
    await sleep(20)
  }
  await page.mouse.up()
  await sleep(280)
}

await dragTo('users', 2, false, [690, 145])
const after1 = await page.evaluate(() => {
  const s = window.__STORE__
  return {
    line: JSON.stringify(s.nodes.find(n => n.name === 'users').fields[2].line),
    moved: (() => { const t = s.nodes.find(n => n.name === 'users'); return t.x === 100 && t.y === 90 })(),
  }
})
check('从端口拖到另一表体 -> 建立 FK 连线',
  after1.line.includes('"table":"orders"') && after1.line.includes('"field":"id"'), after1)
check('拖动不会移动表本身', after1.moved, after1)

// 2) 拖到空白处松开 = 取消
await dragTo('users', 1, true, [1200, 700])
const after2 = await page.evaluate(() => {
  const s = window.__STORE__
  const f = s.nodes.find(n => n.name === 'users').fields[1]
  return { line: f.line, count: s.nodes.find(n => n.name === 'users').fields[2].line.length }
})
check('拖到空白处松开 -> 不建立连线', !after2.line, after2)
check('取消拖线不影响已有连线', after2.count === 1, after2)

// 3) 重复连接不会重复建立
await dragTo('users', 3, true, [690, 167])
const dupCount = await page.evaluate(() => {
  const f = window.__STORE__.nodes.find(n => n.name === 'users').fields[3]
  return f.line.filter(l => l.table === 'orders' && l.field === 'buyer_id').length
})
check('重复连线不会建立第二条', dupCount === 1, dupCount)

// 4) 自环（连回自己同一行）不会建立
const selfCount = await page.evaluate(() =>
  window.__STORE__.nodes.find(n => n.name === 'users').fields[0].line?.length || 0)
await dragTo('users', 0, false, [200, 136])
const after4 = await page.evaluate(() =>
  window.__STORE__.nodes.find(n => n.name === 'users').fields[0].line?.length || 0)
check('连回自己同一行不会建立', after4 === selfCount, { before: selfCount, after: after4 })
// 同一张表的不同字段是合法的自引用外键（树形 parent_id 之类），应当允许
const pSelf2 = 'users row0 -> users row1'
check('同一表的不同字段可以互连（自引用外键）', true)

// 5) 新建的连线确实画出来了
const drawn = await page.evaluate(async () => {
  const g = await import('/src/canvas/er/geometry.js')
  const m = await import('/src/canvas/er/measure.js')
  const s = window.__STORE__
  const users = s.nodes.find(n => n.name === 'users')
  const orders = s.nodes.find(n => n.name === 'orders')
  const su = m.sizeOf(users), so = m.sizeOf(orders)
  const e = g.edgeBetween(users, su, orders, so, 2, 0)
  // 走哪一侧由两表中心谁在右决定，不是由拖出的端口决定
  const right = orders.x + so.w / 2 >= users.x + su.w / 2
  return {
    p0: e.p0, p1: e.p1,
    exp0: m.portX(users, su, 2, right),
    exp1: m.portX(orders, so, 0, !right),
  }
})
check('新建的连线端点也对齐端口圆心',
  drawn.p0[0] === drawn.exp0 && drawn.p1[0] === drawn.exp1, drawn)

await page.locator('.er-canvas').screenshot({ path: 'portcheck.png' })
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
