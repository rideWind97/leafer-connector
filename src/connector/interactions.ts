import {
  BoundsEvent,
  DragEvent,
  PointerEvent,
  PropertyEvent,
  type App,
  type IPointData,
  type IUI,
  type Path,
  type Rect,
} from "leafer-editor";

export function bindConnectorInteractions(params: {
  app: App;
  mode: "node" | "point";
  updateMode?: string;
  labelOnDoubleClick: boolean;

  wire: Path;
  fromHandle: Rect;
  toHandle: Rect;
  handleSize: number;

  getLabelNode: () => any;
  openOrCreateLabelEditor: () => void;

  boundNodes: Map<IUI, { onDrag: () => void; onEnd: () => void }>;
  fromNode: IUI | null;
  toNode: IUI | null;

  pointsEditable: boolean;
  getPointsWorld: () => { from: IPointData; to: IPointData } | null;
  setEditingPoints: (v: boolean) => void;
  getEditingPoints: () => boolean;
  setHandlesVisible: (visible: boolean) => void;
  positionHandles: (fromLocal: IPointData, toLocal: IPointData) => void;
  setDragWorld: (which: "from" | "to", p: IPointData | null) => void;
  commitPointWorld: (which: "from" | "to", p: IPointData) => void;

  getLocalPoint: (p: IPointData) => IPointData;
  getWorldPoint: (p: IPointData) => IPointData;

  onPointsCommit: () => void;
  requestUpdate: (reason?: "render" | "invalidate" | "event") => void;
  invalidate: () => void;
}): () => void {
  const unsubs: Array<() => void> = [];
  const on = (target: any, type: any, handler: any) => {
    target?.on_?.(type, handler);
    unsubs.push(() => target?.off_?.(type, handler));
  };

  const boundThisTime: IUI[] = [];

  // 双击连线：创建/编辑 label
  if (params.labelOnDoubleClick) {
    const onDbl = () => params.openOrCreateLabelEditor();
    on(params.wire, PointerEvent.DOUBLE_CLICK, onDbl);
    on(params.wire, PointerEvent.DOUBLE_TAP, onDbl);
  }

  // node-mode：监听节点拖动
  const bindNode = (node: IUI) => {
    if (params.boundNodes.has(node)) return;
    const onDrag = () => params.requestUpdate("event");
    const onEnd = () => params.requestUpdate("event");
    // 用于捕捉：编辑器拉伸/缩放导致的“节点本地边界变化”（更语义化，避免监听所有属性）
    const onLocalBounds = () => params.requestUpdate("event");

    // 用于补全：纯位移/旋转/倾斜通常不一定触发 BoundsEvent.LOCAL，但会影响连线定位
    const onAttrChange = (e: any) => {
      const name = e?.attrName;
      if (
        name === "x" ||
        name === "y" ||
        name === "rotation" ||
        name === "skewX" ||
        name === "skewY"
      ) {
        params.requestUpdate("event");
      }
    };
    params.boundNodes.set(node, { onDrag, onEnd });
    boundThisTime.push(node);
    on(node, DragEvent.DRAG, onDrag);
    on(node, DragEvent.END, onEnd);
    on(node, BoundsEvent.LOCAL, onLocalBounds);
    on(node, PropertyEvent.CHANGE, onAttrChange);
  };
  if (params.mode === "node" && params.updateMode !== "manual") {
    if (params.fromNode) bindNode(params.fromNode);
    if (params.toNode) bindNode(params.toNode);
  }

  // point-mode：点击进入编辑态，显示可拖拽端点
  if (params.mode === "point" && params.pointsEditable) {
    const enterEdit = () => {
      const pts = params.getPointsWorld();
      if (!pts) return;
      params.setEditingPoints(true);
      params.setHandlesVisible(true);
      params.positionHandles(params.getLocalPoint(pts.from), params.getLocalPoint(pts.to));
    };
    on(params.wire, PointerEvent.CLICK, enterEdit);
    on(params.wire, PointerEvent.TAP as any, enterEdit);

    const leaveEditIfOutside = (e: any) => {
      if (!params.getEditingPoints()) return;
      const t = e?.target;
      if (t === params.wire || t === params.fromHandle || t === params.toHandle || t === params.getLabelNode()) return;
      params.setEditingPoints(false);
      params.setHandlesVisible(false);
    };
    on(params.app.tree, PointerEvent.DOWN as any, leaveEditIfOutside);

    const onHandleDrag = (which: "from" | "to") => {
      const handle = which === "from" ? params.fromHandle : params.toHandle;
      const onDrag = () => {
        if (!params.getEditingPoints()) return;
        const hx = handle.x ?? 0;
        const hy = handle.y ?? 0;
        const hw = handle.width ?? params.handleSize;
        const hh = handle.height ?? params.handleSize;
        const pLocal = { x: hx + hw / 2, y: hy + hh / 2 };
        const pWorld = params.getWorldPoint(pLocal);
        params.setDragWorld(which, pWorld);
        params.requestUpdate("event");
      };

      const onEnd = () => {
        if (!params.getEditingPoints()) return;
        const hx = handle.x ?? 0;
        const hy = handle.y ?? 0;
        const hw = handle.width ?? params.handleSize;
        const hh = handle.height ?? params.handleSize;
        const pLocal = { x: hx + hw / 2, y: hy + hh / 2 };
        const pWorld = params.getWorldPoint(pLocal);
        params.commitPointWorld(which, pWorld);
        params.setDragWorld(which, null);
        params.onPointsCommit();
        params.invalidate();
      };

      on(handle, DragEvent.DRAG, onDrag);
      on(handle, DragEvent.END, onEnd);
    };

    onHandleDrag("from");
    onHandleDrag("to");
  }

  return () => {
    // unbind event handlers
    for (const u of unsubs.splice(0)) u();
    // remove node bindings from map so future rebinds work
    for (const n of boundThisTime) params.boundNodes.delete(n);
  };
}


