// 画布交互控制器：节点拖拽、背景平移、滚轮缩放、双击聚焦。
// 不直接碰 DOM（除光标），只改 store 状态并调用 store.draw()。

const SNAP = 5

export class InteractionController {
  /**
   * @param store 画布 store（提供 hitTest/toWorld/draw/selection 等 API）
   * @param canvas 绑定交互的 canvas 元素
   */
  constructor(store, canvas) {
    this.store = store
    this.canvas = canvas
    // 拖拽模式：'node' | 'pan' | 'deselect' | null
    this.mode = null
    // 按下瞬间的锚点（屏幕坐标 + pan + 组内起点）
    this.start = null
    // 超过 3px 位移才算「拖动过」，单击与拖动的分支用它区分
    this.moved = false
    // 箭头函数持有 this，直接作为事件处理器：attach/detach 用同一引用
    this._onPointerDown = (e) => this.onPointerDown(e)
    this._onPointerMove = (e) => this.onPointerMove(e)
    this._onPointerUp = (e) => this.onPointerUp(e)
    this._onPointerLeave = () => this.onPointerLeave()
    this._onWheel = (e) => this.onWheel(e)
    this._onDblClick = (e) => this.onDblClick(e)
    this._onContextMenu = (e) => e.preventDefault()
  }

  // 选中的树根：selectionGroup 会把图层展开成整棵子树，
  // 但「谁是拖动的主体」要看 selection 里的节点，成员不算
  roots() {
    const group = this.store.selectionGroup()
    const members = new Set(group.filter((n) => this.store.parentOf(n)))
    return group.filter((n) => !members.has(n))
  }

  // 松手时算不算「放进图层」：拖动主体的中心落在某个顶层图层内，且目标不是被拖动者自己的后代
  dropTarget() {
    const r = this.roots()
    if (!r.length) return null
    let cx = 0
    let cy = 0
    for (const n of r) {
      cx += n.x + n.w / 2
      cy += n.y + n.h / 2
    }
    cx /= r.length
    cy /= r.length
    for (let i = this.store.nodes.length - 1; i >= 0; i--) {
      const n = this.store.nodes[i]
      if (n.type !== 'layout' || n.group) continue
      if (r.includes(n) || this.store.subtreeOf(n).some((x) => r.includes(x))) continue
      if (cx >= n.x && cx <= n.x + n.w && cy >= n.y && cy <= n.y + n.h) return n
    }
    return null
  }

  onPointerDown(e) {
    // 右键拖 = 平移画布，与命中什么无关（画布工具惯例）
    if (e.button === 2) {
      try {
        this.canvas.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      this.moved = false
      this.start = { cx: e.clientX, cy: e.clientY, pan: { ...this.store.pan } }
      this.mode = 'pan'
      this.canvas.style.cursor = 'grabbing'
      return
    }
    if (e.button !== 0) return
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      // 合成事件或某些浏览器下拿不到 pointerId，不影响拖动逻辑本身
    }
    this.moved = false
    this.start = { cx: e.clientX, cy: e.clientY, pan: { ...this.store.pan } }
    const p = this.store.toWorld(e.clientX, e.clientY)
    this.start.p = p
    const hit = this.store.hitTest(p.x, p.y)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey

    if (hit) {
      const node = hit.node
      this.store.hovered = hit
      this.mode = 'node'
      if (additive) {
        this.store.selection.has(node)
          ? this.store.select(node, true)
          : this.store.selection.delete(node)
      } else if (!this.store.selection.has(node)) {
        this.store.select(node, false)
      }
      // 图层带出整棵子树一起走
      const group = this.store.selectionGroup()
      this.start.group = new Map(group.map((n) => [n, { x: n.x, y: n.y }]))
      this.start.hit = node
      this.store.draw()
      return
    }

    // 左键点空白 = 取消选区；平移走右键
    this.mode = 'deselect'
    this.store.select(null, false)
    this.store.draw()
  }

  // 光标按命中结果决定：字段行可点、表头/图层框可拖动、空白处可平移。
  // 只在值变化时写 style，pointermove 里每帧都会调
  setCursor(clientX, clientY) {
    const p = this.store.toWorld(clientX, clientY)
    const hit = this.store.hitTest(p.x, p.y)
    const next = hit && hit.row >= 0 ? 'pointer' : hit ? 'move' : 'grab'
    if (this.canvas.style.cursor !== next) this.canvas.style.cursor = next
  }

