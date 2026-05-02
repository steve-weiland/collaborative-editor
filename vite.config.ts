import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Forward WebSocket upgrades during dev to the backend on :3000.
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
