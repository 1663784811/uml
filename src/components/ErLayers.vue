<template>
  <aside
      class="layers"
      @mouseleave="ctrl.onLeave()"
      @dragover="ctrl.onRootDragOver($event)"
      @drop="ctrl.onRootDrop($event)"
  >
    <header class="layers-head">
      <span>分组</span>
      <span class="count">{{ store.nodes.length }}</span>
    </header>
    <div class="layers-scroll">
      <div class="layers-body" ref="bodyRef" @scroll="scheduleSync">
        <div v-if="!store.nodes.length" class="layers-empty">暂无节点</div>
        <GroupList :nodes="store.nodes.filter((n) => !n.group)" :depth="0" />
      </div>
      <div v-show="scroll.visible" class="layers-bar" ref="barRef" @mousedown.prevent="onTrackClick">
        <div
            class="layers-thumb"
            ref="thumbRef"
            :class="{ dragging: scroll.dragging }"
            :style="{
            height: `${scroll.ratio * 100}%`,
            top: `${scroll.offset}%`,
          }"
            @mousedown="onThumbDown"
        />
      </div>
    </div>
    <footer class="layers-foot">
      <button @click="() => store.addLayout('新建分组')">＋ 分组</button>
      <button @click="() => store.addTable(null)">＋ 表</button>
    </footer>
  </aside>
</template>

<script setup>
import { h, reactive, ref, onBeforeUnmount, watch, nextTick } from 'vue'
import { useCanvasStore } from '../stores/canvas.js'
import { LayerPanelController } from './LayerPanelController.js'

const store = useCanvasStore()
// 面板本地状态：拖拽、改名、落点提示。controller 与模板共用同一个 reactive 对象
const state = reactive({
  dragging: null,
  editing: null,
  editText: '',
  dropHint: null,
})
const ctrl = new LayerPanelController(store, state)

// 自定义滚动条：Chrome/Edge 在 Windows 上默认走 overlay 滚动条，::-webkit-scrollbar
// 样式会被忽略、滚动条还只在 hover 时闪现。这里把原生滚动条隐藏，画一个自己的，
// 宽度颜色与面板调性统一，hover 加深、拖动可跳转。
const bodyRef = ref(null)
const barRef = ref(null)
const thumbRef = ref(null)
const scroll = reactive({ visible: false, ratio: 0, offset: 0, dragging: false })

function syncScrollBar() {
  const body = bodyRef.value
  if (!body) return
  const overflow = body.scrollHeight - body.clientHeight
  if (overflow <= 0) {
    scroll.visible = false
    return
  }
  scroll.visible = true
  scroll.ratio = Math.max(0.12, body.clientHeight / body.scrollHeight)
  scroll.offset = (body.scrollTop / overflow) * 100
}

let raf = null
function scheduleSync() {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = null; syncScrollBar() })
}

