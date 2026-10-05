import type { Role } from '@occ/contracts';
import { create } from 'zustand';

export type SessionStatus =
  'signing-in' | 'signed-in' | 'signing-out' | 'insecure-context' | 'failed';

export interface SessionUser {
  displayName: string;
  /** The known roles in the current access token; empty means the user may do nothing. */
  roles: readonly Role[];
}

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Renewal failed: the operator must sign in again. Shown as a banner, never a forced redirect. */
  expired: boolean;

  signedIn(user: SessionUser): void;
  expire(): void;
  setStatus(status: Exclude<SessionStatus, 'signed-in'>): void;
}

/**
 * What the UI shows about the session. Written by `./session`; tokens never live here, they stay
 * in the OIDC client's in-memory store (ADR-0010). The roles are read from the token only to hide
 * actions the user cannot take; the API decides what is allowed (ADR-0011).
 */
export const useSession = create<SessionState>((set) => ({
  status: 'signing-in',
  user: null,
  expired: false,

  signedIn: (user) => set({ status: 'signed-in', user, expired: false }),
  expire: () => set({ expired: true }),
  setStatus: (status) => set({ status }),
}));
