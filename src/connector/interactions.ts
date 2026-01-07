import { DragEvent, PointerEvent, type App, type IPointData, type IUI, type Path, type Rect } from "leafer-editor";

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

  boundNodes: WeakSet<IUI>;
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
}) {
  // 双击连线：创建/编辑 label
  if (params.labelOnDoubleClick) {
    const onDbl = () => params.openOrCreateLabelEditor();
    params.wire.on_(PointerEvent.DOUBLE_CLICK, onDbl);
    params.wire.on_(PointerEvent.DOUBLE_TAP, onDbl);
  }

  // node-mode：监听节点拖动
  const bindNode = (node: IUI) => {
    if (params.boundNodes.has(node)) return;
    params.boundNodes.add(node);
    node.on_(DragEvent.DRAG, () => params.requestUpdate("event"));
    node.on_(DragEvent.END, () => params.requestUpdate("event"));
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
    params.wire.on_(PointerEvent.CLICK, enterEdit);
    params.wire.on_(PointerEvent.TAP as any, enterEdit);

    const leaveEditIfOutside = (e: any) => {
      if (!params.getEditingPoints()) return;
      const t = e?.target;
      if (t === params.wire || t === params.fromHandle || t === params.toHandle || t === params.getLabelNode()) return;
      params.setEditingPoints(false);
      params.setHandlesVisible(false);
    };
    params.app.tree?.on_?.(PointerEvent.DOWN as any, leaveEditIfOutside);

    const onHandleDrag = (which: "from" | "to") => {
      const handle = which === "from" ? params.fromHandle : params.toHandle;
      handle.on_(DragEvent.DRAG, () => {
        if (!params.getEditingPoints()) return;
        const hx = handle.x ?? 0;
        const hy = handle.y ?? 0;
        const hw = handle.width ?? params.handleSize;
        const hh = handle.height ?? params.handleSize;
        const pLocal = { x: hx + hw / 2, y: hy + hh / 2 };
        const pWorld = params.getWorldPoint(pLocal);
        params.setDragWorld(which, pWorld);
        params.requestUpdate("event");
      });

      handle.on_(DragEvent.END, () => {
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
      });
    };

    onHandleDrag("from");
    onHandleDrag("to");
  }
}


