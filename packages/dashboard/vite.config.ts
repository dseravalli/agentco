import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
      "/preview": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/agent": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
