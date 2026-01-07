# Connector 代码逻辑步骤说明（逐步版）

本文基于 `src/Connector.ts`，用“文案步骤”的方式解释 Connector 的运行链路：**创建 → 参数合并 → 渲染(update) → point-mode 编辑态 → label 生命周期 → 状态/协同 diff**。

> 术语约定：
> - **node-mode**：`new Connector(app, { from: IUI, to: IUI, ... })`
> - **point-mode**：`new Connector(app, { fromPoint: IPointData, toPoint: IPointData, ... })`
> - **world/local**：world 是全局坐标；local 是 Connector 自身局部坐标（写入 `wire.path` 用 local，避免平移缩放漂移）。

---

## 1. 创建阶段：`constructor(app, options)` 做了什么

### 1.1 判定模式（node vs point）

1. 检查 `options` 是否包含 `fromPoint/toPoint`。
2. 若存在：进入 **point-mode**，内部存 `fromPointWorld/toPointWorld`。
3. 否则：进入 **node-mode**，内部存 `fromNode/toNode`。

> 作用：保证同一个 `Connector` 兼容两套端点来源。

### 1.2 合并默认参数（options -> this.options）

1. 先计算 `padding/margin` 的默认值（避免 routeOptions 默认值依赖时顺序错误）。
2. “深合并” `routeOptions`：即用户只传部分字段，也会补齐默认值。
3. 计算 `updateMode` 默认值：
   - point-mode：默认 `manual`（符合“只传点就画线，不监听外部变化”的预期）
   - node-mode：默认 `event`

### 1.3 创建渲染节点：wire + handles

1. 创建 `wire: Path`：承载连线路径（`wire.path` 最终写 local SVG path 字符串）。
2. 创建两个端点圆点（内部用 `Rect` + `cornerRadius=width` 画圆）：
   - `fromHandle/toHandle` 默认 `visible=false`
   - 样式来自：
     - 新参数 `options.pointHandles`（point-mode 推荐）
     - 兼容旧的 `options.handles`（历史遗留）

### 1.4 label 的“懒创建”

1. 如果 `options.label.text` 为空或全空白：不创建 label（避免出现空 label 节点）。
2. 否则调用 `ensureLabel()` 创建 label，并绑定编辑监听。

### 1.5 绑定交互 + 初次渲染

1. 调用 `bindInteractions()` 绑定事件（node 拖拽监听 / point 编辑态 / 双击 label）。
2. 立即调用 `update()` 做首次渲染。
3. 如果 `updateMode==="render"`：额外绑定 `RenderEvent.END -> requestUpdate('render')`（协同/程序改坐标场景用）。

---

## 2. 刷新入口：`requestUpdate(reason)` 做了什么

### 2.1 render 模式节流合并

当 `updateMode==="render"`：

1. 计算距离上次渲染更新时间是否小于 `renderThrottleMs`。
2. 若小于且当前没有 pending：用 `setTimeout` 合并到下一次调用 `update()`。
3. 若超过阈值：立即 `update()`。

> 作用：协同/程序高频更新时，避免每帧多次重算路径。

### 2.2 event/manual 模式

直接调用 `update()`（用户也可以自己节流）。

---

## 3. 渲染主流程：`update()` 做了什么

`update()` 是渲染的核心，按照优先级分三大分支：

### 3.1 分支 A：拖拽预览优先（`_dragFromWorld/_dragToWorld`）

当拖拽端点圆点时，内部会写 `_dragFromWorld/_dragToWorld`：

1. 先用“拖拽点”覆盖当前端点坐标（没拖的一端取当前端点）。
2. 如果是 **point-mode**：
   - 调用 `renderPointModeBetween(fromW, toW, setKey=false)`
   - 这样拖拽过程中也保持 `routeType`（bezier 仍是 bezier）
3. 如果是 **node-mode**（当前仅做兜底预览）：
   - 直接画一条直线 `M ... L ...`

> 作用：拖拽时即时反馈路径变化。

### 3.2 分支 B：point-mode 正常渲染

如果 `mode === "point"` 且没有拖拽：

1. 直接调用 `renderPointModeBetween(fromPointWorld, toPointWorld, setKey=true)`
2. 返回，不走 node-mode 的候选点/避障逻辑。

### 3.3 分支 C：node-mode 正常渲染（候选点 + 路由评分）

如果 `mode === "node"`：

1. **key 去重**：
   - 用两端 `worldBoxBounds`（位置/尺寸）+ 关键选项拼一个粗粒度 key
   - 若 key 相同：只更新 label 位置后 return（避免重算）
2. **world bounds -> local rect**：
   - `rectToLocal(worldBoxBounds)`，把两个节点的 bounds 转换为 Connector local 坐标
3. **buildCandidatePoints（端点候选集合）**：
   - 对起点/终点分别生成候选连接点（按 side/percent/linkPoint 等）
   - 候选点里包含：
     - linkPoint（world）
     - paddingPoint（world）
     - side/percent/padding/margin 等
4. **avoidRects（避障矩形）**：
   - 将两端 local rect 外扩 `avoidPadding`（默认用 margin）
5. **枚举候选组合并打分**：
   - 双层循环：`for s in sCandidates` + `for e in eCandidates`
   - 根据 `routeType` 计算中间段：
     - `straight`：中间段就是 `[sPadL, ePadL]`
     - `orthogonal`：调用 `buildOrthogonalBetween(sPadL, ePadL, avoidRects, options)` 生成 L/S 候选并按惩罚评分
     - `bezier`：若节点重叠或距离 < `bezierFallbackDistance`，降级为 orthogonal；否则用三次贝塞尔 `C`
     - `custom`：默认给一条可用的直连结果，期待 `onDraw` 覆盖
