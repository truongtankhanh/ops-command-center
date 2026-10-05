import type { ConfigService } from '@nestjs/config';
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import type { Env } from '../config/env.validation';
import { TokenVerifier } from './token-verifier';

const ISSUER = 'https://issuer.test/realms/occ';
const AUDIENCE = 'occ-api';
const KEY_ID = 'unit-1';

const config = {
  get: (key: keyof Env) =>
    ({
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URL: `${ISSUER}/protocol/openid-connect/certs`,
    })[key as string],
} as unknown as ConfigService<Env, true>;

/**
 * Roles as `TokenVerifier` reads them from Keycloak's `realm_access.roles` (ADR-0011). Tokens are
 * signed and verified for real; only the key-set request is answered locally.
 */
describe('TokenVerifier roles', () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let verifier: TokenVerifier;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const jwks = JSON.stringify({
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: 'RS256', use: 'sig' }],
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(jwks));
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    verifier = new TokenVerifier(config);
  });

  const tokenWith = (claims: JWTPayload) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  const rolesOf = async (claims: JWTPayload) =>
    (await verifier.verify(await tokenWith(claims))).user.roles;

  it('keeps the known realm roles', async () => {
    await expect(rolesOf({ realm_access: { roles: ['viewer'] } })).resolves.toEqual(['viewer']);
  });

  it("drops Keycloak's own roles and duplicates, in a fixed order", async () => {
    const roles = ['viewer', 'default-roles-occ', 'offline_access', 'operator', 'operator'];

    await expect(rolesOf({ realm_access: { roles } })).resolves.toEqual(['operator', 'viewer']);
  });

  it('ignores role names that are not strings', async () => {
    await expect(
      rolesOf({ realm_access: { roles: [42, null, { name: 'operator' }, 'supervisor'] } }),
    ).resolves.toEqual(['supervisor']);
  });

  it('ignores client roles: only realm roles count', async () => {
    await expect(
      rolesOf({ resource_access: { 'occ-console': { roles: ['operator'] } } }),
    ).resolves.toEqual([]);
  });

  // A valid signature with an odd claim is a user without access, not an invalid token (no 401).
  it.each([
    ['missing', {}],
    ['null', { realm_access: null }],
    ['a string', { realm_access: 'operator' }],
    ['an array', { realm_access: ['operator'] }],
    ['without roles', { realm_access: {} }],
    ['with roles as a string', { realm_access: { roles: 'operator' } }],
    ['with roles as an object', { realm_access: { roles: { operator: true } } }],
  ])('accepts the token with no roles when realm_access is %s', async (_label, claims) => {
    const { user } = await verifier.verify(await tokenWith(claims as JWTPayload));

    expect(user).toEqual({ subject: 'user-1', displayName: 'user-1', roles: [] });
  });
});
