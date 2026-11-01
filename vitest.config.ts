import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "test/e2e/**"] },
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
});
