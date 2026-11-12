import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server proxies /api to the Node API, so the browser sees one origin (no CORS setup needed).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
  build: { outDir: '../dist', emptyOutDir: true },
});
