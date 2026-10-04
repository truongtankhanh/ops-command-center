import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { IS_PUBLIC_KEY, type RequestWithUser } from './auth.decorators';
import {
  IdentityProviderUnavailableError,
  InvalidTokenError,
  TokenVerifier,
} from './token-verifier';

/** RFC 6750 challenge. `error="invalid_token"` is added when a token was sent but rejected. */
const CHALLENGE = 'Bearer realm="occ"';

/** `Bearer <token>`: the scheme is case-insensitive, the token a single RFC 6750 `b64token`. */
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i;

/**
 * Global guard (ADR-0010): every HTTP route needs a valid OIDC access token unless it is
 * `@Public()`. Guards run before pipes, so an unauthenticated request gets 401 even when its body
 * is also invalid.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    // `/events` authenticates in its handshake and has no message handlers. Should one ever be
    // added, it stays closed until it gets its own check.
    if (context.getType() !== 'http') return false;

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithUser>();
    const response = http.getResponse<Response>();
    const header = request.headers.authorization;
    if (header === undefined) throw missingToken(response);
    const token = BEARER.exec(header)?.[1];
    if (!token) throw rejectedToken(response);

    try {
      request.user = (await this.tokens.verify(token)).user;
    } catch (error) {
      if (error instanceof InvalidTokenError) throw rejectedToken(response);
      // Not the caller's fault: a 401 would send the console back to a sign-in that cannot help.
      if (error instanceof IdentityProviderUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
    return true;
  }
}

// The exception filter writes the body; the challenge header has to be on the response already.

function missingToken(response: Response): UnauthorizedException {
  response.setHeader('WWW-Authenticate', CHALLENGE);
  return new UnauthorizedException('Missing bearer token');
}

function rejectedToken(response: Response): UnauthorizedException {
  response.setHeader('WWW-Authenticate', `${CHALLENGE}, error="invalid_token"`);
  return new UnauthorizedException('Invalid access token');
}
