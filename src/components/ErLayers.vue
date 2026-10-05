<script setup>
import { h, ref, computed } from 'vue'

const props = defineProps({
  store: { type: Object, required: true },
})
const store = props.store

// 被拖拽的行
const dragging = ref(null)
// 正在改名的行
const editing = ref(null)
const editText = ref('')
// 落点指示：{target, pos}，pos ∈ 'before' | 'after' | 'into'
// PS 里鼠标在行上下边缘 = 换层序，在行中间 = 收编成成员
const dropHint = ref(null)

function onDragStart(n, e) {
  dragging.value = n
  store.select(n, false)
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', String(n.name))
}

function onDragEnd() {
  dragging.value = null
  dropHint.value = null
}

// 鼠标在行内的相对位置决定落点：前 25% = before，后 25% = after，
// 中间 50% = into（仅分组有效）。表格行只做 before/after。
function dropPosFor(target, e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const y = (e.clientY - rect.top) / rect.height
  const isGroup = target.type === 'layout'
  if (y < 0.25) return 'before'
  if (y > 0.75) return 'after'
  return isGroup ? 'into' : 'after'
}

function onRowDragOver(n, e) {
  const d = dragging.value
  if (!d || d === n) return
  // 不允许拖到自己后代里
  if (store.subtreeOf(d).includes(n)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  // 阻止冒泡：外层 aside 也绑了 dragover，不能让它把 dragging 清掉
  e.stopPropagation()
  const pos = dropPosFor(n, e)
  // 只有变化才写入，避免每帧 reactivity
  const cur = dropHint.value
  if (!cur || cur.target !== n || cur.pos !== pos) {
    dropHint.value = { target: n, pos }
  }
}

function onRowDrop(n, e) {
  e.preventDefault()
  e.stopPropagation()
  const d = dragging.value
  onDragEnd()
  if (!d || d === n) return
  const pos = dropPosFor(n, e)
  if (pos === 'into' && n.type === 'layout') {
    if (d.type === 'table') store.nestInto(n, [d])
    else store.nestInto(n, store.subtreeOf(d))
  } else {
    store.reorder(d, n, pos)
  }
}

// 放到顶层（面板空白区）= 退回顶层
// 只作为 drop 处理，dragover 时只 preventDefault 让 drop 生效，不清 dragging
function onRootDragOver(e) {
  if (!dragging.value) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
}

function onRootDrop(e) {
  e.preventDefault()
  const n = dragging.value
  onDragEnd()
  if (!n || n.type !== 'table') return
  store.detachToParent([n])
}

function onRow(n, e) {
  store.select(n, e.shiftKey)
  store.focusNode(n)
}

// 改名：回车确认，Esc 取消，点击行外也取消
function startEdit(n, value) {
  editing.value = n
  editText.value = value
}

function commitEdit() {
  const n = editing.value
  if (n) store.rename(n, editText.value)
  editing.value = null
}

function cancelEdit() {
  editing.value = null
}

// 行悬浮同步到画布：边框变蓝但 row=-1 所以不弹字段详情
function onEnter(n) {
  if (store.hidden.has(n)) return
  store.hovered = { node: n, row: -1 }
}

// 必须清掉：鼠标离开面板若停在画布外，边框高亮会一直残留
function onLeave() {
  store.hovered = null
  store.draw()
}

function onRemove(n) {
  store.select(n, false)
  store.deleteSelected()
}

function sub(n) {
  if (n.type !== 'layout') return `${(n.fields || []).length} 字段`
  return `${store.memberCount(n)} 个成员`
}

// 递归渲染：模板里嵌套 v-for 拿不到父层缩进，所以用一个递归组件
const GroupList = {
  name: 'GroupList',
  props: { nodes: Array, depth: { type: Number, default: 0 } },
  setup(p) {
    return () => {
      const children = []
      for (const n of p.nodes) {
        const isGroup = n.type === 'layout'
        const isEditing = editing.value === n
        const hint = dropHint.value
        const isHint = hint && hint.target === n
        children.push(h('div', {
          class: ['row', {
            'on': store.selection.has(n),
            'off': store.hidden.has(n),
            group: isGroup,
            'hint-before': isHint && hint.pos === 'before',
            'hint-after': isHint && hint.pos === 'after',
            'hint-into': isHint && hint.pos === 'into',
          }],
          style: { marginLeft: `${p.depth * 14}px` },
          // 改名中不允许拖拽
          draggable: isEditing ? 'false' : 'true',
          onDragstart: (e) => onDragStart(n, e),
          onDragend: onDragEnd,
          onClick: (e) => { if (!isEditing) onRow(n, e) },
          onDblClick: (e) => { e.stopPropagation(); startEdit(n, n.name) },
          onDragover: (e) => onRowDragOver(n, e),
          onDrop: (e) => onRowDrop(n, e),
          onMouseenter: () => onEnter(n),
          onMouseleave: onLeave,
        }, [
          h('span', { class: 'caret' }, isGroup ? '▣' : '▤'),
          isEditing
            ? h('input', {
                class: 'rename',
                value: editText.value,
                onInput: (e) => { editText.value = e.target.value },
                onKeydown: (e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                  e.stopPropagation()
                },
                onBlur: commitEdit,
                onClick: (e) => e.stopPropagation(),
              })
            : h('div', { class: 'text' }, [
                h('span', { class: 'name' }, n.name),
                h('span', { class: 'sub' }, sub(n)),
              ]),
          h('button', {
            class: 'eye',
            title: '显示 / 隐藏',
            onClick: (e) => { e.stopPropagation(); store.toggleVisible(n) },
          }, store.hidden.has(n) ? '◌' : '◉'),
          h('div', { class: 'acts' }, [
            h('button', { title: '重命名', onClick: (e) => { e.stopPropagation(); startEdit(n, n.name) } }, '✎'),
            h('button', { title: '置顶', onClick: (e) => { e.stopPropagation(); store.moveLayer(n, 'front') } }, '⇈'),
            h('button', { title: '上移', onClick: (e) => { e.stopPropagation(); store.moveLayer(n, 'forward') } }, '▲'),
            h('button', { title: '下移', onClick: (e) => { e.stopPropagation(); store.moveLayer(n, 'backward') } }, '▼'),
            h('button', { title: '置底', onClick: (e) => { e.stopPropagation(); store.moveLayer(n, 'back') } }, '⇊'),
            isGroup
              ? h('button', { title: '在分组里新建表', onClick: (e) => { e.stopPropagation(); store.addTable(n) } }, '＋')
              : h('button', { title: '移出分组', onClick: (e) => { e.stopPropagation(); store.detachToParent([n]) } }, '⤴'),
            h('button', {
              class: 'del',
              title: isGroup ? '删除分组（成员散到上一层）' : '删除表',
              onClick: (e) => { e.stopPropagation(); onRemove(n) },
            }, '✕'),
          ]),
        ]))
        if (isGroup) {
          children.push(h(GroupList, {
            nodes: store.nodes.filter((x) => x.parent === n.name),
            depth: p.depth + 1,
          }))
        }
      }
      return h('div', null, children)
    }
  },
}
</script>

<template>
  <aside
    class="layers"
    @mouseleave="onLeave"
    @dragover="onRootDragOver"
    @drop="onRootDrop"
  >
    <header class="layers-head">
      <span>分组</span>
      <span class="count">{{ store.nodes.length }}</span>
    </header>
    <div class="layers-body">
      <div v-if="!store.nodes.length" class="layers-empty">暂无节点</div>
      <GroupList :nodes="store.nodes.filter((n) => !n.parent)" :depth="0" />
    </div>
    <footer class="layers-foot">
      <button @click="() => store.addLayout('新建分组')">＋ 分组</button>
      <button @click="() => store.addTable(null)">＋ 表</button>
    </footer>
  </aside>
</template>

<style lang="less" scoped>
@brand: #4a7ebb;
@ink: #1f2937;
@mute: #64748b;
@line: #e4e9ef;
@panel: #ffffff;

.layers {
  position: absolute;
  top: 14px;
  right: 14px;
  bottom: 62px; // 给右下角缩放控件让出空间，不与 .er-zoomer 重叠
  width: 248px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  border: 1px solid @line;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
}

.layers-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 11px;
  border-bottom: 1px solid @line;
  font-size: 12px;
  font-weight: 600;
  color: @ink;
  flex: none;
}

