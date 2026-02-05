import { defineConfig } from 'vite';
import path from 'path';
import { realpathSync } from 'fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import viteTsconfigPaths from 'vite-tsconfig-paths';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/__CROSS_SEED_BASE_PATH__/' : '/',
  plugins: [
    viteTsconfigPaths(),
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173, // Default Vite port
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '../..'),
        (() => {
          try {
            return realpathSync(
              path.resolve(__dirname, '../../node_modules/vite'),
            );
          } catch {
            return path.resolve(__dirname, '../../node_modules/vite');
          }
        })(),
      ],
    },
    proxy: {
      // Proxy tRPC requests to port 2468
      '/api/trpc': {
        target: 'http://localhost:2468',
        changeOrigin: true,
        secure: false,
      },
    },
  },
}));
