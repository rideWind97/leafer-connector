import type { IPointData, IUI } from "leafer-editor";
import type { ConnectorAnchorSpec, ConnectorSide } from "./types";
export declare function inferSideByPoint(node: IUI, p: IPointData): ConnectorSide;
export declare function buildCubicBezierPath(from: IPointData, to: IPointData, fromSide: ConnectorSide, toSide: ConnectorSide, curvature: number): string;
export declare function getCubicBezierControls(from: IPointData, to: IPointData, fromSide: ConnectorSide, toSide: ConnectorSide, curvature: number): {
    c1: IPointData;
    c2: IPointData;
};
export declare function getSideFromAnchorSpec(spec: ConnectorAnchorSpec | ((node: IUI, toward: IPointData) => IPointData)): ConnectorSide | undefined;
//# sourceMappingURL=bezier.d.ts.map