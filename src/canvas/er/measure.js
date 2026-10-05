// 文本测量 / 尺寸计算 / 主题色。layout 与 renderer 共用，保证两边尺寸一致。

const UI_FONT = '"PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif'

export const FONT_12 = `12px ${UI_FONT}`
export const FONT_12_B = `600 12px ${UI_FONT}`
export const FONT_10_B = `700 10px ${UI_FONT}`

export const HEADER_H = 34
export const FIELD_H = 24
export const KEY_W = 26
export const COL_GAP = 10
export const PAD_L = 8
export const PAD_R = 8

// 圆角半径：图层框 > 表体 > 图例 > 徽标
export const RADIUS = { table: 10, layout: 12, legend: 6, badge: 3 }

// 图层：顶部标签留白（名称 + 描述各占一行，见 renderer 的 drawLayout）
export const LABEL_H = 44
// 图层四周内边距：成员并集往里缩这一圈
export const PAD_INNER = 16
// 无成员时的最小尺寸，容纳名称 + 描述 + 留白
export const MIN_LAYOUT_W = 260
export const MIN_LAYOUT_H = 120

// 行内徽标（FK）：宽度 + 与文字的间距
export const BADGE_W = 26
export const BADGE_H = 15
export const BADGE_GAP = 6
// type 列存在外键时，整列都要预留出徽标空间，避免徽标压住文字
export const BADGE_PAD = BADGE_W + BADGE_GAP

export const THEME = {
  bg: '#f7f8fa',
  gridDot: '#d6dbe3',
  gridStep: 20,

  tableBg: '#ffffff',
  tableBorder: '#b7c1cd',
  headerBg: '#4a7ebb',
  headerText: '#ffffff',
  headerSub: 'rgba(255,255,255,0.75)',

  rowAlt: '#f4f7fb',
  rowLine: '#e4e9ef',

  text: '#1f2937',
  type: '#64748b',

  // 可空标记：中性灰。数据里没有主键字段，不要用主键惯用的琥珀色
  nullTag: '#64748b',
  nullTagBg: '#eef1f6',
  nullKeyBg: '#f3f5f9',

  fk: '#1d4ed8',
  fkBg: '#dbeafe',

  // 字段行悬停：主题蓝低透明度铺满整行，压在斑马行与可空列之上
  fieldHover: 'rgba(74,126,187,0.14)',
  fieldHoverLine: '#4a7ebb',
  fieldHoverText: '#0f172a',
  fieldHoverType: '#475569',

  edge: '#8492a6',
  selection: '#f59e0b',
  layoutBorder: '#94a3b8',
  layoutFill: 'rgba(148,163,184,0.05)',
}

let _ctx = null

function ctx() {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d')
  return _ctx
}

export function textW(text, font = FONT_12) {
  const c = ctx()
  c.font = font
  return c.measureText(String(text == null ? '' : text)).width
}

// 超出宽度时尾部截断，保证绘制与测量结果一致（不会溢出单元格）
export function ellipsize(text, maxW, font) {
  const s = String(text == null ? '' : text)
  if (textW(s, font) <= maxW) return s
  for (let i = s.length - 1; i > 0; i--) {
    if (textW(`${s.slice(0, i)}…`, font) <= maxW) return `${s.slice(0, i)}…`
  }
  return '…'
}

// describe 原文；可空/外键状态由徽标表达，这里不再重复拼接
export function describeOf(f) {
  return String((f && f.describe) != null ? f.describe : '')
}

// 列几何：x 为列左边界，w 为文字可用宽度（已扣除徽标占位）
export function columns(size) {
  const nx = PAD_L + KEY_W + COL_GAP
  const name = { x: nx, w: size.nameW || 0 }
  const type = { x: nx + (size.nameW || 0) + COL_GAP, w: size.typeW || 0 }
  const desc = { x: type.x + (size.typeW || 0) + COL_GAP, w: size.descW || 0 }
  return { name, type, desc }
}

export function measureTable(node) {
  const fields = Array.isArray(node && node.fields) ? node.fields : []
  let nameW = 0
  let typeW = 0
  let descW = 0
  let hasFk = false
  for (const f of fields) {
    if (!f) continue
    nameW = Math.max(nameW, textW(f.name, FONT_12_B))
    typeW = Math.max(typeW, textW(f.type, FONT_12))
    descW = Math.max(descW, textW(describeOf(f), FONT_12))
    if (Array.isArray(f.line) && f.line.length > 0) hasFk = true
  }
  // 可空状态走最左侧 KEY_W 通道（已有固定宽度），不需要额外预留；
  // 只有 type 列存在外键时要为 FK 徽标留位，否则徽标会压住类型文字。
  const name = Math.max(nameW, 56)
  const type = Math.max(typeW, 56) + (hasFk ? BADGE_PAD : 0)
  const desc = Math.max(descW, 72)
  const w = Math.round(PAD_L + KEY_W + COL_GAP + name + COL_GAP + type + COL_GAP + desc + PAD_R)
  const h = Math.round(HEADER_H + fields.length * FIELD_H)
  return { w, h, rows: fields.length, nameW: name, typeW: type, descW: desc }
}

