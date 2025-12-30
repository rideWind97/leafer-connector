import { findNearestPort, getNodePorts, portAnchor } from "./ports";
export function centerAnchor(node) {
    const b = node.worldBoxBounds;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
export function sideAnchor(node, side) {
    const b = node.worldBoxBounds;
    switch (side) {
        case "top":
            return { x: b.x + b.width / 2, y: b.y };
        case "right":
            return { x: b.x + b.width, y: b.y + b.height / 2 };
        case "bottom":
            return { x: b.x + b.width / 2, y: b.y + b.height };
        case "left":
            return { x: b.x, y: b.y + b.height / 2 };
    }
}
export function nearestSideMidAnchor(node, toward) {
    // 选择“最近的一条边”，并返回该边的中点（不是射线交点）
    // 规则：比较 4 个边中点到 toward 的距离，取最小值（比 dx/dy 比例更稳定）
    return sideAnchor(node, chooseNearestSide(node, toward));
}
export function chooseNearestSide(node, toward) {
    const sides = ["top", "right", "bottom", "left"];
    let best = "right";
    let bestD = Number.POSITIVE_INFINITY;
    for (const s of sides) {
        const p = sideAnchor(node, s);
        const d = (p.x - toward.x) ** 2 + (p.y - toward.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = s;
        }
    }
    return best;
}
export function nearestEdgeAnchor(node, toward) {
    // 默认：按外接矩形求射线交点；圆角矩形会把交点贴到真实圆弧边界
    const b = node.worldBoxBounds;
    const left = b.x;
    const top = b.y;
    const right = b.x + b.width;
    const bottom = b.y + b.height;
    const cx = left + b.width / 2;
    const cy = top + b.height / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (!dx && !dy)
        return { x: cx, y: cy };
    const halfW = b.width / 2;
    const halfH = b.height / 2;
    const tx = dx ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const ty = dy ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const t = Math.min(tx, ty);
    const p = { x: cx + dx * t, y: cy + dy * t };
    const crRaw = node.cornerRadius;
    if (!crRaw)
        return p;
    const to4 = (r) => {
        if (Array.isArray(r)) {
            const tl = r[0] ?? 0;
            const tr = r[1] ?? tl;
            const br = r[2] ?? tl;
            const bl = r[3] ?? tr;
            return [tl, tr, br, bl];
        }
        return [r, r, r, r];
    };
    let [rtl, rtr, rbr, rbl] = to4(crRaw);
    const maxR = Math.min(halfW, halfH);
    rtl = Math.max(0, Math.min(rtl, maxR));
    rtr = Math.max(0, Math.min(rtr, maxR));
    rbr = Math.max(0, Math.min(rbr, maxR));
    rbl = Math.max(0, Math.min(rbl, maxR));
    const inTopLeft = rtl > 0 && p.x < left + rtl && p.y < top + rtl;
    const inTopRight = rtr > 0 && p.x > right - rtr && p.y < top + rtr;
    const inBottomRight = rbr > 0 && p.x > right - rbr && p.y > bottom - rbr;
    const inBottomLeft = rbl > 0 && p.x < left + rbl && p.y > bottom - rbl;
    if (!inTopLeft && !inTopRight && !inBottomRight && !inBottomLeft)
        return p;
    let ox = 0, oy = 0, r = 0;
    if (inTopLeft) {
        r = rtl;
        ox = left + r;
        oy = top + r;
    }
    else if (inTopRight) {
        r = rtr;
        ox = right - r;
        oy = top + r;
    }
    else if (inBottomRight) {
        r = rbr;
        ox = right - r;
        oy = bottom - r;
    }
    else {
        r = rbl;
        ox = left + r;
        oy = bottom - r;
    }
    // 解射线与圆（圆弧）交点：|(C + v*t) - O| = r
    const vx = dx;
    const vy = dy;
    const fx = cx - ox;
    const fy = cy - oy;
    const a = vx * vx + vy * vy;
    const b2 = 2 * (vx * fx + vy * fy);
    const c0 = fx * fx + fy * fy - r * r;
    const disc = b2 * b2 - 4 * a * c0;
    if (disc <= 0)
        return p;
    const s = Math.sqrt(disc);
    const t1 = (-b2 - s) / (2 * a);
    const t2 = (-b2 + s) / (2 * a);
    const tt = t2 > 0 ? t2 : t1 > 0 ? t1 : t;
    return { x: cx + vx * tt, y: cy + vy * tt };
}
export function resolveAnchor(node, spec, toward) {
    if (typeof spec === "function")
        return spec(node, toward);
    if (spec === "center" || spec.type === "center")
        return centerAnchor(node);
    if (spec.type === "side")
        return sideAnchor(node, spec.side);
    if (spec.type === "nearest-side")
        return nearestSideMidAnchor(node, toward);
    if (spec.type === "nearest-edge")
        return nearestEdgeAnchor(node, toward);
    if (spec.type === "port") {
        const ports = getNodePorts(node);
        if (ports?.length) {
            if (spec.portId) {
                const found = ports.find(p => p.id === spec.portId);
                if (found)
                    return portAnchor(node, found);
            }
            const nearest = findNearestPort(node, toward);
            if (nearest)
                return portAnchor(node, nearest);
        }
        return nearestEdgeAnchor(node, toward);
    }
    return centerAnchor(node);
}
//# sourceMappingURL=anchors.js.map