.count {
  padding: 0 6px;
  border-radius: 4px;
  background: #f1f4f9;
  color: @mute;
  font: 600 11px/16px ui-monospace, monospace;
}

.layers-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.layers-foot {
  display: flex;
  gap: 6px;
  padding: 7px 9px;
  border-top: 1px solid @line;
  flex: none;

  button {
    flex: 1;
    height: 25px;
    border: 1px solid @line;
    border-radius: 5px;
    background: @panel;
    color: @mute;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;

    &:hover {
      color: @ink;
      border-color: #cfd8e3;
      background: #f6f8fa;
    }
  }
}

.layers-empty {
  padding: 18px 10px;
  text-align: center;
  color: @mute;
  font-size: 12px;
}

.row {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  gap: 6px;
  align-items: center;
  padding: 5px 6px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: #f1f4f9;
  }

  &.on {
    background: #eef2f7;

    &:hover {
      background: #e4ebf4;
    }
  }

  &.off {
    opacity: 0.55;

    .name {
      text-decoration: line-through;
    }
  }

  // PS 风格落点：before/after 画一条横线在上下边缘，into 整框高亮
  &.hint-before {
    box-shadow: inset 0 2px 0 -1px @brand;
  }

  &.hint-after {
    box-shadow: inset 0 -2px 0 -1px @brand;
  }

  &.hint-into {
    background: rgba(74, 126, 187, 0.14);
    outline: 1.5px dashed @brand;
    outline-offset: -1px;
  }
}

.caret {
  width: 14px;
  color: @mute;
  font-size: 11px;
  line-height: 1;
  text-align: center;
}

.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.name {
  color: @ink;
  font: 600 12px/15px ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  color: @mute;
  font-size: 10px;
  line-height: 12px;
}

.rename {
  width: 100%;
  min-width: 0;
  height: 22px;
  padding: 0 5px;
  border: 1px solid @brand;
  border-radius: 3px;
  background: #fff;
  color: @ink;
  font: 600 12px/1 ui-monospace, monospace;
  outline: none;
}

.acts {
  display: flex;
  gap: 1px;
  opacity: 0;
  transition: opacity 0.15s;

  .row:hover > & {
    opacity: 1;
  }

  button {
    width: 19px;
    height: 19px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: @mute;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background: #e2e8f0;
      color: @ink;
    }

    &.del:hover {
      background: #fee2e2;
      color: #b91c1c;
    }
  }
}

.eye {
  width: 19px;
  color: @mute;
  font-size: 11px;
  border: 0;
  background: transparent;
  border-radius: 3px;
  cursor: pointer;
  line-height: 1;

  &:hover {
    color: @brand;
    background: #eef1f6;
  }
}
</style>
