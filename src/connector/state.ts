import type { IPointData, IUI } from "leafer-editor";
import type { ConnectorState } from "../types";
import { stableStringify } from "./stableStringify";

export function getConnectorState(params: {
  mode: "node" | "point";
  fromNode: IUI | null;
  toNode: IUI | null;
  fromPointWorld: IPointData | null;
  toPointWorld: IPointData | null;
  options: any;
}): ConnectorState {
  const base = {
    routeType: params.options.routeType,
    padding: params.options.padding,
    margin: params.options.margin,
    cornerRadius: params.options.cornerRadius,
    bezierCurvature: params.options.bezierCurvature,
    opt1: params.options.opt1,
    opt2: params.options.opt2,
    stroke: params.options.stroke,
    strokeWidth: params.options.strokeWidth,
    dashPattern: params.options.dashPattern,
    startArrow: params.options.startArrow,
    endArrow: params.options.endArrow,
    scaleMode: params.options.scaleMode,
    arrowBaseScale: params.options.arrowBaseScale,
    label: params.options.label,
  };

  if (params.mode === "point") {
    if (!params.fromPointWorld || !params.toPointWorld) {
      throw new Error("Connector.getState(point): missing fromPoint/toPoint");
    }
    return {
      mode: "point",
      fromPoint: params.fromPointWorld,
      toPoint: params.toPointWorld,
      ...(base as any),
    };
  }

  const fromId = params.fromNode?.id ?? (params.fromNode as any)?.innerId;
  const toId = params.toNode?.id ?? (params.toNode as any)?.innerId;
  if (!fromId || !toId) throw new Error("Connector.getState: missing fromId/toId");
  return {
    mode: "node",
    fromId,
    toId,
    ...(base as any),
  };
}

export function computeConnectorDiff(prev: ConnectorState, next: ConnectorState) {
  const diff: Partial<ConnectorState> = {};
  const changedKeys: (keyof ConnectorState)[] = [];
  const keys: (keyof ConnectorState)[] = [
    "mode",
    "fromId",
    "toId",
    "fromPoint",
    "toPoint",
    "routeType",
    "padding",
    "margin",
    "cornerRadius",
    "bezierCurvature",
    "opt1",
    "opt2",
    "stroke",
    "strokeWidth",
    "dashPattern",
    "startArrow",
    "endArrow",
    "scaleMode",
    "arrowBaseScale",
    "label",
  ];
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    const same =
      typeof a === "object" || typeof b === "object"
        ? stableStringify(a) === stableStringify(b)
        : a === b;
    if (!same) {
      (diff as any)[k] = b;
      changedKeys.push(k);
    }
  }
  return { diff, changedKeys };
}


