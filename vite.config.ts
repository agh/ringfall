import { defineConfig, type Plugin } from 'vite';

/**
 * The CSP meta tag in index.html is strict enough that the dev server's hot reload would fail
 * under it: Vite injects CSS as inline `<style>` elements and talks over a WebSocket. Only
 * `vite dev` is relaxed here; `vite build` and `vite preview` serve the tag exactly as written,
 * which is what the e2e smoke test runs against.
 */
const devCsp = (): Plugin => ({
  name: 'ringfall:dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html
      .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws: wss:"),
});

// Relative base so the build runs from GitHub Pages, a local preview, or file://.
export default defineConfig({
  base: './',
  plugins: [devCsp()],
  build: {
    target: 'es2022',
    // Maps are still written for local debugging, but without a sourceMappingURL comment, so
    // browsers never fetch 3 MB of annotated source from the published site.
    sourcemap: 'hidden',
    // One scene, one chunk: 706 kB minified at 2026.10.0, most of it three.js. The limit sits
    // just above the measured size so growth past it is a warning, not a daily one.
    chunkSizeWarningLimit: 750,
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
