// 图层面板的状态与事件处理：拖拽重排、行内改名、悬停同步、成员计数。
//
// 状态不放在 controller 内部：Vue 的 reactive 代理里 this 绑定不回原对象，
// 所以「controller 拥有 reactive 状态」在 Vue 3 里没有干净的写法。
// 改为 SFC 创建 reactive 对象、把它交给 controller，controller 通过 this.state.xxx
// 直接读写——既保持 OOP（一个类封装所有面板行为），又让模板能直接读 state.dragging
// 触发响应式。

export class LayerPanelController {
  /**
   * @param store 画布 store
   * @param state reactive 对象，形状 { dragging, editing, editText, dropHint }
   */
  constructor(store, state) {
    this.store = store
    this.state = state
  }

  // ---------- 拖拽 ----------

  onDragStart(n, e) {
    this.state.dragging = n
    this.store.select(n, false)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(n.name))
  }

  onDragEnd() {
    this.state.dragging = null
    this.state.dropHint = null
  }

  // 鼠标在行内的相对位置决定落点：前 25% = before，后 25% = after，
  // 中间 50% = into（仅分组有效）。表格行只做 before/after。
  dropPosFor(target, e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    const isGroup = target.type === 'layout'
    if (y < 0.25) return 'before'
    if (y > 0.75) return 'after'
    return isGroup ? 'into' : 'after'
  }

  onRowDragOver(n, e) {
    const d = this.state.dragging
    if (!d || d === n) return
    // 不允许拖到自己后代里
    if (this.store.subtreeOf(d).includes(n)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // 阻止冒泡：外层 aside 也绑了 dragover，不能让它把 dragging 清掉
    e.stopPropagation()
    const pos = this.dropPosFor(n, e)
    // 只有变化才写入，避免每帧 reactivity
    const cur = this.state.dropHint
    if (!cur || cur.target !== n || cur.pos !== pos) {
      this.state.dropHint = { target: n, pos }
    }
  }

  onRowDrop(n, e) {
    e.preventDefault()
    e.stopPropagation()
    const d = this.state.dragging
    this.onDragEnd()
    if (!d || d === n) return
    const pos = this.dropPosFor(n, e)
    if (pos === 'into' && n.type === 'layout') {
      if (d.type === 'table') this.store.nestInto(n, [d])
      else this.store.nestInto(n, this.store.subtreeOf(d))
    } else {
      this.store.reorder(d, n, pos)
    }
  }

  // 放到顶层（面板空白区）= 退回顶层
  // 只作为 drop 处理，dragover 时只 preventDefault 让 drop 生效，不清 dragging
  onRootDragOver(e) {
    if (!this.state.dragging) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  onRootDrop(e) {
    e.preventDefault()
    const n = this.state.dragging
    this.onDragEnd()
    if (!n || n.type !== 'table') return
    this.store.detachToParent([n])
  }

  // ---------- 行交互 ----------

  onRow(n, e) {
    this.store.select(n, e.shiftKey)
    this.store.focusNode(n)
  }

  // ---------- 改名 ----------

  startEdit(n, value) {
    this.state.editing = n
    this.state.editText = value
  }

  commitEdit() {
    const n = this.state.editing
    if (n) this.store.rename(n, this.state.editText)
    this.state.editing = null
  }

  cancelEdit() {
    this.state.editing = null
  }

  // ---------- 悬停同步 ----------

  // 行悬浮同步到画布：边框变蓝但 row=-1 所以不弹字段详情
  onEnter(n) {
    if (this.store.hidden.has(n)) return
    this.store.hovered = { node: n, row: -1 }
  }

  // 必须清掉：鼠标离开面板若停在画布外，边框高亮会一直残留
  onLeave() {
    this.store.hovered = null
    this.store.draw()
  }

  // ---------- 删除 ----------

  onRemove(n) {
    this.store.select(n, false)
    this.store.deleteSelected()
  }

  // ---------- 子级计数显示 ----------

  sub(n) {
    if (n.type !== 'layout') return `${(n.fields || []).length} 字段`
    return `${this.store.memberCount(n)} 个成员`
  }
}
