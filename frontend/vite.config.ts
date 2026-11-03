/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { fileURLToPath, URL } from "node:url";
import { staticAssets } from "./scripts/static/static-assets";
import { staticBase } from "./scripts/static/static-config.mjs";

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
    css: { postcss: { plugins: [tailwindcss(), autoprefixer()] } },
    // The Rust server and the Docker image serve the repository-level dist/client.
    build: { outDir: "../dist/client", emptyOutDir: true },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
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
