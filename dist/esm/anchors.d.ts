import type { IPointData, IUI } from "leafer-editor";
import type { ConnectorAnchorSpec, ConnectorSide } from "./types";
export declare function centerAnchor(node: IUI): IPointData;
export declare function sideAnchor(node: IUI, side: ConnectorSide): IPointData;
export declare function nearestSideMidAnchor(node: IUI, toward: IPointData): IPointData;
export declare function chooseNearestSide(node: IUI, toward: IPointData): ConnectorSide;
export declare function nearestEdgeAnchor(node: IUI, toward: IPointData): IPointData;
export declare function resolveAnchor(node: IUI, spec: ConnectorAnchorSpec | ((node: IUI, toward: IPointData) => IPointData), toward: IPointData): IPointData;
//# sourceMappingURL=anchors.d.ts.map