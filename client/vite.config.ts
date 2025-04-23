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
});

export default config;
