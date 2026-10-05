<template>
  <div class="er">
    <header class="er-bar">
      <div class="er-brand">
        <span class="er-logo">ER</span>
        <span class="er-name">数据库关系图</span>
      </div>

      <div class="er-stats">
        <span class="er-stat"><b>{{ store.nodes.length }}</b> 节点</span>
        <span class="er-stat"><b>{{ edgeCount }}</b> 关系</span>
        <span class="er-stat"><b>{{ Math.round(store.zoom * 100) }}%</b> 缩放</span>
      </div>

      <div class="er-tools">
        <button class="er-btn" @click="store.fitView()">适应</button>
        <button class="er-btn" :disabled="!store.selection.size" @click="onDelete">
          删除<span class="er-kbd">Del</span>
        </button>
        <button class="er-btn er-btn-primary" @click="onExport">
          导出<span class="er-kbd">Ctrl+S</span>
        </button>
      </div>
    </header>

    <div ref="stageRef" class="er-stage">
      <canvas ref="canvasRef" class="er-canvas"></canvas>

      <div v-if="hoverInfo" class="er-hover" :class="{ 'er-hover-fk': hoverInfo.fk }" :style="hoverStyle">
        <div class="er-hover-head">
          <span class="er-hover-table">{{ hoverInfo.table }}</span>
          <span class="er-hover-name">{{ hoverInfo.name }}</span>
          <span class="er-hover-type">{{ hoverInfo.type }}</span>
          <span class="er-hover-tag" :class="{ null: hoverInfo.nullable }">{{ hoverInfo.nullable ? '可空' : 'NOT NULL' }}</span>
        </div>
        <div v-if="hoverInfo.desc" class="er-hover-desc">{{ hoverInfo.desc }}</div>
        <div v-if="hoverInfo.fk" class="er-hover-link">FK → <b>{{ hoverInfo.fk }}</b></div>
      </div>

      <div class="er-help">
        <span><i>拖表</i>移动</span>
        <span><i>拖到分组</i>收编</span>
        <span><i>右键拖</i>平移</span>
        <span><i>左键拖</i>框选</span>
        <span><i>Shift</i>多选</span>
        <span><i>Alt</i>对齐吸附</span>
        <span><i>滚轮</i>缩放</span>
        <span><i>双击</i>聚焦</span>
        <span><i>悬停</i>字段详情</span>
      </div>

      <ErLayers :store="store" />

      <div class="er-zoomer">
        <button title="缩小" @click="store.zoomTo(store.zoom - 0.15)">−</button>
        <button title="回到 100%" @click="store.zoomTo(1)">100%</button>
        <button title="放大" @click="store.zoomTo(store.zoom + 0.15)">＋</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useCanvasStore } from '../stores/canvas.js'
import { createInteractions } from '../canvas/er/interaction.js'
import sampleData from '../assets/sample.json'
import ErLayers from '../components/ErLayers.vue'

const store = useCanvasStore()
const canvasRef = ref(null)
const stageRef = ref(null)
let act = null

const edgeCount = computed(() =>
  store.nodes.reduce((n, t) => n + ((t.fields || []).filter((f) => f && f.targetTable).length), 0),
)

// 悬停态：命中字段行时给出字段详情；表头/图层框/空白为 null
const hoverInfo = computed(() => {
  const h = store.hovered
  if (!h || h.row < 0) return null
  const f = (h.node.fields || [])[h.row]
  if (!f) return null
  return {
    table: h.node.name,
    name: f.name,
    type: f.type,
    desc: f.describe,
    nullable: !!f.nullable,
    fk: f.targetTable ? `${f.targetTable}${f.targetField ? '.' + f.targetField : ''}` : '',
  }
})

// 跟随鼠标，超出容器右侧/下侧时翻转到左侧/上方，避免被裁掉
const hoverStyle = computed(() => {
  const p = store.hoverPos
  const off = 14
  const w = 300
  const h = 76
  const vw = store.view.w || 0
  const vh = store.view.h || 0
  const left = p.x + off + w > vw ? Math.max(4, p.x - off - w) : p.x + off
  const top = p.y + off + h > vh ? Math.max(4, p.y - off - h) : p.y + off
  return { left: `${left}px`, top: `${top}px` }
})

function onDelete() {
  store.deleteSelected()
}

