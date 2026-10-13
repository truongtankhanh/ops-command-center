import { EventsConnectErrors, type Role } from '@occ/contracts';
import {
  IdentityProviderUnavailableError,
  InvalidTokenError,
  type TokenVerifier,
  type VerifiedToken,
} from '../auth/token-verifier';
import { type ExpirySocket, type HandshakeSocket, SocketAuth } from './socket-auth';

const NOW = Date.parse('2026-10-13T08:00:00.000Z');
/** The longest delay `setTimeout` honours; a longer one fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const verifiedFor = (expiresInMs: number, roles: Role[] = ['viewer']): VerifiedToken => ({
  user: { subject: 'user-1', displayName: 'Demo User', roles },
  expiresAt: new Date(NOW + expiresInMs),
});

/** A service over a fake verifier; the logger is silenced and returned so a test can read it. */
function authOver(verify: jest.Mock) {
  const auth = new SocketAuth({ verify } as unknown as TokenVerifier);
  const error = jest.spyOn(auth['logger'], 'error').mockImplementation(() => undefined);
  return { auth, error };
}

/** A socket as the handshake middleware sees it: `data` is not set until `authenticate` lets it in. */
const handshakeOf = (auth: unknown) =>
  ({ handshake: { auth }, data: undefined }) as unknown as HandshakeSocket;

/** A connected socket with a token that expires in `expiresInMs`; `close` is its transport. */
function connectedSocket(id: string, expiresInMs: number) {
  const close = jest.fn();
  const disconnect = jest.fn();
  const socket = {
    id,
    data: verifiedFor(expiresInMs),
    conn: { close },
    disconnect,
  } as unknown as ExpirySocket;
  return { socket, close, disconnect };
}

describe('SocketAuth.authenticate', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['no auth entries', {}],
    ['another key only', { jwt: 'abc' }],
    ['a null token', { token: null }],
    ['a number', { token: 123 }],
  ])('refuses %s as Unauthorized, without asking the verifier', async (_label, auth) => {
    const verify = jest.fn();
    const { auth: socketAuth } = authOver(verify);
    const socket = handshakeOf(auth);

    await expect(socketAuth.authenticate(socket)).rejects.toThrow(
      new Error(EventsConnectErrors.Unauthorized),
    );

    expect(verify).not.toHaveBeenCalled();
    expect(socket.data).toBeUndefined();
  });

  it('refuses a token the verifier rejects as Unauthorized', async () => {
    const { auth, error } = authOver(jest.fn().mockRejectedValue(new InvalidTokenError()));
    const socket = handshakeOf({ token: 'bad' });

    await expect(auth.authenticate(socket)).rejects.toThrow(
      new Error(EventsConnectErrors.Unauthorized),
    );

    expect(socket.data).toBeUndefined();
    expect(error).not.toHaveBeenCalled(); // a client problem, not a bug
  });

  it('answers Identity provider unavailable when signing keys cannot be fetched', async () => {
    const unavailable = new IdentityProviderUnavailableError(new Error('jwks unreachable'));
    const { auth, error } = authOver(jest.fn().mockRejectedValue(unavailable));
    const socket = handshakeOf({ token: 'any' });

    await expect(auth.authenticate(socket)).rejects.toThrow(
      new Error(EventsConnectErrors.IdentityProviderUnavailable),
    );

    expect(socket.data).toBeUndefined();
    expect(error).not.toHaveBeenCalled(); // `TokenVerifier` already logged it
  });

  it('refuses a verified user with no known role as Forbidden', async () => {
    const { auth } = authOver(jest.fn().mockResolvedValue(verifiedFor(60_000, [])));
    const socket = handshakeOf({ token: 'valid-but-roleless' });

    await expect(auth.authenticate(socket)).rejects.toThrow(
      new Error(EventsConnectErrors.Forbidden),
    );

    expect(socket.data).toBeUndefined();
  });

  it('logs an unexpected error with its stack and tells the client nothing about it', async () => {
    const bug = new TypeError('cannot read properties of undefined');
    const { auth, error } = authOver(jest.fn().mockRejectedValue(bug));
    const socket = handshakeOf({ token: 'any' });

    // Not the original message: the client only ever sees the generic one.
    await expect(auth.authenticate(socket)).rejects.toThrow(new Error('Internal server error'));

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Handshake authentication failed', bug.stack);
    expect(socket.data).toBeUndefined();
  });

  it('sets `data` to the verified token when the token is valid and has a role', async () => {
    const verified = verifiedFor(60_000, ['operator', 'viewer']);
    const verify = jest.fn().mockResolvedValue(verified);
    const { auth } = authOver(verify);
    const socket = handshakeOf({ token: 'a.b.c' });

    await expect(auth.authenticate(socket)).resolves.toBeUndefined();

    expect(verify).toHaveBeenCalledWith('a.b.c');
    expect(socket.data).toBe(verified);
  });
});

describe('SocketAuth.closeAtExpiry and clearExpiry', () => {
  let auth: SocketAuth;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    // A new service per test: its timer map is the state under test.
    auth = new SocketAuth({} as unknown as TokenVerifier);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('closes the transport at the token expiry and not before', () => {
    const { socket, close } = connectedSocket('a', 5_000);

    auth.closeAtExpiry(socket);
    jest.advanceTimersByTime(4_999);
    expect(close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the transport, never `disconnect()`, so the client reconnects by itself', () => {
    const { socket, close, disconnect } = connectedSocket('a', 1_000);

    auth.closeAtExpiry(socket);
    jest.advanceTimersByTime(1_000);

    expect(close).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('closes at once a socket whose token expired while the handshake was running', () => {
    const { socket, close } = connectedSocket('a', -5_000);

    auth.closeAtExpiry(socket);
    jest.advanceTimersByTime(0);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('schedules the remaining lifetime of the token, clamped to what setTimeout honours', () => {
    const delays: unknown[] = [];
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((_fn: unknown, delay?: number) => {
      delays.push(delay);
      return { unref: jest.fn() };
    }) as unknown as typeof setTimeout);
    const thirtyDays = 30 * 24 * 60 * 60 * 1_000;

    auth.closeAtExpiry(connectedSocket('short', 5_000).socket);
    auth.closeAtExpiry(connectedSocket('expired', -5_000).socket);
    // A longer delay would make `setTimeout` fire at once, closing a healthy connection.
    auth.closeAtExpiry(connectedSocket('long', thirtyDays).socket);

    expect(delays).toEqual([5_000, 0, MAX_TIMER_MS]);
  });

  it('does not let the timer keep the process alive', () => {
    const unref = jest.fn();
    jest
      .spyOn(globalThis, 'setTimeout')
      .mockReturnValue({ unref } as unknown as ReturnType<typeof setTimeout>);

    auth.closeAtExpiry(connectedSocket('a', 5_000).socket);

    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('does not close a socket whose timer was cleared on disconnect', () => {
    const { socket, close } = connectedSocket('a', 5_000);

    auth.closeAtExpiry(socket);
    auth.clearExpiry(socket);
    jest.advanceTimersByTime(10_000);

    expect(close).not.toHaveBeenCalled();
  });

  it('keeps one socket timer independent of another socket sharing the service', () => {
    const first = connectedSocket('first', 5_000);
    const second = connectedSocket('second', 5_000);

    auth.closeAtExpiry(first.socket);
    auth.closeAtExpiry(second.socket);
    auth.clearExpiry(first.socket);
    jest.advanceTimersByTime(5_000);

    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('ignores a socket it never saw', () => {
    expect(() => auth.clearExpiry({ id: 'never-connected' })).not.toThrow();
  });
});
