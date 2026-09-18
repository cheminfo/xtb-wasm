import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ir.cheminfo.org sends `Access-Control-Allow-Origin: *` on both /v1/ir routes
// and answers the POST preflight, so the browser can call it directly and this
// proxy is NOT required. It is kept for two cases:
//   1. the upstream ever tightens CORS;
//   2. you want same-origin requests in dev so the browser devtools network
//      panel and any Service Worker cache treat them like first-party calls.
// To use it, build the client with `baseUrl: '/xtb/v1'`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/xtb': {
        target: 'https://ir.cheminfo.org',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/xtb/, ''),
        // The service can take ~60s; do not let the dev proxy cut in earlier.
        timeout: 70_000,
        proxyTimeout: 70_000,
      },
    },
  },
});
