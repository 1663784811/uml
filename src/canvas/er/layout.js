// 自动布局：按字段实测宽度做一行式（shelf）装箱，行满后换行。
// 图层与其成员作为一个整体参与装箱——先把子树排好，再由成员并集推出图层几何。

import { measureTable, membersOf, layoutBounds, sizeOf, PAD_INNER, LABEL_H } from './measure.js'

// 把整棵子树（含所有后代）平移到 (x, y)：先排好再挪，避免逐层重排
function shiftSubtree(node, x, y, nodes) {
  node.x += x
  node.y += y
  if (node.type !== 'layout') return
  for (const m of membersOf(nodes, node)) shiftSubtree(m, x, y, nodes)
}

// 把 root 及其后代排好，root 左上角落在 (0,0)；返回整棵子树的占位尺寸
function placeSubtree(root, nodes, opts) {
  const { gapX, maxWidth } = opts
  const gapY = opts.gapY
  const s = sizeOf(root, nodes)
  root.x = 0
  root.y = 0
  if (root.type !== 'layout') {
    return { w: s.w, h: s.h }
  }

  // 成员落在图层内的可用区（标签条下方 + 内边距）
  let x = PAD_INNER
  let y = LABEL_H + PAD_INNER
  let rowH = 0
  let count = 0
  for (const kid of nodes.filter((n) => n && n.parent === root.name)) {
    const foot = placeSubtree(kid, nodes, opts)
    if (count > 0 && x + foot.w > maxWidth) {
      x = PAD_INNER
      y += rowH + gapY
      rowH = 0
    }
    shiftSubtree(kid, x, y, nodes)
    x += foot.w + gapX
    rowH = Math.max(rowH, foot.h)
    count++
  }

  const b = layoutBounds(nodes, root)
  root.w = b.w
  root.h = b.h
  return { w: b.w, h: b.h }
}

export function autoLayout(nodes, opts = {}) {
  const { gapX = 80, gapY = 80, margin = 48, maxWidth = 1440 } = opts
  const list = Array.isArray(nodes) ? nodes : []

  // 只有无 parent 的节点参与顶层装箱；有 parent 的由所属图层带进来
  const roots = list.filter((n) => n && !n.parent)

  let x = margin
  let y = margin
  let rowH = 0
  let count = 0

  for (const n of roots) {
    const foot = placeSubtree(n, list, opts)
    if (count > 0 && x + foot.w > margin + maxWidth) {
      x = margin
      y += rowH + gapY
      rowH = 0
    }
    shiftSubtree(n, x, y, list)
    x += foot.w + gapX
    rowH = Math.max(rowH, foot.h)
    count++
  }
}
