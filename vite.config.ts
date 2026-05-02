import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    // ES2022 enables top-level await (used in main.ts to wait on
    // IndexeddbPersistence.synced before binding the textarea).
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Forward WebSocket upgrades during dev to the backend on :3001.
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