6. **选 best（score 最小）**
7. **onDraw 覆盖点/路径**：
   - 对外提供的是 world 坐标的 `defaultResult`
   - 如果外部返回：
     - `override.path`：视为 world path，内部转换回 local 写入
     - `override.points`：视为 world points，内部转换回 local 并重新生成 rounded path
8. **写入 wire.path（local） + 更新 labelMid + applyScaleMode**

---

## 4. point-mode 路径引擎：`renderPointModeBetween(fromW, toW, setKey)`

这是 point-mode（包含拖拽预览）使用的统一渲染函数：

### 4.1 key 去重（仅 setKey=true）

1. 拼一个 point key：`P|from|to|routeType|padding|cornerRadius|scaleMode`
2. key 相同：只同步 label / handles 位置后 return

### 4.2 计算路径（按 routeType）

1. 将两端 world 点转换到 local：`fromL/toL`
2. 用向量方向推导 `fromSide/toSide`（`inferSideByVector`）
3. 计算 padding 出线段：`sPadL/ePadL = endpoint + outDir*padding`
4. routeType 分支：
   - `bezier`：计算控制点 `c1/c2`，path = `M L C L`，labelMid 取 t=0.5
   - `orthogonal`：调用 `buildOrthogonalBetween(sPadL,ePadL, avoidRects=[])`（point-mode 不做避障矩形）
   - `straight/custom`：走 rounded polyline
5. `onDraw` 覆盖（同 node-mode，一律按 world 入参/出参）
6. 写入 `wire.path`（local），更新 labelMid，若处于编辑态则更新 handles 位置，最后 `applyScaleMode()`

---

## 5. point-mode 编辑态（点击显示圆点、拖动修改端点）

对应 `bindInteractions()` 里的 point-mode 分支：

### 5.1 进入编辑态

1. `wire.on(CLICK/TAP)` 触发 `enterEdit()`
2. `editingPoints=true`
3. `fromHandle/toHandle visible=true`
4. `positionHandles(fromPointWorld,toPointWorld)`

### 5.2 退出编辑态

1. `tree.on(PointerEvent.DOWN)`：点击空白处
2. 如果 target 不是 wire/handles/label，则：
   - `editingPoints=false`
   - `handles.visible=false`

### 5.3 拖拽端点圆点

1. `DragEvent.DRAG`：
   - 将 handle 中心点转换到 world
   - 写入 `_dragFromWorld/_dragToWorld`
   - `requestUpdate('event')` -> `update()`（走拖拽预览）
2. `DragEvent.END`：
   - 提交：把 fromPointWorld/toPointWorld 更新为最终 world 坐标
   - 清理 `_dragFromWorld/_dragToWorld`
   - 回调：`onPointsChange({from,to})`
   - 协同：`emitChange('points')`
   - `invalidate()`（清掉 key，保证下一次完整重算）

---

## 6. label 生命周期（创建/编辑/删除）

### 6.1 `ensureLabel()` 创建 label

1. 合并默认背景样式（可读性保障）+ 用户 style
2. 创建 `Text` 并 add 到 Connector
3. 同步 `options.label.text`
4. 关键：`_lastKey = null` + `update()`，强制算一次 labelMid 并放回中点

### 6.2 输入变化监听

- `InnerEditorEvent.CLOSE`：编辑器关闭时 trim；若为空则删除 label
- `RenderEvent.END`：输入过程中兜底监听文本变化（microtask 合并）

### 6.3 删除 label：`removeLabelNode()`

1. destroy label
2. 清理 `_label/_labelMid/_lastLabelText`
3. `options.label = undefined`
4. `_lastKey=null` 强制下一次重算
5. 触发 `onLabelChange(old -> "")` + `emitChange('label')` + `requestUpdate`

---

## 7. 状态/协同：`getState` / `setState` / diff / onChange

### 7.1 `getState()`

返回 `ConnectorState`，并包含 `mode`：

- node-mode：`{ mode:'node', fromId, toId, ...style/route }`
- point-mode：`{ mode:'point', fromPoint, toPoint, ...style/route }`

### 7.2 `emitChange(reason)`

1. 计算 `next = getState()`
2. `prev = _lastEmittedState || next`
3. `computeDiff(prev,next)`：
   - keys 包含 `mode/fromId/toId/fromPoint/toPoint/...`
   - 对对象字段用 stableStringify 做稳定比较（避免 key 顺序误触发）
4. 若 `changedKeys` 非空：
   - 更新 `_lastEmittedState`
   - 调用 `options.onChange({reason, prev, next, diff, changedKeys})`

### 7.3 `setState(state, resolveNode)`

1. 根据 `state.mode` 分支：
   - point：`bindPoints(fromPoint,toPoint)`
   - node：通过 `resolveNode(fromId/toId)` 找回节点后 `bind(from,to)`
2. 应用 style/label 等字段
3. `invalidate()` 强制重算
4. `emitChange('setState')`

---

## 8. 为什么一定要写 local path？

核心原因：**避免画布平移/缩放后“线条漂移”**。

- 计算路由、避障、最终写入 `wire.path` 全部使用 Connector local 坐标
- 只有 `onDraw` 对外提供 world 坐标（业务更好理解）
- 若外部返回 `override.path`（world），内部再转换回 local 写入

---

## 9. 推荐你 Debug 的“观察点”

- **point-mode**：观察 `_dragFromWorld/_dragToWorld` + `renderPointModeBetween()` 输出 `wire.path`
- **node-mode**：观察 `buildCandidatePoints()` 候选数量、`avoidRects`、以及 best.score 变化
- **协同**：观察 `_lastEmittedState`、`computeDiff()` 的 `changedKeys`


