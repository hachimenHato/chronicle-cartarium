import { defineConfig } from 'vite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
const buildId = randomUUID();
const applicationVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'chronicle-cartarium-build-version',
      apply: 'build',
      transformIndexHtml() {
        return [
          {
            tag: 'meta',
            attrs: { name: 'chronicle-cartarium-build', content: buildId },
            injectTo: 'head',
          },
          { tag: 'meta', attrs: { name: 'worldloom-build', content: buildId }, injectTo: 'head' },
        ];
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'app-version.json',
          source: JSON.stringify({ buildId, applicationVersion }),
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Preserve the browser-facing Host so the API can verify same-origin writes.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
      '/uploads': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          graphs: ['@xyflow/react'],
          markdown: ['react-markdown'],
        },
      },
    },
  },
});
