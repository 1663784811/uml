// 纯绘制：只读传入的状态对象，不持有状态、不依赖 store 实例。
// 拖拽、缩放等每一次变更都会调用 Renderer.draw()。

import { edgeBetween } from './geometry.js'
import {
  THEME,
  FONT_12,
  FONT_12_B,
  FONT_10_B,
  HEADER_H,
  FIELD_H,
  KEY_W,
  COL_GAP,
  BADGE_W,
  BADGE_H,
  PORT_R,
  PAD_L,
  PAD_R,
  RADIUS,
  LABEL_H,
  MIN_LAYOUT_W,
  MIN_LAYOUT_H,
  columns,
  describeOf,
  ellipsize,
  textW,
  sizeOf,
  textColorFor,
  withAlpha,
  portX,
  portY,
} from './measure.js'

// 表头描述的最小可用宽度（约 3 个汉字）：小于此值就整段省略
const MIN_DESC_W = 36
// 拖线时控制点的最低伸出量，和 geometry.edgeBetween 里的保持一致
const MIN_REACH = 40
// 端口描边宽度：空心端口和连线同粗时读起来像线的一部分
const PORT_STROKE_W = 2
// 连线线宽：1.5px 在端口圆点上读不出来，粗到能压住圆点才看得出方向
const EDGE_W = 2.4
const EDGE_W_HOVER = 3
const EDGE_W_SEL = 2.8

/**
 * 一条 FK 连线：从 from 表的某字段行指向 to 表的某字段行。
 * 由 Renderer 从字段的 line 数组派生，不作为持久数据。
 * color 取自该条 line 自身，独立于其它 line。
 */
export class Edge {
  constructor(from, to, color, fromSize, toSize, fromRow, toRow, avoid) {
    this.from = from
    this.to = to
    this.color = color
    this.fromSize = fromSize
    this.toSize = toSize
    this.fromRow = fromRow
    this.toRow = toRow
    // 想绕开的其它表（矩形列表）；edgeBetween 用它挑一个穿过最少的偏移
    this.avoid = avoid || null
    // 悬停高亮：由 render 阶段填入
    this.aHovered = false
    this.bHovered = false
  }
}

export class Renderer {
  /**
   * @param ctx Canvas 2D 上下文
   */
  constructor(ctx) {
    this.ctx = ctx
  }

