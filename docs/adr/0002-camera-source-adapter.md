# ADR-0002: Camera access behind a `CameraSource` adapter

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

In production, cameras are IP cameras speaking RTSP with ONVIF for discovery and control. Browsers cannot play RTSP, so a media server (MediaMTX) re-publishes streams as HLS or WebRTC. In development, in CI and in public demos there are no cameras at all — yet the console must still render camera tiles and the API must still answer "how do I show camera X?".

If the console or the API knew about RTSP URLs directly, every environment without real cameras would need special cases scattered through the code.

## Decision

Introduce a `CameraSource` port in `packages/camera-adapter`:

```ts
interface CameraSource {
  readonly kind: string;
  resolveStream(camera: CameraRef): Promise<StreamDescriptor>;
}
```

- `MockCameraSource` returns `{ kind: 'mock', label, seed }`; the console renders a synthetic animated feed.
- `MediaMtxCameraSource` (M2) maps a camera's RTSP path to MediaMTX's HLS/WebRTC endpoint.
- The API selects the implementation once, at startup, from `CAMERA_SOURCE`.
- The console renders by `StreamDescriptor.kind` and has no knowledge of where the stream comes from.

## Consequences

- Development, CI and demos run with zero camera infrastructure.
- Adding a vendor-specific source (e.g. a cloud VMS) is a new class, not a change to existing code.
- `StreamDescriptor` lives in `packages/contracts`, so a new stream kind is a compile error in the console until it is handled.
- Cost: one extra indirection for a feature that, in a single-vendor deployment, could be a URL template.
