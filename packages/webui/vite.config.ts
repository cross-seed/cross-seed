import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Uncomment once you install the plugin
// import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173, // Default Vite port
    proxy: {
      // Proxy tRPC requests to port 2468
      "/api/trpc": {
        target: "http://localhost:2468",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
