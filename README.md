# leafer-connector

基于 LeaferJS（通过 `leafer-editor`）实现的连接线（Connector / Edge）组件，面向“白板 / 流程图 / 节点图”场景。

你可以把它理解成：**给两个 `IUI` 节点自动画出一条“像流程图工具一样”的连线**，并支持重连、label、协同等能力。

## 能力概览

- **连接 2 个节点**：`from/to: IUI`
- **端点模型**：`padding / margin / side / percent / portId / linkPoint`
- **路由类型**：`orthogonal / bezier / straight / custom`
- **样式**：`stroke / strokeWidth / dashPattern / startArrow / endArrow`
- **缩放策略**：`scaleMode: world | pixel`（线宽/箭头是否随 zoom 缩放）
- **交互**：
  - 端点手柄（handles）拖拽重连（可选，默认隐藏）
  - 双击连线创建/编辑 label（label 永远在路径中点）
- **协同/程序更新**：`updateMode="render"` + `renderThrottleMs`
- **状态同步**：`getState/setState` + `onChange/onLabelChange` 输出 diff

## 安装

```bash
pnpm add leafer-connector leafer-editor
```

> `leafer-editor` 为 peerDependency，需要业务侧安装并锁定版本。

## 快速开始（最小可用）

最小输入参数只有：`app` + `from/to`。

```ts
import { App, Rect } from "leafer-editor";
import { Connector } from "leafer-connector";

const app = new App({ view: container, editor: {} });

const a = new Rect({ x: 100, y: 100, width: 200, height: 160, fill: "#32cd79", draggable: true });
const b = new Rect({ x: 520, y: 280, width: 220, height: 160, fill: "#3b82f6", draggable: true });

const edge = new Connector(app, { from: a, to: b });
app.tree.add([a, b, edge]);
```

## 典型用法（推荐配置）

```ts
import { App, Rect } from "leafer-editor";
import { Connector, setNodePorts } from "leafer-connector";

const app = new App({ view: container, editor: {} });

const a = new Rect({ x: 100, y: 100, width: 200, height: 160, fill: "#32cd79", draggable: true });
const b = new Rect({ x: 520, y: 280, width: 220, height: 160, fill: "#3b82f6", draggable: true });

// 1) ports：给节点注册可连接的“插口”（可选）
setNodePorts(a, [
  { id: "top", x: 0.5, y: 0, unit: "percent" },
  { id: "right", x: 1, y: 0.5, unit: "percent" },
  { id: "bottom", x: 0.5, y: 1, unit: "percent" },
  { id: "left", x: 0, y: 0.5, unit: "percent" },
]);

// 2) 创建连线
const edge = new Connector(app, {
  from: a,
  to: b,

  // 路由类型：默认 orthogonal；如果你希望更“平滑”，用 bezier
  routeType: "bezier",

  // 端点出线段、边距、圆角
  padding: 24,
  margin: 6,
  cornerRadius: 16,

  // bezier 参数（可选，默认 0.6）
  bezierCurvature: 0.6,

  // bezier 的“降级阈值”（可选，默认 0；设为 140 则近距离会转正交圆角更稳定）
  routeOptions: { bezierFallbackDistance: 0 },

  // 样式
  stroke: "#ffffff",
  strokeWidth: 2,
  dashPattern: undefined,
  endArrow: { type: "triangle", scale: 1 },

  // 端点策略（单端覆盖）
  opt1: { side: "auto", percent: 0.5 },
  opt2: { side: "auto", percent: 0.5 },

  // 交互：端点重连手柄（默认隐藏）
  handles: { visible: false },

  // label：双击连线即可编辑，默认会给背景遮挡线条（不传 boxStyle/padding 时）
  label: {
    text: "关系",
    editable: true,
    style: {
      fill: "#ffffff",
      fontSize: 12,
      // boxStyle: { fill: "#00000088", cornerRadius: 6 }, // 你也可以自定义背景
    },
  },
});

app.tree.add([a, b, edge]);
```

