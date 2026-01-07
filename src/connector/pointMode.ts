import type { IPointData } from "leafer-editor";
import type { ConnectorDrawResult, ConnectorPoint, ConnectorRouteType } from "../types";
import { buildOrthogonalBetween, buildRoundedPolylinePath, polylineMidpoint } from "../route";
import { getCubicBezierControls } from "../bezier";
import { cubicBezierPoint, dedupePoints, inferSideByVector, sideOutDir } from "./geometry";
import { transformSvgPath } from "./svgPath";

export function makePointKey(
  fromW: IPointData,
  toW: IPointData,
  routeType: ConnectorRouteType,
  padding: number,
  cornerRadius: number,
  scaleMode: string
) {
  return `P|${fromW.x.toFixed(1)},${fromW.y.toFixed(1)}|${toW.x.toFixed(1)},${toW.y.toFixed(1)}|${routeType}|${padding}|${cornerRadius}|${scaleMode}`;
}

export function renderPointModeBetween(params: {
  fromW: IPointData;
  toW: IPointData;
  setKey: boolean;
  lastKey: string | null;

  routeType: ConnectorRouteType;
  padding: number;
  cornerRadius: number;
  bezierCurvature: number;
  scaleMode: string;
  routeOptions?: {
    intersectionPenalty?: number;
    longStraightRatio?: number;
    longStraightWeight?: number;
    enableSRoutes?: boolean;
  };

  getLocalPoint: (p: IPointData) => IPointData;
  getWorldPoint: (p: IPointData) => IPointData;

  onDraw?: (param: {
    s: ConnectorPoint;
    e: ConnectorPoint;
    defaultResult: ConnectorDrawResult;
  }) => Partial<ConnectorDrawResult> | void;
}): {
  key: string;
  fastHit: boolean;
  pathLocal: string;
  labelMidLocal: IPointData;
  fromLocal: IPointData;
  toLocal: IPointData;
} {
  const key = makePointKey(
    params.fromW,
    params.toW,
    params.routeType,
    params.padding,
    params.cornerRadius,
    params.scaleMode
  );
  if (params.setKey && params.lastKey === key) {
    return {
      key,
      fastHit: true,
      pathLocal: "",
      labelMidLocal: { x: 0, y: 0 },
      fromLocal: params.getLocalPoint(params.fromW),
      toLocal: params.getLocalPoint(params.toW),
    };
  }

  const fromL = params.getLocalPoint(params.fromW);
  const toL = params.getLocalPoint(params.toW);

  const fromSide = inferSideByVector(toL.x - fromL.x, toL.y - fromL.y);
  const toSide = inferSideByVector(fromL.x - toL.x, fromL.y - toL.y);
  const fromDir = sideOutDir(fromSide);
  const toDir = sideOutDir(toSide);
  const sPadL = { x: fromL.x + fromDir.x * params.padding, y: fromL.y + fromDir.y * params.padding };
  const ePadL = { x: toL.x + toDir.x * params.padding, y: toL.y + toDir.y * params.padding };

  const s: ConnectorPoint = {
    node: undefined,
    side: fromSide,
    percent: 0.5,
    margin: 0,
    padding: params.padding,
    linkPoint: params.fromW,
    paddingPoint: params.getWorldPoint(sPadL),
  };
  const e: ConnectorPoint = {
    node: undefined,
    side: toSide,
    percent: 0.5,
    margin: 0,
    padding: params.padding,
    linkPoint: params.toW,
    paddingPoint: params.getWorldPoint(ePadL),
  };

  let pointsLocal: IPointData[];
  let pathLocal: string;
  let labelMid: IPointData;

  if (params.routeType === "bezier") {
    const { c1, c2 } = getCubicBezierControls(
      sPadL,
      ePadL,
      fromSide,
      toSide,
      params.bezierCurvature
    );
    pathLocal = `M ${fromL.x} ${fromL.y} L ${sPadL.x} ${sPadL.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${ePadL.x} ${ePadL.y} L ${toL.x} ${toL.y}`;
    labelMid = cubicBezierPoint(sPadL, c1, c2, ePadL, 0.5);
    pointsLocal = [fromL, sPadL, ePadL, toL];
  } else if (params.routeType === "straight" || params.routeType === "custom") {
    pointsLocal = dedupePoints([fromL, sPadL, ePadL, toL]);
    pathLocal = buildRoundedPolylinePath(pointsLocal, params.cornerRadius);
    labelMid = polylineMidpoint(pointsLocal);
  } else {
    const mid = buildOrthogonalBetween(sPadL, ePadL, [], {
      radius: params.cornerRadius,
      intersectionPenalty: params.routeOptions?.intersectionPenalty,
      longStraightRatio: params.routeOptions?.longStraightRatio,
      longStraightWeight: params.routeOptions?.longStraightWeight,
      enableSRoutes: params.routeOptions?.enableSRoutes,
    });
    pointsLocal = dedupePoints([fromL, ...mid.points, toL]);
    pathLocal = buildRoundedPolylinePath(pointsLocal, params.cornerRadius);
    labelMid = polylineMidpoint(pointsLocal);
  }

  // onDraw override (world)
  if (params.onDraw) {
    const defaultWorldPoints = pointsLocal.map((p) => params.getWorldPoint(p));
    const defaultWorldPath = transformSvgPath(pathLocal, (p) => params.getWorldPoint(p));
    const defaultResult = { points: defaultWorldPoints, path: defaultWorldPath };
    const override = params.onDraw({ s, e, defaultResult });
    if (override?.path && typeof override.path === "string") {
      pathLocal = transformSvgPath(override.path, (p) => params.getLocalPoint(p));
    }
    if (override?.points?.length) {
      const ptsLocal = dedupePoints(override.points.map((p) => params.getLocalPoint(p)));
      pointsLocal = ptsLocal;
      pathLocal = buildRoundedPolylinePath(ptsLocal, params.cornerRadius);
      labelMid = polylineMidpoint(ptsLocal);
    }
  }

  return {
    key,
    fastHit: false,
    pathLocal,
    labelMidLocal: labelMid,
    fromLocal: fromL,
    toLocal: toL,
  };
}