  /**
   * 画一帧
   * @param state {dpr, pan:{x,y}, zoom, selection:Set, hovered, dropTarget, nodes:[]}
   * @param cssW 视口 CSS 宽度
   * @param cssH 视口 CSS 高度
   */
  draw(state, cssW, cssH) {
    const { dpr, pan, zoom, selection, hovered, dropTarget, linkSource, linkCursor, nodes } = state
    const ctx = this.ctx

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = THEME.bg
    ctx.fillRect(0, 0, cssW, cssH)

    // 坐标网格：屏幕坐标下固定间距，随 pan 平移。必须在下面的 translate/scale
    // 之前画，否则坐标会被二次变换，导致虚线偏移、铺不满画布。
    this.drawGrid(pan, cssW, cssH)

    ctx.save()
    ctx.translate(pan.x, pan.y)
    ctx.scale(zoom, zoom)

    const byName = new Map(nodes.map((n) => [n.name, n]))
    const idx = new Map(nodes.map((n, i) => [n, i]))
    const key = (n, i) => `${idx.get(n)}:${i}`

    // 一条连线的端点：起点是 FK 字段行，终点是它指向的字段行。
    // 一个字段可引出多条线（line 数组），每条各自成一条 Edge，颜色独立。
    const edges = []
    // 连线想绕开的不相关表：除两端节点之外的所有 table。edgeBetween 会在若干
    // 垂直偏移里挑一个让曲线穿过这些表体最少的偏移（优先 0 穿，退而取最少）。
    // 端点节点本身不算障碍——线必须从它出。端点行的表头/其它行的表体
    // 在几何上也算穿过，但那只是同表内部的路径，绕开没意义也没用
    const obstacleRects = nodes.filter((n) => n.type === 'table').map((n) => {
      const s = sizeOf(n)
      return { x: n.x, y: n.y, w: s.w, h: s.h, node: n }
    })
    for (const n of nodes) {
      if (n.type !== 'table') continue
      const fields = n.fields || []
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i]
        const lines = Array.isArray(f && f.line) ? f.line : []
        for (const ln of lines) {
          if (!ln || !ln.table) continue
          const t = byName.get(ln.table)
          if (!t) continue
          const tr = ln.field
            ? (t.fields || []).findIndex((x) => x && x.name === ln.field)
            : -1
          edges.push(new Edge(n, t, ln.color || null, sizeOf(n), sizeOf(t), i, tr, obstacleRects))
        }
      }
    }

    // 悬停字段时它对应的连线一起高亮：悬停在 FK 行或它的目标行上都算。
    // 行号是表内局部索引，key 必须带节点，否则两个表的第 i 行会互相误命中。
    // FK 行可引出多条线，目标行也高亮；反向：悬停在目标行时，所有指向它的 FK 行也高亮
    const hvKey = new Set()
    if (hovered && hovered.row >= 0) {
      hvKey.add(key(hovered.node, hovered.row))
      const f = (hovered.node.fields || [])[hovered.row]
      const lines = Array.isArray(f && f.line) ? f.line : []
      for (const ln of lines) {
        if (!ln || !ln.table) continue
        const t = byName.get(ln.table)
        const tr = t && ln.field
          ? (t.fields || []).findIndex((x) => x && x.name === ln.field)
          : -1
        if (tr >= 0) hvKey.add(key(t, tr))
      }
      // 反向：悬停在目标行时，把所有指向该行（同表同字段名）的 FK 行也标上
      for (const n of nodes) {
        if (n.type !== 'table') continue
        const fs = n.fields || []
        for (let i = 0; i < fs.length; i++) {
          const ls = Array.isArray(fs[i] && fs[i].line) ? fs[i].line : []
          for (const ln of ls) {
            if (!ln || ln.table !== hovered.node.name) continue
            if (ln.field && fs[i] && hovered.node.fields) {
              const hi = hovered.node.fields.findIndex((x) => x && x.name === ln.field)
              if (hi === hovered.row) hvKey.add(key(n, i))
            }
          }
        }
      }
    }
    for (const e of edges) {
      e.aHovered = hvKey.has(key(e.from, e.fromRow))
      e.bHovered = e.toRow >= 0 && hvKey.has(key(e.to, e.toRow))
    }

    // 有连线的字段行 -> 这条线解析后的颜色。端口画成实心并取这个颜色，
    // 一眼能看出线从哪个圆点长出来。目标行同样算。
    // 颜色必须和 drawEdge 用同一套规则算，否则悬停/选中时线变色而端口不变，
    // 会看到颜色接缝
    const connected = new Map()
    for (const e of edges) {
      const hot = e.aHovered || e.bHovered
      const color = hot ? THEME.fieldHoverLine
        : selection.has(e.from) || selection.has(e.to) ? THEME.selection
        : e.color || THEME.edge
      for (const [node, row] of [[e.from, e.fromRow], [e.to, e.toRow]]) {
        if (row == null || row < 0) continue
        let m = connected.get(node)
        if (!m) connected.set(node, m = new Map())
        m.set(row, color)
      }
    }

    // 五层：图层底 → 表 → 连线 → 端口 → 图层框。
    // 图层盒比成员表大，如果按数组顺序一趟画，排在后面的图层会盖住表；
    // 拆成层后表永远在填充之上、虚线框永远可见，成员拖到框外框线也不会断。
    // 连线要画在表之后：端点在表体两侧的圆点上，压不到表体上才看得出线的起点。
    // 端口要画在连线之后：圆点压在端点正上方，线像从圆点后面长出来，
    // 悬停/选中让线变色时也不会把圆点涂花
    for (const n of nodes) if (n.type === 'layout') this.drawLayoutFill(n, selection.has(n))

    for (const n of nodes) {
      if (n.type !== 'table') continue
      const hv = hovered && hovered.node === n ? hovered.row : null
      this.drawTable(n, sizeOf(n), selection.has(n), hv != null, hv)
    }

    for (const e of edges) {
      this.drawEdge(e, selection.has(e.from), selection.has(e.to))
    }

    for (const n of nodes) {
      if (n.type !== 'table') continue
      this.drawPorts(n, sizeOf(n), connected.get(n))
    }

    for (const n of nodes) if (n.type === 'layout') this.drawLayout(n, selection.has(n), n === dropTarget)

    if (dropTarget) this.drawDropHint(dropTarget)

    // 拖线：画在图层框之上，用户才看得到拖到哪里；必须在 restore 之前，
    // 因为 drawLinkDrag 用 portX/portY 算的世界坐标，restore 之后就退到 dpr 空间了
    if (linkSource) this.drawLinkDrag(linkSource, linkCursor, nodes)

    ctx.restore()

    this.drawLegend(cssW, cssH)
  }

  // 坐标网格：屏幕坐标下固定间距，与 zoom 无关。缩放时密度不变，
  // pan 时跟随平移，方便定位节点。主轴虚线 100px，次轴点阵 20px。
  // 起点用 ((pan % step) + step) % step 处理负数偏移，保证第一根线从视口内开始。
  drawGrid(pan, cssW, cssH) {
    const ctx = this.ctx
    const step = THEME.gridStep
    const major = 100

    // 主轴虚线
    const sxm = ((pan.x % major) + major) % major
    const sym = ((pan.y % major) + major) % major
    ctx.save()
    ctx.strokeStyle = '#c7cfda'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    for (let x = sxm; x <= cssW; x += major) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssH)
    }
    for (let y = sym; y <= cssH; y += major) {
      ctx.moveTo(0, y)
      ctx.lineTo(cssW, y)
    }
    ctx.stroke()
    ctx.restore()

    // 次轴点阵
    const sx = ((pan.x % step) + step) % step
    const sy = ((pan.y % step) + step) % step
    ctx.fillStyle = THEME.gridDot
    for (let x = sx; x < cssW; x += step) {
      for (let y = sy; y < cssH; y += step) {
        ctx.fillRect(x, y, 1.5, 1.5)
      }
    }
  }

  drawEdge(e, aSel, bSel) {
    const ctx = this.ctx
    const { p0, c1, c2, p1 } = edgeBetween(e.from, e.fromSize, e.to, e.toSize, e.fromRow, e.toRow, e.avoid)
    // 关联行悬停优先于选中色：选中用琥珀，悬停用主题蓝，两者不同色才分得清
    const hot = e.aHovered || e.bHovered
    const color = hot ? THEME.fieldHoverLine : aSel || bSel ? THEME.selection : e.color || THEME.edge

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = hot ? EDGE_W_HOVER : aSel || bSel ? EDGE_W_SEL : EDGE_W
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(p0[0], p0[1])
    ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p1[0], p1[1])
    ctx.stroke()
    // 方向性靠两端的端口圆点区分：FK 源端（p0）实心，目标端（p1）空心。
    // 端口层由 drawPorts 画，这里不再画鸦爪/箭头
    ctx.restore()
  }

  drawTable(n, s, isSel, isHovered, hoverRow) {
    const ctx = this.ctx
    const { x, y } = n
    const fields = n.fields || []
    const cols = columns(s)
    const r = RADIUS.table

    // 阴影单独画：fill 圆角路径即可得到圆角阴影
    if (isSel) {
      ctx.save()
      ctx.shadowColor = 'rgba(245,158,11,0.45)'
      ctx.shadowBlur = 14
      ctx.fillStyle = THEME.tableBg
      this.roundRect(x, y, s.w, s.h, r)
      ctx.fill()
      ctx.restore()
    } else {
      ctx.fillStyle = THEME.tableBg
      this.roundRect(x, y, s.w, s.h, r)
      ctx.fill()
    }

    // 表头、斑马行、可空列都靠裁剪才不会漏出圆角
    ctx.save()
    this.clipRounded(x, y, s.w, s.h, r)

    // 表头：优先用户配色，未给 fontColor 时按背景亮度自动选黑白
    const headerBg = n.bgColor || THEME.headerBg
    const headerFg = n.fontColor || textColorFor(headerBg) || THEME.headerText
    ctx.fillStyle = headerBg
    ctx.fillRect(x, y, s.w, HEADER_H)
    // 名称与描述同一行：名称是表标识优先完整显示，描述吃剩余宽度。
    // 剩余不足 MIN_DESC_W 就整段省略，别只剩一串省略号
    const avail = s.w - PAD_L - PAD_R - 36
    const midY = y + HEADER_H / 2
    ctx.fillStyle = headerFg
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = FONT_12_B
    const nameW = textW(n.name, FONT_12_B)
    const nameTxt = nameW <= avail ? n.name : ellipsize(n.name, avail, FONT_12_B)
    const nameDispW = textW(nameTxt, FONT_12_B)
    ctx.fillText(nameTxt, x + PAD_L, midY)
    const descAvail = avail - nameDispW - 8
    if (n.describe && descAvail >= MIN_DESC_W) {
      ctx.font = FONT_12
      ctx.globalAlpha = 0.72
      ctx.fillText(ellipsize(n.describe, descAvail, FONT_12), x + PAD_L + nameDispW + 8, midY)
      ctx.globalAlpha = 1
    }
    ctx.font = FONT_10_B
    ctx.textAlign = 'right'
    ctx.fillText(`${fields.length}`, x + s.w - PAD_R, midY)

    // 字段行
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] || {}
      const fy = y + HEADER_H + i * FIELD_H
      const cy = fy + FIELD_H / 2
      const isHv = i === hoverRow

      if (i % 2 === 1) {
        ctx.fillStyle = THEME.rowAlt
        ctx.fillRect(x, fy, s.w, FIELD_H)
      }
      // 最左窄列：可空标记。用中性灰，不用主键惯用的琥珀色（数据里没有主键）
      if (f.nullable) {
        ctx.fillStyle = THEME.nullKeyBg
        ctx.fillRect(x, fy, KEY_W, FIELD_H)
      }
      // 悬停底色压在最上层，整行同一底色；文字随后重画，保证清晰
      if (isHv) {
        ctx.fillStyle = THEME.fieldHover
        ctx.fillRect(x, fy, s.w, FIELD_H)
        ctx.fillStyle = THEME.fieldHoverLine
        ctx.fillRect(x, fy, 3, FIELD_H)
      }
      if (f.nullable) {
        ctx.fillStyle = THEME.nullTag
        ctx.font = FONT_10_B
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('N', x + KEY_W / 2, cy + 0.5)
      }

      const nx = x + cols.name.x
      const tx = x + cols.type.x
      const dx = x + cols.desc.x

      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = FONT_12_B
      ctx.fillStyle = isHv ? THEME.fieldHoverText : THEME.text
      ctx.fillText(ellipsize(f.name, cols.name.w - 1, FONT_12_B), nx, cy)

      ctx.font = FONT_12
      ctx.fillStyle = isHv ? THEME.fieldHoverType : THEME.type
      // 外键徽标靠 type 列右端对齐，所以有徽标时文字宽度要让出 BADGE_PAD
      const hasFk = Array.isArray(f.line) && f.line.length > 0
      const typeW = hasFk ? cols.type.w - BADGE_W - 6 : cols.type.w
      ctx.fillText(ellipsize(f.type, typeW - 1, FONT_12), tx, cy)

      ctx.fillStyle = isHv ? THEME.fieldHoverText : THEME.text
      ctx.fillText(ellipsize(describeOf(f), cols.desc.w, FONT_12), dx, cy)

      if (hasFk) this.drawBadge(tx + cols.type.w - BADGE_W, cy, 'FK')
    }
    ctx.restore()

    // 边框最后画，压在裁剪内容之上
    ctx.strokeStyle = isSel ? THEME.selection : isHovered ? '#6c8caf' : THEME.tableBorder
    ctx.lineWidth = isSel ? 2 : 1
    this.roundRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, s.w - ctx.lineWidth, s.h - ctx.lineWidth, r)
    ctx.stroke()
  }

  // 每个字段行在左右两边各一个圆点。行中心与连线端点共用 portY/portX，
  // 所以这里画出来的点正好是 geometry 里那条线的锚点
  drawPorts(n, s, ports) {
    const rows = s.rows || 0
    if (!rows) return
    for (let i = 0; i < rows; i++) {
      const cy = portY(n, s, i)
      this.drawPort(portX(n, s, i, false), cy, ports && ports.get(i))
      this.drawPort(portX(n, s, i, true), cy, ports && ports.get(i))
    }
  }

  // 有连线的端口实心，颜色取那条线的颜色，明显更大：实心 = 这条线长在这里。
  // 没有连线的空心，描边加粗——1.5px 的圈和连线一样细，会显得又小又飘。
  // 实心额外描一圈白色，把它从连线里抠出来，不然颜色相同就看不出口径
  drawPort(cx, cy, color) {
    const ctx = this.ctx
    const rad = color ? PORT_R + 2.5 : PORT_R
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fillStyle = color || THEME.port
    ctx.fill()
    ctx.strokeStyle = color ? THEME.port : THEME.portStroke
    ctx.lineWidth = PORT_STROKE_W
    ctx.stroke()
  }

  // 拖一条新连线时的辅助渲染：虚线从源端口弯到光标，命中到的目标行
  // 用高亮条 + 实心端口提示「松手就接上这一格」。光标本身不命中端口时
  // 也能落在表体任意字段行上（interaction 用 hitTest 兜底）。
  // 目标行按 nodes 数组逆序找，后画的表（图层里的成员）优先。
  drawLinkDrag(src, cursor, nodes) {
    const ctx = this.ctx
    if (!src || !src.node) return
    const sn = src.node
    const ss = sizeOf(sn)
    const sx = portX(sn, ss, src.row, src.side)
    const sy = portY(sn, ss, src.row)

    if (!cursor) return

    // 命中目标行：先试端口（拖到圆点上），再退回表体
    let target = null
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (n.type !== 'table') continue
      const s2 = sizeOf(n)
      if (cursor.x < n.x || cursor.x > n.x + s2.w) continue
      if (cursor.y < n.y || cursor.y > n.y + s2.h) continue
      const row = Math.floor((cursor.y - n.y - HEADER_H) / FIELD_H)
      if (row < 0 || row >= (s2.rows || 0)) continue
      target = { node: n, row, size: s2 }
      break
    }

    // 终点吸附：命中目标行就把线收到那个端口圆心上，光标只是示意
    const tx = target
      ? portX(target.node, target.size, target.row, cursor.x < sx)
      : cursor.x
    const ty = target
      ? portY(target.node, target.size, target.row)
      : cursor.y

    const dx = tx - sx
    const reach = Math.max(MIN_REACH, Math.abs(dx) / 2)
    const s = dx >= 0 ? 1 : -1

    ctx.save()
    ctx.strokeStyle = THEME.fieldHoverLine
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.bezierCurveTo(sx + s * reach, sy, tx - s * reach, ty, tx, ty)
    ctx.stroke()
    ctx.setLineDash([])

    // 命中目标行：整行底色 + 两端都画出实心端口，暗示「松手就接上」
    if (target) {
      const n = target.node
      const s2 = target.size
      const fy = n.y + HEADER_H + target.row * FIELD_H
      ctx.fillStyle = THEME.fieldHover
      ctx.fillRect(n.x, fy, s2.w, FIELD_H)
      ctx.fillStyle = THEME.fieldHoverLine
      ctx.fillRect(n.x, fy, 3, FIELD_H)
      this.drawPort(portX(n, s2, target.row, cursor.x < sx), ty, THEME.fieldHoverLine)
    }
    this.drawPort(sx, sy, THEME.fieldHoverLine)
    ctx.restore()
  }

  drawBadge(x, cy, label) {
    const ctx = this.ctx
    ctx.fillStyle = THEME.fkBg
    this.roundRect(x, cy - BADGE_H / 2, BADGE_W, BADGE_H, RADIUS.badge)
    ctx.fill()
    ctx.fillStyle = THEME.fk
    ctx.font = FONT_10_B
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + BADGE_W / 2, cy + 0.5)
  }

  // 图层的填充层：压在成员表之下。标签条单独填一遍，让虚线框压在上面不断
  drawLayoutFill(n, isSel) {
    const ctx = this.ctx
    const { x, y } = n
    const w = n.w || MIN_LAYOUT_W
    const h = n.h || MIN_LAYOUT_H

    ctx.fillStyle = n.bgColor ? withAlpha(n.bgColor, 0.1) : THEME.layoutFill
    this.roundRect(x, y, w, h, RADIUS.layout)
    ctx.fill()

    // 标签条底色：有配色时跟着走，没有就用中性灰
    ctx.fillStyle = n.bgColor ? withAlpha(n.bgColor, 0.14) : 'rgba(148,163,184,0.1)'
    this.roundRect(x, y, w, LABEL_H, RADIUS.layout)
    ctx.fill()
    // 左侧色条：标签与框体的分界，有配色时用它当视觉锚点
    ctx.fillStyle = n.bgColor || THEME.layoutBorder
    ctx.fillRect(x + 6, y + 9, 3, LABEL_H - 18)
  }

  // 图层的描边与标签层：压在成员表之上，保证虚线框始终可见
  drawLayout(n, isSel, isDrop) {
    const ctx = this.ctx
    const { x, y } = n
    const w = n.w || MIN_LAYOUT_W
    const h = n.h || MIN_LAYOUT_H

    ctx.setLineDash([6, 5])
    ctx.strokeStyle = isDrop ? THEME.fieldHoverLine : isSel ? THEME.selection : THEME.layoutBorder
    ctx.lineWidth = isDrop || isSel ? 2 : 1
    this.roundRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, RADIUS.layout)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = FONT_12_B
    ctx.fillStyle = n.fontColor || THEME.layoutBorder
    ctx.fillText(`▢ ${n.name}`, x + 16, y + 9)
    ctx.font = FONT_12
    ctx.fillStyle = 'rgba(100,116,139,1)'
    ctx.fillText(ellipsize(n.describe, w - 30, FONT_12), x + 16, y + 29)
  }

  // 放置中：实线框 + 提示文字，明确「松手就收进来」
  drawDropHint(n) {
    const ctx = this.ctx
    const { x, y } = n
    const w = n.w || MIN_LAYOUT_W
    const h = n.h || MIN_LAYOUT_H

    ctx.strokeStyle = THEME.fieldHoverLine
    ctx.lineWidth = 2.5
    this.roundRect(x + 1, y + 1, w - 2, h - 2, RADIUS.layout)
    ctx.stroke()

    ctx.fillStyle = 'rgba(29,78,216,0.1)'
    this.roundRect(x, y, w, h, RADIUS.layout)
    ctx.fill()

    const label = '放入此分组'
    ctx.font = FONT_10_B
    const tw = textW(label, FONT_10_B)
    const bx = x + w / 2 - tw / 2 - 8
    const by = y + h - 30
    ctx.fillStyle = THEME.fieldHoverLine
    this.roundRect(bx, by, tw + 16, 22, RADIUS.legend)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + w / 2, by + 11.5)
  }

  drawLegend(cssW, cssH) {
    const ctx = this.ctx
    const items = [
      ['N', '可空', THEME.nullTagBg, THEME.nullTag],
      ['FK', '外键', THEME.fkBg, THEME.fk],
    ]
    ctx.save()
    ctx.font = FONT_12
    let w = 0
    for (const [, label] of items) w += textW(label, FONT_12) + 44
    const bx = cssW - w - 12
    const by = cssH - 26

    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.strokeStyle = THEME.rowLine
    ctx.lineWidth = 1
    this.roundRect(bx - 6, by - 4, w, 22, RADIUS.legend)
    ctx.fill()
    ctx.stroke()

    let cx = bx
    for (const [tag, label, bg, color] of items) {
      ctx.fillStyle = bg
      this.roundRect(cx, by + 2, BADGE_W, BADGE_H, RADIUS.badge)
      ctx.fill()
      ctx.fillStyle = color
      ctx.font = FONT_10_B
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(tag, cx + BADGE_W / 2, by + 9.5)
      ctx.font = FONT_12
      ctx.fillStyle = THEME.text
      ctx.textAlign = 'left'
      ctx.fillText(label, cx + 32, by + 9.5)
      cx += textW(label, FONT_12) + 44
    }
    ctx.restore()
  }

  // 圆角路径 + 裁剪。表内的表头、斑马行、可空列都靠它不会漏出圆角；
  // 用 clip 而不是逐块画圆角矩形，是因为斑马行要跨整宽、底色要铺满。
  clipRounded(x, y, w, h, r) {
    this.roundRect(x, y, w, h, r)
    this.ctx.clip()
  }

  // 只描边不裁剪，用于填充与最外层边框
  roundRect(x, y, w, h, r) {
    const ctx = this.ctx
    r = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
}

// 兼容旧调用：`drawScene(state, ctx, w, h)`。
// 唯一调用方是 store 的 draw()，未来可直接改用 new Renderer(ctx).draw(...)。
export function drawScene(state, ctx, cssW, cssH) {
  return new Renderer(ctx).draw(state, cssW, cssH)
}