## 默认值（重要）

这些默认值来自 `Connector` 构造器与 `src/types.ts`：

- `routeType`: `"orthogonal"`
- `padding`: `20`
- `margin`: `0`
- `cornerRadius`: `16`
- `bezierCurvature`: `0.6`
- `stroke`: `"#ffffff"`
- `strokeWidth`: `2`
- `scaleMode`: `"world"`
- `arrowBaseScale`: `1`
- `labelOnDoubleClick`: `true`
- `updateMode`: `"event"`
- `renderThrottleMs`: `16`
- `handles.visible`: `false`（默认不显示/不可拖拽）
- `routeOptions`（会做深合并）：
  - `avoidPadding`: 默认为 `margin`
  - `intersectionPenalty`: `1e6`
  - `longStraightRatio`: `0.65`
  - `longStraightWeight`: `2000`
  - `enableSRoutes`: `true`
  - `bezierFallbackDistance`: `0`

## 参数说明（ConnectorOptions）

> 完整类型定义见 `packages/leafer-connector/src/types.ts`。

### 必填

- `from: IUI`：起点节点
- `to: IUI`：终点节点

### 端点与路由

- `routeType?: "orthogonal" | "bezier" | "straight" | "custom"`  
  - `"orthogonal"`：正交折线 + 圆角（smart-route）
  - `"bezier"`：smooth-step 风格曲线（在节点很近/重叠时可选降级为正交）
  - `"straight"`：直线（仍会包含 linkPoint/paddingPoint 的出线段）
  - `"custom"`：默认给一个可用结果，但你应通过 `onDraw` 覆盖
- `padding?: number`：出线段长度（从 linkPoint 沿法线外扩）
- `margin?: number`：连接点与节点边界的间距（让线不要贴边）
- `cornerRadius?: number`：正交圆角半径
- `opt1?: TargetOption` / `opt2?: TargetOption`：单端覆盖（见下方 TargetOption）
- `fromPorts?: ConnectorPort[]` / `toPorts?: ConnectorPort[]`：可选，给 from/to 注册 ports（也可以用 `setNodePorts`）

### Bezier

- `bezierCurvature?: number`：曲率/张力（越大曲线“张开”越明显）
- `routeOptions?.bezierFallbackDistance?: number`：当 `routeType="bezier"` 时，若两端 padding 点距离小于该值（或节点重叠），可降级为正交圆角  
  - 默认 `0`：尽量保持贝塞尔
  - 推荐 `140`：近距离更稳定、避免回勾

### 样式

- `stroke?: string`
- `strokeWidth?: number`
- `dashPattern?: number[]`：虚线，例如 `[6, 4]`
- `startArrow?: IArrowStyle`
- `endArrow?: IArrowStyle`（默认 `"triangle"`）

### 缩放策略

- `scaleMode?: "world" | "pixel"`  
  - `"world"`：跟随画布缩放（默认）
  - `"pixel"`：保持像素大小（线宽/箭头不随 zoom 变化）
- `arrowBaseScale?: number`：箭头基准缩放（配合 pixel 模式更常用）

### handles（端点手柄 / 重连）

- `handles?: { visible?: boolean; size?: number; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }`  
  - `visible: true` 才会显示并允许拖拽重连

### label（连线文字）

- `label?: { text?: string; editable?: boolean; style?: Partial<ITextInputData> }`
- `labelOnDoubleClick?: boolean`：是否允许双击连线打开/创建 label（默认 true）

> 提示：如果你不传 `style.boxStyle/padding`，组件会给 label 自动加半透明背景遮挡线条，保证可读。

### 更新模式（协同/性能）

- `updateMode?: "event" | "render" | "manual"`
  - `event`：仅交互事件触发 `update()`（性能最好，默认）
  - `render`：每帧 `RenderEvent.END` 触发（适合协同/程序改变坐标）
  - `manual`：完全手动
