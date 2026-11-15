import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Dev only: the control plane owns /api/app and proxies the rest to the engine.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/videos': 'http://127.0.0.1:3000',
      '/thumbnails': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
