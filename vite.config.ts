import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The PWA (src/web) builds to dist/web, which the Worker serves as static assets (wrangler.jsonc).
// `npm run dev:web` serves it with hot reload and forwards /api to `npm run dev:worker` on :8787.
export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
