// 外键连线的锚点选择与三次贝塞尔曲线生成。

import { portX, portY } from './measure.js'

// 跨度很小或两表横向重叠时控制点的最低伸出量：保证弧线始终看得出弧度
const MIN_REACH = 40

// 垂直偏移的搜索步长与上限：从 0 开始，±20/±40/... 逐步加大，直到曲线穿过
// 任何障碍表的数量为 0 为止
const BULGE_STEP = 20
const BULGE_MAX = 240

// 采样次数：30 个中间点足够把曲线穿表情况看清楚，也不会让每条边多算几十次
const SAMPLE_N = 30

// 采样三次贝塞尔曲线，返回 N 个中间点（不含端点）
function sampleBezier(p0, c1, c2, p1, N) {
  const out = []
  for (let i = 1; i < N; i++) {
    const t = i / N
    const v = 1 - t
    const x = v*v*v*p0[0] + 3*v*v*t*c1[0] + 3*v*t*t*c2[0] + t*t*t*p1[0]
    const y = v*v*v*p0[1] + 3*v*v*t*c1[1] + 3*v*t*t*c2[1] + t*t*t*p1[1]
    out.push([x, y])
  }
  return out
}

// 点严格在矩形内部（不含边界）——边界上的端点不算穿表
function inRect(x, y, r) {
  return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h
}

// 数采样点里有多少落在障碍表里
function countCrossings(p0, c1, c2, p1, avoid) {
  if (!avoid || !avoid.length) return 0
  const pts = sampleBezier(p0, c1, c2, p1, SAMPLE_N)
  let hits = 0
  for (const [x, y] of pts) {
    for (let i = 0; i < avoid.length; i++) {
      const r = avoid[i]
      if (inRect(x, y, r)) { hits++; break }
    }
  }
  return hits
}

/**
 * 生成两个节点之间的一条三次贝塞尔曲线。
 *
 * 端点统一落在字段行两侧的端口圆心上，不锚在字段名的水平中心——那样线会接到
 * 表体中间，看起来像穿过字段格子。控制点沿连线轴向延伸，曲线在两端都贴着轴向
 * 进出，端点不会横向漂移。
 *
 * 走哪个轴向、从哪一侧进出，按两表的位移量算（取较大的那个）。
 *
 * @param a 起点节点（含 x/y）
 * @param sa 起点尺寸（measureTable 结果）
 * @param b 终点节点
 * @param sb 终点尺寸
 * @param rowA 起点字段行号
 * @param rowB 终点字段行号
 * @param avoid 想绕开的不相关表数组 [{x,y,w,h}, ...]，可选。
 *        非空时会在若干个垂直偏移里挑一个让曲线穿过表体最少的偏移，
 *        优先找 0 穿的，找不到再退而取穿得最少的
 * @returns {{p0:[number,number], c1:[number,number], c2:[number,number], p1:[number,number], dir:'h'|'v', rightward:boolean}}
 */
export function edgeBetween(a, sa, b, sb, rowA, rowB, avoid) {
  const acx = a.x + (sa.w || 0) / 2
  const bcx = b.x + (sb.w || 0) / 2
  const acy = a.y + (sa.h || 0) / 2
  const bcy = b.y + (sb.h || 0) / 2
  const dcx = bcx - acx
  const dcy = bcy - acy

  // 走哪个轴按位移量选：单轴不重叠时沿那一轴，两轴都不重叠时取较大的那个
  const dir = Math.abs(dcx) >= Math.abs(dcy) ? 'h' : 'v'

  if (dir === 'h') {
    // 左右错开：各自从朝向对方一侧的端口出 / 进，端点就是圆点圆心
    const rightward = dcx >= 0
    const p0 = [portX(a, sa, rowA, rightward), portY(a, sa, rowA)]
    const p1 = [portX(b, sb, rowB, !rightward), portY(b, sb, rowB)]
    const reach = Math.max(MIN_REACH, Math.abs(p1[0] - p0[0]) / 2)
    const s = rightward ? 1 : -1

    // 垂直偏移：把 c1/c2 的 y 一起抬高或压低，让曲线在垂直方向弯过去。
    // 两个控制点的基准 x 方向相反（c1 朝右、c2 朝左），但 y 偏移方向一致
    const best = searchBulge(p0, p1, s * reach, 0, -s * reach, 0, 'y', avoid)
    return {
      p0,
      c1: [p0[0] + s * reach + best.dx, p0[1] + best.dy],
      c2: [p1[0] - s * reach + best.dx, p1[1] + best.dy],
      p1, dir, rightward,
    }
  }

  // 上下错开：两表横向重叠，仍从两个表体侧面的端口出入，线绕外侧弯过去，
  // 不会穿进表体。控制点向两端延伸，出 / 入方向都是水平的。
  // 端点选圆点圆心而不是竖边，否则端点会从表体里斜穿出来。
  const p0 = [portX(a, sa, rowA, dcx >= 0), portY(a, sa, rowA)]
  const p1 = [portX(b, sb, rowB, dcx < 0), portY(b, sb, rowB)]
  const reach = Math.max(MIN_REACH, Math.abs(p1[1] - p0[1]) / 2 + 40)
  const s = dcy >= 0 ? 1 : -1

  // 竖向时垂直方向是横向，一起平移 c1/c2 的 x，形成左右弯的弧
  const best = searchBulge(p0, p1, s * reach, 0, s * reach, 0, 'x', avoid)
  return {
    p0,
    c1: [p0[0] + s * reach + best.dx, p0[1] + best.dy],
    c2: [p1[0] + s * reach + best.dx, p1[1] + best.dy],
    p1, dir, rightward: dcx >= 0,
  }
}

// 在垂直方向的若干个偏移里挑一个让曲线穿过 avoid 表最少的偏移。
// axis: 'y' 表示垂直方向偏移（水平布局用），'x' 表示水平方向偏移（竖向布局用）。
// dx0/dy0 是控制点相对端点的基准偏移，best.dx/best.dy 是搜索出的额外垂直偏移。
function searchBulge(p0, p1, dx1, dy1, dx2, dy2, axis, avoid) {
  const cands = [0]
  for (let k = BULGE_STEP; k <= BULGE_MAX; k += BULGE_STEP) {
    cands.push(k, -k)
  }
  let bestHits = Infinity
  let bestOff = 0
  for (const off of cands) {
    const bx = axis === 'x' ? off : 0
    const by = axis === 'y' ? off : 0
    const c1 = [p0[0] + dx1 + bx, p0[1] + dy1 + by]
    const c2 = [p1[0] + dx2 + bx, p1[1] + dy2 + by]
    const hits = countCrossings(p0, c1, c2, p1, avoid)
    if (hits < bestHits) {
      bestHits = hits
      bestOff = off
    }
    if (hits === 0) break
  }
  return axis === 'x' ? { dx: bestOff, dy: 0 } : { dx: 0, dy: bestOff }
}
