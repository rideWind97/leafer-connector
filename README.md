# leafer-connector

基于 LeaferJS（通过 `leafer-editor`）实现的连接线（Connector / Edge）组件，面向“白板 / 流程图 / 节点图”场景。

你可以把它理解成：**给两个 `IUI` 节点自动画出一条“像流程图工具一样”的连线**，并支持 label、协同等能力。

## 支持与反馈

如果这个项目对你有帮助，欢迎点个 **Star** 支持一下：  
- ⭐️ 点我去 Star：[rideWind97/leafer-connector](https://github.com/rideWind97/leafer-connector)

遇到问题 / 有需求 / 想讨论实现方案，也欢迎提 **Issue**：  
- 🐞/💡 点我去提 Issue：[Issues](https://github.com/rideWind97/leafer-connector/issues)

也非常欢迎 PR（修 bug、补文档、加示例都很棒），我会尽量及时跟进。

## 能力概览

- **连接 2 个节点**：`from/to: IUI`
- **端点模型**：`padding / margin / side(auto) / percent / linkPoint`
- **路由类型**：`orthogonal / bezier / straight / custom`
- **样式**：`stroke / strokeWidth / dashPattern / startArrow / endArrow`
- **缩放策略**：`scaleMode: world | pixel`（线宽/箭头是否随 zoom 缩放）
- **交互**：双击连线创建/编辑 label（label 永远在路径中点）
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

## 纯坐标连线（Point 模式）

如果你不想传节点（`IUI`），只想用 **两个点坐标** 画一条连线，可以用 point 模式：

- 只传点时，Connector **不会监听节点拖拽/渲染事件**（默认 `updateMode="manual"`）
- **点击连线**会显示起点/终点两个圆点（handle），拖动圆点会更新端点坐标

Point 模式新增参数：

- **`fromPoint` / `toPoint`**：`IPointData`（world 坐标），与 `from/to` 二选一
- **`pointsEditable`**：`boolean`，是否允许点击进入编辑态（显示/拖拽端点圆点），默认 `true`
- **`pointHandles`**：端点圆点样式（见下表）
- **`onPointsChange`**：端点坐标变化回调（拖拽端点 / `setPoints` 时触发）

```ts
import { App } from "leafer-editor";
import { Connector } from "leafer-connector";

const app = new App({ view: container, editor: {} });

const edge = new Connector(app, {
  fromPoint: { x: 120, y: 160 },
  toPoint: { x: 520, y: 320 },
  routeType: "bezier",
  pointsEditable: true, // 默认 true（仅 point 模式生效）
  onPointsChange: ({ from, to }) => {
    console.log("points changed:", from, to);
  },
});

app.tree.add(edge);
edge.update(); // point 模式下你也可以手动触发刷新
```
![Preview](https://github.com/rideWind97/leafer-connector/blob/master/playground/assets/point-mode.gif)


### 模式切换（Point → Node）

Connector 支持在运行时从 **Point 模式切回 Node 模式**（比如你先用点画线，后续拿到真实节点再绑定）：

- **会自动清理 point-mode 的编辑态/拖拽态**（隐藏 handles）
- **会解绑旧的交互监听并重新绑定**，避免残留 point-mode 的 click/drag 行为
- 默认会把 `updateMode` 切回 `"event"`（因为 point-mode 默认 `updateMode="manual"`）

API：

```ts
// 从 point-mode 切换到 node-mode
edge.switchToNodeMode(a, b);

// 或者显式指定 updateMode（例如协同场景）
edge.switchToNodeMode(a, b, { updateMode: "render" });
```

参数说明：

- **`from`**：`IUI`，起点节点
- **`to`**：`IUI`，终点节点
- **`opts`**（可选）：
  - **`opts.autoUpdateMode`**：`boolean`，默认 `true`。为 `true` 时（且未传 `opts.updateMode`），会将 `updateMode` 设为 `"event"`
  - **`opts.updateMode`**：`"event" | "render" | "manual"`，强制设置切换后的更新模式

### 模式切换（Node → Point）

当你希望“先连节点”，后续又想把它变成“纯点坐标线”（不再依赖节点）时，可以用：

```ts
// 从 node-mode 切换到 point-mode
edge.switchToPointMode({ x: 120, y: 160 }, { x: 520, y: 320 });

// 或者显式指定 updateMode
edge.switchToPointMode(
  { x: 120, y: 160 },
  { x: 520, y: 320 },
  { updateMode: "manual" }
);
```

行为说明：

- 会解绑旧的交互监听并按 point-mode 重新绑定
- 会清理 node 引用与拖拽态
- 默认会把 `updateMode` 切到 `"manual"`（因为 point-mode 通常由业务侧手动刷新/控制）

参数说明：

- **`fromPoint`**：`IPointData`，起点坐标（world）
- **`toPoint`**：`IPointData`，终点坐标（world）
- **`opts`**（可选）：
  - **`opts.autoUpdateMode`**：`boolean`，默认 `true`。为 `true` 时（且未传 `opts.updateMode`），会将 `updateMode` 设为 `"manual"`
  - **`opts.updateMode`**：`"event" | "render" | "manual"`，强制设置切换后的更新模式

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
![Preview](https://github.com/rideWind97/leafer-connector/blob/master/playground/assets/default.gif)

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
![Preview](https://github.com/rideWind97/leafer-connector/blob/master/playground/assets/bezier.gif)


### 直线（straight）

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  routeType: "straight",
});
```
![Preview](https://github.com/rideWind97/leafer-connector/blob/master/playground/assets/straight.gif)

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
![Preview](https://github.com/rideWind97/leafer-connector/blob/master/playground/assets/custom.gif)

## label（连线文字）示例

### 默认 label（有背景遮挡）

```ts
const edge = new Connector(app, {
  from: a,
  to: b,
  label: { text: "Hello", editable: true },
});
```
![Preview](https://github.com/rideWind97/leafer-connector/blob/master/playground/assets/name.gif)

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

## 参数总览（表格）

> 这一节把所有入参集中在一个地方，方便快速查阅（字段名使用“点号路径”表示嵌套结构）。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `from` | `IUI` | 是 | - | 起点节点 |
| `to` | `IUI` | 是 | - | 终点节点 |
| `fromPoint` | `IPointData` | 否 | - | **Point 模式**起点坐标（world）；与 `from/to` 互斥 |
| `toPoint` | `IPointData` | 否 | - | **Point 模式**终点坐标（world）；与 `from/to` 互斥 |
| `routeType` | `"orthogonal" \| "bezier" \| "straight" \| "custom"` | 否 | `"orthogonal"` | 路由类型 |
| `padding` | `number` | 否 | `20` | 出线段长度（从 linkPoint 沿法线外扩） |
| `margin` | `number` | 否 | `0` | 连接点与节点边界间距（让线不贴边） |
| `cornerRadius` | `number` | 否 | `16` | 正交/智能路由的圆角半径 |
| `opt1` | `TargetOption` | 否 | - | 起点单端端点策略（覆盖全局） |
| `opt2` | `TargetOption` | 否 | - | 终点单端端点策略（覆盖全局） |
| `bezierCurvature` | `number` | 否 | `0.6` | bezier 曲率/张力（越大越“张开”） |
| `routeOptions` | `{ ... }` | 否 | - | smart-route 参数（会做深合并，未传字段会用默认值） |
| `routeOptions.avoidPadding` | `number` | 否 | `margin` | 避障 padding：将需要避开的 bounds 外扩多少（local） |
| `routeOptions.intersectionPenalty` | `number` | 否 | `1e6` | 线段与避障矩形相交的惩罚分（越大越“绕开”） |
| `routeOptions.longStraightRatio` | `number` | 否 | `0.65` | 长直线惩罚阈值（maxSegment/total > ratio 开始惩罚） |
| `routeOptions.longStraightWeight` | `number` | 否 | `2000` | 长直线惩罚权重 |
| `routeOptions.enableSRoutes` | `boolean` | 否 | `true` | 是否生成 S-route（两次转折）候选 |
| `routeOptions.bezierFallbackDistance` | `number` | 否 | `0` | bezier 近距离降级阈值（小于该值或节点重叠可降级为正交圆角） |
| `onDraw` | `({ s, e, defaultResult }) => Partial<{ points; path }> \| void` | 否 | - | 自定义绘制（入参/出参 points/path 都是 world 坐标） |
| `updateMode` | `"event" \| "render" \| "manual"` | 否 | `"event"` | 自动更新模式（协同场景建议用 render） |
| `renderThrottleMs` | `number` | 否 | `16` | render 模式节流（ms） |
| `getNodeId` | `(node: IUI) => string` | 否 | - | 协同序列化：node -> id（用于 getState/onChange） |
| `onChange` | `({ reason, prev, next, diff, changedKeys }) => void` | 否 | - | 统一变更回调（reason: `"label" \| "setState" \| "points"`） |
| `onPointsChange` | `({ from, to }) => void` | 否 | - | **Point 模式**端点坐标变化回调 |
| `onLabelChange` | `({ oldText, newText }) => void` | 否 | - | label 文本变化回调 |
| `stroke` | `string` | 否 | `"#ffffff"` | 线条颜色 |
| `strokeWidth` | `number` | 否 | `2` | 线宽 |
| `dashPattern` | `number[]` | 否 | - | 虚线，例如 `[6, 4]` |
| `startArrow` | `IArrowStyle` | 否 | - | 起点箭头样式 |
| `endArrow` | `IArrowStyle` | 否 | `"triangle"` | 终点箭头样式 |
| `scaleMode` | `"world" \| "pixel"` | 否 | `"world"` | 缩放策略（pixel：线宽/箭头保持像素大小） |
| `arrowBaseScale` | `number` | 否 | `1` | 箭头基准缩放（配合 pixel 更常用） |
| `label` | `{ ... }` | 否 | - | 连线文字配置（存在时可显示/编辑） |
| `label.text` | `string` | 否 | - | 初始文字（空/空白会被视为不创建 label） |
| `label.editable` | `boolean` | 否 | - | 是否允许编辑（打开 inner editor） |
| `label.style` | `Partial<ITextInputData>` | 否 | - | 文案样式（fill/fontSize/boxStyle/padding 等） |
| `labelOnDoubleClick` | `boolean` | 否 | `true` | 是否允许双击连线打开/创建 label |
| `pointsEditable` | `boolean` | 否 | `true` | **Point 模式**是否允许点击进入编辑态（显示/拖拽端点圆点） |
| `pointHandles` | `{ ... }` | 否 | - | **Point 模式**端点圆点样式 |
| `pointHandles.size` | `number` | 否 | `10` | 端点圆点直径 |
| `pointHandles.fill` | `string` | 否 | `"#ffffff"` | 填充色 |
| `pointHandles.stroke` | `string` | 否 | `"#000000"` | 描边色 |
| `pointHandles.strokeWidth` | `number` | 否 | `1` | 描边宽度 |
| `pointHandles.opacity` | `number` | 否 | `1` | 透明度 |
| `pointHandles.hitStrokeWidth` | `number` | 否 | `12` | 命中范围（越大越好点） |

### `TargetOption`（用于 `opt1/opt2`）表格

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `optX.side` | `"top" \| "right" \| "bottom" \| "left" \| "auto"` | 否 | `"auto"` | 固定连接面，或自动择优 |
| `optX.percent` | `number` | 否 | `0.5` | 连接点在该面的比例（0~1，0.5=边中点） |
| `optX.padding` | `number` | 否 | - | 单端 padding（覆盖全局 padding） |
| `optX.margin` | `number` | 否 | - | 单端 margin（覆盖全局 margin） |
| `optX.linkPoint` | `IPointData` | 否 | - | 固定连接点（world，优先级最高） |

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

## TargetOption（单端端点策略）

`opt1/opt2` 的字段与优先级（从高到低）：

1. `linkPoint?: IPointData`（world 坐标）：固定连接点（最高优先级）
2. `side?: "top" | "right" | "bottom" | "left" | "auto"` + `percent?: number`：在某条边上按比例取点

其它：

- `padding?: number` / `margin?: number`：单端覆盖
- `percent` 默认 `0.5`（边中点）

## 协同：序列化/恢复（getState / setState）

你可以把 Connector 状态写入 Yjs（或其它 CRDT），并在远端恢复：

```ts
// 1) 序列化：需要提供 node -> id
const state = edge.getState((node) => String((node as any).id));

// 2) 恢复：需要提供 id -> node
edge.setState(state, (id) => nodeById.get(id));
```

## 协同：onChange / onLabelChange

如果你希望 **label 变化** 能自动产出 “可同步的 diff”，可以用 `onChange`：

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

- 导出：`Connector` 以及相关类型（见 `src/types.ts`）

### Connector 实例方法（补充）

| 方法 | 说明 |
| --- | --- |
| `switchToNodeMode(from, to, opts?)` | 从 point-mode 切换到 node-mode，并重新绑定交互监听（详见上方“模式切换”小节） |
| `switchToPointMode(fromPoint, toPoint, opts?)` | 从 node-mode 切换到 point-mode，并重新绑定交互监听（详见上方“模式切换”小节） |

## 构建与发布

本包默认输出 **双产物**：

- ESM：`dist/esm`
- CJS：`dist/cjs`（`.cjs` 后缀）

## Vue 3 + Vite Playground（本仓库内运行示例）

本仓库内置了一个 Vue 3 的 Vite 示例项目（用于本地调试/演示）：

```bash
pnpm install
pnpm run dev
```

- 默认会启动在 `http://localhost:5173`
- playground 代码在 `playground-vue/`
- 开发时会通过 Vite alias 直接引用本仓库源码：`leafer-connector → ../src/index.ts`

可选：Rollup 生产 bundle（更适合做体积检查/发布前 smoke test）：

```bash
pnpm run bundle:rollup
```

产物会输出到 `dist/bundle/`（含 `*.min.*`）。

发布前：

```bash
pnpm run build
npm publish
```

## 备注

- 本包是 **ESM**（`type: module`），发布时会输出到 `dist/`（含类型声明）
- `leafer-editor` 作为 peerDependency，需要由业务侧安装与锁定版本