import type { IArrowStyle, IPointData, ITextInputData, IUI } from "leafer-editor";
export type ConnectorRouteType = "orthogonal" | "bezier" | "straight" | "custom";
export type ConnectorScaleMode = "world" | "pixel";
export type ConnectorSide = "top" | "right" | "bottom" | "left";
export type ConnectorPortUnit = "percent" | "px";
export interface ConnectorPort {
    id: string;
    x: number;
    y: number;
    unit?: ConnectorPortUnit;
}
export type ConnectorAnchorSpec = "center" | {
    type: "center";
} | {
    type: "side";
    side: ConnectorSide;
} | {
    type: "nearest-side";
} | {
    type: "nearest-edge";
} | {
    type: "port";
    portId?: string;
};
export interface ConnectorPoint {
    node: IUI;
    side: ConnectorSide;
    percent: number;
    margin: number;
    padding: number;
    /**
     * 与节点边界相交（考虑 margin）的点（world）
     */
    linkPoint: IPointData;
    /**
     * 从 linkPoint 沿法线方向外扩 padding 后的点（world）
     */
    paddingPoint: IPointData;
}
export interface TargetOption {
    /**
     * 强制连接面：top/right/bottom/left
     * - "auto"：自动在有效 side 中择优
     */
    side?: ConnectorSide | "auto";
    /**
     * 连接点在该面上的比例位置（0~1）
     */
    percent?: number;
    /**
     * 单端 padding（覆盖全局）
     */
    padding?: number;
    /**
     * 单端 margin（覆盖全局）
     */
    margin?: number;
    /**
     * 使用 portId 固定连接点（优先级高于 side/percent）
     */
    portId?: string;
    /**
     * 固定连接点（world 坐标，优先级最高）
     */
    linkPoint?: IPointData;
}
export type ConnectorDrawResult = {
    /**
     * 生成的路径点（world 坐标）
     */
    points: IPointData[];
    /**
     * SVG path 字符串（world 坐标）
     */
    path: string;
};
export interface ConnectorOptions {
    from: IUI;
    to: IUI;
    /**
     * 全局：从边界外扩的距离（出线段长度）
     */
    padding?: number;
    /**
     * 全局：连线与对象之间间距（让线不贴边）
     */
    margin?: number;
    /**
     * 全局：正交/智能路由的圆角半径
     */
    cornerRadius?: number;
    /**
     * 端点配置（单端覆盖）
     */
    opt1?: TargetOption;
    opt2?: TargetOption;
    /**
     * 为节点定义 ports（可选）：用于 opt.portId 吸附
     */
    fromPorts?: ConnectorPort[];
    toPorts?: ConnectorPort[];
    /**
     * 路由类型
     */
    routeType?: ConnectorRouteType;
    /**
     * bezier 张力/曲率（用于控制点强度/或 smart-route 参数），默认 0.6
     */
    bezierCurvature?: number;
    /**
     * 自定义绘制（结构化回调）
     * - 你可以基于默认结果修改 points/path
     */
    onDraw?: (param: {
        s: ConnectorPoint;
        e: ConnectorPoint;
        defaultResult: ConnectorDrawResult;
    }) => Partial<ConnectorDrawResult> | void;
    /**
     * 路由参数（smart-route 参数化）
     */
    routeOptions?: {
        /**
         * 避障 padding：将需要避开的 bounds 外扩多少（local 坐标）
         * - 默认使用 margin
         */
        avoidPadding?: number;
        /**
         * 线段与避障矩形相交的惩罚分（越大越“绕开”）
         */
        intersectionPenalty?: number;
        /**
         * “长直线惩罚”的阈值（maxSegment/total > ratio 开始加惩罚）
         */
        longStraightRatio?: number;
        /**
         * “长直线惩罚”的权重
         */
        longStraightWeight?: number;
        /**
         * 生成候选路径时是否包含 S-route（两次转折）
         */
        enableSRoutes?: boolean;
        /**
         * routeType=bezier 时，距离小于该值会自动降级为 orthogonal（避免回勾/贴边）
         */
        bezierFallbackDistance?: number;
    };
    /**
     * 自动更新模式
     * - event: 仅 DragEvent + 交互触发 update（默认）
     * - render: 每帧 RenderEvent.END 调用 update（适合协同/程序频繁改坐标）
     * - manual: 完全手动（你需要自己调用 connector.update()）
     */
    updateMode?: "event" | "render" | "manual";
    /**
     * render 模式下的节流（ms）
     * - 0 表示不节流（每帧都允许触发，但仍会走内部 key 去重）
     * - 建议协同场景设置 16~33
     */
    renderThrottleMs?: number;
    /**
     * 协同序列化：从节点对象获取 id（用于 getState）
     */
    getNodeId?: (node: IUI) => string;
    /**
     * 重连时 pick 的命中对象过滤/归一化（例如命中子节点后返回可连接的父节点）
     */
    pickFilter?: (pickTarget: IUI) => IUI | null;
    /**
     * 重连时是否允许连接到某个候选节点
     */
    canConnect?: (candidate: IUI, which: "from" | "to") => boolean;
    /**
     * 重连回调
     */
    onReconnect?: (param: {
        which: "from" | "to";
        oldNode: IUI;
        newNode: IUI;
    }) => void;
    /**
     * label 文本变化回调（用于协同同步 label）
     */
    onLabelChange?: (param: {
        oldText: string;
        newText: string;
    }) => void;
    /**
     * 统一变更回调（用于协同同步 connector 状态）
     * - 依赖 getNodeId，缺失时将无法生成 state（会跳过回调）
     */
    onChange?: (param: {
        reason: "reconnect" | "label" | "setState";
        prev: ConnectorState;
        next: ConnectorState;
        diff: Partial<ConnectorState>;
        changedKeys: (keyof ConnectorState)[];
    }) => void;
    stroke?: string;
    strokeWidth?: number;
    dashPattern?: number[];
    startArrow?: IArrowStyle;
    endArrow?: IArrowStyle;
    scaleMode?: ConnectorScaleMode;
    arrowBaseScale?: number;
    handles?: {
        visible?: boolean;
        size?: number;
        fill?: string;
        stroke?: string;
        strokeWidth?: number;
        opacity?: number;
    };
    label?: {
        text?: string;
        editable?: boolean;
        style?: Partial<ITextInputData>;
    };
    labelOnDoubleClick?: boolean;
}
export interface ConnectorState {
    fromId: string;
    toId: string;
    routeType: ConnectorRouteType;
    padding: number;
    margin: number;
    cornerRadius: number;
    bezierCurvature: number;
    opt1?: TargetOption;
    opt2?: TargetOption;
    stroke?: string;
    strokeWidth?: number;
    dashPattern?: number[];
    startArrow?: IArrowStyle;
    endArrow?: IArrowStyle;
    scaleMode?: ConnectorScaleMode;
    arrowBaseScale?: number;
    label?: {
        text?: string;
        editable?: boolean;
        style?: Partial<ITextInputData>;
    };
}
//# sourceMappingURL=types.d.ts.map