import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@occ/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from './token-verifier';

export const IS_PUBLIC_KEY = 'auth:public';

/**
 * Exempts a controller or handler from the global bearer-token check (ADR-0010). Everything else
 * is authenticated by default, so each use should say why the route must be open.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRED_PERMISSION_KEY = 'auth:permission';

/**
 * The permission a handler needs, checked by `RolesGuard` against `ROLE_PERMISSIONS` (ADR-0011).
 * A route without it is open to any user with a known role, so only reads should omit it.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);

/** A request as `AuthGuard` leaves it: `user` is set on every route that is not `@Public()`. */
export type RequestWithUser = Request & { user?: AuthenticatedUser };

/** The user `AuthGuard` authenticated for this request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const { user } = ctx.switchToHttp().getRequest<RequestWithUser>();
    // Only reachable on a `@Public()` route, where nobody is authenticated: a wiring bug.
    if (!user) throw new Error('@CurrentUser() needs a route that AuthGuard authenticates');
    return user;
  },
);
