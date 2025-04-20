import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	build: {
		// Generate source maps for better debugging
		sourcemap: true,
		// Ensure we have a clean build each time
		emptyOutDir: true,
		// Optimize for production
		minify: "terser",
		// Configure output location
		outDir: resolve(__dirname, "dist"),
	},
	server: {
		// Configure dev server to proxy API requests to the backend during development
		proxy: {
			"/api": {
				target: "http://localhost:2468",
				changeOrigin: true,
			},
		},
	},
});
