<template>
  <div class="wrap">
    <div class="bar">
      <div><strong>leafer-connector</strong> · Vue 3 playground</div>
      <div style="opacity: 0.8">Try dragging the rectangles / handles.</div>
      <div style="margin-left: auto; opacity: 0.8">
        Imports local source via alias: <code>leafer-connector → ../src</code>
      </div>
    </div>
    <div class="stage">
      <div ref="container"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { App, Rect } from "leafer-editor";
import { Connector } from "../../src/index";

const container = ref<HTMLDivElement | null>(null);
let app: App | null = null;

onMounted(() => {
  if (!container.value) return;

  app = new App({ view: container.value, editor: {} as any });

  const a = new Rect({
    x: 120,
    y: 140,
    width: 220,
    height: 160,
    fill: "#32cd79",
    draggable: true,
    cornerRadius: 16,
  });

  const b = new Rect({
    x: 520,
    y: 320,
    width: 240,
    height: 160,
    fill: "#3b82f6",
    draggable: true,
    cornerRadius: 16,
  });

  // node-mode
  const edge1 = new Connector(app, {
    from: a,
    to: b,
    routeType: "orthogonal",
    cornerRadius: 16,
    label: { text: "node-mode (drag rects)" },
  });

  // point-mode (click edge to show draggable endpoint handles)
  const edge2 = new Connector(app, {
    fromPoint: { x: 220, y: 520 },
    toPoint: { x: 720, y: 560 },
    routeType: "bezier",
    pointsEditable: true,
    label: { text: "point-mode (click to edit)" },
    onPointsChange: ({ from, to }) => {
      console.log("point-mode changed:", from, to);
    },
  });

  app.tree.add([a, b, edge1, edge2]);
  edge2.update(); // point-mode默认 manual，可手动触发一次
});

onBeforeUnmount(() => {
  // leafer-editor 不同版本销毁方法名可能不同，这里尽量兜底
  (app as any)?.destroy?.();
  app = null;
});
</script>


