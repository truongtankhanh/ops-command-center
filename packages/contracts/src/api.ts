import type { IncidentSeverity, IncidentStatus, IncidentType, LngLat } from './domain';

/** Request bodies and query shapes of the REST API (`/api`). */

export interface ListIncidentsQuery {
  status?: IncidentStatus[];
  severity?: IncidentSeverity[];
  limit?: number;
}

export interface ReportIncidentRequest {
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description?: string;
  zoneId: string;
  /** Must lie inside the zone's polygon or on its edge. Defaults to the zone center when omitted. */
  position?: LngLat;
}

/**
 * Optional request header on `POST /incidents`. Send the same value on every retry of one
 * submission: the API then creates the incident once and returns the first response again.
 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export interface TransitionIncidentRequest {
  note?: string;
}

/** How a client should render a camera. Resolved by the API through a CameraSource. */
export type StreamDescriptor =
  | { kind: 'mock'; cameraId: string; label: string; seed: number }
  | { kind: 'hls'; cameraId: string; label: string; url: string }
  | { kind: 'webrtc'; cameraId: string; label: string; url: string };

export interface ApiError {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}