// 拖动 thumb 滚动
function onThumbDown(e) {
  if (!scroll.visible) return
  scroll.dragging = true
  const startY = e.clientY
  const startTop = bodyRef.value.scrollTop
  const trackH = barRef.value.offsetHeight
  const thumbH = trackH * scroll.ratio
  const track = trackH - thumbH
  const range = bodyRef.value.scrollHeight - bodyRef.value.clientHeight
  const move = (ev) => {
    const dy = ev.clientY - startY
    bodyRef.value.scrollTop = startTop + (dy / track) * range
  }
  const up = () => {
    scroll.dragging = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  e.preventDefault()
}

// 点击轨道跳转
function onTrackClick(e) {
  if (!scroll.visible || e.target === thumbRef.value) return
  const body = bodyRef.value
  const rect = barRef.value.getBoundingClientRect()
  const rel = (e.clientY - rect.top) / rect.height
  body.scrollTop = rel * (body.scrollHeight - body.clientHeight)
}

onBeforeUnmount(() => {
  if (state.dragging) ctrl.onDragEnd()
  if (raf) cancelAnimationFrame(raf)
})

// 节点数组变化时重算滚动条（新增/删除节点、改名都会触发）
watch(() => store.nodes, scheduleSync, { deep: true })
// 挂载后首次同步
watch(bodyRef, () => nextTick(syncScrollBar), { immediate: true })

// 递归渲染：模板里嵌套 v-for 拿不到父层缩进，所以用一个递归组件
const GroupList = {
  name: 'GroupList',
  props: { nodes: Array, depth: { type: Number, default: 0 } },
  setup(p) {
    return () => {
      const children = []
      for (const n of p.nodes) {
        const isGroup = n.type === 'layout'
        const isEditing = state.editing === n
        const hint = state.dropHint
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
          onDragstart: (e) => ctrl.onDragStart(n, e),
          onDragend: () => ctrl.onDragEnd(),
          onClick: (e) => { if (!isEditing) ctrl.onRow(n, e) },
          onDblClick: (e) => { e.stopPropagation(); ctrl.startEdit(n, n.name) },
          onDragover: (e) => ctrl.onRowDragOver(n, e),
          onDrop: (e) => ctrl.onRowDrop(n, e),
          onMouseenter: () => ctrl.onEnter(n),
          onMouseleave: () => ctrl.onLeave(),
        }, [
          h('span', { class: 'caret' }, isGroup ? '▦' : '▤'),
          h('div', { class: 'text' }, [
            isEditing
              ? h('input', {
                  class: 'rename',
                  value: state.editText,
                  onInput: (e) => { state.editText = e.target.value },
                  onKeydown: (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); ctrl.commitEdit() }
                    else if (e.key === 'Escape') { e.preventDefault(); ctrl.cancelEdit() }
                    e.stopPropagation()
                  },
                  onBlur: () => ctrl.commitEdit(),
                  onClick: (e) => e.stopPropagation(),
                })
              : [
                  h('span', { class: 'name' }, n.name),
                  ...(isGroup ? [h('span', { class: 'sub' }, ctrl.sub(n))] : []),
                ],
          ]),
          h('button', {
            class: 'eye',
            title: '显示 / 隐藏',
            onClick: (e) => { e.stopPropagation(); store.toggleVisible(n) },
          }, store.hidden.has(n) ? '◌' : '◉'),
          h('div', { class: 'acts' }, [
            h('button', { title: '重命名', onClick: (e) => { e.stopPropagation(); ctrl.startEdit(n, n.name) } }, '✎'),
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
              onClick: (e) => { e.stopPropagation(); ctrl.onRemove(n) },
            }, '✕'),
          ]),
        ]))
        if (isGroup) {
          children.push(h(GroupList, {
            nodes: store.nodes.filter((x) => x.group === n.name),
            depth: p.depth + 1,
          }))
        }
      }
      return h('div', null, children)
    }
  },
}
</script>

<style lang="less" scoped>
@brand: #4a7ebb;
@ink: #1f2937;
@mute: #64748b;
@line: #e4e9ef;
@panel: #ffffff;

// ============================================================
// 面板容器
// ============================================================
.layers {
  position: absolute;
  top: 14px;
  right: 14px;
  bottom: 14px;
  width: 268px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  border: 1px solid @line;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);

  // ---------- 头部 ----------
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

    .count {
      padding: 0 6px;
      border-radius: 4px;
      background: #f1f4f9;
      color: @mute;
      font: 600 11px/16px ui-monospace, monospace;
    }
  }

  // ---------- 滚动区 ----------
  .layers-scroll {
    flex: 1;
    display: flex;
    min-height: 0; // flex 子项默认 min-height:auto，不加会撑出容器
    contain: layout style;

    .layers-body {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 4px;
      overscroll-behavior: contain;
      // 隐藏原生滚动条，自己画一个
      scrollbar-width: none;
      -ms-overflow-style: none;

      &::-webkit-scrollbar {
        width: 0;
        height: 0;
      }

      .layers-empty {
        padding: 18px 10px;
        text-align: center;
        color: @mute;
        font-size: 12px;
      }
    }

    // 自定义滚动条
    .layers-bar {
      position: relative;
      width: 6px;
      margin-left: 1px;
      background: transparent;
      border-radius: 3px;
      flex: none;

      .layers-thumb {
        position: absolute;
        left: 0;
        right: 0;
        background: rgba(100, 116, 139, 0.32);
        border-radius: 3px;
        cursor: grab;
        transition: background 0.15s;

        &:hover {
          background: rgba(100, 116, 139, 0.6);
        }

        &.dragging {
          background: rgba(74, 126, 187, 0.75);
          cursor: grabbing;
        }
      }
    }
  }

  // ---------- 底部 ----------
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
}

