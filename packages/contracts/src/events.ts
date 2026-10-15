import type { Incident, TelemetryValue } from './domain';

/** Socket.IO namespace that streams live updates to clients. */
export const EVENTS_NAMESPACE = '/events';

export const IncidentEvents = {
  Created: 'incident.created',
  Updated: 'incident.updated',
} as const;

/**
 * Server → client event map. Used to type both the gateway and the client socket,
 * so renaming an event or changing a payload is a compile error on both sides.
 */
export interface ServerToClientEvents {
  [IncidentEvents.Created]: (incident: Incident) => void;
  [IncidentEvents.Updated]: (incident: Incident) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientToServerEvents {}

/**
 * Handshake payload for `/events` and `/telemetry`: `io(url, { auth })`. A connection without a
 * valid access token is refused. Pass `auth` as a function, `(cb) => cb({ token })`, so every
 * reconnect sends the current token: the server closes a connection when its token expires, and
 * the client reconnects.
 */
export interface EventsHandshakeAuth {
  token: string;
}

/** `connect_error` messages for a refused handshake, so a client can tell them apart. */
export const EventsConnectErrors = {
  /** No token, or one the API does not accept: sign in again. */
  Unauthorized: 'Unauthorized',
  /** The API cannot check tokens right now: retry, signing in again will not help. */
  IdentityProviderUnavailable: 'Identity provider unavailable',
  /** Signed in, but no role grants access: signing in again will not help. */
  Forbidden: 'Forbidden',
} as const;

/**
 * Socket.IO namespace that streams asset readings (ADR-0019). Delivery is best-effort and
 * latest-wins, unlike `/events`. The handshake is the same: `EventsHandshakeAuth` and
 * `EventsConnectErrors`.
 */
export const TELEMETRY_NAMESPACE = '/telemetry';

/** `Watch` is sent by the client; the other four are sent by the server. */
export const TelemetryEvents = {
  Overview: 'telemetry.overview',
  Frames: 'telemetry.frames',
  Snapshot: 'telemetry.snapshot',
  Status: 'telemetry.status',
  Watch: 'telemetry.watch',
} as const;

/** The most assets one socket can watch at once. The one place the limit is written. */
export const TELEMETRY_WATCH_LIMIT = 4;

/**
 * The new readings of one watched asset, at most 10 times a second, carried in a
 * `TelemetryFrames` batch (`telemetry.frames`). Best-effort: a console that cannot keep up skips
 * the batch, and the next frame or the overview corrects it.
 */
export interface TelemetryFrame {
  /** The asset's code: `CT-01`. */
  assetCode: string;
  /** ISO time the device measured the values. */
  at: string;
  /** ISO time this API received them. A client judges freshness from it (ADR-0019). */
  receivedAt: string;
  /** Changed keys only: a key that is absent is unchanged, not `null`. */
  values: Record<string, TelemetryValue>;
}

/**
 * What a socket receives on `telemetry.frames`: the frames of every asset it watches that changed
 * in one 100 ms tick, in a single volatile emit. A socket gets one packet per tick, never one per
 * asset, because Socket.IO discards a volatile packet while the transport is still sending the
 * previous one (ADR-0019). At most `TELEMETRY_WATCH_LIMIT` entries, one per asset. Best-effort: a
 * console that cannot keep up skips the whole batch, and the next one or the overview corrects it.
 */
export interface TelemetryFrames {
  frames: TelemetryFrame[];
}

/** One asset's entry in `TelemetryOverview`. */
export interface TelemetryAssetOverview {
  /** Whether the device is online, from its status topic: `false` once its last will fired. */
  online: boolean;
  /** ISO time the API received the asset's latest reading. */
  receivedAt: string;
  /** The current values of the asset's headline points, by point key. */
  headline: Record<string, TelemetryValue>;
}

/**
 * Where every asset stands, every second (`telemetry.overview`). Best-effort, like
 * `TelemetryFrames`.
 */
export interface TelemetryOverview {
  /** ISO time the overview was built. */
  at: string;
  /**
   * Keyed by asset code. An asset this replica holds no reading of yet is absent: a client reads
   * it as "no data".
   */
  assets: Record<string, TelemetryAssetOverview>;
}

/** One asset's entry in `TelemetrySnapshot`. */
export interface TelemetryAssetSnapshot {
  /** Whether the device is online, as in `TelemetryAssetOverview`. */
  online: boolean;
  /** ISO time the API received the asset's latest reading. */
  receivedAt: string;
  /** The asset's latest value of every key received so far. */
  values: Record<string, TelemetryValue>;
}

/**
 * Sent after connect, with every asset, and after each `telemetry.watch` change, with the newly
 * watched assets only (`telemetry.snapshot`). Always delivered. A client replaces the `values` of
 * each asset listed and leaves every other asset alone.
 */
export interface TelemetrySnapshot {
  /** ISO time the snapshot was built. */
  at: string;
  /** Keyed by asset code. An asset with no reading yet is absent, as in `TelemetryOverview`. */
  assets: Record<string, TelemetryAssetSnapshot>;
}

/**
 * Whether this replica's connection to its telemetry source is up (`telemetry.status`). It says
 * nothing about the console's own socket: a client shows "Telemetry paused" for `paused`.
 * Always delivered.
 */
export interface TelemetryStatus {
  upstream: 'live' | 'paused';
  /** ISO time `upstream` last changed. */
  since: string;
}

/**
 * `telemetry.watch`: the assets a console wants every reading of, up to 10 times a second. The
 * set replaces the previous one. The server checks it against the catalogue and ignores a code it
 * does not know.
 */
export interface TelemetryWatchRequest {
  /** Asset codes, at most `TELEMETRY_WATCH_LIMIT`. */
  assets: string[];
}

/** The reply to `telemetry.watch`. */
export interface TelemetryWatchAck {
  /** The codes of the request that the server accepted. */
  accepted: string[];
}

/** Server → client event map of `/telemetry`, as `ServerToClientEvents` is for `/events`. */
export interface TelemetryServerToClientEvents {
  [TelemetryEvents.Overview]: (overview: TelemetryOverview) => void;
  [TelemetryEvents.Frames]: (batch: TelemetryFrames) => void;
  [TelemetryEvents.Snapshot]: (snapshot: TelemetrySnapshot) => void;
  [TelemetryEvents.Status]: (status: TelemetryStatus) => void;
}

/**
 * Client → server event map of `/telemetry`, the first in the system: `/events` stays
 * broadcast-only. The acknowledgement carries the codes the server accepted.
 */
export interface TelemetryClientToServerEvents {
  [TelemetryEvents.Watch]: (
    request: TelemetryWatchRequest,
    ack: (response: TelemetryWatchAck) => void,
  ) => void;
}
