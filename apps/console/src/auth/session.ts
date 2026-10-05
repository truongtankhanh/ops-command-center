import { ROLES, type Role } from '@occ/contracts';
import {
  InMemoryWebStorage,
  UserManager,
  type UserProfile,
  WebStorageStateStore,
} from 'oidc-client-ts';
import { useSession } from './store';

/** Realm and public client from `ops/keycloak/occ-realm.json`, served on the console's own origin. */
const REALM_PATH = '/auth/realms/occ';
const CLIENT_ID = 'occ-console';

let manager: UserManager | undefined;
let started: Promise<void> | undefined;
let renewal: Promise<boolean> | undefined;

/** Built on first use, so importing this module has no side effect. */
function userManager(): UserManager {
  if (manager) return manager;
  const origin = window.location.origin;
  manager = new UserManager({
    authority: `${origin}${REALM_PATH}`,
    client_id: CLIENT_ID,
    redirect_uri: `${origin}/`,
    post_logout_redirect_uri: `${origin}/`,
    // ADR-0010: tokens in memory only. Both stores must be set, because the library's defaults
    // keep tokens in sessionStorage and the sign-in state in localStorage.
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    // The one-time PKCE verifier and state have to survive the redirect to Keycloak and back, so
    // they cannot live in memory; sessionStorage keeps them to this tab until the callback.
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // Every renewal goes through renewSession(): with refresh-token rotation, two concurrent
    // refreshes would spend the same token twice, and the second would end the session.
    automaticSilentRenew: false,
    monitorSession: false,
  });
  // Raised on sign-in and after every renewal, so the roles always match the current token.
  manager.events.addUserLoaded((user) =>
    useSession.getState().signedIn({
      displayName: displayName(user.profile),
      roles: realmRoles(user.access_token),
    }),
  );
  manager.events.addAccessTokenExpiring(() => void renewSession());
  return manager;
}

/** Same order as the API's `TokenVerifier`, so the console and the API name a user alike. */
function displayName(profile: UserProfile): string {
  return [profile.name, profile.preferred_username].find((name) => name?.trim()) ?? profile.sub;
}

/**
 * Same rule as the API's `TokenVerifier`: Keycloak's `realm_access.roles` from the access token
 * (the ID token does not carry it), reduced to the known roles. Anything unreadable means no
 * roles. The signature is not checked: the result only hides actions, the API decides (ADR-0011).
 */
function realmRoles(accessToken: string | undefined): Role[] {
  const payload = jwtPayload(accessToken);
  if (typeof payload !== 'object' || payload === null) return [];
  const realmAccess = (payload as { realm_access?: unknown }).realm_access;
  if (typeof realmAccess !== 'object' || realmAccess === null) return [];
  const { roles } = realmAccess as { roles?: unknown };
  if (!Array.isArray(roles)) return [];
  return ROLES.filter((role) => roles.includes(role));
}

/** The decoded payload of a JWT, or `undefined` when it is not one. */
function jwtPayload(token: string | undefined): unknown {
  const segments = token?.split('.');
  if (segments?.length !== 3) return undefined;
  try {
    const base64 = segments[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    // atob() yields one character per byte; the bytes are UTF-8 (a name may not be ASCII).
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * Signs in once per page load: finishes the redirect back from Keycloak, or starts one. Memoised,
 * so a second call (StrictMode, a re-render) cannot replay the single-use authorization code.
 */
export function startSession(): Promise<void> {
  started ??= signIn();
  return started;
}

async function signIn(): Promise<void> {
  // PKCE S256 needs crypto.subtle, which browsers only expose in a secure context.
  if (!window.isSecureContext) {
    useSession.getState().setStatus('insecure-context');
    return;
  }
  if (!isSigninResponse(new URLSearchParams(window.location.search))) return signInAgain();

  try {
    await userManager().signinRedirectCallback();
  } catch (error) {
    console.error('Sign-in failed', error);
    useSession.getState().setStatus('failed');
  } finally {
    // Whatever the outcome, a reload must never send a used code again.
    window.history.replaceState(null, '', window.location.pathname);
  }
}

function isSigninResponse(params: URLSearchParams): boolean {
  return (params.has('code') || params.has('error')) && params.has('state');
}

/** Leaves for Keycloak. With a live SSO session it comes straight back without a password. */
export async function signInAgain(): Promise<void> {
  try {
    await userManager().signinRedirect();
  } catch (error) {
    console.error('Sign-in failed', error);
    useSession.getState().setStatus('failed');
  }
}

/** The current access token, renewed first if it has expired; `null` when there is none. */
export async function getAccessToken(): Promise<string | null> {
  if (!manager) return null; // no session was started on this page
  if (renewal) await renewal;
  const user = await manager.getUser();
  if (!user) return null;
  if (user.expired && !(await renewSession())) return null;
  return (await manager.getUser())?.access_token ?? null;
}

/**
 * Refreshes the tokens. Every caller (the expiry timer, a REST 401, a refused socket) shares one
 * attempt. Resolves `false` instead of throwing, and flags the session as expired.
 */
export function renewSession(): Promise<boolean> {
  if (!manager) return Promise.resolve(false);
  renewal ??= refresh().finally(() => {
    renewal = undefined;
  });
  return renewal;
}

async function refresh(): Promise<boolean> {
  try {
    // With a refresh token in memory, this is a refresh-token grant: no iframe, no redirect.
    if (await userManager().signinSilent()) return true;
  } catch (error) {
    console.warn('Session renewal failed', error);
  }
  useSession.getState().expire();
  return false;
}

/** Ends the Keycloak session too, so the next operator at this workstation signs in afresh. */
export async function signOut(): Promise<void> {
  // Synchronously first: the console unmounts, closing its socket, before the page leaves.
  useSession.getState().setStatus('signing-out');
  try {
    await userManager().signoutRedirect();
  } catch (error) {
    console.error('Sign-out failed', error);
    useSession.getState().setStatus('failed');
  }
}
