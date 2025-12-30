import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

/**
 * 生产环境 bundle（可选）：
 * - 输入：tsc 产物（dist/esm + dist/cjs）
 * - 输出：dist/bundle（esm/cjs + min）
 *
 * 注意：本包把 `leafer-editor` 作为 peerDependency，因此这里默认 external，不打进 bundle。
 */

const external = ["leafer-editor"];

const basePlugins = [
  nodeResolve({ browser: true, preferBuiltins: false }),
  commonjs(),
];

const minPlugins = [
  ...basePlugins,
  terser({
    format: { comments: false },
  }),
];

export default [
  // ESM bundle
  {
    input: "dist/esm/index.js",
    external,
    plugins: basePlugins,
    output: {
      file: "dist/bundle/index.esm.js",
      format: "esm",
      sourcemap: true,
    },
  },
  {
    input: "dist/esm/index.js",
    external,
    plugins: minPlugins,
    output: {
      file: "dist/bundle/index.esm.min.js",
      format: "esm",
      sourcemap: true,
    },
  },

  // CJS bundle
  {
    input: "dist/cjs/index.cjs",
    external,
    plugins: basePlugins,
    output: {
      file: "dist/bundle/index.cjs",
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
  },
  {
    input: "dist/cjs/index.cjs",
    external,
    plugins: minPlugins,
    output: {
      file: "dist/bundle/index.min.cjs",
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
  },
];


