import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: {
      // Import local source during dev for fastest iteration
      "leafer-connector": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});


