"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferSideByPoint = inferSideByPoint;
exports.buildCubicBezierPath = buildCubicBezierPath;
exports.getCubicBezierControls = getCubicBezierControls;
exports.getSideFromAnchorSpec = getSideFromAnchorSpec;
const utils_1 = require("./utils");
function inferSideByPoint(node, p) {
    const b = node.worldBoxBounds;
    const left = b.x;
    const top = b.y;
    const right = b.x + b.width;
    const bottom = b.y + b.height;
    const dl = Math.abs(p.x - left);
    const dr = Math.abs(p.x - right);
    const dt = Math.abs(p.y - top);
    const db = Math.abs(p.y - bottom);
    const m = Math.min(dl, dr, dt, db);
    if (m === dl)
        return "left";
    if (m === dr)
        return "right";
    if (m === dt)
        return "top";
    return "bottom";
}
function sideOutDir(side) {
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
function buildCubicBezierPath(from, to, fromSide, toSide, curvature) {
    const { c1, c2 } = getCubicBezierControls(from, to, fromSide, toSide, curvature);
    return `M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;
}
function getCubicBezierControls(from, to, fromSide, toSide, curvature) {
    /**
     * 计算“smooth-step”风格三次贝塞尔控制点
     *
     * 目标：
     * - 视觉上更像流程图/白板工具的连线（先沿端点外法线“出线”，再平滑过渡到目标）
     * - 当两端很近或重叠时，避免控制点过大导致回勾/打圈
     */
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // 将 curvature 视作“张力系数”，默认值 0.4 => multiplier=1
    const tension = (0, utils_1.clamp)(Math.abs(curvature) / 0.4, 0.5, 3);
    const o1 = sideOutDir(fromSide);
    const o2 = sideOutDir(toSide);
    // 是否为“对向”连接（right<->left / top<->bottom）
    const dot = o1.x * o2.x + o1.y * o2.y;
    const isOpposite = dot === -1;
    let c1;
    let c2;
    if (isOpposite) {
        // smooth-step：控制点严格落在两端切线上（水平/垂直）
        if (o1.x !== 0) {
            const primary = Math.abs(dx);
            // 关键：当两端很近（甚至重叠）时，不能使用过大的最小控制距离，否则会产生“回勾/打圈”
            // 策略：控制距离随 primary 收缩，并限制不超过 primary 的一定比例
            const base = primary * 0.5 * tension;
            const k = Math.min((0, utils_1.clamp)(base, 8, 360), primary * 0.9);
            c1 = { x: from.x + o1.x * k, y: from.y };
            c2 = { x: to.x + o2.x * k, y: to.y };
        }
        else {
            const primary = Math.abs(dy);
            const base = primary * 0.5 * tension;
            const k = Math.min((0, utils_1.clamp)(base, 8, 360), primary * 0.9);
            c1 = { x: from.x, y: from.y + o1.y * k };
            c2 = { x: to.x, y: to.y + o2.y * k };
        }
    }
    else {
        // fallback：沿外法线出/入（保守）
        const dist = Math.hypot(dx, dy);
        // 同样避免近距离时的过大控制距离
        const base = dist * 0.35 * tension;
        const k = (0, utils_1.clamp)(base, 8, 300);
        c1 = { x: from.x + o1.x * k, y: from.y + o1.y * k };
        c2 = { x: to.x + o2.x * k, y: to.y + o2.y * k };
    }
    return { c1, c2 };
}
function getSideFromAnchorSpec(spec) {
    if (!spec || typeof spec === "function")
        return undefined;
    if (typeof spec === "string")
        return undefined;
    if (spec.type === "side")
        return spec.side;
    return undefined;
}
//# sourceMappingURL=bezier.js.map