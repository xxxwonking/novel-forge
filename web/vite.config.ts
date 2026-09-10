import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 开发期 Vite 起在 5173，API 代理到 5174 的 Node 服务。
 * 生产构建输出到 web/dist，由那个 Node 服务直接托管（src/server/http.ts）。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:5174" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
