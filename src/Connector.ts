import {
  DragEvent,
  Group,
  Path,
  Rect,
  RenderEvent,
  PointerEvent,
  InnerEditorEvent,
  Text,
  LeafList,
  type App,
  type IArrowStyle,
  type IPointData,
  type ITextInputData,
  type IUI,
  type IBoundsData,
} from "leafer-editor";

/**
 * Connector（连线）核心类
 *
 * 关键设计点（中文注释版）：
 * - **坐标系**：路由/避障计算与最终写入 `Path.path` 都使用 Connector 的 local 坐标。
 *   只有在对外回调（如 `onDraw`）时才转换为 world 坐标，避免画布平移/缩放时出现“线条漂移”。
 * - **协同更新**：`updateMode="render"` 时会在 `RenderEvent.END` 触发，并用 `renderThrottleMs` 合并更新。
 * - **label**：label 始终放在路径中点，默认加半透明背景遮挡线条，保证可读性。
 */

import type {
  ConnectorOptions,
  ConnectorPoint,
  ConnectorRouteType,
  ConnectorSide,
  ConnectorState,
  TargetOption,
} from "./types";
import { clamp } from "./utils";
import {
  buildRoundedPolylinePath,
  buildOrthogonalBetween,
  polylineMidpoint,
  expandRect,
} from "./route";
import { getCubicBezierControls, inferSideByPoint } from "./bezier";

function asArrowStyle(
  style: IArrowStyle | undefined,
  scale?: number
): IArrowStyle | undefined {
  if (!style) return style;
  if (scale == null) return style;
  if (typeof style === "string") return { type: style, scale };
  if (typeof style === "object" && "type" in style) {
    const old = style.scale;
    return { ...style, scale: old != null ? old * scale : scale };
  }
  return style;
}

