import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import viteTsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    viteTsconfigPaths(),
    react(),
    tailwindcss(),
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  publicDir: "public",
  build: {
    outDir: "dist",
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
