import { DragEvent, LeafList, Group, Path, Rect, RenderEvent, PointerEvent, Text, } from "leafer-editor";
import { setNodePorts, getNodePorts, portAnchor } from "./ports";
import { clamp } from "./utils";
import { buildRoundedPolylinePath, buildOrthogonalBetween, polylineMidpoint, expandRect } from "./route";
import { getCubicBezierControls, inferSideByPoint } from "./bezier";
function asArrowStyle(style, scale) {
    if (!style)
        return style;
    if (scale == null)
        return style;
    if (typeof style === "string")
        return { type: style, scale };
    if (typeof style === "object" && "type" in style) {
        const old = style.scale;
        return { ...style, scale: old != null ? old * scale : scale };
    }
    return style;
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
// local 坐标下：点是否落在轴对齐矩形内部（用于有效 side 过滤/避障）
function pointInRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}
// 去掉连续重复点，避免生成 0 长度线段/影响 rounded path
function dedupePoints(points) {
    const out = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y)
            out.push(p);
    }
    return out;
}
// 计算三次贝塞尔曲线上某个 t 的点（主要用于 label 定位）
function cubicBezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
}
function transformSvgPath(path, map) {
    // 支持命令：M/L/C/Q/Z（绝对坐标）
    // 用于 world <-> local 的 path 坐标批量转换（onDraw 入参/出参都走这里）
    const segRe = /([MLCQZ])([^MLCQZ]*)/gi;
    let out = "";
    let m;
    while ((m = segRe.exec(path))) {
        const cmd = m[1];
        const body = (m[2] || "").trim();
        if (cmd.toUpperCase() === "Z") {
            out += `${cmd} `;
            continue;
        }
        const nums = body
            .replace(/,/g, " ")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(n => Number(n));
        if (!nums.length) {
            out += `${cmd} `;
            continue;
        }
        const mapped = [];
        for (let i = 0; i < nums.length; i += 2) {
            const x = nums[i];
            const y = nums[i + 1];
            if (typeof x !== "number" || typeof y !== "number")
                break;
            const p = map({ x, y });
            mapped.push(p.x, p.y);
        }
        out += `${cmd} ${mapped.join(" ")} `;
    }
    return out.trim();
}
function stableStringify(value) {
    // 用于 onChange.diff：将对象做 means-preserving 的“稳定序列化”，避免 key 顺序不同导致误判
    const seen = new WeakSet();
    const norm = (v) => {
        if (v == null)
            return v;
        const t = typeof v;
        if (t === "string" || t === "number" || t === "boolean")
            return v;
        if (t === "bigint")
            return String(v);
        if (t === "function")
            return undefined;
        if (Array.isArray(v))
            return v.map(norm);
        if (t === "object") {
            if (seen.has(v))
                return undefined;
            seen.add(v);
            const out = {};
            const keys = Object.keys(v).sort();
            for (const k of keys) {
                const nv = norm(v[k]);
                if (nv !== undefined)
                    out[k] = nv;
            }
            return out;
        }
        return undefined;
    };
    return JSON.stringify(norm(value));
}
export class Connector extends Group {
    constructor(app, options) {
        super({});
        this._lastKey = null;
        this._labelMid = null;
        this._dragFromWorld = null;
        this._dragToWorld = null;
        this._pendingUpdate = false;
        this._lastRenderUpdateAt = 0;
        this._lastLabelText = null;
        this._labelChangePending = false;
        this._boundNodes = new WeakSet();
        this._lastEmittedState = null;
        this._app = app;
        this.fromNode = options.from;
        this.toNode = options.to;
        if (options.fromPorts?.length)
            setNodePorts(this.fromNode, options.fromPorts);
        if (options.toPorts?.length)
            setNodePorts(this.toNode, options.toPorts);
        // 这里先把关键默认值算出来，避免 routeOptions 默认值依赖 margin/padding 时出现顺序问题
        const padding = options.padding ?? 20;
        const margin = options.margin ?? 0;
        // Bezier/Smart-route 的默认参数：你只要 routeType="bezier"，就不需要每次手动传
        const mergedRouteOptions = {
            avoidPadding: options.routeOptions?.avoidPadding ?? margin,
            intersectionPenalty: options.routeOptions?.intersectionPenalty ?? 1e6,
            longStraightRatio: options.routeOptions?.longStraightRatio ?? 0.65,
            longStraightWeight: options.routeOptions?.longStraightWeight ?? 2000,
            enableSRoutes: options.routeOptions?.enableSRoutes ?? true,
            // 你在 demo 里手动传的是 0，这里设为默认值：确保默认“就是贝塞尔”
            // 若你希望近距离自动降级为正交圆角（更稳定），可以显式传 140 或更大
            bezierFallbackDistance: options.routeOptions?.bezierFallbackDistance ?? 0,
        };
        this.options = {
            routeType: options.routeType || "orthogonal",
            padding,
            margin,
            cornerRadius: options.cornerRadius ?? 16,
            bezierCurvature: options.bezierCurvature ?? 0.6,
            stroke: options.stroke || "#ffffff",
            strokeWidth: options.strokeWidth ?? 2,
            scaleMode: options.scaleMode || "world",
            arrowBaseScale: options.arrowBaseScale ?? 1,
            labelOnDoubleClick: options.labelOnDoubleClick ?? true,
            updateMode: options.updateMode ?? "event",
            renderThrottleMs: options.renderThrottleMs ?? 16,
            ...options,
            // 深合并 routeOptions：即使用户只传一部分字段，也能带上默认值
            routeOptions: mergedRouteOptions,
        };
        this.wire = new Path({
            stroke: this.options.stroke,
            strokeWidth: this.options.strokeWidth,
            dashPattern: this.options.dashPattern,
            startArrow: this.options.startArrow,
            endArrow: this.options.endArrow ?? "triangle",
            hitStrokeWidth: 12,
        });
        const handles = options.handles || {};
        const handleVisible = handles.visible === true;
        const handleSize = handles.size ?? 10;
        this._handleSize = handleSize;
        const handleStyle = {
            width: handleSize,
            height: handleSize,
            cornerRadius: handleSize,
            fill: handles.fill ?? "#ffffff",
            stroke: handles.stroke ?? "#000000",
            strokeWidth: handles.strokeWidth ?? 1,
            opacity: handles.opacity ?? 1,
            draggable: handleVisible,
            hitStrokeWidth: 12,
            visible: handleVisible,
        };
        this.fromHandle = new Rect({ ...handleStyle });
        this.toHandle = new Rect({ ...handleStyle });
        this.addMany(this.wire, this.fromHandle, this.toHandle);
        if (this.options.label)
            this.ensureLabel();
        this.bindInteractions();
        this.update();
        // 协同/程序更新场景（可选）
        if (this.options.updateMode === "render") {
            this._app.tree?.on_?.(RenderEvent.END, () => this.requestUpdate("render"));
        }
    }
    bind(from, to) {
        this.fromNode = from;
        this.toNode = to;
        this.invalidate();
    }
    invalidate() {
        this._lastKey = null;
        this.requestUpdate("invalidate");
    }
    requestUpdate(_reason = "event") {
        // render 模式下允许节流，把同一帧/短时间内的多次变化合并成一次 update()
        if (this.options.updateMode === "render") {
            const now = Date.now();
            const throttle = Math.max(0, this.options.renderThrottleMs ?? 0);
            if (throttle > 0 && now - this._lastRenderUpdateAt < throttle) {
                if (this._pendingUpdate)
                    return;
                this._pendingUpdate = true;
                setTimeout(() => {
                    this._pendingUpdate = false;
                    this._lastRenderUpdateAt = Date.now();
                    this.update();
                }, throttle);
                return;
            }
            this._lastRenderUpdateAt = now;
            this.update();
            return;
        }
        // event/manual：不需要节流（用户可以自己做）
        this.update();
    }
    getState(getNodeId) {
        const fn = getNodeId || this.options.getNodeId || ((n) => String(n?.id ?? n?.innerId ?? ""));
        const fromId = fn(this.fromNode);
        const toId = fn(this.toNode);
        if (!fromId || !toId)
            throw new Error("Connector.getState: missing fromId/toId (provide getNodeId)");
        return {
            fromId,
            toId,
            routeType: this.options.routeType,
            padding: this.options.padding,
            margin: this.options.margin,
            cornerRadius: this.options.cornerRadius,
            bezierCurvature: this.options.bezierCurvature,
            opt1: this.options.opt1,
            opt2: this.options.opt2,
            stroke: this.options.stroke,
            strokeWidth: this.options.strokeWidth,
            dashPattern: this.options.dashPattern,
            startArrow: this.options.startArrow,
            endArrow: this.options.endArrow,
            scaleMode: this.options.scaleMode,
            arrowBaseScale: this.options.arrowBaseScale,
            label: this.options.label,
        };
    }
    computeDiff(prev, next) {
        const diff = {};
        const changedKeys = [];
        const keys = [
            "fromId",
            "toId",
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
            const same = typeof a === "object" || typeof b === "object"
                ? stableStringify(a) === stableStringify(b)
                : a === b;
            if (!same) {
                diff[k] = b;
                changedKeys.push(k);
            }
        }
        return { diff, changedKeys };
    }
    emitChange(reason) {
        if (!this.options.onChange)
            return;
        try {
            const next = this.getState();
            // prev：从 _lastKey 无法逆推，改为缓存一次上次 state
            const prev = this._lastEmittedState || next;
            const { diff, changedKeys } = this.computeDiff(prev, next);
            if (!changedKeys.length)
                return;
            this._lastEmittedState = next;
            this.options.onChange({ reason, prev, next, diff, changedKeys });
        }
        catch {
            // 缺少 getNodeId 或其它异常时跳过（避免影响渲染）
        }
    }
    setState(state, resolveNode) {
        const from = resolveNode(state.fromId);
        const to = resolveNode(state.toId);
        if (!from || !to)
            throw new Error("Connector.setState: resolveNode failed for fromId/toId");
        this.fromNode = from;
        this.toNode = to;
        this.options.routeType = state.routeType;
        this.options.padding = state.padding;
        this.options.margin = state.margin;
        this.options.cornerRadius = state.cornerRadius;
        this.options.bezierCurvature = state.bezierCurvature;
        this.options.opt1 = state.opt1;
        this.options.opt2 = state.opt2;
        this.options.stroke = state.stroke ?? this.options.stroke;
        this.options.strokeWidth = state.strokeWidth ?? this.options.strokeWidth;
        this.options.dashPattern = state.dashPattern;
        this.options.startArrow = state.startArrow;
        this.options.endArrow = state.endArrow;
        this.options.scaleMode = state.scaleMode ?? this.options.scaleMode;
        this.options.arrowBaseScale = state.arrowBaseScale ?? this.options.arrowBaseScale;
        // style 直接写到 wire
        this.wire.set({
            stroke: this.options.stroke,
            strokeWidth: this.options.strokeWidth,
            dashPattern: this.options.dashPattern,
            startArrow: this.options.startArrow,
            endArrow: this.options.endArrow ?? "triangle",
        });
        // label
        this.options.label = state.label;
        if (state.label) {
            this.ensureLabel();
            if (state.label.text != null)
                this._label.text = state.label.text;
            if (state.label.style)
                this.setLabelStyle(state.label.style);
        }
        this.invalidate();
        this._lastEmittedState = state;
        this.emitChange("setState");
    }
    setLabelText(text) {
        const label = this.ensureLabel();
        const old = String(label.text ?? "");
        label.text = text;
        const now = String(label.text ?? "");
        if (old !== now) {
            this.options.onLabelChange?.({ oldText: old, newText: now });
            this.emitChange("label");
        }
        this.requestUpdate("event");
    }
    setLabelStyle(style) {
        const label = this.ensureLabel();
        label.set({
            ...style,
            textAlign: "center",
            verticalAlign: "middle",
            autoSizeAlign: true,
        });
        this.requestUpdate("event");
    }
    ensureLabel() {
        if (this._label)
            return this._label;
        const cfg = this.options.label || {};
        const style = (cfg.style || {});
        // 默认背景遮线（用户自定义 boxStyle/padding 时不覆盖）
        // 目的：label 永远可读，不会被线条穿过影响识别
        const withDefaultBg = { ...style };
        if (withDefaultBg.fill == null)
            withDefaultBg.fill = "#ffffff";
        if (withDefaultBg.fontSize == null)
            withDefaultBg.fontSize = 12;
        if (withDefaultBg.padding == null)
            withDefaultBg.padding = [2, 6];
        if (withDefaultBg.boxStyle == null) {
            withDefaultBg.boxStyle = { fill: "#00000099", cornerRadius: 6 };
        }
        const label = new Text({
            ...withDefaultBg,
            text: cfg.text ?? withDefaultBg.text ?? "",
            textAlign: "center",
            verticalAlign: "middle",
            autoSizeAlign: true,
            editable: cfg.editable !== false,
            editConfig: {
                movable: false,
                moveable: false,
                resizeable: false,
                rotateable: false,
                skewable: false,
            },
            draggable: false,
            hitStrokeWidth: 8,
        });
        this._label = label;
        this._lastLabelText = String(label.text ?? "");
        this.add(label);
        this.update();
        // 监听 label 文本变化：用 RenderEvent.END 兜底（编辑器输入时一般会触发渲染）
        label.on_(RenderEvent.END, () => {
            const cur = String(label.text ?? "");
            const prev = this._lastLabelText ?? "";
            if (cur === prev)
                return;
            this._lastLabelText = cur;
            // 合并同一微任务内的多次输入（避免 END 事件过于频繁导致 onLabelChange 抖动）
            // 注意：这里选择 microtask，而不是 setTimeout(0)，是为了尽量在同一帧内完成合并。
            if (this._labelChangePending)
                return;
            this._labelChangePending = true;
            queueMicrotask(() => {
                this._labelChangePending = false;
                const now = String(label.text ?? "");
                const old = prev;
                if (now !== old) {
                    this.options.onLabelChange?.({ oldText: old, newText: now });
                    this.emitChange("label");
                    this.requestUpdate("event");
                }
            });
        });
        return label;
    }
    openOrCreateLabelEditor() {
        const label = this.ensureLabel();
        const editor = this._app?.editor;
        editor?.openInnerEditor?.(label, true);
    }
    buildCandidatePoints(node, opt, nodeRectLocal, otherRectLocal) {
        const percent = clamp(opt?.percent ?? 0.5, 0, 1);
        const margin = opt?.margin ?? this.options.margin;
        const padding = opt?.padding ?? this.options.padding;
        // fixed linkPoint (world)
        if (opt?.linkPoint) {
            const lp = this.getLocalPoint(opt.linkPoint);
            const side = inferSideByPoint(node, opt.linkPoint);
            const dir = sideOutDir(side);
            const linkPoint = this.getWorldPoint(lp);
            const paddingPointLocal = { x: lp.x + dir.x * padding, y: lp.y + dir.y * padding };
            const paddingPoint = this.getWorldPoint(paddingPointLocal);
            return [
                {
                    node,
                    side,
                    percent,
                    margin,
                    padding,
                    linkPoint,
                    paddingPoint,
                },
            ];
        }
        // portId
        if (opt?.portId) {
            const ports = getNodePorts(node);
            const found = ports?.find(p => p.id === opt.portId);
            if (found) {
                const wp = portAnchor(node, found);
                const lp = this.getLocalPoint(wp);
                const side = inferSideByPoint(node, wp);
                const dir = sideOutDir(side);
                const paddingPointLocal = { x: lp.x + dir.x * padding, y: lp.y + dir.y * padding };
                return [
                    {
                        node,
                        side,
                        percent,
                        margin,
                        padding,
                        linkPoint: wp,
                        paddingPoint: this.getWorldPoint(paddingPointLocal),
                    },
                ];
            }
        }
        const sides = opt?.side && opt.side !== "auto" ? [opt.side] : ["top", "right", "bottom", "left"];
        // 用 local rect 计算点位（避免画布平移/缩放带来的 world 误差）
        // 这是修复“平移画布后连线漂移”的关键：Path.path 需要写 local 坐标
        const r = expandRect(nodeRectLocal, margin);
        const otherExpanded = expandRect(otherRectLocal, this.options.margin);
        const points = [];
        for (const s of sides) {
            const linkLocal = s === "top"
                ? { x: r.x + r.width * percent, y: r.y }
                : s === "bottom"
                    ? { x: r.x + r.width * percent, y: r.y + r.height }
                    : s === "left"
                        ? { x: r.x, y: r.y + r.height * percent }
                        : { x: r.x + r.width, y: r.y + r.height * percent };
            const dir = sideOutDir(s);
            const padLocal = { x: linkLocal.x + dir.x * padding, y: linkLocal.y + dir.y * padding };
            // valid side：padding 点落入对方 bounds 则判无效（避免“出线就插进对方节点内部”）
            if (pointInRect(padLocal, otherExpanded))
                continue;
            points.push({
                node,
                side: s,
                percent,
                margin,
                padding,
                linkPoint: this.getWorldPoint(linkLocal),
                paddingPoint: this.getWorldPoint(padLocal),
            });
        }
        // 如果全部被过滤掉：fallback 回所有 side（避免无解）
        if (!points.length) {
            for (const s of ["top", "right", "bottom", "left"]) {
                const linkLocal = s === "top"
                    ? { x: r.x + r.width * percent, y: r.y }
                    : s === "bottom"
                        ? { x: r.x + r.width * percent, y: r.y + r.height }
                        : s === "left"
                            ? { x: r.x, y: r.y + r.height * percent }
                            : { x: r.x + r.width, y: r.y + r.height * percent };
                const dir = sideOutDir(s);
                const padLocal = { x: linkLocal.x + dir.x * padding, y: linkLocal.y + dir.y * padding };
                points.push({
                    node,
                    side: s,
                    percent,
                    margin,
                    padding,
                    linkPoint: this.getWorldPoint(linkLocal),
                    paddingPoint: this.getWorldPoint(padLocal),
                });
            }
        }
        return points;
    }
    update() {
        if (this.options.updateMode === "manual" && this._lastKey != null) {
            // manual 模式：默认不自动更新（除非用户 invalidate / update 触发）
            // 这里不强制 return，因为用户可能手动调用 update() 进行刷新
        }
        // 处理拖拽自由端点（world），优先级最高
        if (this._dragFromWorld || this._dragToWorld) {
            const fromW = this._dragFromWorld ?? this.getWorldPoint(this.getLocalPoint(centerOf(this.fromNode.worldBoxBounds)));
            const toW = this._dragToWorld ?? this.getWorldPoint(this.getLocalPoint(centerOf(this.toNode.worldBoxBounds)));
            const fromL = this.getLocalPoint(fromW);
            const toL = this.getLocalPoint(toW);
            const points = dedupePoints([fromL, toL]);
            const d = `M ${points[0].x} ${points[0].y} L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
            this.wire.path = d;
            this.positionHandles(fromL, toL);
            this.positionLabel(points);
            this.applyScaleMode();
            return;
        }
        // 去重 key：基于两端 bounds + 配置（粗略即可）
        // 协同场景下，频繁 END 帧/坐标同步会调用 update()，key 去重能大幅减少重算/重绘
        const fb = this.fromNode.worldBoxBounds;
        const tb = this.toNode.worldBoxBounds;
        const key = `${fb.x.toFixed(1)},${fb.y.toFixed(1)},${fb.width.toFixed(1)},${fb.height.toFixed(1)}|${tb.x.toFixed(1)},${tb.y.toFixed(1)},${tb.width.toFixed(1)},${tb.height.toFixed(1)}|${this.options.routeType}|${this.options.padding}|${this.options.margin}|${this.options.cornerRadius}|${this.options.scaleMode}`;
        if (this._lastKey === key) {
            if (this._label && this._labelMid)
                this._label.set({ x: this._labelMid.x, y: this._labelMid.y });
            return;
        }
        this._lastKey = key;
        // world bounds -> local rect
        // 注意：worldBoxBounds 会随着画布/父容器 transform 变化；转换到 local 后再做路由/避障更稳定
        const rectToLocal = (r) => {
            const p1 = this.getLocalPoint({ x: r.x, y: r.y });
            const p2 = this.getLocalPoint({ x: r.x + r.width, y: r.y + r.height });
            const x1 = Math.min(p1.x, p2.x);
            const y1 = Math.min(p1.y, p2.y);
            const x2 = Math.max(p1.x, p2.x);
            const y2 = Math.max(p1.y, p2.y);
            return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
        };
        const fromRectLocal = rectToLocal(fb);
        const toRectLocal = rectToLocal(tb);
        const sCandidates = this.buildCandidatePoints(this.fromNode, this.options.opt1, fromRectLocal, toRectLocal);
        const eCandidates = this.buildCandidatePoints(this.toNode, this.options.opt2, toRectLocal, fromRectLocal);
        const avoidRects = [
            expandRect(fromRectLocal, this.options.routeOptions?.avoidPadding ?? this.options.margin),
            expandRect(toRectLocal, this.options.routeOptions?.avoidPadding ?? this.options.margin),
        ];
        const routeType = this.options.routeType;
        let best = null;
        for (const s of sCandidates) {
            const sLinkL = this.getLocalPoint(s.linkPoint);
            const sPadL = this.getLocalPoint(s.paddingPoint);
            for (const e of eCandidates) {
                const eLinkL = this.getLocalPoint(e.linkPoint);
                const ePadL = this.getLocalPoint(e.paddingPoint);
                // 中间段（从 padding 到 padding）
                // 两端的 linkPoint -> paddingPoint 用于“出线段”；中间段才是 routing（直线/正交/Bezier）
                let midPoints;
                let midScore = 0;
                if (routeType === "straight") {
                    midPoints = [sPadL, ePadL];
                    midScore = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
                }
                else if (routeType === "bezier") {
                    // bezier：只做中间段的 C；最终还是用 Path 绘制
                    // 控制点方向由 side 推导（若 side 为 auto 选出的）
                    const fromSide = s.side;
                    const toSide = e.side;
                    const dist = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
                    const overlapX = fromRectLocal.x < toRectLocal.x + toRectLocal.width &&
                        fromRectLocal.x + fromRectLocal.width > toRectLocal.x;
                    const overlapY = fromRectLocal.y < toRectLocal.y + toRectLocal.height &&
                        fromRectLocal.y + fromRectLocal.height > toRectLocal.y;
                    // 近距离/重叠：Bezier 很容易丑（回勾/贴边），自动降级为正交圆角（更像流程图工具）
                    const bezFallback = this.options.routeOptions?.bezierFallbackDistance ?? 140;
                    if ((overlapX && overlapY) || dist < bezFallback) {
                        const mid = buildOrthogonalBetween(sPadL, ePadL, avoidRects, {
                            radius: this.options.cornerRadius,
                            intersectionPenalty: this.options.routeOptions?.intersectionPenalty,
                            longStraightRatio: this.options.routeOptions?.longStraightRatio,
                            longStraightWeight: this.options.routeOptions?.longStraightWeight,
                            enableSRoutes: this.options.routeOptions?.enableSRoutes,
                        });
                        const full = dedupePoints([sLinkL, ...mid.points, eLinkL]);
                        const pathLocal = buildRoundedPolylinePath(full, this.options.cornerRadius);
                        const labelMid = polylineMidpoint(full);
                        const score = mid.score + 1000; // 轻微偏好真 bezier（当两者都可用时）
                        if (!best || score < best.score)
                            best = { s, e, pointsLocal: full, pathLocal, score, labelMid };
                        continue;
                    }
                    const { c1, c2 } = getCubicBezierControls(sPadL, ePadL, fromSide, toSide, this.options.bezierCurvature);
                    const d = `M ${sLinkL.x} ${sLinkL.y} L ${sPadL.x} ${sPadL.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${ePadL.x} ${ePadL.y} L ${eLinkL.x} ${eLinkL.y}`;
                    const labelMid = cubicBezierPoint(sPadL, c1, c2, ePadL, 0.5);
                    const score = dist;
                    if (!best || score < best.score)
                        best = { s, e, pointsLocal: [sLinkL, sPadL, ePadL, eLinkL], pathLocal: d, score, labelMid };
                    continue;
                }
                else if (routeType === "custom") {
                    // custom：默认仍给出一条可用的“直连 padding”结果，真正自定义交给 onDraw 覆盖
                    midPoints = [sPadL, ePadL];
                    midScore = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
                }
                else {
                    const mid = buildOrthogonalBetween(sPadL, ePadL, avoidRects, {
                        radius: this.options.cornerRadius,
                        intersectionPenalty: this.options.routeOptions?.intersectionPenalty,
                        longStraightRatio: this.options.routeOptions?.longStraightRatio,
                        longStraightWeight: this.options.routeOptions?.longStraightWeight,
                        enableSRoutes: this.options.routeOptions?.enableSRoutes,
                    });
                    midPoints = mid.points;
                    midScore = mid.score;
                }
                const full = dedupePoints([sLinkL, ...midPoints, eLinkL]);
                const pathLocal = buildRoundedPolylinePath(full, this.options.cornerRadius);
                const labelMid = polylineMidpoint(full);
                const score = midScore;
                if (!best || score < best.score)
                    best = { s, e, pointsLocal: full, pathLocal, score, labelMid };
            }
        }
        if (!best)
            return;
        // onDraw（可覆盖）：默认结果以 world 坐标提供
        // 原因：业务侧通常以 world 坐标理解场景；同时可避免误把 local path 当 world 导致漂移
        const defaultWorldPoints = best.pointsLocal.map(p => this.getWorldPoint(p));
        const defaultWorldPath = transformSvgPath(best.pathLocal, p => this.getWorldPoint(p));
        const defaultResult = { points: defaultWorldPoints, path: defaultWorldPath };
        if (this.options.onDraw) {
            const override = this.options.onDraw({ s: best.s, e: best.e, defaultResult });
            if (override?.path && typeof override.path === "string") {
                // path 视为 world 坐标，转成 local 后再写入 Path.path
                best.pathLocal = transformSvgPath(override.path, p => this.getLocalPoint(p));
                // label：若没有提供 points，则沿用默认中点
            }
            if (override?.points?.length) {
                const ptsLocal = dedupePoints(override.points.map(p => this.getLocalPoint(p)));
                best.pointsLocal = ptsLocal;
                best.pathLocal = buildRoundedPolylinePath(ptsLocal, this.options.cornerRadius);
                best.labelMid = polylineMidpoint(ptsLocal);
            }
        }
        this.wire.path = best.pathLocal;
        // handle：落在 linkPoint（local）
        const sLinkL = this.getLocalPoint(best.s.linkPoint);
        const eLinkL = this.getLocalPoint(best.e.linkPoint);
        this.positionHandles(sLinkL, eLinkL);
        // label
        this._labelMid = best.labelMid;
        if (this._label)
            this._label.set({ x: best.labelMid.x, y: best.labelMid.y });
        this.applyScaleMode();
    }
    positionHandles(from, to) {
        const fhw = (this.fromHandle.width ?? this._handleSize) / 2;
        const fhh = (this.fromHandle.height ?? this._handleSize) / 2;
        const thw = (this.toHandle.width ?? this._handleSize) / 2;
        const thh = (this.toHandle.height ?? this._handleSize) / 2;
        this.fromHandle.set({ x: from.x - fhw, y: from.y - fhh });
        this.toHandle.set({ x: to.x - thw, y: to.y - thh });
    }
    positionLabel(pointsLocal) {
        if (!this._label)
            return;
        const mid = polylineMidpoint(pointsLocal);
        this._labelMid = mid;
        this._label.set({ x: mid.x, y: mid.y });
    }
    applyScaleMode() {
        const strokeTarget = this.wire;
        if (this.options.scaleMode === "pixel") {
            strokeTarget.strokeWidthFixed = true;
            const scale = Math.max(Math.abs(strokeTarget.worldTransform.scaleX || 1), Math.abs(strokeTarget.worldTransform.scaleY || 1));
            const inv = scale ? 1 / scale : 1;
            const s = inv * this.options.arrowBaseScale;
            strokeTarget.startArrow = asArrowStyle(this.options.startArrow, s);
            strokeTarget.endArrow = asArrowStyle(this.options.endArrow ?? "triangle", s);
        }
        else {
            strokeTarget.strokeWidthFixed = false;
            strokeTarget.startArrow = this.options.startArrow;
            strokeTarget.endArrow = (this.options.endArrow ?? "triangle");
        }
    }
    bindInteractions() {
        // 双击连线：创建/编辑 label
        if (this.options.labelOnDoubleClick) {
            const onDbl = () => this.openOrCreateLabelEditor();
            this.wire.on_(PointerEvent.DOUBLE_CLICK, onDbl);
            this.wire.on_(PointerEvent.DOUBLE_TAP, onDbl);
        }
        // 监听节点拖动，实时更新
        // 注意：协同场景如果节点是“程序更新位置”，不会触发 DragEvent，需要用 updateMode="render"
        const bindNode = (node) => {
            if (this._boundNodes.has(node))
                return;
            this._boundNodes.add(node);
            node.on_(DragEvent.DRAG, () => this.requestUpdate("event"));
            node.on_(DragEvent.END, () => this.requestUpdate("event"));
        };
        if (this.options.updateMode !== "manual") {
            bindNode(this.fromNode);
            bindNode(this.toNode);
        }
        const onHandleDrag = (which) => {
            const handle = which === "from" ? this.fromHandle : this.toHandle;
            handle.on_(DragEvent.DRAG, () => {
                const hx = handle.x ?? 0;
                const hy = handle.y ?? 0;
                const hw = handle.width ?? this._handleSize;
                const hh = handle.height ?? this._handleSize;
                const pLocal = { x: hx + hw / 2, y: hy + hh / 2 };
                const pWorld = this.getWorldPoint(pLocal);
                if (which === "from")
                    this._dragFromWorld = pWorld;
                else
                    this._dragToWorld = pWorld;
                this.requestUpdate("event");
            });
            handle.on_(DragEvent.END, () => {
                const hx = handle.x ?? 0;
                const hy = handle.y ?? 0;
                const hw = handle.width ?? this._handleSize;
                const hh = handle.height ?? this._handleSize;
                const pLocal = { x: hx + hw / 2, y: hy + hh / 2 };
                const pWorld = this.getWorldPoint(pLocal);
                const tree = this._app.tree;
                if (!tree?.pick)
                    return;
                // pick 排除自身/连线/handles/label，避免“捡到自己”导致无法重连
                const exclude = new LeafList([this, this.wire, this.fromHandle, this.toHandle, this._label]);
                const pick = tree.pick(pWorld, { exclude });
                let target = pick?.target;
                if (target && this.options.pickFilter)
                    target = this.options.pickFilter(target) || undefined;
                if (target && this.options.canConnect && !this.options.canConnect(target, which))
                    target = undefined;
                if (target && target !== this.wire && target !== this.fromHandle && target !== this.toHandle) {
                    if (which === "from") {
                        const oldNode = this.fromNode;
                        this.fromNode = target;
                        if (this.options.updateMode !== "manual")
                            bindNode(target);
                        this.options.onReconnect?.({ which, oldNode, newNode: target });
                        this.emitChange("reconnect");
                    }
                    else {
                        const oldNode = this.toNode;
                        this.toNode = target;
                        if (this.options.updateMode !== "manual")
                            bindNode(target);
                        this.options.onReconnect?.({ which, oldNode, newNode: target });
                        this.emitChange("reconnect");
                    }
                    // 重连成功：清掉自由端点
                    if (which === "from")
                        this._dragFromWorld = null;
                    else
                        this._dragToWorld = null;
                }
                else {
                    // 未命中：保持自由端点
                    if (which === "from")
                        this._dragFromWorld = pWorld;
                    else
                        this._dragToWorld = pWorld;
                }
                this.update();
            });
        };
        onHandleDrag("from");
        onHandleDrag("to");
    }
}
function centerOf(b) {
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
//# sourceMappingURL=Connector.js.map