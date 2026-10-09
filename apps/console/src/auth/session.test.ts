import type * as Session from './session';
import type { useSession as UseSession } from './store';

// A stand-in for oidc-client-ts: records how the session module configures and drives it.
const oidc = vi.hoisted(() => {
  const asyncMock = (value?: unknown) =>
    vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve(value));

  class InMemoryWebStorage {}

  class WebStorageStateStore {
    constructor(readonly options: { store: unknown }) {}
  }

  class FakeUserManager {
    static instances: FakeUserManager[] = [];
    /** Runs on construction, so a case can script a manager the module has not built yet. */
    static onCreate: ((manager: FakeUserManager) => void) | undefined;

    userLoaded: ((user: unknown) => void) | undefined;
    tokenExpiring: (() => void) | undefined;
    readonly events = {
      addUserLoaded: (callback: (user: unknown) => void) => {
        this.userLoaded = callback;
      },
      addAccessTokenExpiring: (callback: () => void) => {
        this.tokenExpiring = callback;
      },
    };
    signinRedirect = asyncMock();
    signinRedirectCallback = asyncMock({});
    signinSilent = asyncMock(null);
    getUser = asyncMock(null);
    signoutRedirect = asyncMock();

    constructor(readonly settings: Record<string, unknown>) {
      FakeUserManager.instances.push(this);
      FakeUserManager.onCreate?.(this);
    }
  }

  return { InMemoryWebStorage, WebStorageStateStore, FakeUserManager };
});

vi.mock('oidc-client-ts', () => ({
  InMemoryWebStorage: oidc.InMemoryWebStorage,
  WebStorageStateStore: oidc.WebStorageStateStore,
  UserManager: oidc.FakeUserManager,
}));

type FakeUserManager = InstanceType<typeof oidc.FakeUserManager>;

/**
 * Fresh copies of the session module and its store: the module keeps its manager, its sign-in
 * and its renewal in module scope, so every case starts from a clean import.
 */
async function load(
  url = '/',
): Promise<{ session: typeof Session; useSession: typeof UseSession }> {
  window.history.replaceState(null, '', url);
  vi.resetModules();
  const session = await import('./session');
  const { useSession } = await import('./store');
  return { session, useSession };
}

/** A page that has started signing in (redirect pending), with the manager it built. */
async function loadStarted() {
  const loaded = await load('/');
  await loaded.session.startSession();
  return { ...loaded, manager: lastManager() };
}

function lastManager(): FakeUserManager {
  const manager = oidc.FakeUserManager.instances.at(-1);
  if (!manager) throw new Error('No UserManager was built');
  return manager;
}

function storeOf(stateStore: unknown): unknown {
  return (stateStore as InstanceType<typeof oidc.WebStorageStateStore>).options.store;
}

/** `Promise.withResolvers` is ES2024; the console targets ES2023. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

function setSecureContext(secure: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
}

/** Base64url without padding, as in a JWT. */
function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** An unsigned access token: the console reads its claims but never checks the signature. */
function accessToken(claims: object): string {
  return `${base64url('{"alg":"none"}')}.${base64url(JSON.stringify(claims))}.sig`;
}

const PROFILE = { sub: 'user-1', name: 'Demo Operator' };

