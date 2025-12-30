"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setNodePorts = setNodePorts;
exports.getNodePorts = getNodePorts;
exports.portAnchor = portAnchor;
exports.findNearestPort = findNearestPort;
// --- Ports registry (WeakMap，避免污染 UI 对象) ---
const nodePorts = new WeakMap();
function setNodePorts(node, ports) {
    nodePorts.set(node, ports);
}
function getNodePorts(node) {
    return nodePorts.get(node);
}
function portAnchor(node, port) {
    const b = node.worldBoxBounds;
    const unit = port.unit || "percent";
    if (unit === "px")
        return { x: b.x + port.x, y: b.y + port.y };
    return { x: b.x + b.width * port.x, y: b.y + b.height * port.y };
}
function findNearestPort(node, toward) {
    const ports = getNodePorts(node);
    if (!ports?.length)
        return undefined;
    let best;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of ports) {
        const wp = portAnchor(node, p);
        const d = (wp.x - toward.x) ** 2 + (wp.y - toward.y) ** 2;
        if (d < bestD)
            bestD = d, (best = p);
    }
    return best;
}
//# sourceMappingURL=ports.js.map