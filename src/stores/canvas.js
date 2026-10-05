// 画布状态：节点数据、选区、视图变换（平移/缩放）。
// 布局与渲染逻辑放在 ../canvas/er 下，store 只负责状态与编排。
// 分组（内部仍叫 layout）归属写在节点的 parent 字段上（指向所属 layout 的 name），
// 同一父级下数组顺序即层级次序；所有结构改动都走「拆成树 -> 改树 -> rewrite 写回」，
// 保证 parent 与数组顺序不打架。

import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { autoLayout } from '../canvas/er/layout.js'
import {
  sizeOf, HEADER_H, FIELD_H, PAD_INNER, LABEL_H, MIN_LAYOUT_W, MIN_LAYOUT_H,
  membersOf, syncLayoutBounds,
} from '../canvas/er/measure.js'
import { drawScene } from '../canvas/er/renderer.js'

const PAD_X = 24
const PAD_Y = 20
const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.5

export const useCanvasStore = defineStore('canvas', () => {
  const nodes = reactive([])
  const selection = reactive(new Set())
  const hovered = ref(null)
  // 指针相对 stage 的位置，用于悬停浮层定位
  const hoverPos = ref({ x: 0, y: 0 })
  const marquee = ref(null)
  // 隐藏的节点：用 Set 而不是给节点加字段，保证 serialize 导出的数据与输入同构
  const hidden = reactive(new Set())
  const pan = reactive({ x: 0, y: 0 })
  const zoom = ref(1)
  const dpr = ref(1)
  const view = reactive({ w: 0, h: 0 })

  // 放置中的目标图层（渲染层把它的边框画成实线，提示「松手就收进来」）
  let dropTarget = null

  // 绘制句柄不进 store 响应式状态：它们不是数据
  let ctx = null
  let canvasEl = null
  let ro = null
  // 视口未就绪时待补跑的初始视图：首次挂载时容器可能还没有高度。
  // 存函数而不是布尔，因为初始视图（100% 居中）和「适应」是两种不同算法。
  // 只由 syncSize 消费一次，之后清空——窗口缩放不该把画布拉回居中。
  let pendingFit = null

  function clear() {
    nodes.length = 0
    selection.clear()
    hovered.value = null
    marquee.value = null
    hidden.clear()
  }

  // ---------- 图层树 ----------

  // 可见节点。renderer 只收到可见节点，外键连线由它派生所以一并消失。
  // 成员要检查父图层链：隐藏图层后它的成员不该继续渲染
  function visibleNodes() {
    if (!hidden.size) return nodes
    return nodes.filter((n) => !hidden.has(n) && !hasHiddenAncestor(n))
  }

  function hasHiddenAncestor(n) {
    let p = parentOf(n)
    let guard = 0
    while (p && guard++ < 64) {
      if (hidden.has(p)) return true
      p = parentOf(p)
    }
    return false
  }

  // 把节点数组按 parent 拆成顶层列表 + 每个父级下的子节点列表
  function structureOf() {
    const top = []
    const kids = new Map()
    for (const n of nodes) {
      if (!n) continue
      const p = n.parent || null
      if (p == null) top.push(n)
      else {
        let l = kids.get(p)
        if (!l) kids.set(p, (l = []))
        l.push(n)
      }
    }
    return { top, kids }
  }

  // 深度优先写回：图层排在自己成员之前，成员永远画在所属图层框之上
  function rewrite(top, kids) {
    const out = []
    const seen = new Set()
    const walk = (list) => {
      for (const n of list) {
        if (!n || seen.has(n)) continue
        seen.add(n)
        out.push(n)
        if (n.type === 'layout') walk(kids.get(n.name) || [])
      }
    }
    walk(top)
    // parent 指向已不存在的图层时兜底，否则节点会从画布上消失
    for (const n of nodes) if (!seen.has(n)) { seen.add(n); out.push(n) }
    for (let i = 0; i < out.length; i++) nodes[i] = out[i]
    nodes.length = out.length
  }

  // 节点及其全部后代（含自身）；非图层只有自己
  function subtreeOf(node) {
    const out = [node]
    const seen = new Set(out)
    const stack = node.type === 'layout' ? nodes.filter((n) => n && n.parent === node.name) : []
    while (stack.length) {
      const n = stack.pop()
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
      if (n.type === 'layout') {
        for (const c of nodes.filter((x) => x && x.parent === n.name)) stack.push(c)
      }
    }
    return out
  }

  function inSubtree(node, items) {
    return subtreeOf(node).some((n) => items.includes(n))
  }

  function memberCount(node) {
    return node && node.type === 'layout' ? membersOf(nodes, node).length : 0
  }

  // 拖动用的选区：图层展开成整棵子树，成员跟着一起走
  function selectionGroup() {
    const out = []
    const seen = new Set()
    for (const n of nodes) {
      if (!selection.has(n)) continue
      for (const m of subtreeOf(n)) {
        if (seen.has(m)) continue
        seen.add(m)
        out.push(m)
      }
    }
    return out
  }

  // 父级：只认显式的 parent 字段。
  // 不按包围关系兜底：拖表进图层时表还没改 parent，几何判定会让它「看起来是成员」，
  // selectionGroup/roots 就把拖拽主体当成别人的成员，dropTarget 永远返回 null
  function parentOf(node) {
    if (!node || !node.parent) return null
    return nodes.find((n) => n.name === node.parent) || null
  }

  /**
   * 载入数据（数组格式，见 数据加载格式.md）。
   * @param data 节点数组
   * @param {object} opts
   * @param {boolean} opts.layout 是否按字段实测尺寸重新自动排布，默认 true
   * @param {boolean} opts.fit 铺满视口；默认 false，只按 100% 居中
   */
  function load(data, opts = {}) {
    clear()
    const raw = Array.isArray(data) ? data : []
    const list = []
    for (const item of raw) {
      list.push(
        Array.isArray(item && item.fields)
          ? { ...item, fields: item.fields.map((f) => ({ ...f })) }
          : { ...item },
      )
    }
    if (opts.layout !== false) {
      autoLayout(list, { maxWidth: Math.max(view.w - PAD_X * 2, 600) })
    } else {
      for (const n of list) {
        const s = sizeOf(n)
        n.x = n.x || 0
        n.y = n.y || 0
        n.w = s.w
        n.h = s.h
      }
    }
    // 图层宽高坐标是派生值：按成员并集重算一次，空图层保留数据里给的尺寸
    syncLayoutBounds(list)
    for (const n of list) nodes.push(n)
    if (opts.fit) {
      pendingFit = fitView
      fitView()
    } else {
      // 初始视图：100% + 居中。视口还没就绪时 centerView 会直接返回，
      // 由 syncSize 里的 pendingFit 补跑，否则容器高度为 0 会得到偏心的 pan。
      pendingFit = centerView
      centerView()
    }
    draw()
  }

  // 每次状态变更后调用；上下文或视口未就绪时直接跳过
  function draw() {
    if (!ctx || !view.w || !view.h) return
    // 显式传状态对象：renderer 不感知 store，也避免 this 绑定陷阱
    drawScene(
      {
        dpr: dpr.value,
        pan: { x: pan.x, y: pan.y },
        zoom: zoom.value,
        selection,
        hovered: hovered.value,
        marquee: marquee.value,
        dropTarget,
        nodes: visibleNodes(),
      },
      ctx,
      view.w,
      view.h,
    )
  }

  // 按真实像素尺寸设置画布；返回是否拿到了非零尺寸
  function syncSize(el) {
    if (!canvasEl) return false
    const r = el.getBoundingClientRect()
    const d = window.devicePixelRatio || 1
    const cssW = Math.max(1, Math.round(r.width))
    const cssH = Math.max(1, Math.round(r.height))
    canvasEl.width = Math.round(cssW * d)
    canvasEl.height = Math.round(cssH * d)
    dpr.value = d
    view.w = cssW
    view.h = cssH
    const valid = cssW > 1 && cssH > 1
    if (valid && pendingFit) {
      const run = pendingFit
      pendingFit = null
      run()
    }
    return valid
  }

  function bind(ctx_, el) {
    ctx = ctx_
    canvasEl = ctx_.canvas
    if (ro) ro.disconnect()
    // 同步量一次：ResizeObserver 回调是异步的，不等它的话 load→fitView 拿不到尺寸
    if (syncSize(el)) draw()
    ro = new ResizeObserver(() => {
      if (syncSize(el)) draw()
    })
    ro.observe(el)
  }

  function unbind() {
    if (ro) ro.disconnect()
    ro = null
    ctx = null
    canvasEl = null
    pendingFit = null
  }

  // ---------- 坐标换算与命中 ----------

  function toWorld(clientX, clientY) {
    const r = ctx.canvas.getBoundingClientRect()
    return {
      x: (clientX - r.left - pan.x) / zoom.value,
      y: (clientY - r.top - pan.y) / zoom.value,
    }
  }

  // 从上层往下找，返回 { node, row }：row >= 0 为字段行，-1 为表头或图层框。
  // 隐藏节点点不中
  function hitTest(wx, wy) {
    const vis = visibleNodes()
    for (let i = vis.length - 1; i >= 0; i--) {
      const n = vis[i]
      if (wx < n.x || wx > n.x + n.w || wy < n.y || wy > n.y + n.h) continue
      if (n.type === 'table' && wy > n.y + HEADER_H) {
        const s = sizeOf(n)
        const row = Math.min(s.rows - 1, Math.floor((wy - n.y - HEADER_H) / FIELD_H))
        if (row >= 0 && n.fields && n.fields[row]) return { node: n, row }
      }
      return { node: n, row: -1 }
    }
    return null
  }

  function select(node, additive) {
    if (!additive) selection.clear()
    if (node) selection.add(node)
  }

  function selectMany(list) {
    selection.clear()
    for (const n of list) selection.add(n)
  }

  // 框选：矩形与节点包围盒相交即选中。隐藏节点不参与框选
  function marqueeSelect(x, y, w, h) {
    const x0 = Math.min(x, x + w)
    const y0 = Math.min(y, y + h)
    const x1 = Math.max(x, x + w)
    const y1 = Math.max(y, y + h)
    selectMany(
      visibleNodes().filter((n) => n.x < x1 && n.x + n.w > x0 && n.y < y1 && n.y + n.h > y0),
    )
  }

  function deleteSelected() {
    if (!selection.size) return false
    // 分组（layout）像 PS 里的"取消编组"：只删框本身，成员散到顶层；
    // 表是原子，直接删除。这样分组是纯粹的视觉/组织手段，删它不会误伤内容。
    const drop = new Set()
    for (const n of nodes) {
      if (!selection.has(n)) continue
      if (n.type === 'layout') {
        drop.add(n)
      } else {
        for (const m of subtreeOf(n)) drop.add(m)
      }
    }
    const gone = new Set([...drop].map((n) => n.name))
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (drop.has(nodes[i])) {
        hidden.delete(nodes[i])
        nodes.splice(i, 1)
      }
    }
    // 被删分组的成员不再悬空：接到被删分组的父级下（PS 的删除组语义），
    // 被删的是顶层分组时父级为 null，等于回到顶层
    for (const g of drop) {
      if (g.type !== 'layout') continue
      const p = g.parent || null
      for (const n of nodes) {
        if (n.parent === g.name) n.parent = p
      }
    }
    const { top, kids } = structureOf()
    const prune = (list) => {
      const out = []
      for (const n of list) {
        if (drop.has(n)) continue
        out.push(n)
        if (n.type === 'layout') out.push(...prune(kids.get(n.name) || []))
      }
      return out
    }
    rewrite(prune(top), new Map([...kids.entries()].map(([k, v]) => [k, prune(v)])))
    selection.clear()
    hovered.value = null
    draw()
    return true
  }

  // ---------- 视图变换 ----------

  function zoomAt(clientX, clientY, factor) {
    const next = clampZoom(zoom.value * factor)
    if (next === zoom.value) return
    const p = toWorld(clientX, clientY)
    zoom.value = next
    const r = ctx.canvas.getBoundingClientRect()
    pan.x = clientX - r.left - p.x * next
    pan.y = clientY - r.top - p.y * next
    draw()
  }

  function zoomTo(z) {
    const z1 = clampZoom(z)
    // 以视口中心为锚点，保证中心内容不跳
    const cx = view.w / 2
    const cy = view.h / 2
    const wx = (cx - pan.x) / zoom.value
    const wy = (cy - pan.y) / zoom.value
    zoom.value = z1
    pan.x = cx - wx * z1
    pan.y = cy - wy * z1
    draw()
  }

  function resetView() {
    pan.x = 0
    pan.y = 0
    zoom.value = 1
    draw()
  }

  // 按节点包围盒居中，不缩放。初始视图用它：100% 是默认值，
  // 缩放只留给用户主动操作（滚轮 / 按钮），不该由载入决定。
  function centerView() {
    if (!nodes.length) {
      pendingFit = null
      return
    }
    // 阈值与 fitView 一致：syncSize 会把 0 尺寸 clamp 到 1，
    // 只看真值判断不出「容器还没高度」，会算出偏心的 pan。
    // 必须重新挂上 pendingFit：syncSize 是「先清空再执行」，
    // 若清空后这里因尺寸不足直接返回，补跑机会就永久丢了。
    if (view.w < 200 || view.h < 200) {
      pendingFit = centerView
      return
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.w)
      maxY = Math.max(maxY, n.y + n.h)
    }
    zoom.value = 1
    pan.x = (view.w - (maxX - minX)) / 2 - minX
    pan.y = (view.h - (maxY - minY)) / 2 - minY
    pendingFit = null
  }

  function fitView() {
    // 视口过小（含首次挂载时高度为 0）时不计算：否则会得到负的缩放比再被
    // clamp 到 0.3，用户会看到一个莫名缩小的画布
    if (!nodes.length || view.w < 200 || view.h < 200) {
      pendingFit = fitView
      return
    }
    pendingFit = null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.w)
      maxY = Math.max(maxY, n.y + n.h)
    }
    const bw = maxX - minX
    const bh = maxY - minY
    if (bw <= 0 || bh <= 0) return
    const z = clampZoom(
      Math.min((view.w - PAD_X * 2) / bw, (view.h - PAD_Y * 2) / bh),
    )
    zoom.value = z
    pan.x = (view.w - bw * z) / 2 - minX * z
    pan.y = (view.h - bh * z) / 2 - minY * z
  }

  // 输出可序列化的节点数据（补齐 w/h，字段浅拷贝）
  function serialize() {
    return nodes.map((n) => {
      const s = sizeOf(n)
      const o = { ...n, x: Math.round(n.x), y: Math.round(n.y), w: s.w, h: s.h }
      if (n.type === 'table') o.fields = n.fields.map((f) => ({ ...f }))
      return o
    })
  }

  function clampZoom(z) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
  }

  // ---------- 图层操作 ----------

  // 显隐切换。图层隐藏时整棵子树一起藏：框没了但表还漂在外面会显得很怪
  // 只切节点自身的显隐；可见性由 visibleNodes 按父图层链推导
  function toggleVisible(node) {
    if (hidden.has(node)) hidden.delete(node)
    else {
      hidden.add(node)
      if (hovered.value && hovered.value.node === node) hovered.value = null
    }
    draw()
  }

  // 层级：整棵子树按整体搬，父级内相对次序保持不变
  //   front/back 移到全部节点的最上/最下
  //   forward/backward 在同层内交换相邻一项（跨不过父级边界）
  function moveLayer(node, dir) {
    const i = nodes.indexOf(node)
    if (i < 0) return
    const tree = subtreeOf(node)
    let j
    if (dir === 'front' || dir === 'back') {
      j = dir === 'front' ? nodes.length - tree.length : 0
    } else {
      const k = dir === 'forward' ? i + 1 : i - 1
      if (k < 0 || k >= nodes.length) return
      if ((nodes[k].parent || null) !== (node.parent || null)) return
      // 后移越过的是自己子树里的成员，等于没动
      if (dir === 'forward' && tree.includes(nodes[k])) return
      j = k
    }
    if (j === i || j === i - tree.length + 1) return
    const block = nodes.splice(i, tree.length)
    nodes.splice(j, 0, ...block)
    draw()
  }

  // 在 target 的父级列表里，把 node 插到 target 的 before/after 位置。
  // 跨父级时改 node.parent；不能插到自己后代里（那会构成环）。
  // 面板拖拽重排用：整棵子树作为一个块移动，rewrite 会重新 DFS 写回。
  function reorder(node, target, pos) {
    if (!node || !target || node === target) return false
    if (pos !== 'before' && pos !== 'after') return false
    if (subtreeOf(node).includes(target)) return false
    const newParent = target.parent || null
    if (node.parent !== newParent) node.parent = newParent
    const { top, kids } = structureOf()
    const list = newParent == null ? top : (kids.get(newParent) || [])
    const i = list.indexOf(node)
    if (i < 0) return false
    list.splice(i, 1)
    let j = list.indexOf(target)
    if (j < 0) return false
    if (pos === 'after') j += 1
    list.splice(j, 0, node)
    rewrite(top, kids)
    draw()
    return true
  }

  // 重命名。图层与表共用命名空间，成员靠 parent 字段里的 name 挂过来，
  // 改图层名必须把所有成员的 parent 一起改，否则整棵子树会悬空消失。
  function rename(node, name) {
    if (!node) return false
    const v = String(name || '').trim()
    if (!v || v === node.name) return false
    const old = node.name
    // nextName 从 nodes 取名空间，把自己剔除，否则输入原名会自撞
    const final = nextName(v, nodes.filter((n) => n !== node))
    node.name = final
    for (const n of nodes) if (n.parent === old) n.parent = final
    selection.delete(node)
    selection.add(node)
    draw()
    return true
  }

  // 按节点居中，不改变缩放（不足 100% 时提到 100%）。
  // 从 interaction.js 的双击逻辑提取，双击聚焦与图层面板定位共用
  function focusNode(node) {
    const z = Math.min(2, Math.max(zoom.value, 1))
    zoom.value = z
    pan.x = view.w / 2 - (node.x + node.w / 2) * z
    pan.y = view.h / 2 - (node.y + node.h / 2) * z
    draw()
  }

  // ---------- 增删移动：树的写入操作 ----------

  // 名称唯一化：图层与表共用命名空间，parent 靠 name 匹配，撞名会让成员挂错人
  function nextName(base, list) {
    const taken = new Set((list || nodes).map((n) => n.name))
    const b = String(base || 'untitled')
    if (!taken.has(b)) return b
    let k = 2
    while (taken.has(`${b}_${k}`)) k++
    return `${b}_${k}`
  }

  function countMembers(parent) {
    return parent ? nodes.filter((n) => n.parent === parent.name).length : 0
  }

  // 新建表。放在已有内容下方（图层内则在其内部），避免和已有节点叠在一起
  function addTable(parent, at) {
    const n = { type: 'table', name: nextName('new_table'), fields: [] }
    n.parent = parent && parent.type === 'layout' ? parent.name : null
    const s = sizeOf(n)
    n.w = s.w
    n.h = s.h

    if (n.parent) {
      const sibs = nodes.filter((m) => m.parent === n.parent)
      // 落在最后一个成员的下方，保证连续新增不会重叠
      const y = sibs.length
        ? Math.max(...sibs.map((m) => m.y + (m.h || 0))) + 12
        : parent.y + LABEL_H + PAD_INNER
      n.x = Math.round(parent.x + PAD_INNER)
      n.y = Math.round(y)
    } else if (at) {
      n.x = Math.round(at.x)
      n.y = Math.round(at.y)
    } else {
      // 落在当前视口中心，保证新建后一定看得见
      n.x = Math.round((view.w / 2 - pan.x) / zoom.value - s.w / 2)
      n.y = Math.round((view.h / 2 - pan.y) / zoom.value - s.h / 2)
    }
    nodes.push(n)
    syncLayoutBounds(nodes)
    rewriteOf()
    select(n, false)
    draw()
    return n
  }

  // 新建空图层：空图层保留数据里的 x/y/w/h，不跟着成员并集走
  function addLayout(name) {
    const n = {
      type: 'layout',
      name: nextName(String(name || 'layout')),
      x: Math.round(-pan.x / zoom.value + 60),
      y: Math.round(-pan.y / zoom.value + 60),
      w: MIN_LAYOUT_W,
      h: MIN_LAYOUT_H,
    }
    nodes.push(n)
    rewriteOf()
    select(n, false)
    draw()
    return n
  }

  // 收编进图层：改 parent 指向目标图层，同时把成员平移进目标框内。
  // 不平移的话图层会为了罩住远处的成员撑成大框，整个画布都被吞掉。
  // 收编进图层：改 parent 指向目标图层，同时把成员平移进目标框内。
  // 不平移的话图层会为了罩住远处的成员撑成大框，整个画布都被吞掉。
  function nestInto(target, items) {
    if (!target || target.type !== 'layout' || !items.length) return false
    const self = new Set(subtreeOf(target))
    let changed = false
    const incoming = []
    for (const n of items) {
      if (!n || n === target || self.has(n)) continue
      if (subtreeOf(n).includes(target)) continue // 不能把自己塞进自己的后代
      if (n.parent === target.name) continue
      n.parent = target.name
      changed = true
      incoming.push(n)
    }
    if (!changed) return false
    // 把新进来的项整体平移到目标框左上角附近
    let minX = Infinity
    let minY = Infinity
    for (const n of incoming) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
    }
    if (Number.isFinite(minX)) {
      const dx = target.x + PAD_INNER - minX
      const dy = target.y + PAD_INNER - minY
      for (const n of incoming) {
        n.x += dx
        n.y += dy
      }
    }
    syncLayoutBounds(nodes)
    rewriteOf()
    draw()
    return true
  }

  // 退回顶层：清掉 parent，排到顶层末尾
  function detachToParent(items) {
    if (!items.length) return false
    let changed = false
    for (const n of items) {
      if (!n || n.parent == null) continue
      n.parent = null
      changed = true
    }
    if (!changed) return false
    syncLayoutBounds(nodes)
    rewriteOf()
    draw()
    return true
  }

  // 按当前 parent 关系重排数组
  function rewriteOf() {
    const { top, kids } = structureOf()
    rewrite(top, kids)
  }

  // 由 placement 写入：渲染层据此把目标图层描成实线
  function setDropTarget(n) {
    if (dropTarget === n) return
    dropTarget = n
    draw()
  }

  return {
    nodes,
    selection,
    hovered,
    hoverPos,
    marquee,
    hidden,
    pan,
    zoom,
    dpr,
    view,

    load,
    clear,
    draw,
    bind,
    unbind,
    toWorld,
    hitTest,
    select,
    selectMany,
    marqueeSelect,
    selectionGroup,
    parentOf,
    subtreeOf,
    memberCount,
    deleteSelected,
    toggleVisible,
    moveLayer,
    focusNode,
    addTable,
    addLayout,
    nestInto,
    detachToParent,
    rename,
    reorder,
    setDropTarget,
    syncLayoutBounds,
    zoomAt,
    zoomTo,
    resetView,
    fitView,
    serialize,
  }
})
