/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_URL ?? 'http://localhost:13000';
const keycloakTarget = process.env.KEYCLOAK_URL ?? 'http://localhost:18081';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 15173,
    // Same-origin in development, exactly like nginx does in production — no CORS anywhere.
    proxy: {
      '/api': apiTarget,
      '/socket.io': { target: apiTarget, ws: true },
      // Keycloak builds the token issuer from the forwarded host, and the API expects this origin
      // (OIDC_ISSUER in apps/api/.env.example). changeOrigin must stay off so the Host is kept.
      '/auth': { target: keycloakTarget, xfwd: true, changeOrigin: false },
    },
  },
  build: {
    // MapLibre alone is ~800 kB minified; the console is an internal app on a LAN, not a landing page.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
