import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve("src/renderer"),
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": path.resolve("src/renderer"),
      "@shared": path.resolve("src/shared"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4780",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve("dist/renderer"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
