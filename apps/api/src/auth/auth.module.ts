import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { TokenVerifier } from './token-verifier';

/**
 * Authentication and authorization for the whole API (ADR-0010, ADR-0011). Both guards are
 * global, so a new route is protected without anyone remembering to add a guard. Global guards
 * run in the order they are listed: `AuthGuard` (who, 401) before `RolesGuard` (may they, 403).
 * `TokenVerifier` is exported for the `/events` handshake.
 */
@Module({
  providers: [
    TokenVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenVerifier],
})
export class AuthModule {}