describe('session', () => {
  beforeEach(() => {
    oidc.FakeUserManager.instances.length = 0;
    oidc.FakeUserManager.onCreate = undefined;
    setSecureContext(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'isSecureContext');
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  describe('startSession', () => {
    it('keeps tokens in memory and only the sign-in state in sessionStorage', async () => {
      const { session } = await load('/');
      await session.startSession();

      expect(oidc.FakeUserManager.instances).toHaveLength(1);
      const { settings } = lastManager();
      const origin = window.location.origin;
      expect(settings).toMatchObject({
        authority: `${origin}/auth/realms/occ`,
        client_id: 'occ-console',
        redirect_uri: `${origin}/`,
        post_logout_redirect_uri: `${origin}/`,
        automaticSilentRenew: false,
        monitorSession: false,
      });
      expect(storeOf(settings.userStore)).toBeInstanceOf(oidc.InMemoryWebStorage);
      expect(storeOf(settings.stateStore)).toBe(window.sessionStorage);
    });

    it('redirects to sign in when the page is not a sign-in response', async () => {
      const { session, useSession } = await load('/');
      await session.startSession();

      expect(lastManager().signinRedirect).toHaveBeenCalledTimes(1);
      expect(useSession.getState().status).toBe('signing-in');
    });

    it('signs in only once per page load', async () => {
      const { session } = await load('/');

      const first = session.startSession();
      const second = session.startSession();
      await first;

      expect(second).toBe(first);
      expect(lastManager().signinRedirect).toHaveBeenCalledTimes(1);
    });

    it('completes a sign-in response and removes the code from the address', async () => {
      const { session } = await load('/?code=c&state=s');
      await session.startSession();

      const manager = lastManager();
      expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
      expect(manager.signinRedirect).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe('/');
      expect(window.location.search).toBe('');
    });

    it('still removes the code from the address when the sign-in response is rejected', async () => {
      oidc.FakeUserManager.onCreate = (manager) =>
        manager.signinRedirectCallback.mockRejectedValue(new Error('invalid_grant'));
      const { session, useSession } = await load('/?code=c&state=s');

      await session.startSession();

      expect(useSession.getState().status).toBe('failed');
      expect(console.error).toHaveBeenCalled();
      expect(window.location.search).toBe('');
    });

    it('treats an error returned by Keycloak as a failed sign-in', async () => {
      oidc.FakeUserManager.onCreate = (manager) =>
        manager.signinRedirectCallback.mockRejectedValue(new Error('access_denied'));
      const { session, useSession } = await load('/?error=access_denied&state=s');

      await session.startSession();

      const manager = lastManager();
      expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
      expect(manager.signinRedirect).not.toHaveBeenCalled();
      expect(useSession.getState().status).toBe('failed');
      expect(window.location.search).toBe('');
    });

    it('does not start a sign-in outside a secure context', async () => {
      setSecureContext(false);
      const { session, useSession } = await load('/');

      await session.startSession();

      expect(useSession.getState().status).toBe('insecure-context');
      expect(oidc.FakeUserManager.instances).toHaveLength(0);
    });

    it('treats a sign-out return as not signed in', async () => {
      // Keycloak comes back from sign-out with ?state= only: that is not a sign-in response.
      const { session } = await load('/?state=s');
      await session.startSession();

      const manager = lastManager();
      expect(manager.signinRedirect).toHaveBeenCalledTimes(1);
      expect(manager.signinRedirectCallback).not.toHaveBeenCalled();
    });
  });

  describe('signInAgain', () => {
    it('shows the sign-in as failed when Keycloak cannot be reached', async () => {
      const { session, useSession, manager } = await loadStarted();
      manager.signinRedirect.mockRejectedValueOnce(new Error('Failed to fetch'));

      await session.signInAgain();

      expect(useSession.getState().status).toBe('failed');
    });
  });

  describe('user events', () => {
    it('marks the session signed in, with the user name, and clears an expired flag', async () => {
      const { useSession, manager } = await loadStarted();
      useSession.getState().expire();

      manager.userLoaded!({ profile: { sub: 'user-1', name: 'Demo Operator' } });

      expect(useSession.getState()).toMatchObject({
        status: 'signed-in',
        user: { displayName: 'Demo Operator' },
        expired: false,
      });
    });

    it.each([
      {
        label: 'the username when the name is blank',
        profile: { sub: 'user-1', name: '  ', preferred_username: 'operator' },
        displayName: 'operator',
      },
      {
        label: 'the subject when nothing else is set',
        profile: { sub: 'user-1' },
        displayName: 'user-1',
      },
    ])('names the user by $label', async ({ profile, displayName }) => {
      const { useSession, manager } = await loadStarted();

      manager.userLoaded!({ profile });

      expect(useSession.getState().user).toEqual({ displayName, roles: [] });
    });

    it('reads the known realm roles from the access token', async () => {
      const { useSession, manager } = await loadStarted();
      const roles = ['viewer', 'default-roles-occ', 'operator', 'operator'];

      manager.userLoaded!({
        profile: PROFILE,
        access_token: accessToken({ realm_access: { roles } }),
      });

      // Known roles only, in the API's order, once each.
      expect(useSession.getState().user).toEqual({
        displayName: 'Demo Operator',
        roles: ['operator', 'viewer'],
      });
    });

    it('reads the technician role (ADR-0021)', async () => {
      const { useSession, manager } = await loadStarted();

      manager.userLoaded!({
        profile: PROFILE,
        access_token: accessToken({ realm_access: { roles: ['technician', 'default-roles-occ'] } }),
      });

      expect(useSession.getState().user).toEqual({
        displayName: 'Demo Operator',
        roles: ['technician'],
      });
    });

    it.each([
      { label: 'the access token is missing', token: undefined },
      { label: 'the token is not a JWT', token: 'opaque-token' },
      { label: 'the payload is not base64', token: 'a.%%%.c' },
      { label: 'the payload is not JSON', token: `a.${base64url('not json')}.c` },
      { label: 'realm_access is missing', token: accessToken({}) },
      { label: 'realm_access is null', token: accessToken({ realm_access: null }) },
      { label: 'realm_access is a string', token: accessToken({ realm_access: 'operator' }) },
      {
        label: 'roles is not an array',
        token: accessToken({ realm_access: { roles: 'operator' } }),
      },
    ])('signs in with no roles when $label', async ({ token }) => {
      const { useSession, manager } = await loadStarted();

      expect(() => manager.userLoaded!({ profile: PROFILE, access_token: token })).not.toThrow();

      expect(useSession.getState()).toMatchObject({ status: 'signed-in', user: { roles: [] } });
    });

    it('decodes a base64url payload', async () => {
      const { useSession, manager } = await loadStarted();
      const token = accessToken({
        realm_access: { roles: ['operator'] },
        name: 'Nguyễn Văn A',
        note: '???>>>',
      });
      // These claims encode to `-` and `_`, which atob() rejects unless they are translated.
      expect(token.split('.')[1]).toMatch(/[-_]/);

      manager.userLoaded!({ profile: PROFILE, access_token: token });

      expect(useSession.getState().user?.roles).toEqual(['operator']);
    });

    it('follows the roles of the latest token', async () => {
      const { useSession, manager } = await loadStarted();
      manager.userLoaded!({
        profile: PROFILE,
        access_token: accessToken({ realm_access: { roles: ['operator'] } }),
      });

      // A renewal raises the same event with the new token.
      manager.userLoaded!({
        profile: PROFILE,
        access_token: accessToken({ realm_access: { roles: ['viewer'] } }),
      });

      expect(useSession.getState().user?.roles).toEqual(['viewer']);
    });

    it('keeps the roles, never the token, in the session store', async () => {
      const { useSession, manager } = await loadStarted();
      const token = accessToken({ realm_access: { roles: ['operator'] } });

      manager.userLoaded!({ profile: PROFILE, access_token: token });

      expect(useSession.getState().user?.roles).toEqual(['operator']);
      expect(JSON.stringify(useSession.getState())).not.toContain(token.split('.')[1]);
    });

    it('renews the session when the access token is about to expire', async () => {
      const { session, manager } = await loadStarted();

      manager.tokenExpiring!();
      await session.renewSession();

      expect(manager.signinSilent).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAccessToken', () => {
    it('has no token before a session was started', async () => {
      const { session } = await load('/');

      await expect(session.getAccessToken()).resolves.toBeNull();
      expect(oidc.FakeUserManager.instances).toHaveLength(0);
    });

    it('returns the current access token', async () => {
      const { session, manager } = await loadStarted();
      manager.getUser.mockResolvedValue({ access_token: 'token-1', expired: false });

      await expect(session.getAccessToken()).resolves.toBe('token-1');
    });

    it('has no token when no user is signed in', async () => {
      const { session } = await loadStarted();

      await expect(session.getAccessToken()).resolves.toBeNull();
    });

    it('renews an expired token before returning it', async () => {
      const { session, manager } = await loadStarted();
      manager.getUser
        .mockResolvedValueOnce({ access_token: 'expired', expired: true })
        .mockResolvedValueOnce({ access_token: 'fresh', expired: false });
      manager.signinSilent.mockResolvedValue({});

      await expect(session.getAccessToken()).resolves.toBe('fresh');
      expect(manager.signinSilent).toHaveBeenCalledTimes(1);
    });

    it('has no token when an expired one cannot be renewed', async () => {
      const { session, useSession, manager } = await loadStarted();
      manager.getUser.mockResolvedValue({ access_token: 'expired', expired: true });
      manager.signinSilent.mockRejectedValue(new Error('invalid_grant'));

      await expect(session.getAccessToken()).resolves.toBeNull();
      expect(useSession.getState().expired).toBe(true);
    });

    it('waits for a renewal in progress', async () => {
      const { session, manager } = await loadStarted();
      const silent = deferred<unknown>();
      manager.signinSilent.mockReturnValue(silent.promise);
      manager.getUser.mockResolvedValue({ access_token: 'fresh', expired: false });

      const renewal = session.renewSession();
      const token = session.getAccessToken();
      await settle();
      expect(manager.getUser).not.toHaveBeenCalled();

      silent.resolve({});
      await expect(token).resolves.toBe('fresh');
      await renewal;
    });
  });

  describe('renewSession', () => {
    it('does nothing before a session was started', async () => {
      const { session, useSession } = await load('/');

      await expect(session.renewSession()).resolves.toBe(false);
      expect(oidc.FakeUserManager.instances).toHaveLength(0);
      expect(useSession.getState().expired).toBe(false);
    });

    it('shares one refresh between concurrent callers', async () => {
      const { session, manager } = await loadStarted();
      const silent = deferred<unknown>();
      manager.signinSilent.mockReturnValue(silent.promise);

      const first = session.renewSession();
      const second = session.renewSession();
      silent.resolve({});

      expect(second).toBe(first);
      await expect(first).resolves.toBe(true);
      expect(manager.signinSilent).toHaveBeenCalledTimes(1);
    });

    it('flags the session as expired when no user comes back', async () => {
      const { session, useSession } = await loadStarted();

      await expect(session.renewSession()).resolves.toBe(false);
      expect(useSession.getState().expired).toBe(true);
    });

    it('resolves false instead of throwing when the refresh fails', async () => {
      const { session, useSession, manager } = await loadStarted();
      manager.signinSilent.mockRejectedValue(new Error('invalid_grant'));

      await expect(session.renewSession()).resolves.toBe(false);
      expect(useSession.getState().expired).toBe(true);
      expect(console.warn).toHaveBeenCalled();
    });

    it('starts a new refresh once the previous one has settled', async () => {
      const { session, manager } = await loadStarted();

      await session.renewSession();
      await session.renewSession();

      expect(manager.signinSilent).toHaveBeenCalledTimes(2);
    });
  });

  describe('signOut', () => {
    it('leaves the console at once, then ends the Keycloak session', async () => {
      const { session, useSession, manager } = await loadStarted();

      const signingOut = session.signOut();

      expect(useSession.getState().status).toBe('signing-out');
      await signingOut;
      expect(manager.signoutRedirect).toHaveBeenCalledTimes(1);
    });

    it('shows a failure when the sign-out redirect fails', async () => {
      const { session, useSession, manager } = await loadStarted();
      manager.signoutRedirect.mockRejectedValueOnce(new Error('Failed to fetch'));

      await session.signOut();

      expect(useSession.getState().status).toBe('failed');
    });
  });
});
