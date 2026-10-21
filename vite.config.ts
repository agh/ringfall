import { defineConfig } from 'vite';

// Relative base so the build runs from GitHub Pages, a local preview, or file://.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~550 kB minified; a single chunk is the right call for one scene.
    chunkSizeWarningLimit: 650,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
