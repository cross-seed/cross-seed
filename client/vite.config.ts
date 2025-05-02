import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import viteTsconfigPaths from "vite-tsconfig-paths";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const config = defineConfig({
	plugins: [
		viteTsconfigPaths(),
		TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
		tailwind(),
		react(),
	],
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

export default config;