- `renderThrottleMs?: number`：`render` 模式节流，推荐 `16~33`

### 协同同步

- `getNodeId?: (node: IUI) => string`：用于 `getState`
- `onChange?: ({ reason, prev, next, diff, changedKeys }) => void`：结构变化统一回调（用于写入 Yjs diff）
- `onLabelChange?: ({ oldText, newText }) => void`：label 文本变化

### 重连过滤

- `pickFilter?: (pickTarget: IUI) => IUI | null`：将 pick 命中对象归一化（例如命中子节点返回父节点）
- `canConnect?: (candidate: IUI, which: "from" | "to") => boolean`：是否允许连接到候选节点
- `onReconnect?: ({ which, oldNode, newNode }) => void`：重连成功回调

## TargetOption（单端端点策略）

`opt1/opt2` 的字段与优先级（从高到低）：

1. `linkPoint?: IPointData`（world 坐标）：固定连接点（最高优先级）
2. `portId?: string`：吸附到某个 port
3. `side?: "top" | "right" | "bottom" | "left" | "auto"` + `percent?: number`：在某条边上按比例取点

其它：

- `padding?: number` / `margin?: number`：单端覆盖
- `percent` 默认 `0.5`（边中点）

## Ports（插口）

你可以通过 `setNodePorts(node, ports)` 给节点注册 ports，也可以直接在创建 Connector 时传 `fromPorts/toPorts`。

```ts
import { setNodePorts } from "leafer-connector";

setNodePorts(node, [
  { id: "top", x: 0.5, y: 0, unit: "percent" },
  { id: "right", x: 1, y: 0.5, unit: "percent" },
  { id: "bottom", x: 0.5, y: 1, unit: "percent" },
  { id: "left", x: 0, y: 0.5, unit: "percent" },
]);
```

使用 port：

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  opt1: { portId: "right" },
  opt2: { portId: "left" },
});
```

## 路由示例

### 正交（orthogonal）

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  routeType: "orthogonal",
  cornerRadius: 16,
});
```

### 贝塞尔（bezier）

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  routeType: "bezier",
  bezierCurvature: 0.6,
  routeOptions: {
    // 0：尽量保持贝塞尔；140：近距离自动降级正交更稳定
    bezierFallbackDistance: 0,
  },
});
```

### 直线（straight）

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  routeType: "straight",
});
```

### 自定义（custom + onDraw）

你可以在组件算出默认结果后，通过 `onDraw` 覆盖：

- **覆盖 `points`**（world 坐标）：组件会基于 points 重新生成圆角路径并更新 label 中点
- **覆盖 `path`**（world 坐标 SVG path）：支持 `M/L/C/Q/Z`（绝对坐标）。若只覆盖 path 不覆盖 points，label 会沿用默认中点

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  routeType: "custom",
  onDraw: ({ s, e, defaultResult }) => {
    // 1) 直接用默认结果
    // return

    // 2) 覆盖 points（world）
    // return { points: [s.linkPoint, s.paddingPoint, e.paddingPoint, e.linkPoint] }

    // 3) 覆盖 path（world，M/L/C/Q/Z）
    return { path: defaultResult.path };
  },
});
```

## label（连线文字）示例

### 默认 label（有背景遮挡）

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  label: { text: "Hello", editable: true },
});
```

### 自定义 label 样式

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  label: {
    text: "关系",
    style: {
      fill: "#fff",
      fontSize: 12,
      fontFamily: "Arial",
      fontWeight: "bold",
      padding: [2, 6],
      boxStyle: { fill: "#00000099", cornerRadius: 6 },
    },
  },
});
```

## handles（端点手柄）重连示例

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  handles: { visible: true, size: 10, fill: "#fff", stroke: "#000", strokeWidth: 1 },
  pickFilter: (t) => t, // 命中子节点时可在这里返回父节点
  canConnect: (candidate) => candidate !== edge,
  onReconnect: ({ which, oldNode, newNode }) => {
    console.log(which, oldNode, newNode);
  },
});
```

