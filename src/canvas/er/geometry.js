// 外键连线的锚点选择与三次贝塞尔曲线生成。

import { rowAnchorX, rowCenterY } from './measure.js'

// 跨度很小时控制点的最低伸出量：保证弧线始终看得出弧度
const MIN_REACH = 40

/**
 * 生成两个节点之间的一条三次贝塞尔曲线。
 *
 * 端点仍贴在表格边缘（与折线版一致）。控制点沿端点所在边的法线方向延伸，
 * 于是曲线从起点贴边飞出、在终点贴边进入，端点不会横向漂移——
 * 这也是 drawCrown 直接拿 c1 当切线方向就正确的原因。
 *
 * @param a 起点节点（含 x/y）
 * @param sa 起点尺寸（measureTable 结果）
 * @param b 终点节点
 * @param sb 终点尺寸
 * @param rowA 起点字段行号
 * @param rowB 终点字段行号
 * @returns {{p0:[number,number], c1:[number,number], c2:[number,number], p1:[number,number]}}
 */
export function edgeBetween(a, sa, b, sb, rowA, rowB) {
  const acx = a.x + (sa.w || 0) / 2
  const acy = a.y + (sa.h || 0) / 2
  const bcx = b.x + (sb.w || 0) / 2
  const bcy = b.y + (sb.h || 0) / 2
  const dcx = bcx - acx
  const dcy = bcy - acy

  const sepX = a.x + sa.w <= b.x || b.x + sb.w <= a.x
  const sepY = a.y + sa.h <= b.y || b.y + sb.h <= a.y

  let dir
  if (sepX && !sepY) dir = 'h'
  else if (sepY && !sepX) dir = 'v'
  else dir = Math.abs(dcx) >= Math.abs(dcy) ? 'h' : 'v'

  if (dir === 'h') {
    const rightward = dcx >= 0
    const p0 = [rightward ? a.x + sa.w : a.x, a.y + rowCenterY(sa, rowA)]
    const p1 = [rightward ? b.x : b.x + sb.w, b.y + rowCenterY(sb, rowB)]
    const reach = Math.max(MIN_REACH, Math.abs(p1[0] - p0[0]) / 2)
    // 控制点沿 X 轴：起点向外、终点向内，形成 S 形
    const s = rightward ? 1 : -1
    return { p0, c1: [p0[0] + s * reach, p0[1]], c2: [p1[0] - s * reach, p1[1]], p1 }
  }

  const downward = dcy >= 0
  const p0 = [a.x + rowAnchorX(sa, rowA), downward ? a.y + sa.h : a.y]
  const p1 = [b.x + rowAnchorX(sb, rowB), downward ? b.y : b.y + sb.h]
  const reach = Math.max(MIN_REACH, Math.abs(p1[1] - p0[1]) / 2)
  const s = downward ? 1 : -1
  return { p0, c1: [p0[0], p0[1] + s * reach], c2: [p1[0], p1[1] - s * reach], p1 }
}
