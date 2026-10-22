import type { LngLat } from './geo';

/** What a camera sees: a circular sector from its `position`. */
export interface CameraFieldOfView {
  /** Direction of the view's centre line, in degrees clockwise from true north: 0 ≤ heading < 360. */
  heading: number;
  /** Width of the view in degrees: 0 < angle ≤ 360. */
  angle: number;
  /** How far the camera sees, in metres: > 0. */
  range: number;
}

export interface Camera {
  id: string;
  code: string;
  name: string;
  zoneId: string;
  position: LngLat;
  online: boolean;
  /** `null` when the camera's orientation is not known; clients then draw no view. */
  fieldOfView: CameraFieldOfView | null;
}