## 协同：序列化/恢复（getState / setState）

你可以把 Connector 状态写入 Yjs（或其它 CRDT），并在远端恢复：

```ts
// 1) 序列化：需要提供 node -> id
const state = edge.getState((node) => String((node as any).id));

// 2) 恢复：需要提供 id -> node
edge.setState(state, (id) => nodeById.get(id));
```

## 协同：onChange / onLabelChange

如果你希望 **重连、label 变化** 都能自动产出 “可同步的 diff”，可以用 `onChange`：

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  getNodeId: (node) => String((node as any).id),
  onChange: ({ reason, diff }) => {
    // 把 diff 写入 Yjs
    console.log(reason, diff);
  },
  onLabelChange: ({ oldText, newText }) => {
    console.log(oldText, newText);
  },
});
```

协同/性能注意事项：

- **diff 对比是稳定的**：内部对对象字段做 key 排序稳定序列化，避免误触发 `onChange`
- **避免重复绑定**：同一节点多次被设置为 `from/to` 时，内部会去重绑定拖拽监听
- **label 变更会自动合并**：输入过程中可能产生高频 `RenderEvent.END`，内部会合并到同一微任务批次再触发回调

## 性能与更新模式（updateMode）

- `event`（默认）：仅拖拽/交互触发 `update()`，性能最好
- `render`：每帧 `RenderEvent.END` 强制 `update()`，适合协同/程序频繁更新坐标
- `manual`：你自己控制刷新（可调用 `connector.invalidate()` 或 `connector.update()`）

### render 模式节流

协同场景建议开启节流减少压力：

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  updateMode: "render",
  renderThrottleMs: 16,
});
```

## routeOptions（smart-route 参数）

你可以用 `routeOptions` 调整正交 smart-route 的取舍（更偏好绕开/更偏好 S-route 等）：

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  routeType: "orthogonal",
  routeOptions: {
    avoidPadding: 12,
    intersectionPenalty: 1e6,
    longStraightRatio: 0.65,
    longStraightWeight: 2000,
    enableSRoutes: true,
  },
});
```

> `bezierFallbackDistance` 仅在 `routeType="bezier"` 时生效。

## 常见问题（FAQ）

### 1) 为什么我设置了 bezier，看起来还是折线？

- 你可能没有设置 `routeType: "bezier"`（默认是 `"orthogonal"`）
- 或者你显式把 `routeOptions.bezierFallbackDistance` 设置成较大值（例如 140），导致近距离自动降级为正交圆角

### 2) 为什么平移画布后连线会“漂移”？

本组件内部会把路由计算与绘制统一在 **Connector 的 local 坐标**，并在 `onDraw` 回调里对外提供 world 坐标，已避免常见的坐标系漂移问题。  
如果你在 `onDraw` 返回自定义 `path`，务必返回 **world 坐标 path**（组件会自动转回 local）。

## API 导出

- 导出：`Connector`、`setNodePorts`、`getNodePorts`、以及相关类型（见 `src/types.ts`）

## 构建与发布

本包默认输出 **双产物**：

- ESM：`dist/esm`
- CJS：`dist/cjs`（`.cjs` 后缀）

可选：Rollup 生产 bundle（更适合做体积检查/发布前 smoke test）：

```bash
cd packages/leafer-connector
pnpm run bundle:rollup
```

产物会输出到 `dist/bundle/`（含 `*.min.*`）。

发布前：

```bash
cd packages/leafer-connector
pnpm run build
npm publish
```

> 如果你是在 monorepo 根目录安装依赖（本项目是这样），也可以在根目录执行：
> `pnpm -C packages/leafer-connector run build`

## 备注

- 本包是 **ESM**（`type: module`），发布时会输出到 `dist/`（含类型声明）
- `leafer-editor` 作为 peerDependency，需要由业务侧安装与锁定版本