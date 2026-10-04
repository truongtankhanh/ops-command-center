import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { TokenVerifier } from './token-verifier';

/**
 * Authentication for the whole API (ADR-0010). `AuthGuard` is registered globally, so a new route
 * is protected without anyone remembering to add a guard. `TokenVerifier` is exported for the
 * `/events` handshake.
 */
@Module({
  providers: [TokenVerifier, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokenVerifier],
})
export class AuthModule {}
