import type { IPointData, IUI } from "leafer-editor";
import type { ConnectorPort } from "./types";

// --- Ports registry (WeakMap，避免污染 UI 对象) ---
const nodePorts = new WeakMap<IUI, ConnectorPort[]>();

export function setNodePorts(node: IUI, ports: ConnectorPort[]) {
  nodePorts.set(node, ports);
}

export function getNodePorts(node: IUI): ConnectorPort[] | undefined {
  return nodePorts.get(node);
}

export function portAnchor(node: IUI, port: ConnectorPort): IPointData {
  const b = node.worldBoxBounds;
  const unit = port.unit || "percent";
  if (unit === "px") return { x: b.x + port.x, y: b.y + port.y };
  return { x: b.x + b.width * port.x, y: b.y + b.height * port.y };
}

export function findNearestPort(node: IUI, toward: IPointData): ConnectorPort | undefined {
  const ports = getNodePorts(node);
  if (!ports?.length) return undefined;
  let best: ConnectorPort | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of ports) {
    const wp = portAnchor(node, p);
    const d = (wp.x - toward.x) ** 2 + (wp.y - toward.y) ** 2;
    if (d < bestD) bestD = d, (best = p);
  }
  return best;
}


