import type { IPointData } from "leafer-editor";
// clamp 留在 utils.ts 供其它模块使用；此文件不需要

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function expandRect(r: RectLike, pad: number): RectLike {
  return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

function rectMinMax(r: RectLike) {
  return { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height };
}

function axisSegmentIntersectsRect(a: IPointData, b: IPointData, r: RectLike) {
  const { x1, y1, x2, y2 } = rectMinMax(r);
  if (a.x === b.x) {
    const x = a.x;
    const yMin = Math.min(a.y, b.y);
    const yMax = Math.max(a.y, b.y);
    return x >= x1 && x <= x2 && yMax >= y1 && yMin <= y2;
  }
  if (a.y === b.y) {
    const y = a.y;
    const xMin = Math.min(a.x, b.x);
    const xMax = Math.max(a.x, b.x);
    return y >= y1 && y <= y2 && xMax >= x1 && xMin <= x2;
  }
  // 非轴对齐：保守处理为不判断（我们的 route 都是轴对齐）
  return false;
}

function polylineLength(points: IPointData[]) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function polylineSegmentLengths(points: IPointData[]) {
  const lens: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    lens.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return lens;
}

export function polylineMidpoint(points: IPointData[]): IPointData {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const total = polylineLength(points);
  if (total <= 0) return points[0]!;
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= half) {
      const t = seg ? (half - acc) / seg : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += seg;
  }
  return points[points.length - 1]!;
}

export function buildRoundedPolylinePath(points: IPointData[], radius: number): string {
  if (!points.length) return "M 0 0";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  if (points.length === 2) return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;

  const rBase = Math.max(0, radius);
  let d = `M ${points[0]!.x} ${points[0]!.y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;

    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 === 0 || len2 === 0) continue;

    const r = Math.min(rBase, len1 / 2, len2 / 2);
    const u1x = v1x / len1;
    const u1y = v1y / len1;
    const u2x = v2x / len2;
    const u2y = v2y / len2;

    const pA = { x: cur.x - u1x * r, y: cur.y - u1y * r };
    const pB = { x: cur.x + u2x * r, y: cur.y + u2y * r };

    d += ` L ${pA.x} ${pA.y} Q ${cur.x} ${cur.y} ${pB.x} ${pB.y}`;
  }

  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export function buildOrthogonalBetween(
  from: IPointData,
  to: IPointData,
  avoidRects: RectLike[],
  options: {
    radius: number;
    intersectionPenalty?: number;
    longStraightRatio?: number;
    longStraightWeight?: number;
    enableSRoutes?: boolean;
  }
): { points: IPointData[]; path: string; mid: IPointData; score: number } {
  /**
   * 智能正交路由（简化版）
   *
   * 思路：
   * - 生成多条候选折线（L 型、S 型）
   * - 对每条候选打分：基础长度 + 穿过避障矩形惩罚 + “过长直线段”惩罚
   * - 取最小分作为最终路径，并用圆角半径做 Q 圆角
   */
  const cand: IPointData[][] = [];
  const bend1 = { x: to.x, y: from.y };
  const bend2 = { x: from.x, y: to.y };
  const midY = (from.y + to.y) / 2;
  const midX = (from.x + to.x) / 2;
  const enableSRoutes = options.enableSRoutes !== false;

  const normalize = (pts: IPointData[]) => {
    const out: IPointData[] = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
    }
    const out2: IPointData[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out2[out2.length - 1];
      const b = out[i]!;
      const c = out[i + 1];
      if (!a || !c) {
        out2.push(b);
        continue;
      }
      const col = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
      if (!col) out2.push(b);
    }
    return out2;
  };

  cand.push(normalize([from, bend1, to]));
  cand.push(normalize([from, bend2, to]));
  if (enableSRoutes) {
    cand.push(normalize([from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]));
    cand.push(normalize([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]));
  }

  const score = (pts: IPointData[]) => {
    let s = polylineLength(pts);
    // 相交惩罚
    const intersectionPenalty = options.intersectionPenalty ?? 1e6;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      for (const r of avoidRects) {
        if (axisSegmentIntersectsRect(a, b, r)) s += intersectionPenalty;
      }
    }
    // 长直线惩罚
    const lens = polylineSegmentLengths(pts);
    const total = lens.reduce((acc, v) => acc + v, 0);
    if (total > 0) {
      const maxSeg = Math.max(...lens, 0);
      const ratio = maxSeg / total;
      const thr = options.longStraightRatio ?? 0.65;
      const w = options.longStraightWeight ?? 2000;
      if (ratio > thr) s += (ratio - thr) * w;
    }
    return s;
  };

  let best = cand[0]!;
  let bestScore = score(best);
  for (let i = 1; i < cand.length; i++) {
    const sc = score(cand[i]!);
    if (sc < bestScore) {
      bestScore = sc;
      best = cand[i]!;
    }
  }

  const mid = polylineMidpoint(best);
  const path = buildRoundedPolylinePath(best, options.radius);
  return { points: best, path, mid, score: bestScore };
}


