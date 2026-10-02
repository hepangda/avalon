import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { staticAssets } from "./scripts/static-assets";
import { staticBase } from "./scripts/static-config.mjs";

export default defineConfig(({ command, mode }) => {
  const base =
    command === "build"
      ? staticBase(loadEnv(mode, process.cwd(), "").STATIC_ASSET_BASE_URL)
      : "/";
  return {
    base,
    plugins: [
      react(),
      staticAssets(fileURLToPath(new URL("./public", import.meta.url)), base),
    ],
    build: { outDir: "dist/client" },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/debug/addRandomCard": "http://127.0.0.1:3000",
        "/api": "http://127.0.0.1:3000",
        "/rooms": { target: "http://127.0.0.1:3000", ws: true },
      },
    },
  };
});