function onExport() {
  const blob = new Blob([JSON.stringify(store.serialize(), null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'uml-data.json'
  a.click()
  URL.revokeObjectURL(url)
}

function onKey(e) {
  // 输入框里不拦截
  const tag = e.target && e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    onDelete()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    onExport()
  } else if (e.key === '0') {
    store.zoomTo(1)
  }
}

function init() {
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  // bind 内会同步写入初始视口尺寸，load 里的 centerView 才有锚点
  store.bind(ctx, stageRef.value)
  act = createInteractions(store, canvas)
  act.attach()
  window.addEventListener('keydown', onKey)
  // 不传 fit：初始 100% + 居中，缩放交给用户（滚轮 / 适应按钮）
  store.load(sampleData, { layout: true })
  if (import.meta.env.DEV) window.__STORE__ = store // 仅开发环境，供调试用
}

onMounted(init)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (act) act.detach()
  store.unbind()
  store.clear()
})
</script>

<style lang="less" scoped>
@brand: #4a7ebb;
@ink: #1f2937;
@mute: #64748b;
@line: #e4e9ef;
@panel: #ffffff;

.er {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f7f8fa;
  color: @ink;
  font-size: 14px;
}

.er-bar {
  display: flex;
  align-items: center;
  gap: 20px;
  height: 52px;
  padding: 0 16px;
  background: @panel;
  border-bottom: 1px solid @line;
  flex: none;
}

.er-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.er-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: @brand;
  color: #fff;
  font: 700 11px/1 system-ui, sans-serif;
  letter-spacing: 0.5px;
}

.er-name {
  font-size: 15px;
  font-weight: 600;
}

.er-stats {
  display: flex;
  gap: 8px;
  margin-left: 4px;
}

.er-stat {
  padding: 4px 10px;
  border-radius: 6px;
  background: #f1f4f9;
  color: @mute;
  font-size: 12px;
  font-variant-numeric: tabular-nums;

  b {
    color: @ink;
    font-weight: 600;
  }
}

.er-tools {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.er-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid @line;
  border-radius: 7px;
  background: @panel;
  color: @ink;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;

  &:hover:not(:disabled) {
    background: #f6f8fa;
    border-color: #cfd8e3;
  }

  &:active:not(:disabled) {
    background: #eef1f6;
  }

  &:disabled {
    color: #b4bcc8;
    cursor: not-allowed;
  }

  &.er-btn-primary {
    background: @brand;
    border-color: @brand;
    color: #fff;

    &:hover:not(:disabled) {
      background: darken(@brand, 7%);
      border-color: darken(@brand, 7%);
    }
  }
}

.er-kbd {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.2);
  font: 11px/15px ui-monospace, monospace;
  opacity: 0.8;
}

.er-stage {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.er-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: default;
}

// 悬停状态：命中字段行时显示字段详情，鼠标位置跟随（由 store 写入）
.er-hover {
  position: absolute;
  z-index: 3;
  min-width: 180px;
  max-width: 340px;
  padding: 8px 10px;
  border: 1px solid #cdd7e3;
  border-left: 3px solid @brand;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.1);
  pointer-events: none;
  backdrop-filter: blur(6px);
  transition: border-color 0.15s;

  &.er-hover-fk {
    border-left-color: #1d4ed8;
  }
}

.er-hover-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  line-height: 20px;
}

.er-hover-table {
  padding: 1px 6px;
  border-radius: 4px;
  background: #eef2f7;
  color: @mute;
  font: 11px/16px ui-monospace, monospace;
}

.er-hover-name {
  color: @ink;
  font-weight: 600;
  font-family: ui-monospace, monospace;
}

.er-hover-type {
  color: @mute;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

.er-hover-tag {
  padding: 1px 5px;
  border-radius: 4px;
  background: #e8f5e9;
  color: #2e7d32;
  font: 600 10px/15px ui-monospace, monospace;

  &.null {
    background: #fff3e0;
    color: #b45309;
  }
}

.er-hover-desc {
  margin-top: 4px;
  color: @mute;
  font-size: 12px;
}

.er-hover-link {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed #e4e9ef;
  color: #1d4ed8;
  font-size: 12px;

  b {
    font-family: ui-monospace, monospace;
    font-weight: 600;
  }
}

.er-help {
  position: absolute;
  left: 14px;
  bottom: 14px;
  display: flex;
  gap: 14px;
  padding: 7px 12px;
  border: 1px solid @line;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  color: @mute;
  font-size: 12px;
  pointer-events: none;
  backdrop-filter: blur(6px);

  span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  i {
    padding: 1px 5px;
    border-radius: 4px;
    background: #eef1f6;
    color: @ink;
    font: 11px/16px ui-monospace, monospace;
    font-style: normal;
  }
}

.er-zoomer {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid @line;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);

  button {
    min-width: 30px;
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: @ink;
    font-size: 13px;
    font-family: ui-monospace, monospace;
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
      background: #eef1f6;
    }

    &:active {
      background: #e2e8f0;
    }
  }
}
</style>
