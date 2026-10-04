import { randomBytes } from 'node:crypto';
import {
  type CryptoKey,
  generateKeyPair,
  importJWK,
  type JWTPayload,
  SignJWT,
  UnsecuredJWT,
} from 'jose';
import { TEST_KEY_ID } from './test-issuer';

/** Access tokens for the e2e suite, signed by the test issuer unless a case needs otherwise. */

export interface TokenOptions {
  /** `null` leaves the claim out. */
  sub?: string | null;
  name?: string;
  aud?: string;
  iss?: string;
  /** Seconds from now until `exp`; negative for a token that has already expired. */
  expiresIn?: number;
  /** `'other'` signs with a key the issuer never published. */
  key?: 'issuer' | 'other';
}

interface SigningKey {
  key: CryptoKey | Uint8Array;
  kid: string;
}

let issuerKey: Promise<SigningKey> | undefined;
let otherKey: Promise<SigningKey> | undefined;

export async function signToken(options: TokenOptions = {}): Promise<string> {
  const signing = await (options.key === 'other' ? getOtherKey() : getIssuerKey());
  return new SignJWT(claims(options))
    .setProtectedHeader({ alg: 'RS256', kid: signing.kid })
    .sign(signing.key);
}

/** A well-formed token with `alg: none`: valid claims, no signature. */
export function unsignedToken(): string {
  return new UnsecuredJWT(claims({})).encode();
}

/** Valid claims signed with HS256 and a shared secret, as in an algorithm-confusion attack. */
export function hs256Token(): Promise<string> {
  return new SignJWT(claims({})).setProtectedHeader({ alg: 'HS256' }).sign(randomBytes(32));
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

function claims({
  sub = 'e2e-operator',
  name = 'E2E Operator',
  aud = requiredEnv('OIDC_AUDIENCE'),
  iss = requiredEnv('OIDC_ISSUER'),
  expiresIn = 3600,
}: TokenOptions): JWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return { ...(sub === null ? {} : { sub }), name, aud, iss, iat: now, exp: now + expiresIn };
}

function getIssuerKey(): Promise<SigningKey> {
  issuerKey ??= importJWK(JSON.parse(requiredEnv('E2E_SIGNING_JWK')), 'RS256').then((key) => ({
    key,
    kid: TEST_KEY_ID,
  }));
  return issuerKey;
}

function getOtherKey(): Promise<SigningKey> {
  otherKey ??= generateKeyPair('RS256').then(({ privateKey }) => ({
    key: privateKey,
    kid: 'other',
  }));
  return otherKey;
}

/** Set by `test-issuer.ts` in `global-setup.ts`; missing means the Jest config lost `globalSetup`. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: is global-setup.ts configured?`);
  return value;
}
