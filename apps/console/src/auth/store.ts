import { create } from 'zustand';

export type SessionStatus =
  'signing-in' | 'signed-in' | 'signing-out' | 'insecure-context' | 'failed';

export interface SessionUser {
  displayName: string;
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
 * in the OIDC client's in-memory store (ADR-0010).
 */
export const useSession = create<SessionState>((set) => ({
  status: 'signing-in',
  user: null,
  expired: false,

  signedIn: (user) => set({ status: 'signed-in', user, expired: false }),
  expire: () => set({ expired: true }),
  setStatus: (status) => set({ status }),
}));
