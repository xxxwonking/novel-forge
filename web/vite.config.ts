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
    // 保留浏览器 Host，后端才能按同一 Origin 校验开发页的写请求。
    proxy: { "/api": { target: "http://127.0.0.1:5174", changeOrigin: false } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
