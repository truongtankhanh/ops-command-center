import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  customFetch,
  errors,
  type FetchImplementation,
  type JWTPayload,
  jwtVerify,
} from 'jose';
import type { Env } from '../config/env.validation';

/**
 * OIDC access-token verification, shared by the REST guard and the `/events` handshake so both
 * apply the same rules (ADR-0010). The API is a resource server only: it checks tokens against the
 * issuer's public keys, holds no client secret and keeps no session.
 */

/** Who made a request, as the identity provider asserts it. */
export interface AuthenticatedUser {
  /** The token's `sub`: stable and unique within the issuer. */
  subject: string;
  /** For people reading what happened, never for access decisions. */
  displayName: string;
}

export interface VerifiedToken {
  user: AuthenticatedUser;
  /** The token's `exp`. A socket authenticated with it is closed at this moment. */
  expiresAt: Date;
}

/** Not a token this API accepts. Callers answer 401 without saying why. */
export class InvalidTokenError extends Error {
  constructor() {
    super('Invalid access token');
    this.name = new.target.name;
  }
}

/** The signing keys could not be fetched, so no token can be checked. Callers answer 503. */
export class IdentityProviderUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Identity provider unavailable', { cause });
    this.name = new.target.name;
  }
}

/** Keycloak signs access tokens with RS256. Anything else, `none` included, is rejected. */
const ALGORITHMS = ['RS256'];
/** Seconds of clock skew tolerated between the identity provider and this host. */
const CLOCK_TOLERANCE_S = 30;

@Injectable()
export class TokenVerifier {
  private readonly logger = new Logger(TokenVerifier.name);
  private readonly issuer: string;
  private readonly audience: string;
  private readonly signingKeys: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: ConfigService<Env, true>) {
    this.issuer = config.get('OIDC_ISSUER', { infer: true });
    this.audience = config.get('OIDC_AUDIENCE', { infer: true });
    // Nothing is fetched until the first token arrives, so the API boots while the identity
    // provider is down. Keys are cached; an unknown `kid` refetches them, which covers rotation.
    this.signingKeys = createRemoteJWKSet(new URL(config.get('OIDC_JWKS_URL', { infer: true })), {
      [customFetch]: fetchSigningKeys,
    });
  }

  /**
   * Throws `InvalidTokenError` for any token that fails a check, `IdentityProviderUnavailableError`
   * when the keys cannot be fetched. Anything else is a bug and is rethrown as is.
   */
  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.signingKeys, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ['sub', 'exp'],
      }));
    } catch (error) {
      throw this.classify(error);
    }
    return toVerifiedToken(payload);
  }

  private classify(error: unknown): unknown {
    if (error instanceof IdentityProviderUnavailableError || isUnusableKeySet(error)) {
      const unavailable =
        error instanceof IdentityProviderUnavailableError
          ? error
          : new IdentityProviderUnavailableError(error);
      this.logger.warn(`Cannot fetch signing keys: ${describe(unavailable.cause)}`);
      return unavailable;
    }
    if (error instanceof errors.JOSEError) {
      // The reason helps debugging; the client is never told which check failed.
      this.logger.debug(`Rejected access token: ${error.code}`);
      return new InvalidTokenError();
    }
    return error;
  }
}

/**
 * `fetch` for the key set, reporting a network failure or a non-200 answer as the identity
 * provider being unavailable. jose would surface them as a bare `TypeError` or a generic
 * `JOSEError`, indistinguishable from a bug or a bad token.
 */
const fetchSigningKeys: FetchImplementation = async (url, options) => {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new IdentityProviderUnavailableError(error);
  }
  if (response.status !== 200) {
    await response.body?.cancel(); // free the connection
    throw new IdentityProviderUnavailableError(new Error(`JWKS answered HTTP ${response.status}`));
  }
  return response;
};

/** A key set that arrived but cannot be used: not JSON (jose's bare `JOSEError`), or not a JWKS. */
function isUnusableKeySet(error: unknown): boolean {
  return (
    error instanceof errors.JWKSInvalid ||
    (error instanceof errors.JOSEError && error.code === errors.JOSEError.code)
  );
}

function toVerifiedToken(payload: JWTPayload): VerifiedToken {
  const { sub, exp } = payload;
  // `requiredClaims` checked presence; an empty subject identifies nobody.
  if (!sub || exp === undefined) throw new InvalidTokenError();
  return {
    user: {
      subject: sub,
      displayName: claimText(payload.name) ?? claimText(payload.preferred_username) ?? sub,
    },
    expiresAt: new Date(exp * 1000),
  };
}

function claimText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
