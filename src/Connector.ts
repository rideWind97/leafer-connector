import {
  Group,
  Path,
  Rect,
  RenderEvent,
  type App,
  type IPointData,
  type ITextInputData,
  type IUI,
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
  ConnectorState,
} from "./types";

import { asArrowStyle } from "./connector/arrowStyle";
import { centerOfBounds } from "./connector/geometry";
import { renderPointModeBetween } from "./connector/pointMode";
import { computeNodeModePath, makeNodeKey } from "./connector/nodeMode";
import { LabelManager } from "./connector/LabelManager";
import { bindConnectorInteractions } from "./connector/interactions";
import { computeConnectorDiff, getConnectorState } from "./connector/state";

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

  private _labelMid: IPointData | null = null;
  private readonly _labelManager: LabelManager;

  private _pendingUpdate = false;
  private _lastRenderUpdateAt = 0;

  private _boundNodes = new WeakSet<IUI>();

  private setHandlesVisible(visible: boolean) {
    this.fromHandle.visible = visible;
    this.toHandle.visible = visible;
    // 避免隐藏状态仍可拖拽/触发 drag 事件（更符合“点击进入编辑态”预期）
    this.fromHandle.draggable = visible;
    this.toHandle.draggable = visible;
  }

  private positionHandles(fromLocal: IPointData, toLocal: IPointData) {
    const hw = (this.fromHandle.width ?? this._handleSize) / 2;
    const hh = (this.fromHandle.height ?? this._handleSize) / 2;
    this.fromHandle.set({ x: fromLocal.x - hw, y: fromLocal.y - hh });
    this.toHandle.set({ x: toLocal.x - hw, y: toLocal.y - hh });
  }

  private renderPointModeBetween(fromW: IPointData, toW: IPointData, setKey: boolean) {
    const r = renderPointModeBetween({
      fromW,
      toW,
      setKey,
      lastKey: this._lastKey,
      routeType: this.options.routeType,
      padding: this.options.padding,
      cornerRadius: this.options.cornerRadius,
      bezierCurvature: this.options.bezierCurvature,
      scaleMode: this.options.scaleMode,
      routeOptions: this.options.routeOptions,
      getLocalPoint: (p) => this.getLocalPoint(p),
      getWorldPoint: (p) => this.getWorldPoint(p),
      onDraw: this.options.onDraw,
    });

    // fast path: only follow endpoints/label/handles
    if (setKey && r.fastHit) {
      if (this._labelMid) this._labelManager.setPosition(this._labelMid);
      if (this._editingPoints) this.positionHandles(r.fromLocal, r.toLocal);
      return;
    }

    this._lastKey = r.key;
    this.wire.path = r.pathLocal;
    this._labelMid = r.labelMidLocal;
    this._labelManager.setPosition(r.labelMidLocal);
    if (this._editingPoints) this.positionHandles(r.fromLocal, r.toLocal);
    this.applyScaleMode();
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

    this._labelManager = new LabelManager({
      add: (label) => this.add(label),
      updateNow: () => this.update(),
      invalidateKey: () => {
        this._lastKey = null;
      },
      emitChange: () => this.emitChange("label"),
      requestUpdate: (r) => this.requestUpdate(r),
      getLabelConfig: () => this.options.label,
      setLabelConfig: (cfg) => {
        this.options.label = cfg as any;
      },
      onLabelChange: this.options.onLabelChange,
    });

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
      draggable: false,
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
      this._labelManager.ensureLabel();

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
    return getConnectorState({
      mode: this._mode,
      fromNode: this.fromNode,
      toNode: this.toNode,
      fromPointWorld: this.fromPointWorld,
      toPointWorld: this.toPointWorld,
      options: this.options,
    });
  }

  private emitChange(reason: "label" | "setState" | "points") {
    if (!this.options.onChange) return;
    try {
      const next = this.getState();
      // prev：从 _lastKey 无法逆推，改为缓存一次上次 state
      const prev = this._lastEmittedState || next;
      const { diff, changedKeys } = computeConnectorDiff(prev, next);
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
    this._labelManager.applyFromState(state.label);

    this.invalidate();
    this._lastEmittedState = state;
    this.emitChange("setState");
  }

  setLabelText(text: string) {
    this._labelManager.setLabelText(text);
  }

  setLabelStyle(style: Partial<ITextInputData>) {
    this._labelManager.setLabelStyle(style);
  }

  private openOrCreateLabelEditor() {
    this._labelManager.openOrCreateLabelEditor();
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
      this._labelManager.setPosition(this._labelMid);
      this.applyScaleMode();
      return;
    }

    // 2) point-mode：基于两个点计算连线（无节点，无需监听）
    if (this._mode === "point") {
      if (!this.fromPointWorld || !this.toPointWorld) return;
      this.renderPointModeBetween(this.fromPointWorld, this.toPointWorld, true);
      return;
    }

    // node-mode：key去重 + router 计算
    if (!this.fromNode || !this.toNode) return;
    const fb = this.fromNode.worldBoxBounds;
    const tb = this.toNode.worldBoxBounds;
    const key = makeNodeKey({
      fromBounds: fb,
      toBounds: tb,
      routeType: this.options.routeType,
      padding: this.options.padding,
      margin: this.options.margin,
      cornerRadius: this.options.cornerRadius,
      scaleMode: this.options.scaleMode,
    });
    if (this._lastKey === key) {
      if (this._labelMid) this._labelManager.setPosition(this._labelMid);
      return;
    }
    this._lastKey = key;

    const res = computeNodeModePath({
      fromNode: this.fromNode,
      toNode: this.toNode,
      fromBounds: fb,
      toBounds: tb,
      routeType: this.options.routeType,
      padding: this.options.padding,
      margin: this.options.margin,
      cornerRadius: this.options.cornerRadius,
      bezierCurvature: this.options.bezierCurvature,
      scaleMode: this.options.scaleMode,
      opt1: this.options.opt1,
      opt2: this.options.opt2,
      routeOptions: this.options.routeOptions,
      onDraw: this.options.onDraw,
      getLocalPoint: (p) => this.getLocalPoint(p),
      getWorldPoint: (p) => this.getWorldPoint(p),
    });
    if (!res) return;

    this.wire.path = res.pathLocal;
    this._labelMid = res.labelMidLocal;
    this._labelManager.setPosition(res.labelMidLocal);
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
    bindConnectorInteractions({
      app: this._app,
      mode: this._mode,
      updateMode: this.options.updateMode,
      labelOnDoubleClick: this.options.labelOnDoubleClick,
      wire: this.wire,
      fromHandle: this.fromHandle,
      toHandle: this.toHandle,
      handleSize: this._handleSize,
      getLabelNode: () => this._labelManager.label,
      openOrCreateLabelEditor: () => this.openOrCreateLabelEditor(),
      boundNodes: this._boundNodes,
      fromNode: this.fromNode,
      toNode: this.toNode,
      pointsEditable: this.options.pointsEditable !== false,
      getPointsWorld: () => this.getPoints(),
      setEditingPoints: (v) => (this._editingPoints = v),
      getEditingPoints: () => this._editingPoints,
      setHandlesVisible: (v) => this.setHandlesVisible(v),
      positionHandles: (a, b) => this.positionHandles(a, b),
      setDragWorld: (which, p) => {
        if (which === "from") this._dragFromWorld = p;
        else this._dragToWorld = p;
      },
      commitPointWorld: (which, p) => {
        if (which === "from") this.fromPointWorld = p;
        else this.toPointWorld = p;
      },
      getLocalPoint: (p) => this.getLocalPoint(p),
      getWorldPoint: (p) => this.getWorldPoint(p),
      onPointsCommit: () => {
        if (this.fromPointWorld && this.toPointWorld) {
          this.options.onPointsChange?.({ from: this.fromPointWorld, to: this.toPointWorld });
          this.emitChange("points");
        }
      },
      requestUpdate: (r) => this.requestUpdate(r),
      invalidate: () => this.invalidate(),
    });
  }
}
