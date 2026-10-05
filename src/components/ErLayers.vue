<script setup>
import { h, reactive, onBeforeUnmount } from 'vue'
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

onBeforeUnmount(() => {
  if (state.dragging) ctrl.onDragEnd()
})

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
          h('span', { class: 'caret' }, isGroup ? '▣' : '▤'),
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
            : h('div', { class: 'text' }, [
                h('span', { class: 'name' }, n.name),
                h('span', { class: 'sub' }, ctrl.sub(n)),
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
    @mouseleave="ctrl.onLeave()"
    @dragover="ctrl.onRootDragOver($event)"
    @drop="ctrl.onRootDrop($event)"
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
  min-height: 0; // flex 子项默认 min-height:auto，不加这条会把 body 撑出容器
  // 用 scroll 而不是 auto：Chrome/Edge 在 Windows 上默认走 overlay 滚动条，
  // auto 模式会被浏览器接管成隐藏式，::-webkit-scrollbar 样式全部失效。
  // scroll 强制经典滚动条，样式才生效；代价是内容不足时也显示轨道。
  overflow-y: scroll;
  padding: 4px 0 4px 4px; // 右侧给滚动条留边
  // 隔离布局与绘制：滚动条 / 内容变化不触发外层重排重绘
  contain: strict;
  overscroll-behavior: contain;

  // Firefox：scrollbar-color 不支持 hover 变体，只有当前/轨道两色。
  // Chrome/Edge 由下面的 ::-webkit-scrollbar 规则接管，本属性可安全忽略
  scrollbar-width: thin;
  scrollbar-color: rgba(100, 116, 139, 0.55) transparent;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
    margin: 2px 0; // 让 thumb 不顶到容器边缘
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(100, 116, 139, 0.4);
    border-radius: 4px;
    // 4px 内缩，让 thumb 视觉宽度 8-4=4px，避免占满轨道显得像实心条
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(100, 116, 139, 0.85);
  }

  &::-webkit-scrollbar-thumb:active {
    background: rgba(74, 126, 187, 0.9);
  }

  &::-webkit-scrollbar-thumb:disabled {
    background: rgba(100, 116, 139, 0.15);
  }
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
