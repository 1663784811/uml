// 画布交互：节点拖拽、背景框选/平移、滚轮缩放、双击聚焦。
// 不直接碰 DOM（除光标），只改 store 状态并调用 store.draw()。

const SNAP = 5

export function createInteractions(store, canvas) {
  let mode = null // 'node' | 'pan' | 'deselect'
  let start = null
  let moved = false

  // 选中的树根：selectionGroup 会把图层展开成整棵子树，
  // 但「谁是拖动的主体」要看 selection 里的节点，成员不算
  function roots() {
    const group = store.selectionGroup()
    const members = new Set(group.filter((n) => store.parentOf(n)))
    return group.filter((n) => !members.has(n))
  }

  // 松手时算不算「放进图层」：拖动主体的中心落在某个顶层图层内，且目标不是被拖动者自己的后代
  function dropTarget() {
    const r = roots()
    if (!r.length) return null
    let cx = 0
    let cy = 0
    for (const n of r) {
      cx += n.x + n.w / 2
      cy += n.y + n.h / 2
    }
    cx /= r.length
    cy /= r.length
    for (let i = store.nodes.length - 1; i >= 0; i--) {
      const n = store.nodes[i]
      if (n.type !== 'layout' || n.parent) continue
      if (r.includes(n) || store.subtreeOf(n).some((x) => r.includes(x))) continue
      if (cx >= n.x && cx <= n.x + n.w && cy >= n.y && cy <= n.y + n.h) return n
    }
    return null
  }

  function onPointerDown(e) {
    // 右键拖 = 平移画布，与命中什么无关（画布工具惯例）
    if (e.button === 2) {
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      moved = false
      start = { cx: e.clientX, cy: e.clientY, pan: { ...store.pan } }
      mode = 'pan'
      canvas.style.cursor = 'grabbing'
      return
    }
    if (e.button !== 0) return
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // 合成事件或某些浏览器下拿不到 pointerId，不影响拖动逻辑本身
    }
    moved = false
    start = { cx: e.clientX, cy: e.clientY, pan: { ...store.pan } }
    const p = store.toWorld(e.clientX, e.clientY)
    start.p = p
    const hit = store.hitTest(p.x, p.y)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey

    if (hit) {
      const node = hit.node
      store.hovered = hit
      mode = 'node'
      if (additive) {
        store.selection.has(node) ? store.select(node, true) : store.selection.delete(node)
      } else if (!store.selection.has(node)) {
        store.select(node, false)
      }
      // 图层带出整棵子树一起走
      const group = store.selectionGroup()
      start.group = new Map(group.map((n) => [n, { x: n.x, y: n.y }]))
      start.hit = node
      store.draw()
      return
    }

    // 左键点空白 = 取消选区（框选已移除；平移走右键）
    mode = 'deselect'
    store.select(null, false)
    store.draw()
  }

  // 光标按命中结果决定：字段行可点、表头/图层框可拖动、空白处可平移。
  // 只在值变化时写 style，pointermove 里每帧都会调
  function setCursor(clientX, clientY) {
    const p = store.toWorld(clientX, clientY)
    const hit = store.hitTest(p.x, p.y)
    const next = hit && hit.row >= 0 ? 'pointer' : hit ? 'move' : 'grab'
    if (canvas.style.cursor !== next) canvas.style.cursor = next
  }

  function onPointerMove(e) {
    const r = canvas.getBoundingClientRect()
    store.hoverPos = { x: e.clientX - r.left, y: e.clientY - r.top }

    if (!mode || !start) {
      const p = store.toWorld(e.clientX, e.clientY)
      const hit = store.hitTest(p.x, p.y)
      const next = hit || null
      // 光标要每次都重算：从画布外移入空白时命中值是 null -> null，
      // 只放在 hover 变化的分支里光标就永远不会变成 grab
      setCursor(e.clientX, e.clientY)
      if (store.hovered !== next) {
        store.hovered = next
        store.draw()
      }
      return
    }

    if (!moved && Math.hypot(e.clientX - start.cx, e.clientY - start.cy) > 3) moved = true

    if (mode === 'node') {
      const dx = (e.clientX - start.cx) / store.zoom
      const dy = (e.clientY - start.cy) / store.zoom
      const snap = e.altKey ? SNAP : 0
      for (const [n, o] of start.group) {
        n.x = Math.round((o.x + dx) / (snap || 1)) * (snap || 1)
        n.y = Math.round((o.y + dy) / (snap || 1)) * (snap || 1)
      }
      store.setDropTarget(moved ? dropTarget() : null)
    } else if (mode === 'pan') {
      store.pan.x = start.pan.x + (e.clientX - start.cx)
      store.pan.y = start.pan.y + (e.clientY - start.cy)
      canvas.style.cursor = 'grabbing'
    }
    store.draw()
  }

  // 离开画布时清掉悬停，否则最后一行会一直停在高亮态
  function onPointerLeave() {
    if (mode || start) return
    if (store.hovered) {
      store.hovered = null
      canvas.style.cursor = 'grab'
      store.draw()
    }
  }

  function onPointerUp(e) {
    if (!mode) return
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (mode === 'marquee' && moved && store.marquee) {
      const m = store.marquee
      store.marqueeSelect(m.x, m.y, m.w, m.h)
    } else if (mode === 'node' && moved) {
      // 拖到另一个图层里松手 = 收编；图层尺寸会跟着成员并集重算
      const t = dropTarget()
      if (t) {
        store.nestInto(t, roots())
        store.focusNode(t)
      }
    } else if (mode === 'pan' && !moved) {
      // 空白处点一下（没有拖动）= 取消选区。平移只在 moved 时生效，
      // 所以这里不会误清掉刚刚点选的表
      store.select(null, false)
    } else if (mode === 'node' && !moved) {
      const hit = store.hitTest(store.toWorld(e.clientX, e.clientY).x, store.toWorld(e.clientX, e.clientY).y)
      // 无选区时在图层空白处点一下 = 在这个图层里新建一张表
      if (hit && hit.row < 0 && hit.node.type === 'layout' && !store.selection.has(hit.node)) {
        store.addTable(hit.node)
      }
    }
    store.marquee = null
    store.setDropTarget(null)
    mode = null
    start = null
    setCursor(e.clientX, e.clientY)
    store.draw()
  }

  function onWheel(e) {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * (e.ctrlKey || e.metaKey ? 0.003 : 0.0012))
    store.zoomAt(e.clientX, e.clientY, factor)
  }

  function onDblClick(e) {
    const p = store.toWorld(e.clientX, e.clientY)
    const hit = store.hitTest(p.x, p.y)
    if (hit) {
      store.select(hit.node, false)
      store.focusNode(hit.node)
    }
  }

  function attach() {
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    // passive:false 是必须的：passive 监听器里 preventDefault 会被忽略，页面会跟着滚
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDblClick)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  function detach() {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('dblclick', onDblClick)
  }

  return { attach, detach }
}
