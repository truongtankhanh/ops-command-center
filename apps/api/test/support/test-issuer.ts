import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair } from 'jose';

/**
 * A stand-in OIDC issuer for the e2e suite: its own RS256 key pair and a JWKS endpoint on
 * loopback. The API fetches keys from it exactly as it would from Keycloak, so the suite runs the
 * production verification path; there is no switch that turns authentication off (ADR-0010).
 */
export interface TestIssuer {
  close(): Promise<void>;
}

declare global {
  /** Set by `global-setup.ts`, closed by `global-teardown.ts`. */
  var __E2E_ISSUER__: TestIssuer | undefined;
}

export const TEST_KEY_ID = 'e2e-1';
const REALM_PATH = '/realms/e2e';

/**
 * Starts the issuer and publishes it through `process.env`: the `OIDC_*` variables the API
 * validates at import, and `E2E_SIGNING_JWK` (the private key, test-only) for `signToken`.
 */
export async function startTestIssuer(): Promise<TestIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid: TEST_KEY_ID, alg: 'RS256', use: 'sig' };
  const privateJwk = { ...(await exportJWK(privateKey)), kid: TEST_KEY_ID, alg: 'RS256' };
  const jwks = JSON.stringify({ keys: [publicJwk] });

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === `${REALM_PATH}/certs`) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(jwks);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const issuer = `http://127.0.0.1:${port}${REALM_PATH}`;
  process.env.OIDC_ISSUER = issuer;
  process.env.OIDC_JWKS_URL = `${issuer}/certs`;
  process.env.OIDC_AUDIENCE = 'occ-api';
  process.env.E2E_SIGNING_JWK = JSON.stringify(privateJwk);

  return { close: () => closeServer(server) };
}

function closeServer(server: Server): Promise<void> {
  // The API's `fetch` keeps connections alive; they would hold `close()` open.
  server.closeAllConnections();
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
