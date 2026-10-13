import { Injectable, Logger } from '@nestjs/common';
import { EventsConnectErrors, type EventsHandshakeAuth } from '@occ/contracts';
import {
  IdentityProviderUnavailableError,
  InvalidTokenError,
  TokenVerifier,
  type VerifiedToken,
} from '../auth/token-verifier';

/** Set by `SocketAuth.authenticate` on every socket that is let in. */
export type RealtimeSocketData = VerifiedToken;

/** What `authenticate` needs of a socket: a Socket.IO socket of any namespace fits. */
export interface HandshakeSocket {
  readonly handshake: { readonly auth: unknown };
  data: RealtimeSocketData;
}

/** What `closeAtExpiry` needs of a socket that has passed `authenticate`. */
export interface ExpirySocket {
  readonly id: string;
  readonly data: RealtimeSocketData;
  readonly conn: { close(): void };
}

/** `setTimeout` fires at once for longer delays; tokens never live that long anyway. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The socket handshake rules (ADR-0010, ADR-0011), shared by every namespace so that a security
 * control cannot drift between them (ADR-0019): the access token comes from `handshake.auth`, any
 * known role is let in, a refusal is one of `EventsConnectErrors`, and the transport is closed when
 * the token expires. A change here changes every namespace.
 */
@Injectable()
export class SocketAuth {
  private readonly logger = new Logger(SocketAuth.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly tokens: TokenVerifier) {}

  /** Rejects with the `Error` the client receives; its message is all the client sees. */
  async authenticate(socket: HandshakeSocket): Promise<void> {
    const { token } = socket.handshake.auth as Partial<EventsHandshakeAuth>;
    if (typeof token !== 'string') throw new Error(EventsConnectErrors.Unauthorized);
    let verified: VerifiedToken;
    try {
      verified = await this.tokens.verify(token);
    } catch (error) {
      if (error instanceof InvalidTokenError) throw new Error(EventsConnectErrors.Unauthorized);
      if (error instanceof IdentityProviderUnavailableError) {
        throw new Error(EventsConnectErrors.IdentityProviderUnavailable);
      }
      // A bug, not a client problem: log it here, because no exception filter sees the handshake.
      this.logger.error('Handshake authentication failed', (error as Error)?.stack);
      throw new Error('Internal server error');
    }
    // The roles stay those of this token until it expires and the connection is closed.
    if (verified.user.roles.length === 0) throw new Error(EventsConnectErrors.Forbidden);
    socket.data = verified;
  }

  /**
   * Call once the socket is connected, and `clearExpiry` when it disconnects. Closes the transport
   * rather than `disconnect()`, as `EventsGateway.onOutboxResynced` does: the client then
   * reconnects on its own, with a fresh token, and refetches once.
   */
  closeAtExpiry(socket: ExpirySocket): void {
    const delay = Math.min(socket.data.expiresAt.getTime() - Date.now(), MAX_TIMER_MS);
    const timer = setTimeout(() => socket.conn.close(), Math.max(delay, 0));
    timer.unref();
    this.expiryTimers.set(socket.id, timer);
  }

  clearExpiry(socket: Pick<ExpirySocket, 'id'>): void {
    clearTimeout(this.expiryTimers.get(socket.id));
    this.expiryTimers.delete(socket.id);
  }
}
