import { Group, Path, Rect, type App, type ITextInputData, type IUI } from "leafer-editor";
/**
 * Connector（连线）核心类
 *
 * 关键设计点（中文注释版）：
 * - **坐标系**：路由/避障计算与最终写入 `Path.path` 都使用 Connector 的 local 坐标。
 *   只有在对外回调（如 `onDraw`）时才转换为 world 坐标，避免画布平移/缩放时出现“线条漂移”。
 * - **协同更新**：`updateMode="render"` 时会在 `RenderEvent.END` 触发，并用 `renderThrottleMs` 合并更新。
 * - **重连交互**：拖拽端点结束后用 `tree.pick` 找新节点，`pickFilter/canConnect` 用于过滤候选。
 * - **label**：label 始终放在路径中点，默认加半透明背景遮挡线条，保证可读性。
 */
import type { ConnectorOptions, ConnectorState } from "./types";
export declare class Connector extends Group {
    readonly wire: Path;
    readonly fromHandle: Rect;
    readonly toHandle: Rect;
    private readonly _app;
    private readonly _handleSize;
    private fromNode;
    private toNode;
    private options;
    private _lastKey;
    private _label?;
    private _labelMid;
    private _dragFromWorld;
    private _dragToWorld;
    private _pendingUpdate;
    private _lastRenderUpdateAt;
    private _lastLabelText;
    private _labelChangePending;
    private _boundNodes;
    constructor(app: App, options: ConnectorOptions);
    bind(from: IUI, to: IUI): void;
    invalidate(): void;
    requestUpdate(_reason?: "render" | "invalidate" | "event"): void;
    getState(getNodeId?: (node: IUI) => string): ConnectorState;
    private computeDiff;
    private emitChange;
    private _lastEmittedState;
    setState(state: ConnectorState, resolveNode: (id: string) => IUI | undefined): void;
    setLabelText(text: string): void;
    setLabelStyle(style: Partial<ITextInputData>): void;
    private ensureLabel;
    private openOrCreateLabelEditor;
    private buildCandidatePoints;
    update(): void;
    private positionHandles;
    private positionLabel;
    private applyScaleMode;
    private bindInteractions;
}
//# sourceMappingURL=Connector.d.ts.map