  onPointerMove(e) {
    const r = this.canvas.getBoundingClientRect()
    this.store.hoverPos = { x: e.clientX - r.left, y: e.clientY - r.top }

    if (!this.mode || !this.start) {
      const p = this.store.toWorld(e.clientX, e.clientY)
      const hit = this.store.hitTest(p.x, p.y)
      const next = hit || null
      // 光标要每次都重算：从画布外移入空白时命中值是 null -> null，
      // 只放在 hover 变化的分支里光标就永远不会变成 grab
      this.setCursor(e.clientX, e.clientY)
      if (this.store.hovered !== next) {
        this.store.hovered = next
        this.store.draw()
      }
      return
    }

    if (!this.moved && Math.hypot(e.clientX - this.start.cx, e.clientY - this.start.cy) > 3) {
      this.moved = true
    }

    if (this.mode === 'node') {
      const dx = (e.clientX - this.start.cx) / this.store.zoom
      const dy = (e.clientY - this.start.cy) / this.store.zoom
      const snap = e.altKey ? SNAP : 0
      // 跳过 layout 自身：它的 x/y 由 syncLayoutBounds 从成员重算，直接写会被覆盖
      for (const [n, o] of this.start.group) {
        if (n.type === 'layout') continue
        n.x = Math.round((o.x + dx) / (snap || 1)) * (snap || 1)
        n.y = Math.round((o.y + dy) / (snap || 1)) * (snap || 1)
      }
      // 拖动期间实时重算图层框，否则框停在原地视觉断裂
      // 节点路径的 draw 由 syncLayouts/setDropTarget 负责，这里不再补画
      this.store.syncLayouts()
      this.store.setDropTarget(this.moved ? this.dropTarget() : null)
    } else {
      // pan 没有内部 draw，平移后必须自己刷
      this.store.pan.x = this.start.pan.x + (e.clientX - this.start.cx)
      this.store.pan.y = this.start.pan.y + (e.clientY - this.start.cy)
      this.canvas.style.cursor = 'grabbing'
      this.store.draw()
    }
  }

  // 离开画布时清掉悬停，否则最后一行会一直停在高亮态
  onPointerLeave() {
    if (this.mode || this.start) return
    if (this.store.hovered) {
      this.store.hovered = null
      this.canvas.style.cursor = 'grab'
      this.store.draw()
    }
  }

  onPointerUp(e) {
    if (!this.mode) return
    try {
      this.canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (this.mode === 'node' && this.moved) {
      // 拖到另一个图层里松手 = 收编；图层几何会跟着成员并集重算。
      // 不调 focusNode：自动平移/提 zoom 会让画布跳动，破坏放置动作的视觉连续性。
      const t = this.dropTarget()
      if (t) {
        this.store.nestInto(t, this.roots())
      }
    } else if (this.mode === 'pan' && !this.moved) {
      // 空白处点一下（没有拖动）= 取消选区。平移只在 moved 时生效，
      // 所以这里不会误清掉刚刚点选的表
      this.store.select(null, false)
    } else if (this.mode === 'node' && !this.moved) {
      const hit = this.store.hitTest(
        this.store.toWorld(e.clientX, e.clientY).x,
        this.store.toWorld(e.clientX, e.clientY).y,
      )
      // 无选区时在图层空白处点一下 = 在这个图层里新建一张表
      if (hit && hit.row < 0 && hit.node.type === 'layout' && !this.store.selection.has(hit.node)) {
        this.store.addTable(hit.node)
      }
    }
    this.store.setDropTarget(null)
    this.mode = null
    this.start = null
    this.setCursor(e.clientX, e.clientY)
    this.store.draw()
  }

  onWheel(e) {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * (e.ctrlKey || e.metaKey ? 0.003 : 0.0012))
    this.store.zoomAt(e.clientX, e.clientY, factor)
  }

  onDblClick(e) {
    const p = this.store.toWorld(e.clientX, e.clientY)
    const hit = this.store.hitTest(p.x, p.y)
    if (hit) {
      this.store.select(hit.node, false)
      this.store.focusNode(hit.node)
    }
  }

  attach() {
    this.canvas.addEventListener('pointerdown', this._onPointerDown)
    this.canvas.addEventListener('pointermove', this._onPointerMove)
    this.canvas.addEventListener('pointerup', this._onPointerUp)
    this.canvas.addEventListener('pointercancel', this._onPointerUp)
    this.canvas.addEventListener('pointerleave', this._onPointerLeave)
    // passive:false 是必须的：passive 监听器里 preventDefault 会被忽略，页面会跟着滚
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false })
    this.canvas.addEventListener('dblclick', this._onDblClick)
    this.canvas.addEventListener('contextmenu', this._onContextMenu)
  }

  detach() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown)
    this.canvas.removeEventListener('pointermove', this._onPointerMove)
    this.canvas.removeEventListener('pointerup', this._onPointerUp)
    this.canvas.removeEventListener('pointercancel', this._onPointerUp)
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave)
    this.canvas.removeEventListener('wheel', this._onWheel)
    this.canvas.removeEventListener('dblclick', this._onDblClick)
    this.canvas.removeEventListener('contextmenu', this._onContextMenu)
  }
}