// ============================================================
// 行（GroupList 是 render 函数组件，元素无 scoped 属性，需 :deep）
// ============================================================
:deep(.row) {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  margin: 2px 3px;
  border-radius: 7px;
  cursor: pointer;
  position: relative;
  border: 1px solid transparent;
  transition: background 0.12s, border-color 0.12s;

  // ---------- 状态 ----------

  &:hover {
    background: #f4f6fa;
    border-color: #e4e9ef;
  }

  &.on {
    background: #e8edf5;
    border-color: #b5c4d6;

    &:hover {
      background: #dfe7f2;
    }

    .name {
      color: @brand;
    }
  }

  &.off {
    opacity: 0.4;

    .name {
      text-decoration: line-through;
    }
  }

  // 分组行：琥珀色微底色
  &.group {
    background: rgba(245, 158, 11, 0.05);
    border-color: rgba(245, 158, 11, 0.18);

    &:hover {
      background: rgba(245, 158, 11, 0.1);
      border-color: rgba(245, 158, 11, 0.3);
    }

    &.on {
      background: rgba(245, 158, 11, 0.14);
      border-color: rgba(245, 158, 11, 0.4);

      &:hover {
        background: rgba(245, 158, 11, 0.18);
      }
    }
  }

  // 落点提示：before/after 上下边缘横线，into 整框高亮
  &.hint-before {
    box-shadow: inset 0 2px 0 -1px @brand;
  }

  &.hint-after {
    box-shadow: inset 0 -2px 0 -1px @brand;
  }

  &.hint-into {
    background: rgba(74, 126, 187, 0.12) !important;
    border-color: @brand !important;
    outline: 1.5px dashed @brand;
    outline-offset: -1.5px;
  }

  // ---------- 类型图标 ----------

  .caret {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    font-size: 15px;
    line-height: 1;
    color: @mute;
    background: #eef1f6;
  }

  &.group .caret {
    color: #b45309;
    background: #fef3c7;
  }

  &:not(.group) .caret {
    color: #1d4ed8;
    background: #dbeafe;
  }

  // ---------- 文本区 ----------

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;

    .name {
      color: @ink;
      font: 600 13px/16px system-ui, -apple-system, sans-serif;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: -0.005em;
    }

    .sub {
      color: @mute;
      font: 400 11px/13px system-ui, -apple-system, sans-serif;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rename {
      width: 100%;
      min-width: 0;
      height: 26px;
      padding: 0 7px;
      border: 1px solid @brand;
      border-radius: 4px;
      background: #fff;
      color: @ink;
      font: 600 13px/1 system-ui, -apple-system, sans-serif;
      outline: none;
      box-shadow: 0 0 0 3px rgba(74, 126, 187, 0.12);
    }
  }

  // ---------- 眼睛按钮（常显）----------

  .eye {
    flex: none;
    width: 24px;
    height: 24px;
    border: 0;
    background: transparent;
    color: @mute;
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 0.12s, background 0.12s;

    &:hover {
      color: @brand;
      background: #eef1f6;
    }
  }

  // ---------- 操作按钮（hover 浮出）----------

  .acts {
    position: absolute;
    left: 50%;
    top: 100%;
    transform: translateX(-50%);
    display: flex;
    gap: 0;
    padding: 2px;
    background: #fff;
    border-radius: 5px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12), 0 0 0 1px #e4e9ef;
    opacity: 0;
    pointer-events: none;
    z-index: 10;
    transition: opacity 0.12s;

    button {
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 3px;
      background: transparent;
      color: @mute;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.1s, color 0.1s;

      &:hover {
        background: #e8edf5;
        color: @ink;
      }

      &.del:hover {
        background: #fee2e2;
        color: #b91c1c;
      }
    }
  }

  &:hover .acts {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
