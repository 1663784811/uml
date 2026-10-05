// 外键连线的锚点选择与三次贝塞尔曲线生成。

import { rowCenterY } from './measure.js'

// 跨度很小或两表横向重叠时控制点的最低伸出量：保证弧线始终看得出弧度
const MIN_REACH = 40

/**
 * 生成两个节点之间的一条三次贝塞尔曲线。
 *
 * 端点统一贴在左/右边框上，不锚在字段名的水平中心——那样线会接到表体中间，
 * 看起来像穿过字段格子。控制点沿连线轴向延伸，曲线在两端都贴着轴向进出，
 * 端点不会横向漂移；drawCrown 拿 c1 当切线方向也是这个原因。
 *
 * 走哪个轴向、从哪一侧进出，按两表的位移量算（sepX/sepY + 取较大者）。
 *
 * @param a 起点节点（含 x/y）
 * @param sa 起点尺寸（measureTable 结果）
 * @param b 终点节点
 * @param sb 终点尺寸
 * @param rowA 起点字段行号
 * @param rowB 终点字段行号
 * @returns {{p0:[number,number], c1:[number,number], c2:[number,number], p1:[number,number], dir:'h'|'v', rightward:boolean}}
 */
export function edgeBetween(a, sa, b, sb, rowA, rowB) {
  const acx = a.x + (sa.w || 0) / 2
  const bcx = b.x + (sb.w || 0) / 2
  const acy = a.y + (sa.h || 0) / 2
  const bcy = b.y + (sb.h || 0) / 2
  const dcx = bcx - acx
  const dcy = bcy - acy

  // 走哪个轴按位移量选：单轴不重叠时沿那一轴，两轴都不重叠时取较大的那个。
  const sepX = a.x + sa.w <= b.x || b.x + sb.w <= a.x
  const sepY = a.y + sa.h <= b.y || b.y + sb.h <= a.y
  const dir = sepX && !sepY ? 'h'
    : sepY && !sepX ? 'v'
    : Math.abs(dcx) >= Math.abs(dcy) ? 'h' : 'v'

  if (dir === 'h') {
    // 左右错开：各自从朝向对方的一侧出 / 进
    const rightward = dcx >= 0
    const p0 = [rightward ? a.x + sa.w : a.x, a.y + rowCenterY(sa, rowA)]
    const p1 = [rightward ? b.x : b.x + sb.w, b.y + rowCenterY(sb, rowB)]
    const reach = Math.max(MIN_REACH, Math.abs(p1[0] - p0[0]) / 2)
    const s = rightward ? 1 : -1
    return { p0, c1: [p0[0] + s * reach, p0[1]], c2: [p1[0] - s * reach, p1[1]], p1, dir, rightward }
  }

  // 上下错开：两表横向重叠，端点都落在同一条竖边（偏右走右边、偏左走左边），
  // 线绕外侧弯过去，不会穿进表体
  const rightSide = dcx >= 0
  const ax = rightSide ? a.x + sa.w : a.x
  const bx = rightSide ? b.x + sb.w : b.x
  const downward = dcy >= 0
  const p0 = [ax, downward ? a.y + sa.h : a.y]
  const p1 = [bx, downward ? b.y : b.y + sb.h]
  const reach = Math.max(MIN_REACH, Math.abs(p1[1] - p0[1]) / 2)
  const s = downward ? 1 : -1
  return { p0, c1: [p0[0], p0[1] + s * reach], c2: [p1[0], p1[1] - s * reach], p1, dir, rightward: rightSide }
}
