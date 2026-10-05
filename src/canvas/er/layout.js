// 自动布局：按字段实测宽度做一行式（shelf）装箱，行满后换行。
// 图层与其成员作为一个整体参与装箱——先把子树排好，再由成员并集推出图层几何。

import { measureTable, membersOf, layoutBounds, sizeOf, PAD_INNER, LABEL_H } from './measure.js'

export class LayoutEngine {
  /**
   * @param opts
   * @param {number} opts.gapX 同一行相邻子树间距，默认 80
   * @param {number} opts.gapY 行间距，默认 80
   * @param {number} opts.margin 画布边距，默认 48
   * @param {number} opts.maxWidth 单行最大宽度，默认 1440
   */
  constructor(opts = {}) {
    const { gapX = 80, gapY = 80, margin = 48, maxWidth = 1440 } = opts
    this.opts = { gapX, gapY, margin, maxWidth }
  }

  // 把整棵子树（含所有后代）平移到 (x, y)：先排好再挪，避免逐层重排
  shiftSubtree(node, x, y, nodes) {
    node.x += x
    node.y += y
    if (node.type !== 'layout') return
    for (const m of membersOf(nodes, node)) this.shiftSubtree(m, x, y, nodes)
  }

  // 把 root 及其后代排好，root 左上角落在 (0,0)；返回整棵子树的占位尺寸
  placeSubtree(root, nodes) {
    const { gapX, gapY, maxWidth } = this.opts
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
    for (const kid of nodes.filter((n) => n && n.group === root.name)) {
      const foot = this.placeSubtree(kid, nodes)
      if (count > 0 && x + foot.w > maxWidth) {
        x = PAD_INNER
        y += rowH + gapY
        rowH = 0
      }
      this.shiftSubtree(kid, x, y, nodes)
      x += foot.w + gapX
      rowH = Math.max(rowH, foot.h)
      count++
    }

    const b = layoutBounds(nodes, root)
    root.x = b.x
    root.y = b.y
    root.w = b.w
    root.h = b.h
    return { w: b.w, h: b.h }
  }

  autoLayout(nodes) {
    const { gapX, gapY, margin, maxWidth } = this.opts
    const list = Array.isArray(nodes) ? nodes : []

    // 只有无 group 的节点参与顶层装箱；有 group 的由所属图层带进来
    const roots = list.filter((n) => n && !n.group)

    let x = margin
    let y = margin
    let rowH = 0
    let count = 0

    for (const n of roots) {
      const foot = this.placeSubtree(n, list)
      if (count > 0 && x + foot.w > margin + maxWidth) {
        x = margin
        y += rowH + gapY
        rowH = 0
      }
      this.shiftSubtree(n, x, y, list)
      x += foot.w + gapX
      rowH = Math.max(rowH, foot.h)
      count++
    }
  }
}

// 兼容旧调用：`autoLayout(nodes, opts)`。
export function autoLayout(nodes, opts = {}) {
  return new LayoutEngine(opts).autoLayout(nodes)
}
