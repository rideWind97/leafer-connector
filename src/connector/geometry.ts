import type { IBoundsData, IPointData } from "leafer-editor";
import type { ConnectorSide } from "../types";

export function sideOutDir(side: ConnectorSide): { x: number; y: number } {
  switch (side) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
  }
}

export function inferSideByVector(dx: number, dy: number): ConnectorSide {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

export function centerOfBounds(b: IBoundsData): IPointData {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function pointInRect(
  p: IPointData,
  r: { x: number; y: number; width: number; height: number }
) {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function dedupePoints(points: IPointData[]) {
  const out: IPointData[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function cubicBezierPoint(
  p0: IPointData,
  p1: IPointData,
  p2: IPointData,
  p3: IPointData,
  t: number
): IPointData {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}