const _sizeCache = new WeakMap()

// 递归取一个图层的所有后代表节点（含中间层 layout）。
// 归属写在节点的 group 字段上，指向 layout 的 name；seen 防 group 环导致死循环
export function membersOf(nodes, layout) {
  const list = Array.isArray(nodes) ? nodes : []
  const out = []
  const seen = new Set()
  const walk = (groupName) => {
    for (const n of list) {
      if (!n || n.group !== groupName || seen.has(n)) continue
      seen.add(n)
      out.push(n)
      if (n.type === 'layout') walk(n.name)
    }
  }
  walk(layout.name)
  return out
}

// 图层的几何完全由成员并集派生。x 取成员最小 x 减内边距（框左侧紧贴成员）；
// y 取成员最小 y 减去标签条高度与内边距——顶部要容下标签条（LABEL_H），
// 否则成员表头会落进标签条里、文字重叠。底部只需 PAD_INNER。
// w/h 取成员并集 + 内边距；空图层无成员，落到 (0,0) + 最小尺寸。
// 成员被拖出就缩回、被拖进就撑开（PS 分组语义）；框永远跟着成员走，不被用户直接拖动。
export function layoutBounds(nodes, layout) {
  const mem = membersOf(nodes, layout)
  if (!mem.length) return { x: 0, y: 0, w: MIN_LAYOUT_W, h: MIN_LAYOUT_H }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const m of mem) {
    const s = sizeOf(m, nodes)
    minX = Math.min(minX, m.x)
    minY = Math.min(minY, m.y)
    maxX = Math.max(maxX, m.x + s.w)
    maxY = Math.max(maxY, m.y + s.h)
  }
  return {
    x: minX - PAD_INNER,
    y: minY - LABEL_H - PAD_INNER,
    w: Math.max(MIN_LAYOUT_W, maxX - minX + PAD_INNER * 2),
    h: Math.max(MIN_LAYOUT_H, maxY - minY + LABEL_H + PAD_INNER * 2),
  }
}

// 把推导出的几何写回节点，让 renderer / hitTest / edgeBetween 继续只读 n.x/n.y/n.w/n.h。
// 图层 x/y/w/h 全部由成员并集派生：成员拖到哪，框跟到哪。
// 嵌套图层按成员数从小到大写回：外层依赖内层的最终尺寸，
// 内层先确定后外层的并集才是准的，一次遍历即收敛。
// 写回 lay.x/y 后不平移成员：成员绝对坐标不动，框跳到成员旁边是预期行为，
// 下次重算 minX 不变 → 收敛不循环。
export function syncLayoutBounds(nodes) {
  const list = Array.isArray(nodes) ? nodes : []
  for (const n of list) {
    if (n && n.type === 'table') {
      const s = measureTable(n)
      n.w = s.w
      n.h = s.h
    }
  }
  const layouts = list
    .filter((n) => n && n.type === 'layout')
    .sort((a, b) => membersOf(list, a).length - membersOf(list, b).length)
  for (const lay of layouts) {
    const b = layoutBounds(list, lay)
    lay.x = b.x
    lay.y = b.y
    lay.w = b.w
    lay.h = b.h
  }
}

export function sizeOf(node, nodes) {
  if (!node) return { w: 0, h: 0, rows: 0 }
  if (node.type === 'table') {
    // 按字段内容做记忆化：拖拽期间 sizeOf 会被反复调用，避免每次重算 measureText
    const key = (node.fields || [])
      .map((f) => `${f && f.name}|${f && f.type}|${describeOf(f)}`)
      .join('§')
    let hit = _sizeCache.get(node)
    if (!hit || hit.key !== key) {
      hit = { key, size: measureTable(node) }
      _sizeCache.set(node, hit)
    }
    return hit.size
  }
  // layout：syncLayoutBounds 已经把推导结果写回节点，这里直接读
  if (Array.isArray(nodes)) return layoutBounds(nodes, node)
  return { w: node.w || MIN_LAYOUT_W, h: node.h || MIN_LAYOUT_H, rows: 0 }
}

function hex2rgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim())
  if (!m) return null
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

// 纯色加透明度，图层底色要用。已经是 rgba/hsl 之类的写法就原样返回，不破坏用户值
export function withAlpha(color, a) {
  const rgb = hex2rgb(color)
  if (!rgb) return color
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`
}

// 依据背景亮度决定前景色，用户自定义 bgColor 时保证文字始终可读
export function textColorFor(bg) {
  const rgb = hex2rgb(bg)
  if (!rgb) return null
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
  return lum > 0.56 ? '#1f2937' : '#ffffff'
}

// 第 row 行字段在表内的垂直中心；row < 0 表示无行数据，落到整体中心
export function rowCenterY(size, row) {
  if (row == null || row < 0 || row >= (size.rows || 0)) return (size.h || 0) / 2
  return HEADER_H + row * FIELD_H + FIELD_H / 2
}