function sideOutDir(side: ConnectorSide): { x: number; y: number } {
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

function inferSideByVector(dx: number, dy: number): ConnectorSide {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function centerOfBounds(b: IBoundsData): IPointData {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// local 坐标下：点是否落在轴对齐矩形内部（用于有效 side 过滤/避障）
function pointInRect(
  p: IPointData,
  r: { x: number; y: number; width: number; height: number }
) {
  return (
    p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  );
}

// 去掉连续重复点，避免生成 0 长度线段/影响 rounded path
function dedupePoints(points: IPointData[]) {
  const out: IPointData[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

// 计算三次贝塞尔曲线上某个 t 的点（主要用于 label 定位）
function cubicBezierPoint(
  p0: IPointData,
  p1: IPointData,
  p2: IPointData,
  p3: IPointData,
  t: number
): IPointData {
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

function transformSvgPath(
  path: string,
  map: (p: IPointData) => IPointData
): string {
  // 支持命令：M/L/C/Q/Z（绝对坐标）
  // 用于 world <-> local 的 path 坐标批量转换（onDraw 入参/出参都走这里）
  const segRe = /([MLCQZ])([^MLCQZ]*)/gi;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(path))) {
    const cmd = m[1]!;
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
      .map((n) => Number(n));
    if (!nums.length) {
      out += `${cmd} `;
      continue;
    }
    const mapped: number[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      if (typeof x !== "number" || typeof y !== "number") break;
      const p = map({ x, y });
      mapped.push(p.x, p.y);
    }
    out += `${cmd} ${mapped.join(" ")} `;
  }
  return out.trim();
}

function stableStringify(value: any): string {
  // 用于 onChange.diff：将对象做 means-preserving 的“稳定序列化”，避免 key 顺序不同导致误判
  const seen = new WeakSet<object>();
  const norm = (v: any): any => {
    if (v == null) return v;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (t === "bigint") return String(v);
    if (t === "function") return undefined;
    if (Array.isArray(v)) return v.map(norm);
    if (t === "object") {
      if (seen.has(v)) return undefined;
      seen.add(v);
      const out: any = {};
      const keys = Object.keys(v).sort();
      for (const k of keys) {
        const nv = norm(v[k]);
        if (nv !== undefined) out[k] = nv;
      }
      return out;
    }
    return undefined;
  };
  return JSON.stringify(norm(value));
}

export class Connector extends Group {
  readonly wire: Path;
  readonly fromHandle: Rect;
  readonly toHandle: Rect;

  private readonly _app: App;

  private readonly _handleSize: number;

  private _mode: "node" | "point";

  private fromNode: IUI | null = null;
  private toNode: IUI | null = null;
  private fromPointWorld: IPointData | null = null;
  private toPointWorld: IPointData | null = null;

  private _editingPoints = false;
  private _dragFromWorld: IPointData | null = null;
  private _dragToWorld: IPointData | null = null;
  private options: Required<
    Pick<
      ConnectorOptions,
      | "routeType"
      | "padding"
      | "margin"
      | "cornerRadius"
      | "bezierCurvature"
      | "stroke"
      | "strokeWidth"
      | "scaleMode"
      | "arrowBaseScale"
      | "labelOnDoubleClick"
    >
  > &
    Omit<
      ConnectorOptions,
      | "routeType"
      | "padding"
      | "margin"
      | "cornerRadius"
      | "bezierCurvature"
      | "stroke"
      | "strokeWidth"
      | "scaleMode"
      | "arrowBaseScale"
      | "labelOnDoubleClick"
    >;

  private _lastKey: string | null = null;

  private _label?: Text;
  private _labelMid: IPointData | null = null;

  private _pendingUpdate = false;
  private _lastRenderUpdateAt = 0;

  private _lastLabelText: string | null = null;
  private _labelChangePending = false;
  private _boundNodes = new WeakSet<IUI>();

  private setHandlesVisible(visible: boolean) {
    this.fromHandle.visible = visible;
    this.toHandle.visible = visible;
  }

  private positionHandles(fromLocal: IPointData, toLocal: IPointData) {
    const hw = (this.fromHandle.width ?? this._handleSize) / 2;
    const hh = (this.fromHandle.height ?? this._handleSize) / 2;
    this.fromHandle.set({ x: fromLocal.x - hw, y: fromLocal.y - hh });
    this.toHandle.set({ x: toLocal.x - hw, y: toLocal.y - hh });
  }

  private renderPointModeBetween(fromW: IPointData, toW: IPointData, setKey: boolean) {
    const fw = fromW;
    const tw = toW;
    const key = `P|${fw.x.toFixed(1)},${fw.y.toFixed(1)}|${tw.x.toFixed(1)},${tw.y.toFixed(1)}|${this.options.routeType}|${this.options.padding}|${this.options.cornerRadius}|${this.options.scaleMode}`;
    if (setKey) {
      if (this._lastKey === key) {
        if (this._label && this._labelMid) this._label.set({ x: this._labelMid.x, y: this._labelMid.y });
        if (this._editingPoints) {
          this.positionHandles(this.getLocalPoint(fw), this.getLocalPoint(tw));
        }
        return;
      }
      this._lastKey = key;
    }

    const routeType: ConnectorRouteType = this.options.routeType;
    const fromL = this.getLocalPoint(fw);
    const toL = this.getLocalPoint(tw);

    const fromSide = inferSideByVector(toL.x - fromL.x, toL.y - fromL.y);
    const toSide = inferSideByVector(fromL.x - toL.x, fromL.y - toL.y);
    const pad = this.options.padding ?? 0;
    const sPadL = {
      x: fromL.x + sideOutDir(fromSide).x * pad,
      y: fromL.y + sideOutDir(fromSide).y * pad,
    };
    const ePadL = {
      x: toL.x + sideOutDir(toSide).x * pad,
      y: toL.y + sideOutDir(toSide).y * pad,
    };

    const s: ConnectorPoint = {
      node: undefined,
      side: fromSide,
      percent: 0.5,
      margin: 0,
      padding: pad,
      linkPoint: fw,
      paddingPoint: this.getWorldPoint(sPadL),
    };
    const e: ConnectorPoint = {
      node: undefined,
      side: toSide,
      percent: 0.5,
      margin: 0,
      padding: pad,
      linkPoint: tw,
      paddingPoint: this.getWorldPoint(ePadL),
    };

    let pointsLocal: IPointData[];
    let pathLocal: string;
    let labelMid: IPointData;

    if (routeType === "bezier") {
      const { c1, c2 } = getCubicBezierControls(
        sPadL,
        ePadL,
        fromSide,
        toSide,
        this.options.bezierCurvature
      );
      pathLocal = `M ${fromL.x} ${fromL.y} L ${sPadL.x} ${sPadL.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${ePadL.x} ${ePadL.y} L ${toL.x} ${toL.y}`;
      labelMid = cubicBezierPoint(sPadL, c1, c2, ePadL, 0.5);
      pointsLocal = [fromL, sPadL, ePadL, toL];
    } else if (routeType === "straight" || routeType === "custom") {
      pointsLocal = dedupePoints([fromL, sPadL, ePadL, toL]);
      pathLocal = buildRoundedPolylinePath(pointsLocal, this.options.cornerRadius);
      labelMid = polylineMidpoint(pointsLocal);
    } else {
      const mid = buildOrthogonalBetween(sPadL, ePadL, [], {
        radius: this.options.cornerRadius,
        intersectionPenalty: this.options.routeOptions?.intersectionPenalty,
        longStraightRatio: this.options.routeOptions?.longStraightRatio,
        longStraightWeight: this.options.routeOptions?.longStraightWeight,
        enableSRoutes: this.options.routeOptions?.enableSRoutes,
      });
      pointsLocal = dedupePoints([fromL, ...mid.points, toL]);
      pathLocal = buildRoundedPolylinePath(pointsLocal, this.options.cornerRadius);
      labelMid = polylineMidpoint(pointsLocal);
    }

    // onDraw override (world)
    const defaultWorldPoints = pointsLocal.map((p) => this.getWorldPoint(p));
    const defaultWorldPath = transformSvgPath(pathLocal, (p) => this.getWorldPoint(p));
    const defaultResult = { points: defaultWorldPoints, path: defaultWorldPath };
    if (this.options.onDraw) {
      const override = this.options.onDraw({ s, e, defaultResult });
      if (override?.path && typeof override.path === "string") {
        pathLocal = transformSvgPath(override.path, (p) => this.getLocalPoint(p));
      }
      if (override?.points?.length) {
        const ptsLocal = dedupePoints(override.points.map((p) => this.getLocalPoint(p)));
        pointsLocal = ptsLocal;
        pathLocal = buildRoundedPolylinePath(ptsLocal, this.options.cornerRadius);
        labelMid = polylineMidpoint(ptsLocal);
      }
    }

    this.wire.path = pathLocal;
    this._labelMid = labelMid;
    if (this._label) this._label.set({ x: labelMid.x, y: labelMid.y });
    if (this._editingPoints) this.positionHandles(fromL, toL);
    this.applyScaleMode();
  }

  /**
   * 删除 label 节点（当用户清空文本时）
   * - 会同步清理 this.options.label，确保 getState/onChange 结果一致
   */
  private removeLabelNode(oldText?: string) {
    const label = this._label;
    if (!label) return;

    // 尽可能从树中移除（不同版本 API 可能叫 remove/removeSelf）
    const anyLabel = label as Text;
    anyLabel.destroy();

    this._label = undefined;
    this._labelMid = null;
    this._lastLabelText = null;
    this.options.label = undefined;
    // 关键：删除 label 后清掉 key，让下一次 update() 必定重算（否则会被 key 去重跳过，导致新建 label 坐标不更新）
    this._lastKey = null;

    // 删除也视为一次 label 变化：对外通知（用于协同）
    const prev = String(oldText ?? "");
    if (prev.trim() !== "") {
      this.options.onLabelChange?.({ oldText: prev, newText: "" });
    }
    this.emitChange("label");
    this.requestUpdate("event");
  }

  constructor(app: App, options: ConnectorOptions) {
    super({});
    this._app = app;
    // mode detect
    const hasPoints = "fromPoint" in options && "toPoint" in options;
    this._mode = hasPoints ? "point" : "node";
    if (this._mode === "node") {
      // union narrowing ensures from/to exist
      this.fromNode = (options as any).from;
      this.toNode = (options as any).to;
    } else {
      this.fromPointWorld = (options as any).fromPoint;
      this.toPointWorld = (options as any).toPoint;
    }

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
      // point 模式默认不监听外部变化：manual 更符合“只传点就画线”的预期
      updateMode: options.updateMode ?? (this._mode === "point" ? "manual" : "event"),
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

    // point-mode handles (hidden by default, shown on click)
    // NOTE: supports legacy `handles` (untyped) and new typed `pointHandles`
    const handles = options.pointHandles || (options as any).handles || {};
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
      draggable: true,
      hitStrokeWidth: handles.hitStrokeWidth ?? 12,
      visible: false,
    };
    this.fromHandle = new Rect({ ...handleStyle });
    this.toHandle = new Rect({ ...handleStyle });

    this.addMany(this.wire, this.fromHandle, this.toHandle);

    // 如果用户一开始就传了 label.text，则立即创建显示；如果 text 为空/空白，则不创建（避免出现空 label 节点）
    if (
      this.options.label &&
      String(this.options.label.text ?? "").trim() !== ""
    )
      this.ensureLabel();

    this.bindInteractions();
    this.update();

    // 协同/程序更新场景（可选）
    // point 模式默认不监听 render（除非用户显式指定）
    if (this.options.updateMode === "render") {
      this._app.tree?.on_?.(RenderEvent.END, () =>
        this.requestUpdate("render")
      );
    }
  }

  bind(from: IUI, to: IUI) {
    this._mode = "node";
    this.fromNode = from;
    this.toNode = to;
    this.fromPointWorld = null;
    this.toPointWorld = null;
    this.invalidate();
  }

  bindPoints(from: IPointData, to: IPointData) {
    this._mode = "point";
    this.fromPointWorld = from;
    this.toPointWorld = to;
    this.fromNode = null;
    this.toNode = null;
    this.invalidate();
  }

  isPointMode() {
    return this._mode === "point";
  }

  getPoints(): { from: IPointData; to: IPointData } | null {
    if (this._mode !== "point" || !this.fromPointWorld || !this.toPointWorld)
      return null;
    return { from: this.fromPointWorld, to: this.toPointWorld };
  }

  setPoints(from: IPointData, to: IPointData) {
    this.bindPoints(from, to);
    this.options.onPointsChange?.({ from, to });
    this.emitChange("points");
    this.requestUpdate("event");
  }

  invalidate() {
    this._lastKey = null;
    this.requestUpdate("invalidate");
  }

  requestUpdate(_reason: "render" | "invalidate" | "event" = "event") {
    // render 模式下允许节流，把同一帧/短时间内的多次变化合并成一次 update()
    if (this.options.updateMode === "render") {
      const now = Date.now();
      const throttle = Math.max(0, this.options.renderThrottleMs ?? 0);
      if (throttle > 0 && now - this._lastRenderUpdateAt < throttle) {
        if (this._pendingUpdate) return;
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

  getState(): ConnectorState {
    const base = {
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
    } satisfies Omit<ConnectorState, "mode" | "fromId" | "toId" | "fromPoint" | "toPoint"> as any;

    if (this._mode === "point") {
      if (!this.fromPointWorld || !this.toPointWorld)
        throw new Error("Connector.getState(point): missing fromPoint/toPoint");
      return {
        mode: "point",
        fromPoint: this.fromPointWorld,
        toPoint: this.toPointWorld,
        ...base,
      };
    }

    const fromId = this.fromNode?.id ?? this.fromNode?.innerId;
    const toId = this.toNode?.id ?? this.toNode?.innerId;
    if (!fromId || !toId) throw new Error("Connector.getState: missing fromId/toId");
    return {
      mode: "node",
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

  private computeDiff(prev: ConnectorState, next: ConnectorState) {
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
          ? stableStringify(a as { text?: string; editable?: boolean; style?: Partial<ITextInputData> }) === stableStringify(b as { text?: string; editable?: boolean; style?: Partial<ITextInputData> })
          : a === b;
      if (!same) {
        (diff as any)[k] = b;
        changedKeys.push(k);
      }
    }
    return { diff, changedKeys };
  }

  private emitChange(reason: "label" | "setState" | "points") {
    if (!this.options.onChange) return;
    try {
      const next = this.getState();
      // prev：从 _lastKey 无法逆推，改为缓存一次上次 state
      const prev = this._lastEmittedState || next;
      const { diff, changedKeys } = this.computeDiff(prev, next);
      if (!changedKeys.length) return;
      this._lastEmittedState = next;
      this.options.onChange({ reason, prev, next, diff, changedKeys });
    } catch {
      // 缺少 getNodeId 或其它异常时跳过（避免影响渲染）
    }
  }

  private _lastEmittedState: ConnectorState | null = null;

  setState(
    state: ConnectorState,
    resolveNode: (id: string | number) => IUI | undefined
  ) {
    if (state.mode === "point") {
      if (!state.fromPoint || !state.toPoint)
        throw new Error("Connector.setState(point): missing fromPoint/toPoint");
      this.bindPoints(state.fromPoint, state.toPoint);
    } else {
      const from = resolveNode(state.fromId!);
      const to = resolveNode(state.toId!);
      if (!from || !to)
        throw new Error("Connector.setState: resolveNode failed for fromId/toId");
      this.bind(from, to);
    }

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
    this.options.arrowBaseScale =
      state.arrowBaseScale ?? this.options.arrowBaseScale;

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
      if (state.label.text != null) this._label!.text = state.label.text;
      if (state.label.style) this.setLabelStyle(state.label.style);
    }

    this.invalidate();
    this._lastEmittedState = state;
    this.emitChange("setState");
  }

  setLabelText(text: string) {
    // 规范化：
    // - 允许回车换行（不要剔除 \n/\r）
    // - 去掉整体前后空白字符（用户提的“前后空字符”）
    const next = String(text ?? "").trim();
    // 空文本：删除 label 节点
    if (next === "") {
      const old = String(this._label?.text ?? this.options.label?.text ?? "");
      this.removeLabelNode(old);
      return;
    }

    const label = this.ensureLabel();
    const old = String(label.text ?? "");
    label.text = next;
    const now = String(label.text ?? "");

    // 同步到 options（用于 getState/onChange）
    this.options.label = { ...(this.options.label || {}), text: now };

    if (old !== now) {
      this.options.onLabelChange?.({ oldText: old, newText: now });
      this.emitChange("label");
    }
    this.requestUpdate("event");
  }

  setLabelStyle(style: Partial<ITextInputData>) {
    const label = this.ensureLabel();
    label.set({
      ...style,
      textAlign: "center",
      verticalAlign: "middle",
      autoSizeAlign: true,
    });
    this.requestUpdate("event");
  }

  private ensureLabel() {
    if (this._label) return this._label;
    const cfg = this.options.label || {};
    const style = (cfg.style || {}) as Partial<ITextInputData>;

    // 默认背景遮线（用户自定义 boxStyle/padding 时不覆盖）
    // 目的：label 永远可读，不会被线条穿过影响识别
    const withDefaultBg: Partial<ITextInputData> = { fill: "#ffffff", fontSize: 12, padding: [2, 6], boxStyle: { fill: "#00000099", cornerRadius: 6 }, ...style };

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
    // 同步：确保 options.label 至少包含当前 text（用于 getState/onChange）
    this.options.label = {
      ...cfg,
      text: String(label.text ?? ""),
    };
    this.add(label);
    // 关键：新建 label 后清掉 key，强制下一次 update() 计算 labelMid 并把 label 放回连线中点
    this._lastKey = null;
    this.update();

    // 编辑关闭：做一次最终规范化（去掉前后空白）；若清空则删除 label 节点
    label.on_(InnerEditorEvent.CLOSE, () => {
      if (this._label !== label) return;
      // CLOSE 时做最终规范化：允许回车换行，仅做 trim
      const raw = String(label.text ?? "");
      const trimmed = raw.trim();
      const prev = String(this._lastLabelText ?? "");

      if (trimmed === "") {
        this.removeLabelNode(prev);
        return;
      }

      if (trimmed !== raw) label.text = trimmed;
      this._lastLabelText = trimmed;
      this.options.label = {
        ...(this.options.label || {}),
        text: trimmed,
      };

      const editor = label.app.editor;
      if (!editor) return;
      if (editor.getItem?.() === label) editor.cancel?.();

      if (prev !== trimmed) {
        this.options.onLabelChange?.({ oldText: prev, newText: trimmed });
        this.emitChange("label");
      }
      this.requestUpdate("event");
    });

    // 监听 label 文本变化：用 RenderEvent.END 兜底（编辑器输入时一般会触发渲染）
    label.on_(RenderEvent.END, () => {
      // 若 label 已被删除（例如用户清空文本触发 remove），则忽略后续事件
      if (this._label !== label) return;
      const cur = String(label.text ?? "");
      const prev = this._lastLabelText ?? "";
      if (cur === prev) return;
      this._lastLabelText = cur;

      // 合并同一微任务内的多次输入（避免 END 事件过于频繁导致 onLabelChange 抖动）
      // 注意：这里选择 microtask，而不是 setTimeout(0)，是为了尽量在同一帧内完成合并。
      if (this._labelChangePending) return;
      this._labelChangePending = true;
      queueMicrotask(() => {
        this._labelChangePending = false;
        if (this._label !== label) return;
        let now = String(label.text ?? "");
        const old = prev;

        // 允许回车换行：不再剔除换行符

        // 规则：trim 后为空 => 删除 label 节点
        if (now.trim() === "") {
          this.removeLabelNode(old);
          return;
        }

        if (now !== old) {
          // 同步到 options（用于 getState/onChange）
          this.options.label = {
            ...(this.options.label || {}),
            text: now,
          };
          this.options.onLabelChange?.({ oldText: old, newText: now });
          this.emitChange("label");
          this.requestUpdate("event");
        }
      });
    });

    return label;
  }

  private openOrCreateLabelEditor() {
    if (!this._label) {
      const cur = String(this.options.label?.text ?? "");
      if (cur.trim() === "") {
        this.options.label = {
          ...(this.options.label || {}),
          text: "默认文案",
          editable: true,
        };
      }
    }
    this.ensureLabel();
    // 再 update 一次兜底：保证 labelMid 已产生（尤其是刚刚重建 label 的场景）
    this.update();
  }

  private buildCandidatePoints(
    node: IUI,
    opt: TargetOption | undefined,
    nodeRectLocal: { x: number; y: number; width: number; height: number },
    otherRectLocal: { x: number; y: number; width: number; height: number }
  ): ConnectorPoint[] {
    const percent = clamp(opt?.percent ?? 0.5, 0, 1);
    const margin = opt?.margin ?? this.options.margin;
    const padding = opt?.padding ?? this.options.padding;

    // fixed linkPoint (world)
    if (opt?.linkPoint) {
      const lp = this.getLocalPoint(opt.linkPoint);
      const side = inferSideByPoint(node, opt.linkPoint);
      const dir = sideOutDir(side);
      const linkPoint = this.getWorldPoint(lp);
      const paddingPointLocal = {
        x: lp.x + dir.x * padding,
        y: lp.y + dir.y * padding,
      };
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

    const sides: ConnectorSide[] =
      opt?.side && opt.side !== "auto"
        ? [opt.side]
        : ["top", "right", "bottom", "left"];

    // 用 local rect 计算点位（避免画布平移/缩放带来的 world 误差）
    // 这是修复“平移画布后连线漂移”的关键：Path.path 需要写 local 坐标
    const r = expandRect(nodeRectLocal, margin);
    const otherExpanded = expandRect(otherRectLocal, this.options.margin);

    const points: ConnectorPoint[] = [];
    for (const s of sides) {
      const linkLocal =
        s === "top"
          ? { x: r.x + r.width * percent, y: r.y }
          : s === "bottom"
          ? { x: r.x + r.width * percent, y: r.y + r.height }
          : s === "left"
          ? { x: r.x, y: r.y + r.height * percent }
          : { x: r.x + r.width, y: r.y + r.height * percent };

      const dir = sideOutDir(s);
      const padLocal = {
        x: linkLocal.x + dir.x * padding,
        y: linkLocal.y + dir.y * padding,
      };

      // valid side：padding 点落入对方 bounds 则判无效（避免“出线就插进对方节点内部”）
      if (pointInRect(padLocal, otherExpanded)) continue;

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
      for (const s of ["top", "right", "bottom", "left"] as ConnectorSide[]) {
        const linkLocal =
          s === "top"
            ? { x: r.x + r.width * percent, y: r.y }
            : s === "bottom"
            ? { x: r.x + r.width * percent, y: r.y + r.height }
            : s === "left"
            ? { x: r.x, y: r.y + r.height * percent }
            : { x: r.x + r.width, y: r.y + r.height * percent };
        const dir = sideOutDir(s);
        const padLocal = {
          x: linkLocal.x + dir.x * padding,
          y: linkLocal.y + dir.y * padding,
        };
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

    // 1) 拖拽优先（point-mode handles）
    if (this._dragFromWorld || this._dragToWorld) {
      const fromW =
        this._dragFromWorld ??
        (this._mode === "point"
          ? this.fromPointWorld
          : this.fromNode
          ? centerOfBounds(this.fromNode.worldBoxBounds)
          : null);
      const toW =
        this._dragToWorld ??
        (this._mode === "point"
          ? this.toPointWorld
          : this.toNode
          ? centerOfBounds(this.toNode.worldBoxBounds)
          : null);
      if (!fromW || !toW) return;

      // point-mode: keep routeType during drag preview
      if (this._mode === "point") {
        this.renderPointModeBetween(fromW, toW, false);
        return;
      }

      // node-mode drag preview (fallback to straight)
      const fromL = this.getLocalPoint(fromW);
      const toL = this.getLocalPoint(toW);
      this.wire.path = `M ${fromL.x} ${fromL.y} L ${toL.x} ${toL.y}`;
      this._labelMid = { x: (fromL.x + toL.x) / 2, y: (fromL.y + toL.y) / 2 };
      if (this._label) this._label.set({ x: this._labelMid.x, y: this._labelMid.y });
      this.applyScaleMode();
      return;
    }

    // 2) point-mode：基于两个点计算连线（无节点，无需监听）
    if (this._mode === "point") {
      if (!this.fromPointWorld || !this.toPointWorld) return;
      this.renderPointModeBetween(this.fromPointWorld, this.toPointWorld, true);
      return;
    }

    // 去重 key：基于两端 bounds + 配置（粗略即可）
    // 协同场景下，频繁 END 帧/坐标同步会调用 update()，key 去重能大幅减少重算/重绘
    if (!this.fromNode || !this.toNode) return;
    const fb = this.fromNode.worldBoxBounds;
    const tb = this.toNode.worldBoxBounds;
    const key = `${fb.x.toFixed(1)},${fb.y.toFixed(1)},${fb.width.toFixed(
      1
    )},${fb.height.toFixed(1)}|${tb.x.toFixed(1)},${tb.y.toFixed(
      1
    )},${tb.width.toFixed(1)},${tb.height.toFixed(1)}|${
      this.options.routeType
    }|${this.options.padding}|${this.options.margin}|${
      this.options.cornerRadius
    }|${this.options.scaleMode}`;
    if (this._lastKey === key) {
      if (this._label && this._labelMid)
        this._label.set({ x: this._labelMid.x, y: this._labelMid.y });
      return;
    }
    this._lastKey = key;

    // world bounds -> local rect
    // 注意：worldBoxBounds 会随着画布/父容器 transform 变化；转换到 local 后再做路由/避障更稳定
    const rectToLocal = (r: IBoundsData) => {
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

    const sCandidates = this.buildCandidatePoints(
      this.fromNode,
      this.options.opt1,
      fromRectLocal,
      toRectLocal
    );
    const eCandidates = this.buildCandidatePoints(
      this.toNode,
      this.options.opt2,
      toRectLocal,
      fromRectLocal
    );

    const avoidRects = [
      expandRect(
        fromRectLocal,
        this.options.routeOptions?.avoidPadding ?? this.options.margin
      ),
      expandRect(
        toRectLocal,
        this.options.routeOptions?.avoidPadding ?? this.options.margin
      ),
    ];

    const routeType: ConnectorRouteType = this.options.routeType;

    let best: {
      s: ConnectorPoint;
      e: ConnectorPoint;
      pointsLocal: IPointData[];
      pathLocal: string;
      score: number;
      labelMid: IPointData;
    } | null = null;

    for (const s of sCandidates) {
      const sLinkL = this.getLocalPoint(s.linkPoint);
      const sPadL = this.getLocalPoint(s.paddingPoint);
      for (const e of eCandidates) {
        const eLinkL = this.getLocalPoint(e.linkPoint);
        const ePadL = this.getLocalPoint(e.paddingPoint);

        // 中间段（从 padding 到 padding）
        // 两端的 linkPoint -> paddingPoint 用于“出线段”；中间段才是 routing（直线/正交/Bezier）
        let midPoints: IPointData[];
        let midScore = 0;
        if (routeType === "straight") {
          midPoints = [sPadL, ePadL];
          midScore = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
        } else if (routeType === "bezier") {
          // bezier：只做中间段的 C；最终还是用 Path 绘制
          // 控制点方向由 side 推导（若 side 为 auto 选出的）
          const fromSide = s.side;
          const toSide = e.side;
          const dist = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
          const overlapX =
            fromRectLocal.x < toRectLocal.x + toRectLocal.width &&
            fromRectLocal.x + fromRectLocal.width > toRectLocal.x;
          const overlapY =
            fromRectLocal.y < toRectLocal.y + toRectLocal.height &&
            fromRectLocal.y + fromRectLocal.height > toRectLocal.y;

          // 近距离/重叠：Bezier 很容易丑（回勾/贴边），自动降级为正交圆角（更像流程图工具）
          const bezFallback =
            this.options.routeOptions?.bezierFallbackDistance ?? 140;
          if ((overlapX && overlapY) || dist < bezFallback) {
            const mid = buildOrthogonalBetween(sPadL, ePadL, avoidRects, {
              radius: this.options.cornerRadius,
              intersectionPenalty:
                this.options.routeOptions?.intersectionPenalty,
              longStraightRatio: this.options.routeOptions?.longStraightRatio,
              longStraightWeight: this.options.routeOptions?.longStraightWeight,
              enableSRoutes: this.options.routeOptions?.enableSRoutes,
            });
            const full = dedupePoints([sLinkL, ...mid.points, eLinkL]);
            const pathLocal = buildRoundedPolylinePath(
              full,
              this.options.cornerRadius
            );
            const labelMid = polylineMidpoint(full);
            const score = mid.score + 1000; // 轻微偏好真 bezier（当两者都可用时）
            if (!best || score < best.score)
              best = { s, e, pointsLocal: full, pathLocal, score, labelMid };
            continue;
          }

          const { c1, c2 } = getCubicBezierControls(
            sPadL,
            ePadL,
            fromSide,
            toSide,
            this.options.bezierCurvature
          );
          const d = `M ${sLinkL.x} ${sLinkL.y} L ${sPadL.x} ${sPadL.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${ePadL.x} ${ePadL.y} L ${eLinkL.x} ${eLinkL.y}`;
          const labelMid = cubicBezierPoint(sPadL, c1, c2, ePadL, 0.5);
          const score = dist;
          if (!best || score < best.score)
            best = {
              s,
              e,
              pointsLocal: [sLinkL, sPadL, ePadL, eLinkL],
              pathLocal: d,
              score,
              labelMid,
            };
          continue;
        } else if (routeType === "custom") {
          // custom：默认仍给出一条可用的“直连 padding”结果，真正自定义交给 onDraw 覆盖
          midPoints = [sPadL, ePadL];
          midScore = Math.hypot(ePadL.x - sPadL.x, ePadL.y - sPadL.y);
        } else {
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
        const pathLocal = buildRoundedPolylinePath(
          full,
          this.options.cornerRadius
        );
        const labelMid = polylineMidpoint(full);
        const score = midScore;

        if (!best || score < best.score)
          best = { s, e, pointsLocal: full, pathLocal, score, labelMid };
      }
    }

    if (!best) return;

    // onDraw（可覆盖）：默认结果以 world 坐标提供
    // 原因：业务侧通常以 world 坐标理解场景；同时可避免误把 local path 当 world 导致漂移
    const defaultWorldPoints = best.pointsLocal.map((p) =>
      this.getWorldPoint(p)
    );
    const defaultWorldPath = transformSvgPath(best.pathLocal, (p) =>
      this.getWorldPoint(p)
    );
    const defaultResult = {
      points: defaultWorldPoints,
      path: defaultWorldPath,
    };
    if (this.options.onDraw) {
      const override = this.options.onDraw({
        s: best.s,
        e: best.e,
        defaultResult,
      });
      if (override?.path && typeof override.path === "string") {
        // path 视为 world 坐标，转成 local 后再写入 Path.path
        best.pathLocal = transformSvgPath(override.path, (p) =>
          this.getLocalPoint(p)
        );
        // label：若没有提供 points，则沿用默认中点
      }
      if (override?.points?.length) {
        const ptsLocal = dedupePoints(
          override.points.map((p) => this.getLocalPoint(p))
        );
        best.pointsLocal = ptsLocal;
        best.pathLocal = buildRoundedPolylinePath(
          ptsLocal,
          this.options.cornerRadius
        );
        best.labelMid = polylineMidpoint(ptsLocal);
      }
    }

    this.wire.path = best.pathLocal;

    // label
    this._labelMid = best.labelMid;
    if (this._label)
      this._label.set({ x: best.labelMid.x, y: best.labelMid.y });

    this.applyScaleMode();
  }

  private applyScaleMode() {
    const strokeTarget: Path = this.wire;
    if (this.options.scaleMode === "pixel") {
      strokeTarget.strokeWidthFixed = true;
      const scale = Math.max(
        Math.abs(strokeTarget.worldTransform.scaleX || 1),
        Math.abs(strokeTarget.worldTransform.scaleY || 1)
      );
      const inv = scale ? 1 / scale : 1;
      const s = inv * this.options.arrowBaseScale;
      strokeTarget.startArrow = asArrowStyle(this.options.startArrow, s);
      strokeTarget.endArrow = asArrowStyle(
        this.options.endArrow ?? "triangle",
        s
      );
    } else {
      strokeTarget.strokeWidthFixed = false;
      strokeTarget.startArrow = this.options.startArrow;
      strokeTarget.endArrow = this.options.endArrow ?? "triangle";
    }
  }

  private bindInteractions() {
    // 双击连线：创建/编辑 label
    if (this.options.labelOnDoubleClick) {
      const onDbl = () => this.openOrCreateLabelEditor();
      this.wire.on_(PointerEvent.DOUBLE_CLICK, onDbl);
      this.wire.on_(PointerEvent.DOUBLE_TAP, onDbl);
    }

    // 监听节点拖动，实时更新
    // 注意：协同场景如果节点是“程序更新位置”，不会触发 DragEvent，需要用 updateMode="render"
    const bindNode = (node: IUI) => {
      if (this._boundNodes.has(node)) return;
      this._boundNodes.add(node);
      node.on_(DragEvent.DRAG, () => this.requestUpdate("event"));
      node.on_(DragEvent.END, () => this.requestUpdate("event"));
    };
    if (this._mode === "node" && this.options.updateMode !== "manual") {
      if (this.fromNode) bindNode(this.fromNode);
      if (this.toNode) bindNode(this.toNode);
    }

    // point-mode：点击进入编辑态，显示可拖拽端点
    const pointsEditable = this.options.pointsEditable !== false;
    if (this._mode === "point" && pointsEditable) {
      const enterEdit = () => {
        if (!this.fromPointWorld || !this.toPointWorld) return;
        this._editingPoints = true;
        this.setHandlesVisible(true);
        this.positionHandles(
          this.getLocalPoint(this.fromPointWorld),
          this.getLocalPoint(this.toPointWorld)
        );
      };
      this.wire.on_(PointerEvent.CLICK, enterEdit);
      // touch
      this.wire.on_(PointerEvent.TAP as any, enterEdit);

      const leaveEditIfOutside = (e: any) => {
        if (!this._editingPoints) return;
        const t = e?.target;
        if (t === this.wire || t === this.fromHandle || t === this.toHandle || t === this._label)
          return;
        this._editingPoints = false;
        this.setHandlesVisible(false);
      };
      this._app.tree?.on_?.(PointerEvent.DOWN as any, leaveEditIfOutside);

      const onHandleDrag = (which: "from" | "to") => {
        const handle = which === "from" ? this.fromHandle : this.toHandle;
        handle.on_(DragEvent.DRAG, () => {
          if (!this._editingPoints) return;
          const hx = handle.x ?? 0;
          const hy = handle.y ?? 0;
          const hw = handle.width ?? this._handleSize;
          const hh = handle.height ?? this._handleSize;
          const pLocal = { x: hx + hw / 2, y: hy + hh / 2 };
          const pWorld = this.getWorldPoint(pLocal);
          if (which === "from") this._dragFromWorld = pWorld;
          else this._dragToWorld = pWorld;
          this.requestUpdate("event");
        });

        handle.on_(DragEvent.END, () => {
          if (!this._editingPoints) return;
          const hx = handle.x ?? 0;
          const hy = handle.y ?? 0;
          const hw = handle.width ?? this._handleSize;
          const hh = handle.height ?? this._handleSize;
          const pLocal = { x: hx + hw / 2, y: hy + hh / 2 };
          const pWorld = this.getWorldPoint(pLocal);

          if (which === "from") {
            this.fromPointWorld = pWorld;
            this._dragFromWorld = null;
          } else {
            this.toPointWorld = pWorld;
            this._dragToWorld = null;
          }

          if (this.fromPointWorld && this.toPointWorld) {
            this.options.onPointsChange?.({ from: this.fromPointWorld, to: this.toPointWorld });
            this.emitChange("points");
          }
          this.invalidate();
        });
      };

      onHandleDrag("from");
      onHandleDrag("to");
    }
  }
}
