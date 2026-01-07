import type { IBoundsData, IPointData, IUI } from "leafer-editor";
import type { ConnectorDrawResult, ConnectorPoint, ConnectorRouteType, ConnectorSide, TargetOption } from "../types";
import { clamp } from "../utils";
import { buildOrthogonalBetween, buildRoundedPolylinePath, expandRect, polylineMidpoint } from "../route";
import { getCubicBezierControls, inferSideByPoint } from "../bezier";
import { cubicBezierPoint, dedupePoints, pointInRect, sideOutDir } from "./geometry";
import { transformSvgPath } from "./svgPath";

export function makeNodeKey(params: {
  fromBounds: IBoundsData;
  toBounds: IBoundsData;
  routeType: ConnectorRouteType;
  padding: number;
  margin: number;
  cornerRadius: number;
  scaleMode: string;
}) {
  const fb = params.fromBounds;
  const tb = params.toBounds;
  return `${fb.x.toFixed(1)},${fb.y.toFixed(1)},${fb.width.toFixed(1)},${fb.height.toFixed(
    1
  )}|${tb.x.toFixed(1)},${tb.y.toFixed(1)},${tb.width.toFixed(1)},${tb.height.toFixed(1)}|${
    params.routeType
  }|${params.padding}|${params.margin}|${params.cornerRadius}|${params.scaleMode}`;
}

