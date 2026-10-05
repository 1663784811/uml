// 节点树的纯几何/结构不变量：parent 是 name 字符串（表与图层共享命名空间），
// 数组顺序即渲染次序。所有结构改动都走「拆成树 -> 改树 -> rewrite 写回」。
//
// 这里只操作普通数组，不依赖 Vue 响应式——store 用 reactive([...]) 包住这份数组
// 就能同时获得响应式与这里的 DFS 遍历语义。

export class Tree {
  /**
   * @param nodes 普通数组（reactive 代理或原始数组），元素为 { type, name, parent, x, y, w, h, ... }
   */
  constructor(nodes) {
    this.nodes = nodes
  }

  // 把节点数组按 parent 拆成顶层列表 + 每个父级下的子节点列表
  structureOf() {
    const top = []
    const kids = new Map()
    for (const n of this.nodes) {
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
  rewrite(top, kids) {
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
    for (const n of this.nodes) if (!seen.has(n)) { seen.add(n); out.push(n) }
    for (let i = 0; i < out.length; i++) this.nodes[i] = out[i]
    this.nodes.length = out.length
  }

  // 按当前 parent 关系重排数组
  rewriteOf() {
    const { top, kids } = this.structureOf()
    this.rewrite(top, kids)
  }

  // 节点及其全部后代（含自身）；非图层只有自己
  subtreeOf(node) {
    const out = [node]
    const seen = new Set(out)
    const stack = node.type === 'layout' ? this.nodes.filter((n) => n && n.parent === node.name) : []
    while (stack.length) {
      const n = stack.pop()
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
      if (n.type === 'layout') {
        for (const c of this.nodes.filter((x) => x && x.parent === n.name)) stack.push(c)
      }
    }
    return out
  }

  // 父级：只认显式的 parent 字段。
  // 不按包围关系兜底：拖表进图层时表还没改 parent，几何判定会让它「看起来是成员」，
  // selectionGroup/roots 就把拖拽主体当成别人的成员，dropTarget 永远返回 null
  parentOf(node) {
    if (!node || !node.parent) return null
    return this.nodes.find((n) => n.name === node.parent) || null
  }

  // 拖动用的选区：图层展开成整棵子树，成员跟着一起走
  selectionGroup(selection) {
    const out = []
    const seen = new Set()
    for (const n of this.nodes) {
      if (!selection.has(n)) continue
      for (const m of this.subtreeOf(n)) {
        if (seen.has(m)) continue
        seen.add(m)
        out.push(m)
      }
    }
    return out
  }

  // 名称唯一化：图层与表共用命名空间，parent 靠 name 匹配，撞名会让成员挂错人
  nextName(base, list) {
    const taken = new Set((list || this.nodes).map((n) => n.name))
    const b = String(base || 'untitled')
    if (!taken.has(b)) return b
    let k = 2
    while (taken.has(`${b}_${k}`)) k++
    return `${b}_${k}`
  }

  memberCount(node) {
    if (!node || node.type !== 'layout') return 0
    return this.nodes.filter((n) => n && n.parent === node.name).length
  }

  inSubtree(node, items) {
    return this.subtreeOf(node).some((n) => items.includes(n))
  }
}
