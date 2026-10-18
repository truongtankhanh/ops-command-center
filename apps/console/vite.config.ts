/// <reference types="vitest/config" />
import { createReadStream, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import {
  contentTypeOf,
  DECODER_CACHE_CONTROL,
  DECODER_OUT_DIR,
  type DecoderSource,
  matchDevRequest,
  MODEL_CACHE_CONTROL,
  resolveDecoderSources,
} from './vite.decoders.ts';

const require = createRequire(import.meta.url);

const apiTarget = process.env.API_URL ?? 'http://localhost:13000';
const keycloakTarget = process.env.KEYCLOAK_URL ?? 'http://localhost:18081';

/** Answers a request with a file, or with a 404 when it is not there. Only names `matchDevRequest` accepted reach it. */
function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string | undefined,
  cacheControl: string,
): void {
  let size: number;
  try {
    const stats = path ? statSync(path) : null;
    if (!path || !stats?.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not found');
    return;
  }
  res.setHeader('Content-Type', contentTypeOf(path));
  res.setHeader('Content-Length', size);
  res.setHeader('Cache-Control', cacheControl);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(path)
    .on('error', () => res.destroy())
    .pipe(res);
}

/**
 * What the console serves besides its own code (V2-13.5, ADR-0020 § Serving); the decisions are in
 * `vite.decoders.ts`, tested without a server. One inline plugin, not `vite-plugin-static-copy`: there is one
 * copy to make.
 *
 * - Build: the Basis transcoder is copied from the installed three into `dist/decoders/basis/`, so the image
 *   serves it at `/decoders/basis/…` and nothing is fetched from a third party. A missing source fails the
 *   build at its start with a message that says what moved. Meshopt needs no file (drei embeds it).
 * - `pnpm dev`: the same transcoder at the same URL, and `/models/<name>` from `ops/models/` (nginx does that
 *   in the image, which has no such directory at build time, so it is read only here).
 */
function decoders(): Plugin {
  let sources: DecoderSource[] = [];
  let modelsDir = '';
  return {
    name: 'occ-decoders',
    configResolved(config) {
      modelsDir = resolve(config.root, '../../ops/models');
    },
    buildStart() {
      try {
        sources = resolveDecoderSources((specifier) => require.resolve(specifier));
      } catch (error) {
        this.error(error as Error);
      }
    },
    generateBundle() {
      for (const { file, path } of sources) {
        this.emitFile({
          type: 'asset',
          fileName: `${DECODER_OUT_DIR}/${file}`,
          source: readFileSync(path),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !req.url) return next();
        const match = matchDevRequest(req.url);
        if (!match) return next();
        if (match.kind === 'decoder') {
          const source = sources.find(({ file }) => file === match.file);
          return sendFile(req, res, source?.path, DECODER_CACHE_CONTROL);
        }
        if (match.kind === 'model') {
          return sendFile(req, res, join(modelsDir, match.name), MODEL_CACHE_CONTROL);
        }
        return sendFile(req, res, undefined, DECODER_CACHE_CONTROL);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), decoders()],
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
    // `scripts/chunk-budget.ts` (run by `pnpm build` after `vite build`) reads the manifest to size the
    // 3D twin's lazy chunk against ADR-0020's budget, then deletes it so the image never serves it.
    manifest: true,
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
