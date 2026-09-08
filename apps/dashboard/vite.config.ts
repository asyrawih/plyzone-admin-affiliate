import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const API = process.env.VITE_API_PROXY ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    // Vendor dipisah supaya cache browser tetap valid saat kode app berubah; recharts hanya dimuat saat chart dirender (LazyCharts).
    rollupOptions: { output: { manualChunks: { react: ["react", "react-dom", "react-router", "@tanstack/react-query"], charts: ["recharts"] } } },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: { "/api": API, "/a/": { target: API, bypass: (req) => (req.headers.accept?.includes("text/html") ? "/index.html" : undefined) } },
  },
});