export function rectToLocal(getLocalPoint: (p: IPointData) => IPointData, r: IBoundsData) {
  const p1 = getLocalPoint({ x: r.x, y: r.y });
  const p2 = getLocalPoint({ x: r.x + r.width, y: r.y + r.height });
  const x1 = Math.min(p1.x, p2.x);
  const y1 = Math.min(p1.y, p2.y);
  const x2 = Math.max(p1.x, p2.x);
  const y2 = Math.max(p1.y, p2.y);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function buildCandidatePoints(params: {
  node: IUI;
  opt: TargetOption | undefined;
  nodeRectLocal: { x: number; y: number; width: number; height: number };
  otherRectLocal: { x: number; y: number; width: number; height: number };
  paddingDefault: number;
  marginDefault: number;
  getLocalPoint: (p: IPointData) => IPointData;
  getWorldPoint: (p: IPointData) => IPointData;
}): ConnectorPoint[] {
  const percent = clamp(params.opt?.percent ?? 0.5, 0, 1);
  const margin = params.opt?.margin ?? params.marginDefault;
  const padding = params.opt?.padding ?? params.paddingDefault;

  // fixed linkPoint (world)
  if (params.opt?.linkPoint) {
    const lp = params.getLocalPoint(params.opt.linkPoint);
    const side = inferSideByPoint(params.node, params.opt.linkPoint);
    const dir = sideOutDir(side);
    const linkPoint = params.getWorldPoint(lp);
    const paddingPointLocal = { x: lp.x + dir.x * padding, y: lp.y + dir.y * padding };
    const paddingPoint = params.getWorldPoint(paddingPointLocal);
    return [
      {
        node: params.node,
        side,
        percent,
        margin,
        padding,
        linkPoint,
        paddingPoint,
      },
    ];
  }

  const sides: ConnectorSide[] =
    params.opt?.side && params.opt.side !== "auto"
      ? [params.opt.side]
      : ["top", "right", "bottom", "left"];

  const r = expandRect(params.nodeRectLocal, margin);
  const otherExpanded = expandRect(params.otherRectLocal, params.marginDefault);

  const points: ConnectorPoint[] = [];
  for (const s of sides) {
    const linkLocal =
      s === "top"
        ? { x: r.x + r.width * percent, y: r.y }
        : s === "bottom"
        ? { x: r.x + r.width * percent, y: r.y + r.height }
        : s === "left"
        ? { x: r.x, y: r.y + r.height * percent }
        : { x: r.x + r.width, y: r.y + r.height * percent };

    const dir = sideOutDir(s);
    const padLocal = { x: linkLocal.x + dir.x * padding, y: linkLocal.y + dir.y * padding };
    if (pointInRect(padLocal, otherExpanded)) continue;

    points.push({
      node: params.node,
      side: s,
      percent,
      margin,
      padding,
      linkPoint: params.getWorldPoint(linkLocal),
      paddingPoint: params.getWorldPoint(padLocal),
    });
  }

  if (!points.length) {
    for (const s of ["top", "right", "bottom", "left"] as ConnectorSide[]) {
      const linkLocal =
        s === "top"
          ? { x: r.x + r.width * percent, y: r.y }
          : s === "bottom"
          ? { x: r.x + r.width * percent, y: r.y + r.height }
          : s === "left"
          ? { x: r.x, y: r.y + r.height * percent }
          : { x: r.x + r.width, y: r.y + r.height * percent };
      const dir = sideOutDir(s);
      const padLocal = { x: linkLocal.x + dir.x * padding, y: linkLocal.y + dir.y * padding };
      points.push({
        node: params.node,
        side: s,
        percent,
        margin,
        padding,
        linkPoint: params.getWorldPoint(linkLocal),
        paddingPoint: params.getWorldPoint(padLocal),
      });
    }
  }

  return points;
}

export function computeNodeModePath(params: {
  fromNode: IUI;
  toNode: IUI;
  fromBounds: IBoundsData;
  toBounds: IBoundsData;
  routeType: ConnectorRouteType;
  padding: number;
  margin: number;
  cornerRadius: number;
  bezierCurvature: number;
  scaleMode: string;
  opt1?: TargetOption;
  opt2?: TargetOption;
  routeOptions?: {
    avoidPadding?: number;
    intersectionPenalty?: number;
    longStraightRatio?: number;
    longStraightWeight?: number;
    enableSRoutes?: boolean;
    bezierFallbackDistance?: number;
  };
  onDraw?: (param: {
    s: ConnectorPoint;
    e: ConnectorPoint;
    defaultResult: ConnectorDrawResult;
  }) => Partial<ConnectorDrawResult> | void;

  getLocalPoint: (p: IPointData) => IPointData;
  getWorldPoint: (p: IPointData) => IPointData;
}): { pathLocal: string; labelMidLocal: IPointData } | null {
  const fromRectLocal = rectToLocal(params.getLocalPoint, params.fromBounds);
  const toRectLocal = rectToLocal(params.getLocalPoint, params.toBounds);

  const sCandidates = buildCandidatePoints({
    node: params.fromNode,
    opt: params.opt1,
    nodeRectLocal: fromRectLocal,
    otherRectLocal: toRectLocal,
    paddingDefault: params.padding,
    marginDefault: params.margin,
    getLocalPoint: params.getLocalPoint,
    getWorldPoint: params.getWorldPoint,
  });
  const eCandidates = buildCandidatePoints({
    node: params.toNode,
    opt: params.opt2,
    nodeRectLocal: toRectLocal,
    otherRectLocal: fromRectLocal,
    paddingDefault: params.padding,
    marginDefault: params.margin,
    getLocalPoint: params.getLocalPoint,
    getWorldPoint: params.getWorldPoint,
  });

  const avoidRects = [
    expandRect(fromRectLocal, params.routeOptions?.avoidPadding ?? params.margin),
    expandRect(toRectLocal, params.routeOptions?.avoidPadding ?? params.margin),
  ];

  let best:
    | {
        s: ConnectorPoint;
        e: ConnectorPoint;
        pointsLocal: IPointData[];
        pathLocal: string;
        score: number;
        labelMid: IPointData;
      }
    | null = null;

  for (const s of sCandidates) {
    const sLinkL = params.getLocalPoint(s.linkPoint);
    const sPadL = params.getLocalPoint(s.paddingPoint);
    for (const e of eCandidates) {
      const eLinkL = params.getLocalPoint(e.linkPoint);
      const ePadL = params.getLocalPoint(e.paddingPoint);

      let midPoints: IPointData[];
      let midScore = 0;
      if (params.routeType === "straight") {
        midPoints = [sPadL, ePadL];
        midScore = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
      } else if (params.routeType === "bezier") {
        const fromSide = s.side;
        const toSide = e.side;
        const dist = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
        const overlapX =
          fromRectLocal.x < toRectLocal.x + toRectLocal.width &&
          fromRectLocal.x + fromRectLocal.width > toRectLocal.x;
        const overlapY =
          fromRectLocal.y < toRectLocal.y + toRectLocal.height &&
          fromRectLocal.y + fromRectLocal.height > toRectLocal.y;
        const bezFallback = params.routeOptions?.bezierFallbackDistance ?? 140;

        if ((overlapX && overlapY) || dist < bezFallback) {
          const mid = buildOrthogonalBetween(sPadL, ePadL, avoidRects, {
            radius: params.cornerRadius,
            intersectionPenalty: params.routeOptions?.intersectionPenalty,
            longStraightRatio: params.routeOptions?.longStraightRatio,
            longStraightWeight: params.routeOptions?.longStraightWeight,
            enableSRoutes: params.routeOptions?.enableSRoutes,
          });
          const full = dedupePoints([sLinkL, ...mid.points, eLinkL]);
          const pathLocal = buildRoundedPolylinePath(full, params.cornerRadius);
          const labelMid = polylineMidpoint(full);
          const score = mid.score + 1000;
          if (!best || score < best.score) best = { s, e, pointsLocal: full, pathLocal, score, labelMid };
          continue;
        }

        const { c1, c2 } = getCubicBezierControls(
          sPadL,
          ePadL,
          fromSide,
          toSide,
          params.bezierCurvature
        );
        const d = `M ${sLinkL.x} ${sLinkL.y} L ${sPadL.x} ${sPadL.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${ePadL.x} ${ePadL.y} L ${eLinkL.x} ${eLinkL.y}`;
        const labelMid = cubicBezierPoint(sPadL, c1, c2, ePadL, 0.5);
        const score = dist;
        if (!best || score < best.score) {
          best = { s, e, pointsLocal: [sLinkL, sPadL, ePadL, eLinkL], pathLocal: d, score, labelMid };
        }
        continue;
      } else if (params.routeType === "custom") {
        midPoints = [sPadL, ePadL];
        midScore = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
      } else {
        const mid = buildOrthogonalBetween(sPadL, ePadL, avoidRects, {
          radius: params.cornerRadius,
          intersectionPenalty: params.routeOptions?.intersectionPenalty,
          longStraightRatio: params.routeOptions?.longStraightRatio,
          longStraightWeight: params.routeOptions?.longStraightWeight,
          enableSRoutes: params.routeOptions?.enableSRoutes,
        });
        midPoints = mid.points;
        midScore = mid.score;
      }

      const full = dedupePoints([sLinkL, ...midPoints, eLinkL]);
      const pathLocal = buildRoundedPolylinePath(full, params.cornerRadius);
      const labelMid = polylineMidpoint(full);
      const score = midScore;
      if (!best || score < best.score) best = { s, e, pointsLocal: full, pathLocal, score, labelMid };
    }
  }

  if (!best) return null;

  // onDraw override (world)
  if (params.onDraw) {
    const defaultWorldPoints = best.pointsLocal.map((p) => params.getWorldPoint(p));
    const defaultWorldPath = transformSvgPath(best.pathLocal, (p) => params.getWorldPoint(p));
    const defaultResult = { points: defaultWorldPoints, path: defaultWorldPath };
    const override = params.onDraw({ s: best.s, e: best.e, defaultResult });
    if (override?.path && typeof override.path === "string") {
      best.pathLocal = transformSvgPath(override.path, (p) => params.getLocalPoint(p));
    }
    if (override?.points?.length) {
      const ptsLocal = dedupePoints(override.points.map((p) => params.getLocalPoint(p)));
      best.pathLocal = buildRoundedPolylinePath(ptsLocal, params.cornerRadius);
      best.labelMid = polylineMidpoint(ptsLocal);
    }
  }

  return { pathLocal: best.pathLocal, labelMidLocal: best.labelMid };
}


