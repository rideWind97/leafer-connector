import type { IPointData, IUI } from "leafer-editor";
import type { ConnectorPort } from "./types";
export declare function setNodePorts(node: IUI, ports: ConnectorPort[]): void;
export declare function getNodePorts(node: IUI): ConnectorPort[] | undefined;
export declare function portAnchor(node: IUI, port: ConnectorPort): IPointData;
export declare function findNearestPort(node: IUI, toward: IPointData): ConnectorPort | undefined;
//# sourceMappingURL=ports.d.ts.map